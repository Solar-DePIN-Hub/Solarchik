package net.solardepin.solarchik.ui

import android.text.InputType
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import net.solardepin.solarchik.wallet.WalletError
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.agents.StrategyApi
import net.solardepin.solarchik.agents.StrategyCard
import net.solardepin.solarchik.agents.StrategyRules
import net.solardepin.solarchik.ui.Ui.dp

/**
 * Strategy NFT market + editor on Android (devnet only). Same server routes as the web;
 * every card links to Solana Explorer (devnet) and can recompute its APR on the phone.
 */
class StrategyPanel(private val host: MainActivity, private val onChange: () -> Unit) {
    private val ctx get() = host
    private var market: List<StrategyCard>? = null
    private val mine = mutableMapOf<String, StrategyCard>()
    private val checks = mutableMapOf<String, String>()
    private var status = ""
    private var busy = false
    private var loadedFor = ""

    private fun say(msg: String) {
        status = msg
        onChange()
    }

    fun load(force: Boolean = false) {
        val w = host.wallet
        val key = if (w.connected) w.address else "-"
        if (!force && loadedFor == key && market != null) return
        loadedFor = key
        host.scope.launch {
            market = runCatching { StrategyCard.parseMarket(StrategyApi.post("market-list", JsonObject(emptyMap()))) }.getOrDefault(emptyList())
            mine.clear()
            if (w.connected && w.clusterName == "devnet") {
                for (a in host.store.agentsFor(w.address, "devnet")) {
                    val r = runCatching { StrategyApi.post("strategy-info", buildJsonObject { put("asset", a.asset) }) }.getOrNull() ?: continue
                    if (StrategyApi.ok(r)) mine[a.asset] = StrategyCard.parse(r)
                }
            }
            onChange()
        }
    }

    fun render(box: LinearLayout) {
        box.removeAllViews()
        box.addView(judgeCard())
        if (status.isNotBlank()) box.addView(Ui.card(ctx, pad = 12).apply { addView(Ui.body(ctx, status)) })
        box.addView(Ui.top(Ui.h2(ctx, ctx.getString(R.string.sm_market)), 6))
        box.addView(Ui.muted(ctx, ctx.getString(R.string.sm_market_hint), 12f))
        val m = market
        when {
            m == null -> box.addView(Ui.muted(ctx, ctx.getString(R.string.sm_loading)))
            m.isEmpty() -> box.addView(Ui.card(ctx, pad = 14).apply { addView(Ui.muted(ctx, ctx.getString(R.string.sm_empty, StrategyRules.SALE_LOCK_HOURS))) })
            else -> m.forEach { box.addView(card(it, listing = true)) }
        }
        box.addView(Ui.top(Ui.h2(ctx, ctx.getString(R.string.sm_mine)), 10))
        if (mine.isEmpty()) box.addView(Ui.muted(ctx, ctx.getString(R.string.sm_mine_empty), 12f))
        mine.values.forEach { box.addView(card(it, listing = false)) }
        box.addView(Ui.button(ctx, ctx.getString(R.string.sm_refresh), Ui.Btn.GHOST) { load(force = true) })
    }

