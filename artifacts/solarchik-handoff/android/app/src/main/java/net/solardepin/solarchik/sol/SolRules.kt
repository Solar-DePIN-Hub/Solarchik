package net.solardepin.solarchik.sol

import android.content.Context
import net.solardepin.solarchik.R
import net.solardepin.solarchik.core.SolarchikConfig

/**
 * Game-rule questions are answered on the phone from [SolarchikConfig], so Sol never
 * guesses about fees, windows or limits. Everything else goes to the friend worker.
 */
object SolRules {
    // Explicit rule questions only (0.21.7): "window", "risk", "pro", "підпис" used to catch ordinary
    // chat ("open the window", "I took a risk") and answer it with a canned rule card.
    private val window = Regex("fee[- ]?free( window)?|вікн\\w* без комісі|безкомісійн", RegexOption.IGNORE_CASE)
    private val streak = Regex("\\bstreak\\b|clock[- ]?in|\\bсері[яїюй]\\b.*(днів|підпис)|щоденн\\w* підпис", RegexOption.IGNORE_CASE)
    private val fee = Regex("(profit|performance) fee|\\bfees?\\b.*\\?|комісі\\w*.*\\?|\\bpro\\b.*(cost|price|коштує|ціна|вартість)|royalt|роялті", RegexOption.IGNORE_CASE)
    private val risk = Regex("risk limits?|(daily|day) (loss|spend)|loss limit|ліміт\\w* (ризику|збитк|втрат)|денн\\w* ліміт", RegexOption.IGNORE_CASE)

    fun answer(ctx: Context, message: String, state: SolState? = null): String? {
        if (message.length > 160) return null
        val c = SolarchikConfig
        return when {
            window.containsMatchIn(message) -> ctx.getString(R.string.rule_window, c.STREAK_SHORT_DAYS, c.WINDOW_SHORT_HOURS.toInt(), c.STREAK_LONG_DAYS, c.WINDOW_LONG_DAYS.toInt())
            streak.containsMatchIn(message) -> streakLine(ctx, state)
            fee.containsMatchIn(message) -> ctx.getString(R.string.rule_fee, (c.FREE_FEE_RATE * 100).toInt(), c.PRO_PRICE_SOL.toString(), c.ROYALTY_BPS / 100)
            risk.containsMatchIn(message) -> ctx.getString(R.string.rule_risk, c.HARD_MAX_TRADE_SOL.toString(), c.HARD_DAY_CAP_SOL.toString(), c.HARD_MAX_LOSSES, c.HARD_DAY_LOSS_SOL.toString())
            else -> null
        }
    }

    /** 0.22.0: the streak answer starts from the player's real state (signed today = no "run 1200 m"). */
    fun streakLine(ctx: Context, state: SolState?): String {
        val goal = SolarchikConfig.RUN_GOAL_M
        if (state == null) return ctx.getString(R.string.rule_streak, goal)
        val days = ctx.resources.getQuantityString(R.plurals.sol_streak_days, state.streak, state.streak)
        return when {
            state.signedToday -> ctx.getString(R.string.rule_streak_signed, days, goal)
            state.clockedToday -> ctx.getString(R.string.rule_streak_ready, days)
            else -> ctx.getString(R.string.rule_streak_now, days) + " " + ctx.getString(R.string.rule_streak, goal)
        }
    }

    /** Workers sometimes stop mid-sentence (token cap). Keep whole sentences only. */
    fun tidy(reply: String): String {
        val t = reply.trim()
        if (t.isEmpty() || t.last() in ".!?…»\")") return t
        val cut = t.indexOfLast { it == '.' || it == '!' || it == '?' || it == '…' }
        return if (cut >= t.length * 0.4) t.substring(0, cut + 1) else "$t…"
    }
}
