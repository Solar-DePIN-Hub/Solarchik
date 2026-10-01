package net.solardepin.solarchik.sol

import android.content.Context
import net.solardepin.solarchik.R
import net.solardepin.solarchik.agents.engine.DeskState
import net.solardepin.solarchik.core.FeeLedger
import net.solardepin.solarchik.core.FeeProgress
import net.solardepin.solarchik.core.FeeReason
import net.solardepin.solarchik.core.FeeRow
import net.solardepin.solarchik.core.StreakRules
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Today's note, built only from numbers on this phone (ledger, desk, streak, run).
 * Sol may retell it, but a retelling that adds any number not in [script] is thrown away.
 */
data class Report(val lines: List<String>, val script: String)

object DailyReport {
    fun sol(v: Double): String {
        val bd = BigDecimal(v).setScale(5, RoundingMode.HALF_UP).stripTrailingZeros()
        return bd.toPlainString().let { if (it == "-0") "0" else it }
    }

    fun build(
        ctx: Context,
        today: String,
        streak: Int,
        signedToday: Boolean,
        runMeters: Int,
        progress: FeeProgress,
        fees: List<FeeRow>,
        desk: DeskState,
    ): Report {
        val rows = fees.filter { StreakRules.dayKey(it.closedAt) == today }
        val lines = ArrayList<String>()
        if (rows.isEmpty()) {
            lines += ctx.getString(R.string.report_none)
        } else {
            val s = FeeLedger.summarize(rows)
            lines += ctx.getString(R.string.report_positions, rows.size, s.wins, sol(s.pnl))
            val waived = rows.filter { it.reason == FeeReason.WINDOW }.sumOf { it.fee }
            lines += ctx.getString(R.string.report_fees, sol(s.feesCharged), sol(s.feesOwed), sol(waived))
        }
        lines += ctx.resources.getQuantityString(R.plurals.report_streak_days, streak, streak) + " " +
            ctx.getString(if (signedToday) R.string.report_signed else R.string.report_unsigned)
        if (runMeters > 0) lines += ctx.getString(R.string.report_run, runMeters)
        lines += when (progress) {
            is FeeProgress.Active -> ctx.getString(R.string.report_window_active, (progress.leftMs / 3600_000L).toInt())
            is FeeProgress.Ready -> ctx.getString(R.string.report_window_ready)
            is FeeProgress.Wait -> ctx.getString(R.string.report_window_wait, progress.days48)
        }
        val running = desk.runs.filter { it.running }.map { it.name }
        lines += if (running.isEmpty()) ctx.getString(R.string.report_desk_idle)
        else ctx.getString(R.string.report_desk, running.take(3).joinToString(", "))
        return Report(lines, lines.joinToString(" "))
    }
}
