package net.solardepin.solarchik.ui

import android.content.Context
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.core.FeeLedger
import net.solardepin.solarchik.core.FeeProgress
import net.solardepin.solarchik.ui.Ui.dp

/** Sol: the pocket friend. Milestone A shows an honest local daily report; chat + voice come next. */
class SolScreen(host: MainActivity) : Screen(host) {
    private lateinit var bubble: TextView
    private lateinit var report: LinearLayout

    override fun build(): View = page {
        addView(Ui.display(ctx, ctx.getString(R.string.sol_title), 26f))
        addView(Ui.muted(ctx, ctx.getString(R.string.sol_sub), 14f))

        val stage = FrameLayout(ctx).apply {
            background = Ui.gradient(intArrayOf(Ui.blend(Ui.SURFACE2, Ui.CYAN, 0.18f), Ui.SURFACE), dp(26).toFloat(), android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(300))
        }
        stage.addView(Ui.image(ctx, R.drawable.buddy_happy), FrameLayout.LayoutParams(dp(176), dp(236), Gravity.BOTTOM or Gravity.END).apply {
            bottomMargin = dp(12); rightMargin = dp(10)
        })
        bubble = Ui.text(ctx, "", 15f, Ui.TEXT, 700).apply {
            background = Ui.rounded(Ui.withAlpha(Ui.BG, 0xD8), dp(18).toFloat(), Ui.withAlpha(Ui.CYAN, 0x66), dp(1))
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        stage.addView(bubble, FrameLayout.LayoutParams(dp(190), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            topMargin = dp(18); leftMargin = dp(16)
        })
        addView(stage)

        report = Ui.card(ctx, accent = Ui.CYAN)
        addView(report)

        addView(Ui.card(ctx).apply {
            val r = Ui.row(ctx, gap = 12)
            r.addView(Ui.iconBadge(ctx, R.drawable.ic_nav_sol, Ui.GOLD, 40))
            r.addView(Ui.weight(Ui.body(ctx, ctx.getString(R.string.sol_chat_soon))))
            r.addView(Ui.pill(ctx, ctx.getString(R.string.soon), Ui.GOLD))
            addView(r)
        })
    }

    override fun render() {
        if (!this::report.isInitialized) return
        val save = host.save
        bubble.text = tipOfDay(ctx, save.today())
        report.removeAllViews()
        report.addView(Ui.label(ctx, ctx.getString(R.string.sol_report_title), Ui.CYAN))
        val lines = ArrayList<String>()
        lines += ctx.getString(R.string.sol_report_streak, save.streak)
        lines += ctx.getString(if (save.signedToday()) R.string.sol_report_signed else R.string.sol_report_unsigned)
        val w = host.wallet
        val agents = if (w.connected) host.store.agentsFor(w.address, w.clusterName).count { it.status != "missing" } else 0
        lines += ctx.getString(R.string.sol_report_agents, agents, FeeLedger.summarize(host.store.fees()).positions)
        (save.feeProgress() as? FeeProgress.Active)?.let { lines += ctx.getString(R.string.sol_report_window, Fmt.countdown(it.leftMs)) }
        lines.forEach { report.addView(Ui.top(Ui.body(ctx, "• $it"), 8)) }
    }

    companion object {
        private val TIPS = intArrayOf(R.string.sol_tip_1, R.string.sol_tip_2, R.string.sol_tip_3, R.string.sol_tip_4, R.string.sol_tip_5)

        /** One stable tip per UTC day. */
        fun tipOfDay(ctx: Context, day: String): String {
            val h = day.fold(7) { acc, c -> acc * 31 + c.code } and 0x7fffffff
            return ctx.getString(TIPS[h % TIPS.size])
        }
    }
}
