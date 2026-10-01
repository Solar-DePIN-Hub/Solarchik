package net.solardepin.solarchik.ui

import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.launch
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.agents.MintError
import net.solardepin.solarchik.agents.OwnedAgent
import net.solardepin.solarchik.core.AgentSku
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.core.FeeLedger
import net.solardepin.solarchik.core.FeeReason
import net.solardepin.solarchik.core.FeeRow
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.ui.Ui.dp

class AgentsScreen(host: MainActivity) : Screen(host) {
    private var tier = AgentTier.FREE
    private var busySku: String? = null
    private var balance: Double? = null
    private var refreshed = false

    private lateinit var walletPill: TextView
    private lateinit var clusterLabel: TextView
    private lateinit var segFree: TextView
    private lateinit var segPro: TextView
    private lateinit var tierLine: TextView
    private lateinit var catalogBox: LinearLayout
    private lateinit var mineBox: LinearLayout
    private lateinit var ledgerBox: LinearLayout

    override fun build(): View = page {
        val head = Ui.row(ctx)
        clusterLabel = Ui.label(ctx, "", Ui.CYAN)
        head.addView(Ui.weight(clusterLabel))
        walletPill = Ui.pill(ctx, "", Ui.GOLD, icon = R.drawable.ic_wallet).apply { setOnClickListener { onWalletPill() } }
        head.addView(walletPill)
        addView(head)
        addView(Ui.display(ctx, ctx.getString(R.string.agents_title), 24f))
        addView(Ui.muted(ctx, ctx.getString(R.string.agents_sub), 14f))

        // Tier switch
        val seg = Ui.row(ctx).apply {
            background = Ui.rounded(Ui.SURFACE, dp(18).toFloat(), Ui.STROKE, dp(1))
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        segFree = segment(ctx.getString(R.string.tier_free)) { tier = AgentTier.FREE; tierPicked = true; render() }
        segPro = segment(ctx.getString(R.string.tier_pro)) { tier = AgentTier.PRO; tierPicked = true; render() }
        seg.addView(segFree, LinearLayout.LayoutParams(0, dp(44), 1f))
        seg.addView(segPro, LinearLayout.LayoutParams(0, dp(44), 1f))
        addView(seg)
        tierLine = Ui.text(ctx, "", 13f, Ui.TEXT, 700)
        addView(Ui.column(ctx).apply {
            addView(tierLine)
            addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.tier_royalty), 12f), 4))
        })

        catalogBox = Ui.column(ctx, gap = 14)
        addView(catalogBox)

        addView(Ui.top(Ui.h2(ctx, ctx.getString(R.string.agents_mine)), 10))
        mineBox = Ui.column(ctx, gap = 10)
        addView(mineBox)

        addView(Ui.top(Ui.h2(ctx, ctx.getString(R.string.ledger_title)), 10))
        ledgerBox = Ui.column(ctx, gap = 10)
        addView(ledgerBox)
    }

    private fun segment(label: String, onClick: () -> Unit): TextView = Ui.text(ctx, label, 15f, Ui.MUTED, 800).apply {
        gravity = Gravity.CENTER
        isClickable = true
        setOnClickListener { onClick() }
    }

    private var tierPicked = false

    override fun onShow() {
        if (!tierPicked) {
            val w = host.wallet
            if (w.connected && host.store.freeClaimed(w.address, w.clusterName)) tier = AgentTier.PRO
        }
        render()
        if (!refreshed && host.wallet.connected) {
            refreshed = true
            refreshChain()
        }
    }

    private fun refreshChain() {
        host.scope.launch {
            host.wallet.balanceSol().onSuccess { balance = it }
            runCatching { host.minter.refresh() }
            render()
        }
    }

    override fun render() {
        if (!this::ledgerBox.isInitialized) return
        val w = host.wallet
        clusterLabel.text = "METAPLEX CORE · " + w.clusterName.uppercase()
        walletPill.text = if (w.connected) {
            Fmt.short(w.address) + (balance?.let { " · " + Fmt.sol(it, 3) } ?: "")
        } else ctx.getString(R.string.wallet_connect)

        val pro = tier == AgentTier.PRO
        styleSeg(segFree, !pro)
        styleSeg(segPro, pro)
        tierLine.text = if (pro) ctx.getString(R.string.tier_pro_line, Fmt.sol(SolarchikConfig.PRO_PRICE_SOL)) else ctx.getString(R.string.tier_free_line)
        tierLine.setTextColor(if (pro) Ui.GOLD else Ui.TEXT)

        catalogBox.removeAllViews()
        Catalog.skus.forEach { catalogBox.addView(skuCard(it)) }
        renderMine()
        renderLedger()
    }

    private fun styleSeg(tv: TextView, on: Boolean) {
        tv.background = if (on) Ui.gradient(intArrayOf(Ui.GOLD, Ui.AMBER), tv.dp(14).toFloat(), android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT) else null
        tv.setTextColor(if (on) Ui.INK else Ui.MUTED)
    }

    private fun skuCard(sku: AgentSku): View = Ui.card(ctx, accent = sku.accent).apply {
        val row = Ui.row(ctx, gap = 14).apply { gravity = Gravity.TOP }
        val artBox = FrameLayout(ctx).apply {
            background = Ui.rounded(Ui.withAlpha(sku.accent, 0x1E), dp(18).toFloat())
        }
        artBox.addView(Ui.image(ctx, sku.artRes), FrameLayout.LayoutParams(dp(70), dp(96), Gravity.CENTER))
        row.addView(artBox, LinearLayout.LayoutParams(dp(88), dp(112)))
        val col = Ui.column(ctx)
        val pills = Ui.row(ctx, gap = 6)
        pills.addView(Ui.pill(ctx, ctx.getString(sku.agentClass.shortRes), sku.accent))
        pills.addView(Ui.pill(ctx, ctx.getString(if (tier == AgentTier.PRO) R.string.tier_pro else R.string.tier_free), if (tier == AgentTier.PRO) Ui.GOLD else Ui.CYAN, filled = tier == AgentTier.PRO))
        col.addView(pills)
        col.addView(Ui.top(Ui.text(ctx, sku.nameFor(tier), 17f, Ui.TEXT, 800), 8))
        col.addView(Ui.top(Ui.muted(ctx, ctx.getString(sku.blurbRes)), 4))
        col.addView(Ui.top(Ui.text(ctx, ctx.getString(R.string.mint_lanes, lanes(sku.lanes)), 12f, sku.accent, 700), 6))
        row.addView(Ui.weight(col))
        addView(row)

        val block = host.minter.canMint(sku, tier)
        val busy = busySku == sku.skuId(tier)
        val label = when {
            busy -> ctx.getString(R.string.mint_busy)
            block == MintError.Kind.FREE_USED -> ctx.getString(R.string.mint_free_used)
            block == MintError.Kind.PRO_MAINNET_OFF -> ctx.getString(R.string.mint_pro_off)
            tier == AgentTier.PRO -> ctx.getString(R.string.mint_pro, Fmt.sol(sku.priceSol(tier)))
            else -> ctx.getString(R.string.mint_free)
        }
        val btn = Ui.button(ctx, label, if (tier == AgentTier.PRO) Ui.Btn.PRIMARY else Ui.Btn.SECONDARY, R.drawable.ic_bolt_small) { mint(sku) }
        Ui.setEnabled(btn, block == null && busySku == null)
        addView(Ui.top(btn, 14))
    }

    private fun lanes(code: String): String {
        if (code == "dex") return ctx.getString(R.string.lane_dex)
        return code.mapNotNull {
            when (it) {
                'c' -> ctx.getString(R.string.lane_c)
                'e' -> ctx.getString(R.string.lane_e)
                'w' -> ctx.getString(R.string.lane_w)
                else -> null
            }
        }.joinToString(" · ")
    }

    private fun mint(sku: AgentSku) {
        if (busySku != null) return
        val chosen = tier
        busySku = sku.skuId(chosen)
        render()
        host.scope.launch {
            val res = host.minter.mint(host.sender, sku, chosen)
            busySku = null
            res.onSuccess { rec ->
                host.toast(ctx.getString(R.string.mint_ok, rec.name))
                render()
                val checked = host.minter.verify(rec)
                if (checked.status == OwnedAgent.STATUS_VERIFIED) host.toast(ctx.getString(R.string.mint_verified, rec.name))
                host.wallet.balanceSol().onSuccess { balance = it }
            }.onFailure { host.toast(host.errorText(it)) }
            host.renderAll()
        }
    }

    private fun onWalletPill() {
        if (host.wallet.connected) {
            refreshChain()
            return
        }
        host.scope.launch {
            host.wallet.connect(host.sender)
                .onSuccess { refreshChain() }
                .onFailure { host.toast(host.errorText(it)) }
            host.renderAll()
        }
    }

    private fun renderMine() {
        mineBox.removeAllViews()
        val w = host.wallet
        if (!w.connected) {
            mineBox.addView(emptyCard(ctx.getString(R.string.agents_connect_hint)))
            return
        }
        val mine = host.store.agentsFor(w.address, w.clusterName).sortedByDescending { it.mintedAt }
        if (mine.isEmpty()) {
            mineBox.addView(emptyCard(ctx.getString(R.string.agents_mine_empty, w.clusterName)))
            return
        }
        mine.forEach { mineBox.addView(ownedCard(it)) }
    }

    private fun ownedCard(a: OwnedAgent): View = Ui.card(ctx, pad = 14).apply {
        val sku = Catalog.baseOf(a.skuId)
        val row = Ui.row(ctx, gap = 12)
        row.addView(Ui.image(ctx, sku?.artRes ?: R.drawable.robot_sunflower), LinearLayout.LayoutParams(dp(44), dp(56)))
        val col = Ui.column(ctx)
        col.addView(Ui.text(ctx, a.name, 15f, Ui.TEXT, 800))
        val fee = Catalog.feeRateFor(a.tier)
        col.addView(Ui.top(Ui.muted(ctx, Fmt.short(a.asset) + " · " + ctx.getString(R.string.agent_fee_line, Fmt.pct(fee)), 12f), 3))
        row.addView(Ui.weight(col))
        val (txt, color) = when (a.status) {
            OwnedAgent.STATUS_VERIFIED -> ctx.getString(R.string.agent_verified) to Ui.GREEN
            OwnedAgent.STATUS_MISSING -> ctx.getString(R.string.agent_missing) to Ui.RED
            else -> ctx.getString(R.string.agent_pending) to Ui.GOLD
        }
        row.addView(Ui.pill(ctx, txt, color))
        addView(row)
        isClickable = true
        setOnClickListener { host.openUrl(host.explorerAddress(a.asset, a.cluster)) }
    }

    private fun renderLedger() {
        ledgerBox.removeAllViews()
        val rows = host.store.fees()
        if (rows.isEmpty()) {
            ledgerBox.addView(emptyCard(ctx.getString(R.string.ledger_empty)))
            return
        }
        val s = FeeLedger.summarize(rows)
        ledgerBox.addView(Ui.card(ctx, accent = Ui.GREEN, pad = 14).apply {
            addView(Ui.text(ctx, ctx.getString(R.string.ledger_summary, s.positions, Fmt.signedSol(s.pnl)), 15f, Ui.TEXT, 800))
            addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.ledger_fees, Fmt.sol(s.feesCharged), Fmt.sol(s.feesOwed), Fmt.sol(s.feesWaived)), 12f), 4))
        })
        rows.take(30).forEach { ledgerBox.addView(ledgerRow(it)) }
    }

    private fun ledgerRow(r: FeeRow): View = Ui.card(ctx, pad = 14).apply {
        val top = Ui.row(ctx)
        top.addView(Ui.weight(Ui.text(ctx, r.agent, 14f, Ui.TEXT, 800)))
        top.addView(Ui.text(ctx, Fmt.signedSol(r.pnl) + " SOL", 14f, if (r.pnl > 0) Ui.GREEN else if (r.pnl < 0) Ui.RED else Ui.MUTED, 800))
        addView(top)
        val bottom = Ui.row(ctx, gap = 8)
        val (label, color) = reason(r.reason)
        bottom.addView(Ui.pill(ctx, label, color))
        if (r.fee > 0) bottom.addView(Ui.text(ctx, (if (r.owes) "−" else "") + Fmt.sol(r.fee, 6) + " SOL", 12f, if (r.owes) Ui.AMBER else Ui.MUTED, 700))
        addView(Ui.top(bottom, 8))
        addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.ledger_row_time, Fmt.time(r.openedAt), Fmt.time(r.closedAt)), 11f), 6))
    }

    private fun reason(code: String): Pair<String, Int> = when (code) {
        FeeReason.PRO -> ctx.getString(R.string.reason_pro) to Ui.GOLD
        FeeReason.WINDOW -> ctx.getString(R.string.reason_window) to Ui.GREEN
        FeeReason.LOSS -> ctx.getString(R.string.reason_loss) to Ui.MUTED
        FeeReason.PAPER -> ctx.getString(R.string.reason_paper) to Ui.CYAN
        FeeReason.CHARGED -> ctx.getString(R.string.reason_charged) to Ui.AMBER
        else -> ctx.getString(R.string.reason_unsent) to Ui.AMBER
    }

    private fun emptyCard(text: String): View = Ui.card(ctx, pad = 16).apply {
        addView(Ui.muted(ctx, text, 13f))
    }
}
