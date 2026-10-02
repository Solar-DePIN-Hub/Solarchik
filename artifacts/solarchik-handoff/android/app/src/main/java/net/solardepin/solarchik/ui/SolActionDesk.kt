package net.solardepin.solarchik.ui

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.agents.FlowOutcome
import net.solardepin.solarchik.agents.MwaSigner
import net.solardepin.solarchik.agents.OwnedAgent
import net.solardepin.solarchik.agents.StrategyApi
import net.solardepin.solarchik.agents.StrategyCard
import net.solardepin.solarchik.agents.StrategyFlows
import net.solardepin.solarchik.agents.StrategyRules
import net.solardepin.solarchik.agents.engine.Track
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.sol.ActAgent
import net.solardepin.solarchik.sol.ActContext
import net.solardepin.solarchik.sol.ActListing
import net.solardepin.solarchik.sol.ActType
import net.solardepin.solarchik.sol.ActionPlan
import net.solardepin.solarchik.wallet.WalletError

/** Result line of a confirmed action; [link] is a devnet Explorer URL when a transaction landed. */
data class ActResult(val ok: Boolean, val text: String, val link: String = "")

/**
 * Sol's hands (0.21.7): builds what Sol may act on (my agents, the market) and runs a CONFIRMED
 * [ActionPlan] through the same devnet flows as the Agents tab: [StrategyFlows] (wallet proof + server
 * co-signed txs), [net.solardepin.solarchik.agents.Minter] and the on-phone desk.
 */