    private fun judgeCard(): View = Ui.card(ctx, accent = Ui.CYAN, pad = 14).apply {
        addView(Ui.text(ctx, ctx.getString(R.string.sm_judge_title), 15f, Ui.TEXT, 800))
        addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.sm_judge_body), 12f), 4))
        addView(Ui.top(Ui.button(ctx, ctx.getString(R.string.sm_get_sol)) { getSol() }, 8))
    }

    private fun link(label: String, url: String): View = Ui.text(ctx, label, 13f, Ui.CYAN, 700).apply {
        isClickable = true
        setPadding(0, dp(6), 0, dp(6))
        setOnClickListener { host.openUrl(url) }
    }

    private fun pct(v: Double?) = v?.let { "${Fmt.sol(it, 1)}%" } ?: "—"

    private fun card(c: StrategyCard, listing: Boolean): View = Ui.card(ctx, pad = 14).apply {
        val head = Ui.row(ctx, gap = 8)
        head.addView(Ui.weight(Ui.text(ctx, c.name.ifBlank { Fmt.short(c.asset) }, 15f, Ui.TEXT, 800)))
        c.priceLamports?.let { head.addView(Ui.text(ctx, Fmt.sol(it / 1e9) + " SOL", 15f, Ui.GOLD, 800)) }
        addView(head)
        if (c.hasChain) {
            addView(Ui.top(Ui.muted(ctx, "v${c.version} · ${c.summary}", 12f), 4))
            addView(Ui.muted(ctx, ctx.getString(if (c.hashOk) R.string.sm_hash_ok else R.string.sm_hash_bad, Fmt.short(c.hash)), 12f))
        }
        val p = c.perf
        addView(Ui.top(Ui.body(ctx, ctx.getString(R.string.sm_perf, pct(p?.aprSince), pct(p?.apr7), pct(p?.apr30), p?.trades ?: 0, Fmt.sol(p?.realizedSol ?: 0.0, 5))), 4))
        addView(Ui.muted(ctx, ctx.getString(R.string.sm_simulated), 11f))
        if (c.hasChain) {
            val left = StrategyRules.lockLeftMs(c.unlockSec, System.currentTimeMillis())
            val lock = StrategyRules.lockParts(left)
            addView(Ui.muted(ctx, if (lock == null) ctx.getString(R.string.sm_lock_open) else ctx.getString(R.string.sm_lock_left, lock.first, lock.second), 12f))
        }
        addView(link(ctx.getString(R.string.sm_explorer_asset), StrategyRules.explorerAddress(c.asset)))
        addView(link(ctx.getString(R.string.sm_explorer_attrs), StrategyRules.coreExplorer(c.asset)))
        c.perfSig?.let { addView(link(ctx.getString(R.string.sm_tx_perf, Fmt.short(it)), StrategyRules.explorerTx(it))) }
        c.versionSigs.takeLast(3).forEach { addView(link(ctx.getString(R.string.sm_tx_version, Fmt.short(it)), StrategyRules.explorerTx(it))) }
        c.saleSigs.takeLast(3).forEach { addView(link(ctx.getString(R.string.sm_tx_sale, Fmt.short(it)), StrategyRules.explorerTx(it))) }
        c.feeSigs.takeLast(5).forEach { addView(link(ctx.getString(R.string.sm_tx_fee, Fmt.short(it)), StrategyRules.explorerTx(it))) }
        checks[c.asset]?.let { addView(Ui.top(Ui.body(ctx, it), 4)) }
        val row = Ui.row(ctx, gap = 8)
        row.addView(Ui.weight(Ui.button(ctx, ctx.getString(R.string.sm_verify), Ui.Btn.GHOST) { verify(c) }))
        if (listing) {
            val mineListing = host.wallet.connected && host.wallet.address == c.owner
            val buy = Ui.button(ctx, ctx.getString(if (mineListing) R.string.sm_yours else R.string.sm_buy)) { buy(c) }
            Ui.setEnabled(buy, !mineListing && !busy)
            row.addView(Ui.weight(buy))
        }
        addView(Ui.top(row, 8))
        if (!listing) addView(editor(c))
    }

    private fun verify(c: StrategyCard) {
        val p = c.perf
        checks[c.asset] = if (!c.hasChain || p == null || p.writtenSec == 0L) ctx.getString(R.string.sm_verify_none)
        else {
            val r = StrategyRules.verify(c.trades, c.changedSec, p)
            val base = ctx.getString(if (r.ok) R.string.sm_verify_ok else R.string.sm_verify_bad, r.recomputed.trades, pct(r.recomputed.aprSince), pct(r.recomputed.apr7), pct(r.recomputed.apr30))
            base + (if (r.mismatches.isNotEmpty()) " " + r.mismatches.joinToString("; ") else "") + (if (r.newer > 0) " " + ctx.getString(R.string.sm_verify_newer, r.newer) else "")
        }
        onChange()
    }

    private fun field(hint: String, value: String, decimal: Boolean = true): EditText = EditText(ctx).apply {
        this.hint = hint
        setText(value)
        textSize = 14f
        setTextColor(Ui.TEXT)
        setHintTextColor(Ui.MUTED)
        inputType = if (decimal) InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL else InputType.TYPE_CLASS_TEXT
    }

    private fun num(s: EditText) = s.text.toString().replace(',', '.').toDoubleOrNull()

    private fun editor(c: StrategyCard): View = Ui.column(ctx, gap = 6).apply {
        val spec = c.spec
        fun d(k: String, def: Double) = (spec?.get(k) as? JsonPrimitive)?.content?.toDoubleOrNull() ?: def
        val risks = listOf("calm", "balanced", "risky")
        var risk = risks.indexOf((spec?.get("risk") as? JsonPrimitive)?.content ?: "balanced").coerceAtLeast(0)
        addView(Ui.top(Ui.label(ctx, ctx.getString(R.string.sm_editor)), 8))
        val seg = LinearLayout(ctx)
        fun drawSeg() {
            seg.removeAllViews()
            seg.addView(Ui.segmented(ctx, listOf(ctx.getString(R.string.sm_risk_calm), ctx.getString(R.string.sm_risk_balanced), ctx.getString(R.string.sm_risk_risky)), risk) { risk = it; drawSeg() }, LinearLayout.LayoutParams(-1, -2))
        }
        drawSeg()
        addView(seg)
        val stake = field(ctx.getString(R.string.sm_stake), Fmt.sol(d("stakeSol", 0.01)))
        val stop = field(ctx.getString(R.string.sm_stop), d("stopPct", 50.0).toLong().toString())
        val take = field(ctx.getString(R.string.sm_take), d("takePct", 100.0).toLong().toString())
        val rules = field(ctx.getString(R.string.sm_rules), (spec?.get("rules") as? JsonPrimitive)?.content.orEmpty(), decimal = false)
        listOf(stake, stop, take, rules).forEach { addView(it) }
        val save = Ui.button(ctx, ctx.getString(R.string.sm_save)) {
            val next = buildJsonObject {
                spec?.forEach { (k, v) -> put(k, v) }
                put("risk", risks[risk])
                num(stake)?.let { put("stakeSol", it) }
                num(stop)?.let { put("stopPct", it.toLong()) }
                num(take)?.let { put("takePct", it.toLong()) }
                put("rules", rules.text.toString().trim())
            }
            saveStrategy(c, next)
        }
        Ui.setEnabled(save, !busy && !c.listed)
        addView(save)
        if (c.listed) {
            addView(Ui.button(ctx, ctx.getString(R.string.sm_unlist), Ui.Btn.GHOST) { unlist(c) })
        } else {
            val price = field(ctx.getString(R.string.sm_price), "0.05")
            addView(price)
            val locked = StrategyRules.lockLeftMs(c.unlockSec, System.currentTimeMillis()) > 0
            val list = Ui.button(ctx, ctx.getString(R.string.sm_list), Ui.Btn.GHOST) { num(price)?.let { list(c, it) } }
            Ui.setEnabled(list, !busy && c.hasChain && !locked)
            addView(list)
        }
    }

    /* ---------------- actions: proof (signMessage) → server builds → wallet signs → server confirms ---------------- */

    private suspend fun proof(action: String, extra: String): JsonObject? {
        val w = host.wallet
        val ts = System.currentTimeMillis()
        val signed = w.signText(host.sender, StrategyRules.proofMessage(action, w.address, ts, extra)).getOrElse {
            say(WalletError.text(ctx, it))
            return null
        }
        return StrategyApi.proof(signed.address, ts, signed.signature)
    }

    private fun act(work: suspend () -> String) {
        if (busy) return
        val w = host.wallet
        if (!w.connected || w.clusterName != "devnet") {
            say(ctx.getString(R.string.sm_need_devnet))
            return
        }
        busy = true
        say(ctx.getString(R.string.sm_working))
        host.scope.launch {
            val msg = runCatching { work() }.getOrElse { WalletError.text(ctx, it) }
            busy = false
            say(msg)
            load(force = true)
        }
    }

    private suspend fun confirm(route: String, body: JsonObject): JsonObject {
        var last = buildJsonObject { put("ok", false); put("reason", "…") }
        repeat(6) {
            last = StrategyApi.post(route, body)
            if (StrategyApi.ok(last)) return last
            kotlinx.coroutines.delay(2000)
        }
        return last
    }

    private fun saveStrategy(c: StrategyCard, spec: JsonObject) = act {
        val v = StrategyApi.post("strategy-validate", buildJsonObject { put("spec", spec) })
        if (!StrategyApi.ok(v)) return@act StrategyApi.reason(v)
        val hash = (v["hash"] as JsonPrimitive).content
        val clean = v["spec"] as JsonObject
        val pr = proof("strategy", "${c.asset}:$hash") ?: return@act status
        val prep = StrategyApi.post("strategy-prepare", buildJsonObject { put("proof", pr); put("asset", c.asset); put("spec", clean) })
        if (!StrategyApi.ok(prep)) return@act StrategyApi.reason(prep)
        val sig = host.wallet.signServerTxs(host.sender, StrategyApi.txs(prep)).getOrElse { return@act WalletError.text(ctx, it) }
        val version = (prep["version"] as JsonPrimitive).content.toInt()
        val conf = confirm("strategy-confirm", buildJsonObject { put("asset", c.asset); put("version", version); put("sig", sig) })
        if (StrategyApi.ok(conf)) ctx.getString(R.string.sm_saved, Fmt.short(sig), StrategyRules.SALE_LOCK_HOURS) else StrategyApi.reason(conf)
    }

    private fun list(c: StrategyCard, priceSol: Double) = act {
        val lamports = Math.round(priceSol * 1e9)
        val pr = proof("market", "list:${c.asset}:$lamports") ?: return@act status
        val prep = StrategyApi.post("market-prepare-list", buildJsonObject { put("proof", pr); put("asset", c.asset); put("priceLamports", lamports) })
        if (!StrategyApi.ok(prep)) return@act StrategyApi.reason(prep)
        val sig = host.wallet.signServerTxs(host.sender, StrategyApi.txs(prep)).getOrElse { return@act WalletError.text(ctx, it) }
        val conf = confirm("market-confirm-list", buildJsonObject { put("asset", c.asset) })
        if (StrategyApi.ok(conf)) ctx.getString(R.string.sm_listed, Fmt.short(sig)) else StrategyApi.reason(conf)
    }

    private fun unlist(c: StrategyCard) = act {
        val pr = proof("market", "unlist:${c.asset}") ?: return@act status
        val r = StrategyApi.post("market-unlist", buildJsonObject { put("proof", pr); put("asset", c.asset) })
        if (StrategyApi.ok(r)) ctx.getString(R.string.sm_unlisted) else StrategyApi.reason(r)
    }

    private fun buy(c: StrategyCard) = act {
        val price = c.priceLamports ?: return@act "no price"
        val pr = proof("market", "buy:${c.asset}:$price") ?: return@act status
        val prep = StrategyApi.post("market-prepare-buy", buildJsonObject { put("proof", pr); put("asset", c.asset); put("priceLamports", price) })
        if (!StrategyApi.ok(prep)) return@act StrategyApi.reason(prep)
        val sig = host.wallet.signServerTxs(host.sender, StrategyApi.txs(prep)).getOrElse { return@act WalletError.text(ctx, it) }
        val conf = confirm("market-confirm-buy", buildJsonObject { put("asset", c.asset); put("sig", sig) })
        if (!StrategyApi.ok(conf)) return@act StrategyApi.reason(conf)
        val w = host.wallet
        host.store.upsert(
            net.solardepin.solarchik.agents.OwnedAgent(
                asset = c.asset, skuId = "strategy-nft", tier = "pro", name = c.name, owner = w.address, cluster = "devnet",
                sig = sig, mintedAt = System.currentTimeMillis(), status = net.solardepin.solarchik.agents.OwnedAgent.STATUS_VERIFIED,
            ),
        )
        ctx.getString(R.string.sm_bought, Fmt.short(sig))
    }

    /** Judge onboarding: public devnet airdrop first, then the server's rate-limited faucet. */
    private fun getSol() = act {
        val w = host.wallet
        val air = w.airdrop()
        if (air.isSuccess) return@act ctx.getString(R.string.sm_airdrop_ok, Fmt.short(air.getOrThrow()))
        val pr = proof("faucet", "devnet") ?: return@act status
        val r = StrategyApi.post("faucet-drip", buildJsonObject { put("proof", pr) })
        if (StrategyApi.ok(r)) ctx.getString(R.string.sm_faucet_ok, Fmt.short((r["sig"] as JsonPrimitive).content))
        else ctx.getString(R.string.sm_faucet_bad, StrategyApi.reason(r))
    }
}
