package net.solardepin.solarchik.ui

import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import kotlinx.coroutines.launch
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.agents.SliceBook
import net.solardepin.solarchik.agents.SlicePrice
import net.solardepin.solarchik.agents.SlicePrices
import net.solardepin.solarchik.agents.SliceStocks
import net.solardepin.solarchik.agents.SliceStore
import java.util.Locale

/** Agents › Slice: tokenized stocks with live Jupiter prices and a clearly labelled paper portfolio. */
class SlicePanel(private val host: MainActivity, private val onChange: () -> Unit) {
    private val ctx get() = host
    private val store by lazy { SliceStore(host) }
    var prices: Map<String, SlicePrice> = emptyMap()
        internal set
    private var loading = false
    private var loadedAt = 0L
    private var failed = false

    fun load(force: Boolean = false) {
        if (loading || (!force && System.currentTimeMillis() - loadedAt < 60_000 && prices.isNotEmpty())) return
        loading = true
        host.scope.launch {
            val p = SlicePrices.fetch()
            loading = false
            failed = p.isEmpty()
            if (p.isNotEmpty()) { prices = p; loadedAt = System.currentTimeMillis() }
            onChange()
        }
    }

    private fun usd(v: Double): String = "$" + String.format(Locale.US, if (v >= 100) "%,.2f" else "%.2f", v)
    private fun pct(v: Double): String = (if (v >= 0) "+" else "") + String.format(Locale.US, "%.2f%%", v)

    fun render(box: LinearLayout) {
        box.removeAllViews()
        val book = store.book()
        box.addView(Ui.card(ctx, accent = Ui.CYAN, pad = 16).apply {
            tag = "slice-head"
            addView(Ui.label(ctx, ctx.getString(R.string.slice_label), Ui.CYAN))
            addView(Ui.top(Ui.text(ctx, ctx.getString(R.string.slice_title), 18f, Ui.TEXT, 800), 4))
            addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.slice_body), 12f), 4))
            addView(Ui.top(Ui.pill(ctx, ctx.getString(R.string.slice_paper_pill), Ui.AMBER, filled = true), 10))
            val row = Ui.row(ctx, gap = 12)
            row.addView(Ui.weight(Ui.column(ctx).apply {
                addView(Ui.muted(ctx, ctx.getString(R.string.slice_value), 11f))
                addView(Ui.text(ctx, usd(book.value(prices)), 20f, Ui.TEXT, 900))
            }))
            val pnl = book.pnl(prices)
            row.addView(Ui.column(ctx).apply {
                addView(Ui.muted(ctx, ctx.getString(R.string.slice_pnl), 11f))
                addView(Ui.text(ctx, (if (pnl >= 0) "+" else "−") + usd(kotlin.math.abs(pnl)), 16f, if (pnl > 0.005) Ui.GREEN else if (pnl < -0.005) Ui.RED else Ui.MUTED, 800))
            })
            addView(Ui.top(row, 10))
            addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.slice_cash, usd(book.cash)), 12f), 4))
            val links = Ui.row(ctx, gap = 8)
            links.addView(Ui.weight(Ui.button(ctx, ctx.getString(R.string.slice_open_site), Ui.Btn.SECONDARY) { host.openUrl(SliceStocks.SITE) }.apply { tag = "slice-site" }))
            links.addView(Ui.weight(Ui.button(ctx, ctx.getString(R.string.slice_refresh), Ui.Btn.GHOST) { load(force = true) }))
            addView(Ui.top(links, 12))
        })
        when {
            prices.isEmpty() && failed -> box.addView(Ui.muted(ctx, ctx.getString(R.string.slice_offline), 12f))
            prices.isEmpty() -> box.addView(Ui.muted(ctx, ctx.getString(R.string.slice_loading), 12f))
            else -> box.addView(Ui.muted(ctx, ctx.getString(R.string.slice_source), 11f))
        }
        SliceStocks.all.forEach { box.addView(row(it, book)) }
        box.addView(Ui.button(ctx, ctx.getString(R.string.slice_reset), Ui.Btn.GHOST) { store.reset(); onChange() })
    }

    private fun row(s: SliceStocks.Stock, book: SliceBook): View = Ui.card(ctx, pad = 12).apply {
        tag = "slice-row"
        val p = prices[s.mint]
        val head = Ui.row(ctx, gap = 10).apply { gravity = Gravity.CENTER_VERTICAL }
        head.addView(Ui.text(ctx, s.ticker.take(2), 13f, Ui.INK, 900).apply {
            gravity = Gravity.CENTER
            background = Ui.rounded(Ui.CYAN, dp(12).toFloat())
        }, LinearLayout.LayoutParams(dp(40), dp(40)))
        head.addView(Ui.weight(Ui.column(ctx).apply {
            addView(Ui.text(ctx, s.name, 15f, Ui.TEXT, 800))
            addView(Ui.muted(ctx, s.ticker, 11f))
        }))
        head.addView(Ui.column(ctx).apply {
            gravity = Gravity.END
            addView(Ui.text(ctx, p?.let { usd(it.usd) } ?: "—", 15f, Ui.TEXT, 800).apply { gravity = Gravity.END })
            p?.change24h?.let { addView(Ui.text(ctx, pct(it), 11f, if (it >= 0) Ui.GREEN else Ui.RED, 700).apply { gravity = Gravity.END }) }
        })
        addView(head)
        book.lots[s.mint]?.let { l ->
            val now = p?.let { l.qty * it.usd } ?: l.costUsd
            addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.slice_held, String.format(Locale.US, "%.4f", l.qty), usd(now), usd(l.costUsd)), 11f), 6))
        }
        val btns = Ui.row(ctx, gap = 8)
        val buy = Ui.button(ctx, ctx.getString(R.string.slice_buy, SliceBook.TICKET_USD.toInt()), Ui.Btn.SECONDARY) {
            val price = prices[s.mint]?.usd ?: return@button
            val next = store.book().buy(s.mint, SliceBook.TICKET_USD, price)
            if (next == null) host.toast(ctx.getString(R.string.slice_no_cash)) else { store.save(next); host.toast(ctx.getString(R.string.slice_bought, s.name)) }
            onChange()
        }
        Ui.setEnabled(buy, p != null)
        btns.addView(Ui.weight(buy))
        if (book.lots.containsKey(s.mint)) {
            val sell = Ui.button(ctx, ctx.getString(R.string.slice_sell), Ui.Btn.GHOST) {
                val price = prices[s.mint]?.usd ?: return@button
                store.book().sellAll(s.mint, price)?.let { store.save(it); host.toast(ctx.getString(R.string.slice_sold, s.name)) }
                onChange()
            }
            Ui.setEnabled(sell, p != null)
            btns.addView(Ui.weight(sell))
        }
        addView(Ui.top(btns, 8))
    }

    private fun dp(v: Int) = with(Ui) { ctx.dp(v) }
}