class SolActionDesk(
    private val host: MainActivity,
    private val api: suspend (String, JsonObject) -> JsonObject = { r, b -> StrategyApi.post(r, b) },
) {
    private val ctx get() = host
    private var cache: Pair<Long, ActContext>? = null

    fun invalidate() { cache = null }

    suspend fun context(): ActContext {
        cache?.takeIf { System.currentTimeMillis() - it.first < CACHE_MS }?.let { return it.second }
        val w = host.wallet
        val desk = host.desk.state()
        val agents = mutableListOf<ActAgent>()
        if (w.connected && w.clusterName == "devnet") {
            for (a in host.store.agentsFor(w.address, "devnet").filter { it.status != OwnedAgent.STATUS_MISSING }) {
                val info = runCatching { api("strategy-info", buildJsonObject { put("asset", a.asset) }) }.getOrNull()
                val card = info?.takeIf { StrategyApi.ok(it) }?.let { StrategyCard.parse(it) }
                val run = desk.run(a.asset)
                agents += ActAgent(
                    id = a.asset, name = card?.name?.ifBlank { null } ?: a.name, running = run?.running == true,
                    strategyNft = card?.hasChain == true && card.spec != null, spec = card?.spec, listed = card?.listed == true,
                    unlockSec = card?.unlockSec ?: 0, trades = run?.let { it.wins + it.losses } ?: card?.perf?.trades,
                    pnlSol = run?.pnl ?: card?.perf?.realizedSol, skuId = a.skuId, tier = a.tier, track = Track.DEVNET,
                    aprSince = card?.perf?.aprSince,
                )
            }
        }
        for (sku in Catalog.skus) {
            val key = "paper:${sku.id}"
            val run = desk.run(key)
            agents += ActAgent(
                id = key, name = AgentNames.display(ctx, sku.name), running = run?.running == true, trades = run?.let { it.wins + it.losses },
                pnlSol = run?.pnl, skuId = sku.id, tier = sku.tierFor(AgentTier.FREE), track = Track.PAPER,
            )
        }
        val market = runCatching { StrategyCard.parseMarket(api("market-list", JsonObject(emptyMap()))) }.getOrDefault(emptyList())
            .filter { it.priceLamports != null && !(w.connected && it.owner == w.address) }
            .map { ActListing(it.asset, it.name, it.priceLamports ?: 0, it.spec) }
        val freeSku = Catalog.skus.firstOrNull { !it.paidOnly }
        val canMint = freeSku != null && !w.mainnet && host.minter.canMint(freeSku, AgentTier.FREE) == null
        return ActContext(agents, market, canMint).also { cache = System.currentTimeMillis() to it }
    }

    fun riskLabel(r: String): String = when (r) {
        "calm" -> ctx.getString(R.string.sol_risk_calm)
        "balanced" -> ctx.getString(R.string.sol_risk_balanced)
        "risky" -> ctx.getString(R.string.sol_risk_risky)
        else -> r
    }

    /** "how is my agent doing": answered at once from the desk and the on-chain results. */
    fun status(a: ActAgent): String {
        val state = ctx.getString(if (a.running) R.string.sol_status_running else R.string.sol_status_stopped)
        var s = ctx.getString(R.string.sol_status_line, a.name, state, a.trades ?: 0, Fmt.signedSol(a.pnlSol ?: 0.0, 6))
        if (a.strategyNft) {
            val apr = a.aprSince?.let { "${Fmt.sol(it, 1)}%" } ?: "—"
            s += " " + ctx.getString(R.string.sol_status_strategy, riskLabel(a.risk), a.windows.joinToString("/").ifBlank { "—" }, apr)
            StrategyRules.lockParts(StrategyRules.lockLeftMs(a.unlockSec, System.currentTimeMillis()))?.let { (d, h) ->
                s += " " + ctx.getString(R.string.sm_lock_left, d, h)
            }
        }
        return s
    }

    private fun failText(o: FlowOutcome): String = ctx.getString(R.string.sol_act_failed, o.error?.let { WalletError.text(ctx, it) } ?: o.reason)

    /** Runs a plan the player CONFIRMED. Never called without the tap (see SolScreen.confirm). */
    suspend fun execute(plan: ActionPlan): ActResult {
        val w = host.wallet
        val a = plan.agent
        val result = when (plan.action.type) {
            ActType.BUY_STRATEGY -> {
                val l = plan.listing ?: return ActResult(false, ctx.getString(R.string.sol_act_blocked_gone))
                if (!w.connected || w.clusterName != "devnet") return ActResult(false, ctx.getString(R.string.sm_need_devnet))
                val o = StrategyFlows(MwaSigner(w, host.sender)).buy(w.address, l.id, l.priceLamports)
                if (o.ok) {
                    StrategyPanel.rememberBought(host, l.id, l.name, w.address, o.sig)
                    ActResult(true, ctx.getString(R.string.sol_act_bought, l.name, Fmt.sol(l.priceSol)), StrategyRules.explorerTx(o.sig))
                } else ActResult(false, failText(o), o.sig.takeIf { it.isNotBlank() }?.let(StrategyRules::explorerTx).orEmpty())
            }
            ActType.SET_STRATEGY -> {
                val next = plan.nextSpec
                if (a == null || next == null) return ActResult(false, ctx.getString(R.string.sol_act_blocked_no_nft))
                if (!w.connected || w.clusterName != "devnet") return ActResult(false, ctx.getString(R.string.sm_need_devnet))
                val o = StrategyFlows(MwaSigner(w, host.sender)).changeStrategy(w.address, a.id, next)
                if (o.ok) ActResult(true, ctx.getString(R.string.sol_act_strategy_done, a.name, o.version, StrategyRules.SALE_LOCK_HOURS), StrategyRules.explorerTx(o.sig))
                else ActResult(false, failText(o), o.sig.takeIf { it.isNotBlank() }?.let(StrategyRules::explorerTx).orEmpty())
            }
            ActType.MINT_FREE -> {
                val sku = Catalog.skus.first { !it.paidOnly }
                host.minter.mint(host.sender, sku, AgentTier.FREE).fold(
                    onSuccess = { rec -> ActResult(true, ctx.getString(R.string.sol_act_minted, AgentNames.display(ctx, rec.name)), rec.sig.takeIf { it.isNotBlank() }?.let { host.explorerTx(it, rec.cluster) }.orEmpty()) },
                    onFailure = { ActResult(false, ctx.getString(R.string.sol_act_failed, host.errorText(it))) },
                )
            }
            ActType.START_AGENT -> {
                if (a == null) return ActResult(false, ctx.getString(R.string.sol_act_unclear))
                host.desk.start(a.id, a.skuId, a.tier, a.name, a.track).fold(
                    onSuccess = {
                        host.deskChanged()
                        ActResult(true, ctx.getString(R.string.sol_act_started, a.name, ctx.getString(if (a.track == Track.PAPER) R.string.track_paper else R.string.track_devnet)))
                    },
                    onFailure = { ActResult(false, ctx.getString(R.string.sol_act_failed, if (it is net.solardepin.solarchik.agents.engine.DeskError) ctx.getString(R.string.desk_not_owned) else host.errorText(it))) },
                )
            }
            ActType.STOP_AGENT -> {
                if (a == null) return ActResult(false, ctx.getString(R.string.sol_act_unclear))
                host.desk.stop(a.id)
                host.deskChanged()
                ActResult(true, ctx.getString(R.string.sol_act_stopped, a.name))
            }
            ActType.AGENT_STATUS -> ActResult(true, a?.let(::status) ?: ctx.getString(R.string.sol_act_unclear))
        }
        invalidate()
        return result
    }

    companion object {
        private const val CACHE_MS = 45_000L
    }
}
