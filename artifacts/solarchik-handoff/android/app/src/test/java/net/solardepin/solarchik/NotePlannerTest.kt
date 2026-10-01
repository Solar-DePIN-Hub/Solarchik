package net.solardepin.solarchik

import net.solardepin.solarchik.core.FeeWindow
import net.solardepin.solarchik.core.StreakState
import net.solardepin.solarchik.notify.NoteKind
import net.solardepin.solarchik.notify.NotePlanner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

class NotePlannerTest {
    private val kyiv = ZoneId.of("Europe/Kyiv")
    private val d = LocalDate.of(2026, 10, 1)
    private fun utc(h: Int, m: Int = 0) = d.atTime(h, m).toInstant(ZoneOffset.UTC).toEpochMilli()
    private val alive = StreakState(streak = 4, signedDay = "2026-09-30", seven = 4, thirty = 4)
    private fun due(s: StreakState, now: Long, sent: Set<String> = emptySet(), on: Boolean = true, act: Boolean = false) =
        NotePlanner.due(s, now, sent, { on }, act, kyiv)

    @Test fun streakAtRiskOnlyInLastThreeUtcHours() {
        assertTrue(due(alive, utc(20, 59)).none { it.kind == NoteKind.STREAK })
        assertEquals("streak:2026-10-01", due(alive, utc(21, 0)).single { it.kind == NoteKind.STREAK }.key)
        // already signed today, broken streak, or already sent: nothing
        assertTrue(due(alive.copy(signedDay = "2026-10-01"), utc(22)).isEmpty())
        assertTrue(due(alive.copy(signedDay = "2026-09-28"), utc(22)).isEmpty())
        assertTrue(due(alive, utc(22), sent = setOf("streak:2026-10-01")).isEmpty())
    }

    @Test fun rewardAndWindowEndingOncePerWindow() {
        val ready = alive.copy(feeWindows = listOf(FeeWindow("h48-1-2026-09-30", "h48", 7, FeeWindow.AVAILABLE, grantedAt = utc(1))))
        assertEquals("reward:h48-1-2026-09-30", due(ready, utc(9)).single().key)
        assertTrue(due(ready, utc(9), sent = setOf("reward:h48-1-2026-09-30")).isEmpty())
        val ends = utc(12)
        val active = alive.copy(feeWindows = listOf(FeeWindow("h48-1-2026-09-30", "h48", 7, FeeWindow.ACTIVE, utc(1), ends - 48 * 3600_000L, ends)))
        assertTrue(due(active, ends - 3 * 3600_000L - 1).isEmpty())
        assertEquals(NoteKind.WINDOW, due(active, ends - 3 * 3600_000L).single().kind)
        assertTrue(due(active, ends + 1).isEmpty())
    }

    @Test fun reportAfterEightPmLocalWithActivityAndTogglesRespected() {
        // 17:00 UTC = 20:00 Kyiv (UTC+3)
        assertTrue(due(StreakState(), utc(16, 59), act = true).isEmpty())
        assertEquals("report:2026-10-01", due(StreakState(), utc(17), act = true).single().key)
        assertTrue(due(StreakState(), utc(17), act = false).isEmpty())
        assertTrue(due(alive, utc(22), on = false, act = true).isEmpty())
    }
}
