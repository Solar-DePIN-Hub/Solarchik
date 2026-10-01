package net.solardepin.solarchik.agents

import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.delay
import net.solardepin.solarchik.core.AgentSku
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.solana.CoreIx
import net.solardepin.solarchik.solana.Ix
import net.solardepin.solarchik.solana.LegacyTx
import net.solardepin.solarchik.solana.SystemIx
import net.solardepin.solarchik.wallet.SolanaWallet
import org.sol4k.Keypair
import org.sol4k.PublicKey

class MintError(val kind: Kind, detail: String = "") : Exception(detail.ifBlank { kind.name }) {
    enum class Kind { FREE_USED, PRO_MAINNET_OFF, TOO_BIG }
}

/** Builds and sends Metaplex Core strategy NFT mints through MWA. */
class Minter(private val wallet: SolanaWallet, private val store: AgentStore) {

    fun canMint(sku: AgentSku, tier: String): MintError.Kind? {
        if (tier == AgentTier.PRO && wallet.mainnet && !SolarchikConfig.MAINNET_PAID_MINT) return MintError.Kind.PRO_MAINNET_OFF
        if (tier == AgentTier.FREE && wallet.connected && store.freeClaimed(wallet.address, wallet.clusterName)) return MintError.Kind.FREE_USED
        return null
    }

    suspend fun mint(sender: ActivityResultSender, sku: AgentSku, tier: String): Result<OwnedAgent> {
        canMint(sku, tier)?.let { return Result.failure(MintError(it)) }
        if (!wallet.connected) {
            wallet.connect(sender).onFailure { return Result.failure(it) }
            canMint(sku, tier)?.let { return Result.failure(MintError(it)) }
        }
        val asset = Keypair.generate()
        val sent = wallet.signAndSend(sender) { payer, blockhash ->
            if (tier == AgentTier.FREE && store.freeClaimed(payer.toBase58(), wallet.clusterName)) throw MintError(MintError.Kind.FREE_USED)
            buildMintTx(payer, blockhash, sku, tier, asset)
        }
        return sent.map { tx ->
            val rec = OwnedAgent(
                asset = asset.publicKey.toBase58(),
                skuId = sku.skuId(tier),
                tier = tier,
                name = sku.nameFor(tier),
                owner = tx.address,
                cluster = tx.cluster,
                sig = tx.signature,
                mintedAt = System.currentTimeMillis(),
            )
            store.upsert(rec)
            rec
        }
    }

    /** Polls the chain until the asset account exists and belongs to the owner. */
    suspend fun verify(agent: OwnedAgent, attempts: Int = 10): OwnedAgent {
        var current = agent
        repeat(attempts) { i ->
            current = checkOnce(current)
            if (current.status != OwnedAgent.STATUS_PENDING) return current
            delay(if (i < 3) 1500L else 3000L)
        }
        return current
    }

    suspend fun checkOnce(agent: OwnedAgent): OwnedAgent {
        val rpc = wallet.rpc
        val info = runCatching { rpc.accountInfo(agent.asset) }.getOrElse { return agent }
        val now = System.currentTimeMillis()
        val next = if (info != null && info.owner == SolarchikConfig.MPL_CORE_PROGRAM &&
            CoreIx.ownerOf(info.data)?.toBase58() == agent.owner
        ) {
            agent.copy(status = OwnedAgent.STATUS_VERIFIED, checkedAt = now)
        } else {
            val failed = agent.sig.isNotBlank() && runCatching { rpc.signatureStatus(agent.sig) }.getOrNull() == "failed"
            val stale = now - agent.mintedAt > 3 * 60_000L
            if (failed || (info != null && agent.status == OwnedAgent.STATUS_VERIFIED) || (info == null && stale)) {
                agent.copy(status = OwnedAgent.STATUS_MISSING, checkedAt = now)
            } else agent.copy(checkedAt = now)
        }
        if (next != agent) store.upsert(next)
        return next
    }

    /** Re-checks local records and, when the RPC has DAS, picks up agents minted elsewhere (web). */
    suspend fun refresh(): List<OwnedAgent> {
        val owner = wallet.address
        if (owner.isBlank()) return emptyList()
        val cluster = wallet.clusterName
        runCatching { wallet.rpc.dasAssetsByOwner(owner) }.getOrNull()?.forEach { (id, name) ->
            val hit = Catalog.fromName(name) ?: return@forEach
            if (store.agents().none { it.asset == id }) {
                store.upsert(OwnedAgent(id, hit.first.skuId(hit.second), hit.second, name, owner, cluster, status = OwnedAgent.STATUS_VERIFIED))
            }
        }
        return store.agentsFor(owner, cluster).map { if (it.status == OwnedAgent.STATUS_MISSING) it else checkOnce(it) }
    }

    companion object {
        /**
         * PRO: SOL transfer to the treasury, then Core CreateV1 in the same tx.
         * FREE: CreateV1 only. Both carry the 5% Royalties plugin.
         * The asset keypair partially signs; the wallet signs the fee payer slot.
         */
        fun buildMintTx(payer: PublicKey, blockhash: ByteArray, sku: AgentSku, tier: String, asset: Keypair): LegacyTx {
            val ixs = ArrayList<Ix>()
            val (offerTier, price) = Catalog.offerFor(sku.skuId(tier))
            if (offerTier == AgentTier.PRO && price > 0) {
                ixs += SystemIx.transfer(payer, PublicKey(SolarchikConfig.TREASURY), SolarchikConfig.lamports(price))
            }
            val feeBps = Math.round(Catalog.feeRateFor(offerTier) * 10_000).toInt()
            ixs += CoreIx.createV1(
                asset = asset.publicKey,
                payer = payer,
                name = sku.nameFor(offerTier),
                uri = SolarchikConfig.AGENT_URI,
                plugins = CoreIx.agentPlugins(sku.skuId(offerTier), offerTier, sku.agentClass.id, sku.agentClass.role, feeBps, sku.lanes),
            )
            val tx = LegacyTx.compile(payer, blockhash, ixs).partialSign(asset)
            if (tx.serialize().size > LegacyTx.MAX_SIZE) throw MintError(MintError.Kind.TOO_BIG)
            return tx
        }
    }
}
