package net.solardepin.solarchik.wallet

import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import net.solardepin.solarchik.agents.StrategyApi
import net.solardepin.solarchik.agents.StrategyRules

/**
 * Free devnet SOL for the built-in wallet (0.21.9): the public devnet airdrop first, then the Solarchik
 * server faucet (POST /api/native/faucet-drip, 0.2 SOL, rate-limited, FAUCET_SECRET stays on the server;
 * the app only signs a proof message with the wallet key). Waits until the balance shows up.
 */
object LocalFunding {
    data class Funded(val sig: String, val via: String)

    @Volatile var last: Funded? = null
        private set

    suspend fun fund(wallet: SolanaWallet, minLamports: Long): Result<String> = runCatching {
        check(!wallet.mainnet) { "devnet only" }
        val addr = wallet.address
        require(addr.isNotBlank()) { "no wallet" }
        val rpc = wallet.rpc
        val before = runCatching { rpc.balanceLamports(addr) }.getOrDefault(0L)
        if (before >= minLamports) return@runCatching ""
        var sig = ""
        val air = runCatching { rpc.requestAirdrop(addr, 1_000_000_000L) }
        if (air.isSuccess) {
            sig = air.getOrThrow(); last = Funded(sig, "airdrop")
        } else {
            val kp = LocalKey.keypair(wallet.app()) ?: error("Built-in wallet key is unavailable")
            val ts = System.currentTimeMillis()
            val msg = StrategyRules.proofMessage("faucet", addr, ts, "devnet")
            val proof = StrategyApi.proof(addr, ts, Base58.encode(kp.sign(msg.encodeToByteArray())))
            val r = StrategyApi.post("faucet-drip", buildJsonObject { put("proof", proof) })
            if (!StrategyApi.ok(r)) throw FaucetRefused(StrategyApi.reason(r))
            sig = (r["sig"] as? JsonPrimitive)?.content.orEmpty()
            last = Funded(sig, (r["via"] as? JsonPrimitive)?.content ?: "faucet")
        }
        repeat(30) {
            if (runCatching { rpc.balanceLamports(addr) }.getOrDefault(0L) > before) return@runCatching sig
            delay(1000)
        }
        sig
    }

    class FaucetRefused(reason: String) : Exception(reason)
}
