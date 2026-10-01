package net.solardepin.solarchik.ui

import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.ui.Ui.dp

class RunScreen(host: MainActivity) : Screen(host) {
    private lateinit var lastV: TextView
    private lateinit var bestV: TextView
    private lateinit var scoreV: TextView
    private lateinit var modV: TextView
    private lateinit var ghostV: TextView
    private lateinit var unlocked: TextView
    private lateinit var start: TextView

    override fun build(): View = page {
        addView(Ui.display(ctx, ctx.getString(R.string.run_title), 26f))
        addView(Ui.muted(ctx, ctx.getString(R.string.run_sub, GameSave.GOAL_M), 14f))

        val stage = FrameLayout(ctx).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Ui.blend(Ui.SURFACE2, Ui.AMBER, 0.25f), Ui.SURFACE),
            ).apply { cornerRadius = dp(26).toFloat(); setStroke(dp(1), Ui.STROKE) }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(300))
        }
        // roof line
        stage.addView(View(ctx).apply { setBackgroundColor(Ui.GOLD) },
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.BOTTOM).apply { bottomMargin = dp(46) })
        stage.addView(Ui.image(ctx, R.drawable.hero_yard),
            FrameLayout.LayoutParams(dp(170), dp(240), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(40) })
        stage.addView(Ui.image(ctx, R.drawable.robot_midnight).apply { alpha = 0.28f },
            FrameLayout.LayoutParams(dp(90), dp(130), Gravity.BOTTOM or Gravity.START).apply { bottomMargin = dp(46); leftMargin = dp(18) })
        modV = Ui.pill(ctx, "", Ui.GOLD, icon = R.drawable.ic_nav_sol, filled = true)
        stage.addView(modV, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            topMargin = dp(14); leftMargin = dp(14)
        })
        addView(stage)

        start = Ui.button(ctx, ctx.getString(R.string.run_start), Ui.Btn.PRIMARY, R.drawable.ic_nav_run) { host.startRun() }
        addView(start)

        val stats = Ui.row(ctx, gap = 10)
        lastV = statCard(stats, ctx.getString(R.string.run_last))
        bestV = statCard(stats, ctx.getString(R.string.run_best))
        scoreV = statCard(stats, ctx.getString(R.string.run_best_score))
        addView(stats)

        addView(Ui.card(ctx).apply {
            addView(Ui.label(ctx, ctx.getString(R.string.run_today_mod), Ui.GOLD))
            ghostV = Ui.body(ctx)
            addView(Ui.top(ghostV, 8))
            unlocked = Ui.text(ctx, ctx.getString(R.string.run_unlocked), 14f, Ui.GREEN, 800)
            Ui.setIcon(unlocked, R.drawable.ic_check, Ui.GREEN)
            addView(Ui.top(unlocked, 10))
        })
    }

    private fun statCard(parent: LinearLayout, title: String): TextView {
        val c = Ui.card(ctx, pad = 14)
        c.addView(Ui.label(ctx, title).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
        val v = Ui.text(ctx, "0", 20f, Ui.TEXT, 900).apply {
            maxLines = 1
            setAutoSizeTextTypeUniformWithConfiguration(12, 20, 1, android.util.TypedValue.COMPLEX_UNIT_SP)
        }
        c.addView(v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)).apply { topMargin = dp(6) })
        parent.addView(c, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        return v
    }

    override fun render() {
        if (!this::start.isInitialized) return
        val save = host.save
        lastV.text = ctx.getString(R.string.meters, save.todayDistance())
        bestV.text = ctx.getString(R.string.meters, save.bestDistance)
        scoreV.text = save.bestScore.toString()
        val mod = save.dayMod()
        modV.text = ctx.getString(R.string.mod_chip, YardScreen.modLong(ctx, mod).substringBefore(":"))
        val ghost = save.readGhost()?.takeIf { it.day != save.today() }
        val modLine = YardScreen.modLong(ctx, mod)
        ghostV.text = modLine + "\n" + if (ghost != null) ctx.getString(R.string.run_ghost_on, ghost.day, ghost.meters) else ctx.getString(R.string.run_ghost_off)
        unlocked.visibility = if (save.clockedToday() && !save.signedToday()) View.VISIBLE else View.GONE
        start.text = ctx.getString(if (save.todayDistance() > 0) R.string.run_again else R.string.run_start)
        Ui.setIcon(start, R.drawable.ic_nav_run, Ui.INK)
    }
}
