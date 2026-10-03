package net.solardepin.solarchik.ui

import android.content.Context
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.solardepin.solarchik.R

/**
 * 0.22.0: a Strategy NFT spec in plain words (owner: "a balanced strategy with windows 15 and 60" meant nothing).
 * windows = how long each crypto "price up or down" market lasts before it settles; risk = stake size and how
 * picky the agent is; stake / stop / take = the limits. Used by Sol's confirmation card and Sol's spoken line.
 */
object StrategyWords {
    private fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.content?.toDoubleOrNull()
    private fun JsonElement?.str(): String = (this as? JsonPrimitive)?.content.orEmpty()
    private fun JsonElement?.list(): List<String> = (this as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content }

    fun duration(ctx: Context, min: Int): String = when {
        min >= 60 && min % 60 == 0 -> ctx.resources.getQuantityString(R.plurals.strat_hours, min / 60, min / 60)
        else -> ctx.getString(R.string.strat_minutes, min)
    }

    /** "15 min and 1 h" / "15 хв і 1 год". */
    fun windows(ctx: Context, w: List<Int>): String {
        val parts = w.sorted().distinct().map { duration(ctx, it) }
        return when (parts.size) {
            0 -> "—"
            1 -> parts[0]
            else -> parts.dropLast(1).joinToString(", ") + " " + ctx.getString(R.string.strat_and) + " " + parts.last()
        }
    }

    fun pace(ctx: Context, risk: String): String = ctx.getString(
        when (risk) {
            "calm" -> R.string.strat_pace_calm
            "risky" -> R.string.strat_pace_risky
            else -> R.string.strat_pace_balanced
        },
    )

    private fun paceShort(ctx: Context, risk: String): String = ctx.getString(
        when (risk) {
            "calm" -> R.string.strat_pace_calm_short
            "risky" -> R.string.strat_pace_risky_short
            else -> R.string.strat_pace_balanced_short
        },
    )

    /** What the agent does, how boldly, within which limits: three short lines. */
    fun describe(ctx: Context, spec: JsonObject?): List<String> {
        if (spec == null) return emptyList()
        val lanes = spec["lanes"].list()
        val w = spec["windows"].list().mapNotNull { it.toDoubleOrNull()?.toInt() }
        val what = buildList {
            if (lanes.isEmpty() || "crypto" in lanes) add(ctx.getString(R.string.strat_lane_crypto, windows(ctx, w)))
            if ("events" in lanes) add(ctx.getString(R.string.strat_lane_events))
            if ("weather" in lanes) add(ctx.getString(R.string.strat_lane_weather))
        }
        val out = ArrayList<String>()
        out += ctx.getString(R.string.strat_what, what.joinToString("; "))
        out += pace(ctx, spec["risk"].str())
        val stake = spec["stakeSol"].num()
        val stop = spec["stopPct"].num()?.toInt()
        val take = spec["takePct"].num()?.toInt()
        if (stake != null && stop != null && take != null) out += ctx.getString(R.string.strat_limits, Fmt.sol(stake, 3), stop, take)
        return out
    }

    /** One changed field in plain words: label + before → after. */
    fun change(ctx: Context, key: String, from: String, to: String): String {
        fun win(v: String) = windows(ctx, v.split("/").mapNotNull { it.trim().toDoubleOrNull()?.toInt() })
        return when (key) {
            "windows" -> ctx.getString(R.string.strat_chg_windows, win(from), win(to))
            "risk" -> ctx.getString(R.string.strat_chg_risk, paceShort(ctx, from), paceShort(ctx, to))
            "stakeSol" -> ctx.getString(R.string.strat_chg_stake, from, to)
            "stopPct" -> ctx.getString(R.string.strat_chg_stop, from, to)
            "takePct" -> ctx.getString(R.string.strat_chg_take, from, to)
            "askLo", "askHi" -> ctx.getString(R.string.strat_chg_band)
            "edgeBps" -> ctx.getString(R.string.strat_chg_edge)
            else -> ctx.getString(R.string.strat_chg_rules)
        }
    }

    /** Sol's short spoken line for a proposed change (no jargon; the card has the details). */
    fun say(ctx: Context, agent: String, changes: List<Triple<String, String, String>>): String {
        val main = changes.firstOrNull { it.first == "windows" } ?: changes.firstOrNull { it.first == "risk" } ?: changes.firstOrNull()
        fun win(v: String) = windows(ctx, v.split("/").mapNotNull { it.trim().toDoubleOrNull()?.toInt() })
        val what = when (main?.first) {
            "windows" -> ctx.getString(R.string.strat_say_windows, win(main.second), win(main.third))
            "risk" -> ctx.getString(R.string.strat_say_risk, paceShort(ctx, main.second), paceShort(ctx, main.third))
            null -> ctx.getString(R.string.strat_say_other)
            else -> change(ctx, main.first, main.second, main.third).replaceFirstChar { it.lowercase() }
        }
        return ctx.getString(R.string.strat_say, agent, what)
    }
}
