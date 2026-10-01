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
}

/** A note that is due, with the dedupe key that marks it as sent. */
data class DueNote(val kind: NoteKind, val key: String)

/**
 * Pure: which reminders are due now. Each one fires at most once per [DueNote.key].
 * - streak at risk: a live streak, today not signed, within 3 h of the UTC day end
 * - reward ready: a fee-free window is available (once per window id)
 * - window ending: the active window ends within 3 h (once per window id)
 * - daily report: once per local day after 20:00 when there was activity today
 */
object NotePlanner {
    const val LEAD_MS = 3 * 3600_000L
    const val REPORT_HOUR = 20

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

        val dayEnd = Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC).toLocalDate().plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        if (s.streak > 0 && s.signedDay != today && dayEnd - now <= LEAD_MS) {
            out += DueNote(NoteKind.STREAK, "streak:$today")
        }
        val rows = StreakRules.expire(s.feeWindows, now)
        rows.firstOrNull { it.status == FeeWindow.AVAILABLE }?.let { out += DueNote(NoteKind.REWARD, "reward:${it.id}") }
        rows.firstOrNull { it.status == FeeWindow.ACTIVE && it.endsAt > now && it.endsAt - now <= LEAD_MS }?.let {
            out += DueNote(NoteKind.WINDOW, "window:${it.id}")
        }
        val local = Instant.ofEpochMilli(now).atZone(zone)
        if (activityToday && local.hour >= REPORT_HOUR) out += DueNote(NoteKind.REPORT, "report:${local.toLocalDate()}")
        return out.filter { enabled(it.kind) && it.key !in sent }
    }
}
