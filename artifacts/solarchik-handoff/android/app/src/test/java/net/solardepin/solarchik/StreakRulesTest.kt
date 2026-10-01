package net.solardepin.solarchik

import net.solardepin.solarchik.core.FeeProgress
import net.solardepin.solarchik.core.FeeWindow
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.core.StreakRules
import net.solardepin.solarchik.core.StreakState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class StreakRulesTest {
    private val day0 = LocalDate.of(2026, 10, 1)
    private fun day(i: Int) = day0.plusDays(i.toLong()).toString()
    private fun noon(i: Int) = day0.plusDays(i.toLong()).atTime(12, 0).toInstant(ZoneOffset.UTC).toEpochMilli()
    private val hour = 3_600_000L

    /** Signs days [from, to] inclusive, one per UTC day. */
    private fun signRun(s0: StreakState, from: Int, to: Int): StreakState {
        var s = s0
        for (i in from..to) s = StreakRules.stamp(s, day(i), noon(i))
        return s
    }

    @Test fun firstSignStartsAtOne() {
        val s = StreakRules.stamp(StreakState(), day(0), noon(0))
        assertEquals(1, s.streak)
        assertEquals(1, s.seven)
        assertEquals(1, s.thirty)
        assertEquals(listOf(day(0)), s.clockDays)
    }

    @Test fun secondSignSameDayIsNoop() {
        val s = StreakRules.stamp(StreakState(), day(0), noon(0))
        assertEquals(s, StreakRules.stamp(s, day(0), noon(0) + hour))
    }

    @Test fun consecutiveDaysGrowAndGapResets() {
        val s3 = signRun(StreakState(), 0, 2)
        assertEquals(3, s3.streak)
        val gap = StreakRules.stamp(s3, day(4), noon(4))
        assertEquals(1, gap.streak)
        assertEquals(1, gap.seven)
        assertEquals(1, gap.thirty)
        assertEquals(listOf(day(4)), gap.clockDays)
    }

    @Test fun normalizeDropsBrokenStreakOnRead() {
        val s3 = signRun(StreakState(), 0, 2)
        assertEquals(s3, StreakRules.normalize(s3, day(3))) // yesterday signed: still alive
        val broken = StreakRules.normalize(s3, day(4))
        assertEquals(0, broken.streak)
        assertEquals(0, broken.seven)
        assertEquals(0, broken.thirty)
    }

    @Test fun sevenDaysGrantOne48hWindowAndCounterRestarts() {
        val s6 = signRun(StreakState(), 0, 5)
        assertTrue(s6.feeWindows.isEmpty())
        val s7 = StreakRules.stamp(s6, day(6), noon(6))
        assertEquals(1, s7.feeWindows.size)
        val w = s7.feeWindows.single()
        assertEquals("h48-1", w.id)
        assertEquals(FeeWindow.KIND_SHORT, w.kind)
        assertEquals(FeeWindow.AVAILABLE, w.status)
        assertEquals(7, w.milestone)
        assertEquals(0, s7.seven)
        assertEquals(7, s7.thirty)
        val s14 = signRun(s7, 7, 13)
        assertEquals(listOf("h48-1", "h48-2"), s14.feeWindows.map { it.id })
        assertEquals(14, s14.feeWindows.last().milestone)
    }

    @Test fun thirtyDaysGrantSevenDayWindowAndCounterContinues() {
        val s30 = signRun(StreakState(), 0, 29)
        val long = s30.feeWindows.filter { it.kind == FeeWindow.KIND_LONG }
        assertEquals(listOf("d7-30"), long.map { it.id })
        assertEquals(4, s30.feeWindows.count { it.kind == FeeWindow.KIND_SHORT })
        assertEquals(30, s30.thirty)
        assertEquals(30 % 7, s30.seven)
        val s31 = StreakRules.stamp(s30, day(30), noon(30))
        assertEquals(31, s31.thirty)
        val s60 = signRun(s31, 31, 59)
        assertEquals(listOf("d7-30", "d7-60"), s60.feeWindows.filter { it.kind == FeeWindow.KIND_LONG }.map { it.id })
    }

    @Test fun rewardsWaitUntilActivated() {
        val s7 = signRun(StreakState(), 0, 6)
        val p = StreakRules.progress(s7, noon(6))
        assertTrue(p is FeeProgress.Ready)
        assertFalse(StreakRules.covers(s7, noon(6)))
    }

    @Test fun activationStartsOneWindowAtATime() {
        val s14 = signRun(StreakState(), 0, 13)
        val t = noon(13) + hour
        val a = StreakRules.activate(s14, t)
        val active = a.feeWindows.filter { it.status == FeeWindow.ACTIVE }
        assertEquals(1, active.size)
        assertEquals(t, active[0].startedAt)
        assertEquals(t + SolarchikConfig.WINDOW_SHORT_MS, active[0].endsAt)
        // second activation while one runs: nothing changes
        assertEquals(a, StreakRules.activate(a, t + hour))
        val p = StreakRules.progress(a, t + hour) as FeeProgress.Active
        assertEquals(47 * hour, p.leftMs)
        // after it ends it is spent and the next one can start
        val later = t + SolarchikConfig.WINDOW_SHORT_MS + 1
        val b = StreakRules.activate(a, later)
        assertEquals(1, b.feeWindows.count { it.status == FeeWindow.SPENT })
        assertEquals(1, b.feeWindows.count { it.status == FeeWindow.ACTIVE })
    }

    @Test fun sevenDayWindowLastsSevenDays() {
        val s30 = signRun(StreakState(), 0, 29)
        // spend the four 48h windows first so the d7 is next
        var s = s30
        var t = noon(29)
        repeat(4) {
            s = StreakRules.activate(s, t)
            t += SolarchikConfig.WINDOW_SHORT_MS
        }
        s = StreakRules.activate(s, t)
        val w = s.feeWindows.single { it.status == FeeWindow.ACTIVE }
        assertEquals(FeeWindow.KIND_LONG, w.kind)
        assertEquals(7 * 24 * hour, w.endsAt - w.startedAt)
    }

    @Test fun coverageIsDecidedByOpenTime() {
        val s7 = signRun(StreakState(), 0, 6)
        val t = noon(6)
        val a = StreakRules.activate(s7, t)
        assertFalse(StreakRules.covers(a, t - 1))
        assertTrue(StreakRules.covers(a, t))
        assertTrue(StreakRules.covers(a, t + 47 * hour))
        assertFalse(StreakRules.covers(a, t + 48 * hour))
        // window expired later: a position opened inside it is still covered
        val expired = a.copy(feeWindows = StreakRules.expire(a.feeWindows, t + 72 * hour))
        assertEquals(FeeWindow.SPENT, expired.feeWindows.single().status)
        assertTrue(StreakRules.covers(expired, t + hour))
    }

    @Test fun waitProgressCountsDown() {
        val s3 = signRun(StreakState(), 0, 2)
        val p = StreakRules.progress(s3, noon(2)) as FeeProgress.Wait
        assertEquals(4, p.days48)
        assertEquals(27, p.days30)
        val s33 = signRun(StreakState(), 0, 32)
        val all = s33.feeWindows.fold(s33) { acc, _ -> acc }
        val spent = all.copy(feeWindows = all.feeWindows.map { it.copy(status = FeeWindow.SPENT) })
        val p2 = StreakRules.progress(spent, noon(32)) as FeeProgress.Wait
        assertEquals(60, p2.next30)
        assertEquals(27, p2.days30)
    }

    @Test fun seedsHistoryFromOldSave() {
        assertEquals(listOf("2026-09-29", "2026-09-30", "2026-10-01"), StreakRules.seedDays("2026-10-01", 3))
        assertTrue(StreakRules.seedDays("", 3).isEmpty())
    }
}
