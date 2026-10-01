package net.solardepin.solarchik.core

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** Same shape and wire names as web `FeeWindow` in src/lib/game/save.ts. */
@Serializable
data class FeeWindow(
    val id: String,
    /** "h48" or "d7". */
    val kind: String,
    val milestone: Int,
    /** "available" | "active" | "spent". */
    val status: String,
    val grantedAt: Long = 0,
    val startedAt: Long = 0,
    val endsAt: Long = 0,
) {
    val durationMs: Long get() = if (kind == KIND_LONG) SolarchikConfig.WINDOW_LONG_MS else SolarchikConfig.WINDOW_SHORT_MS

    companion object {
        const val KIND_SHORT = "h48"
        const val KIND_LONG = "d7"
        const val AVAILABLE = "available"
        const val ACTIVE = "active"
        const val SPENT = "spent"
    }
}

/** Streak state. Only a signed CLOCK IN moves it. A run only unlocks the day. */
data class StreakState(
    val streak: Int = 0,
    /** UTC day (yyyy-MM-dd) of the last signed CLOCK IN. */
    val signedDay: String = "",
    /** Signed days toward the next 48h window. Restarts after that reward. */
    val seven: Int = 0,
    /** Signed days toward 30/60/90. Does not restart when a reward is granted. */
    val thirty: Int = 0,
    /** UTC days that were actually signed in the current streak (web: clockDays). */
    val clockDays: List<String> = emptyList(),
    val feeWindows: List<FeeWindow> = emptyList(),
)

sealed class FeeProgress {
    data class Active(val leftMs: Long, val window: FeeWindow) : FeeProgress()
    data class Ready(val window: FeeWindow, val count: Int) : FeeProgress()
    /** Days left to the next 48h window and to the next 7-day window. */
    data class Wait(val days48: Int, val days30: Int, val seven: Int, val thirty: Int, val next30: Int) : FeeProgress()
}

/** Pure rules. Port of web stampClock / activateFeeWindow / feeProgress / feeWindowCovers. */
object StreakRules {
    fun dayKey(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()
    fun prevDay(day: String): String = LocalDate.parse(day).minusDays(1).toString()

    /** On read: a streak whose last signed day is older than yesterday is gone, with its counters. */
    fun normalize(s: StreakState, today: String): StreakState {
        if (s.signedDay == today || s.signedDay == prevDay(today)) return s
        if (s.streak == 0 && s.seven == 0 && s.thirty == 0) return s
        return s.copy(streak = 0, seven = 0, thirty = 0)
    }

    /** A signed CLOCK IN on [today]. Grants rewards as "available"; nothing starts by itself. */
    fun stamp(s: StreakState, today: String, now: Long): StreakState {
        if (s.signedDay == today) return s
        val continued = s.signedDay == prevDay(today)
        val seven = if (continued) s.seven + 1 else 1
        val thirty = if (continued) s.thirty + 1 else 1
        val granted = FeeWindows.grantStreakRewards(s.feeWindows, seven, thirty, now)
        val days = (if (continued) s.clockDays else emptyList()).filter { it != today } + today
        return s.copy(
            streak = if (continued) s.streak + 1 else 1,
            signedDay = today,
            seven = granted.seven,
            thirty = thirty,
            feeWindows = granted.rows,
            clockDays = days.takeLast(SolarchikConfig.CLOCK_DAYS_KEEP),
        )
    }

    /** Starts the first available window. One window runs at a time. */
    fun activate(s: StreakState, now: Long): StreakState = s.copy(feeWindows = FeeWindows.activate(s.feeWindows, now))

    fun progress(s: StreakState, now: Long): FeeProgress {
        val rows = expire(s.feeWindows, now)
        rows.firstOrNull { it.status == FeeWindow.ACTIVE && it.endsAt > now }?.let {
            return FeeProgress.Active(it.endsAt - now, it)
        }
        val ready = rows.filter { it.status == FeeWindow.AVAILABLE }
        if (ready.isNotEmpty()) return FeeProgress.Ready(ready.first(), ready.size)
        val long = SolarchikConfig.STREAK_LONG_DAYS
        val next30 = (s.thirty / long + 1) * long
        return FeeProgress.Wait(
            days48 = maxOf(0, SolarchikConfig.STREAK_SHORT_DAYS - s.seven),
            days30 = maxOf(0, next30 - s.thirty),
            seven = s.seven,
            thirty = s.thirty,
            next30 = next30,
        )
    }

    /** Fee is waived when the position was OPENED inside any activated window (active or spent). */
    fun covers(s: StreakState, openedAt: Long): Boolean = FeeWindows.covers(s.feeWindows, openedAt)

    /** Kept for callers; ids now come from [FeeWindows.h48RewardId] / [FeeWindows.d7RewardId]. */
    fun rewardId(kind: String, n: Int, day: String): String = "$kind-$n-$day"

    fun expire(rows: List<FeeWindow>, now: Long): List<FeeWindow> = FeeWindows.expire(rows, now)

    /** Seeds history for an old save that only has a streak and a last signed day (web readClockDays). */
    fun seedDays(signedDay: String, streak: Int): List<String> {
        if (streak <= 0 || !Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(signedDay)) return emptyList()
        val out = ArrayList<String>()
        var cursor = LocalDate.parse(signedDay)
        repeat(minOf(streak, SolarchikConfig.CLOCK_DAYS_KEEP)) {
            out.add(0, cursor.toString())
            cursor = cursor.minusDays(1)
        }
        return out
    }
}
