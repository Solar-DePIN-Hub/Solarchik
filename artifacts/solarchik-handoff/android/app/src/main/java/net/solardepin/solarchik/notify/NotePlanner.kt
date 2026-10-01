package net.solardepin.solarchik.notify

import net.solardepin.solarchik.core.FeeWindow
import net.solardepin.solarchik.core.StreakRules
import net.solardepin.solarchik.core.StreakState
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

enum class NoteKind(val toggle: String) {
    STREAK("noteStreak"),
    REWARD("noteReward"),
    WINDOW("noteWindow"),
    REPORT("noteReport"),
    /** Positions closed by a background desk tick (app not open). Posted by [DeskNotes]. */
    DESK("noteDesk"),
}

/** A note that is due, with the dedupe key that marks it as sent. */
data class DueNote(val kind: NoteKind, val key: String)

/**
 * Pure: which reminders are due now. Each one fires at most once per [DueNote.key].
 * - streak at risk: a live streak, today not signed, within 3 h of the UTC day end
 * - reward ready: a fee-free window is available (once per window id)
 * - window ending: the active window ends within 3 h (once per window id)
 * - daily report: once per UTC day (the game day the web rules use) when that day had activity.
 *   It fires in the second half of the UTC day, outside local quiet hours (22:00-08:00), at local
 *   20:00 or in the last 4 h before the UTC day ends, whichever comes first. The note says when
 *   the game day ends in local time ([reportDayEnd]).
 */
object NotePlanner {
    const val LEAD_MS = 3 * 3600_000L
    const val REPORT_HOUR = 20
    const val REPORT_LEAD_MS = 4 * 3600_000L
    const val QUIET_FROM = 22
    const val QUIET_TO = 8

    /** End of the UTC game day containing [now] (epoch ms). */
    fun reportDayEnd(now: Long): Long =
        Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC).toLocalDate().plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

    fun reportDue(now: Long, zone: ZoneId): Boolean {
        val end = reportDayEnd(now)
        if (end - now > 12 * 3600_000L) return false // first half of the UTC day: too early to sum it up
        val hour = Instant.ofEpochMilli(now).atZone(zone).hour
        if (hour >= QUIET_FROM || hour < QUIET_TO) return false
        return hour >= REPORT_HOUR || end - now <= REPORT_LEAD_MS
    }

    fun due(
        streak: StreakState,
        now: Long,
        sent: Set<String>,
        enabled: (NoteKind) -> Boolean,
        activityToday: Boolean,
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<DueNote> {
        val out = ArrayList<DueNote>()
        val today = StreakRules.dayKey(now)
        val s = StreakRules.normalize(streak, today)

        val dayEnd = reportDayEnd(now)
        if (s.streak > 0 && s.signedDay != today && dayEnd - now <= LEAD_MS) {
            out += DueNote(NoteKind.STREAK, "streak:$today")
        }
        val rows = StreakRules.expire(s.feeWindows, now)
        rows.firstOrNull { it.status == FeeWindow.AVAILABLE }?.let { out += DueNote(NoteKind.REWARD, "reward:${it.id}") }
        rows.firstOrNull { it.status == FeeWindow.ACTIVE && it.endsAt > now && it.endsAt - now <= LEAD_MS }?.let {
            out += DueNote(NoteKind.WINDOW, "window:${it.id}")
        }
        if (activityToday && reportDue(now, zone)) out += DueNote(NoteKind.REPORT, "report:$today")
        return out.filter { enabled(it.kind) && it.key !in sent }
    }
}
