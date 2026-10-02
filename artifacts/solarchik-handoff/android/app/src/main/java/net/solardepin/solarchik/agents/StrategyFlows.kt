package net.solardepin.solarchik.agents

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Who signs a strategy/market action. On the phone it is the MWA wallet ([MwaSigner]); the opt-in
 * devnet test signs with a throwaway keypair, so the chat → confirm → chain path is the same code.
 */
interface ChainSigner {
    /** Detached signature of [message]: (address, base58 signature). */
    suspend fun signText(message: String): Result<Pair<String, String>>

    /** Sign the server-built, server co-signed [txs] as owner/payer, send them in order, return the last signature. */
    suspend fun signAndSend(txs: List<ByteArray>): Result<String>
}

/** The phone's wallet behind [ChainSigner]. */
class MwaSigner(
    private val wallet: net.solardepin.solarchik.wallet.SolanaWallet,
    private val sender: com.solana.mobilewalletadapter.clientlib.ActivityResultSender,
) : ChainSigner {
    override suspend fun signText(message: String): Result<Pair<String, String>> = wallet.signText(sender, message).map { it.address to it.signature }
    override suspend fun signAndSend(txs: List<ByteArray>): Result<String> = wallet.signServerTxs(sender, txs)
}

/**
 * Outcome of one devnet flow. [error] carries a wallet failure for the localized line;
 * [reason] is the server's own (already localized with lang=en|uk) refusal.
 */
data class FlowOutcome(
    val ok: Boolean,
    val sig: String = "",
    val reason: String = "",
    val error: Throwable? = null,
    val version: Int = 0,
    val unlockSec: Long = 0,
)

/**
 * The strategy/market flows shared by the Strategy panel and Sol's confirmed actions:
 * proof (signMessage) → server builds and co-signs → wallet signs and sends → server confirms.
 */
class StrategyFlows(
    private val signer: ChainSigner,
    private val api: suspend (String, JsonObject) -> JsonObject = { r, b -> StrategyApi.post(r, b) },
    private val confirmDelayMs: Long = 2000,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private suspend fun proof(action: String, extra: (String) -> String, wallet: String): Result<JsonObject> {
        val ts = clock()
        return signer.signText(StrategyRules.proofMessage(action, wallet, ts, extra(wallet))).map { (addr, sig) -> StrategyApi.proof(addr, ts, sig) }
    }

    private suspend fun confirm(route: String, body: JsonObject): JsonObject {
        var last = buildJsonObject { put("ok", false); put("reason", "…") }
        repeat(8) {
            last = api(route, body)
            if (StrategyApi.ok(last)) return last
            kotlinx.coroutines.delay(confirmDelayMs)
        }
        return last
    }

    /** Buy a listed Strategy NFT at the listed price (the proof pins the price, so a re-price cannot charge more). */
    suspend fun buy(wallet: String, asset: String, priceLamports: Long): FlowOutcome {
        val pr = proof("market", { "buy:$asset:$priceLamports" }, wallet).getOrElse { return FlowOutcome(false, error = it) }
        val prep = api("market-prepare-buy", buildJsonObject { put("proof", pr); put("asset", asset); put("priceLamports", priceLamports) })
        if (!StrategyApi.ok(prep)) return FlowOutcome(false, reason = StrategyApi.reason(prep))
        val sig = signer.signAndSend(StrategyApi.txs(prep)).getOrElse { return FlowOutcome(false, error = it) }
        val conf = confirm("market-confirm-buy", buildJsonObject { put("asset", asset); put("sig", sig) })
        return if (StrategyApi.ok(conf)) FlowOutcome(true, sig = sig) else FlowOutcome(false, sig = sig, reason = StrategyApi.reason(conf))
    }

    /** Write a new strategy version on chain. Every change locks sale for [StrategyRules.SALE_LOCK_HOURS]. */
    suspend fun changeStrategy(wallet: String, asset: String, spec: JsonObject): FlowOutcome {
        val v = api("strategy-validate", buildJsonObject { put("spec", spec) })
        if (!StrategyApi.ok(v)) return FlowOutcome(false, reason = StrategyApi.reason(v))
        val hash = (v["hash"] as JsonPrimitive).content
        val clean = v["spec"] as JsonObject
        val pr = proof("strategy", { "$asset:$hash" }, wallet).getOrElse { return FlowOutcome(false, error = it) }
        val prep = api("strategy-prepare", buildJsonObject { put("proof", pr); put("asset", asset); put("spec", clean) })
        if (!StrategyApi.ok(prep)) return FlowOutcome(false, reason = StrategyApi.reason(prep))
        val sig = signer.signAndSend(StrategyApi.txs(prep)).getOrElse { return FlowOutcome(false, error = it) }
        val version = (prep["version"] as JsonPrimitive).content.toInt()
        val unlock = (prep["unlockSec"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0L
        val conf = confirm("strategy-confirm", buildJsonObject { put("asset", asset); put("version", version); put("sig", sig) })
        return if (StrategyApi.ok(conf)) FlowOutcome(true, sig = sig, version = version, unlockSec = unlock)
        else FlowOutcome(false, sig = sig, reason = StrategyApi.reason(conf), version = version)
    }
}
