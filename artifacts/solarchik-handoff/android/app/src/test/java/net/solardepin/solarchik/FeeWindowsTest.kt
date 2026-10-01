package net.solardepin.solarchik

import kotlinx.serialization.json.Json
import net.solardepin.solarchik.core.FeeLedger
import net.solardepin.solarchik.core.FeeReason
import net.solardepin.solarchik.core.FeeWindow
import net.solardepin.solarchik.core.FeeWindows
import net.solardepin.solarchik.core.FeeWindows.D7_MS
import net.solardepin.solarchik.core.FeeWindows.H48_MS
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneOffset

/** Port of web src/lib/game/fee-windows.test.ts (11 cases, same names and numbers). */
class FeeWindowsTest {
    private val day = 86_400_000L
    private val t0 = LocalDateTime.of(2026, 10, 1, 9, 0).toInstant(ZoneOffset.UTC).toEpochMilli()

    private fun win(id: String = "x", kind: String = "h48", milestone: Int = 7, status: String = FeeWindow.AVAILABLE, grantedAt: Long = t0, startedAt: Long = 0, endsAt: Long = 0) =
        FeeWindow(id, kind, milestone, status, grantedAt, startedAt, endsAt)

    private fun feeCovered(rows: List<FeeWindow>, openedAt: Long) = FeeWindows.covers(rows, openedAt)
    private val spent get() = win(id = "h48-1-2026-10-01", status = FeeWindow.SPENT, startedAt = t0, endsAt = t0 + H48_MS)
    private val active get() = win(id = "d7-30-2026-10-10", kind = "d7", status = FeeWindow.ACTIVE, startedAt = t0 + 10 * day, endsAt = t0 + 10 * day + D7_MS)

    // --- fee window coverage ---
    @Test fun aTradeOpenedInsideASpentWindowIsStillFeeFree() {
        assertTrue(FeeWindows.covers(listOf(spent, active), t0 + day))
        assertTrue(feeCovered(listOf(spent), t0 + H48_MS - 1))
    }

    @Test fun startIsInclusiveEndExclusive() {
        assertTrue(FeeWindows.covers(listOf(spent), t0))
        assertFalse(FeeWindows.covers(listOf(spent), t0 + H48_MS))
        assertFalse(FeeWindows.covers(listOf(spent), t0 - 1))
    }

    @Test fun activeWindowCoversGapsAndUnactivatedWindowsDoNot() {
        assertTrue(FeeWindows.covers(listOf(spent, active), t0 + 11 * day))
        assertFalse(FeeWindows.covers(listOf(spent, active), t0 + 5 * day))
        assertFalse(FeeWindows.covers(listOf(win(status = FeeWindow.AVAILABLE)), t0 + 1))
        assertFalse(FeeWindows.covers(listOf(spent), 0))
    }

    @Test fun expiryKeepsStartedAtEndsAtSoAPositionClosedAfterTheEndStaysFree() {
        val rows = FeeWindows.activate(listOf(win(id = "h48-1-2026-10-01")), t0)
        val openedAt = t0 + H48_MS - 60_000
        val later = FeeWindows.activate(rows, t0 + H48_MS + day)
        assertEquals(FeeWindow.SPENT, later[0].status)
        assertEquals(t0, later[0].startedAt)
        val row = FeeLedger.planFee("f", "a", "free", openedAt, t0 + H48_MS + day, 1.0, false, feeCovered(later, openedAt))
        assertEquals(FeeReason.WINDOW, row.reason)
        val charged = FeeLedger.planFee("g", "a", "free", t0 + H48_MS + 1, t0 + 3 * day, 1.0, false, feeCovered(later, t0 + H48_MS + 1))
        assertEquals(FeeReason.UNSENT, charged.reason)
    }

    // --- reward ids ---
    @Test fun idsCarryTheUtcGrantDay() {
        val a = FeeWindows.grantStreakRewards(emptyList(), 7, 30, t0)
        assertEquals(listOf("h48-1-2026-10-01", "d7-30-2026-10-01"), a.rows.map { it.id })
        assertEquals(0, a.seven)
    }

    @Test fun aSecondThirtyDayRunAfterABrokenStreakGrantsANewD7() {
        val first = FeeWindows.grantStreakRewards(emptyList(), 0, 30, t0).rows
        val later = t0 + 45 * day
        val second = FeeWindows.grantStreakRewards(first, 0, 30, later).rows
        assertEquals(2, second.count { it.kind == "d7" })
        assertEquals("d7-30-2026-11-15", second[1].id)
    }

    @Test fun oldSavedIdsStayValidAndNeverBlockNewOnes() {
        val old = FeeWindows.read(Json.parseToJsonElement("""[{"id":"d7-30","kind":"d7","milestone":30,"status":"spent","grantedAt":1,"startedAt":1,"endsAt":2}]"""))
        assertEquals("d7-30", old[0].id)
        val next = FeeWindows.grantStreakRewards(old, 0, 30, t0).rows
        assertEquals(listOf("d7-30", "d7-30-2026-10-01"), next.map { it.id })
    }

    @Test fun sameDayIsGrantedOnce() {
        val once = FeeWindows.grantStreakRewards(emptyList(), 0, 30, t0).rows
        val twice = FeeWindows.grantStreakRewards(once, 0, 30, t0 + 3_600_000).rows
        assertEquals(1, twice.size)
        assertSame(once, FeeWindows.grant(once, once[0].id, "d7", 30, t0))
    }

    @Test fun utcDayNotLocal() {
        val lateUtc = LocalDateTime.of(2026, 10, 1, 23, 30).toInstant(ZoneOffset.UTC).toEpochMilli()
        assertEquals("d7-60-2026-10-01", FeeWindows.grantStreakRewards(emptyList(), 0, 60, lateUtc).rows[0].id)
    }

    @Test fun h48NumbersKeepCountingAfterOldRowsAreTrimmed() {
        var rows: List<FeeWindow> = emptyList()
        for (i in 0 until FeeWindows.CAP + 5) {
            rows = FeeWindows.grantStreakRewards(rows, 7, 1, t0 + i * 7 * day).rows
            rows = FeeWindows.activate(rows, t0 + i * 7 * day)
            rows = FeeWindows.activate(rows, t0 + i * 7 * day + H48_MS + 1)
        }
        assertTrue(rows.size <= FeeWindows.CAP)
        assertTrue(Regex("^h48-${FeeWindows.CAP + 5}-\\d{4}-\\d{2}-\\d{2}$").matches(rows.last().id))
    }

    @Test fun capKeepsAvailableActiveRowsAndTheNewestSpentOnesOnLoad() {
        val raw = (0 until 30).joinToString(",") { i ->
            """{"id":"s$i","kind":"h48","milestone":7,"status":"spent","grantedAt":$t0,"startedAt":${i + 1},"endsAt":${1000 + i}}"""
        } + ""","id":"fresh"""".let { "," + """{"id":"fresh","kind":"h48","milestone":7,"status":"available","grantedAt":$t0,"startedAt":0,"endsAt":0}""" }
        val rows = FeeWindows.read(Json.parseToJsonElement("[$raw]"))
        assertEquals(FeeWindows.CAP, rows.size)
        assertTrue("a new reward is never dropped at the cap", rows.any { it.id == "fresh" })
        assertTrue(rows.any { it.id == "s29" })
        assertFalse(rows.any { it.id == "s0" })
    }
}
