package net.solardepin.solarchik

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import net.solardepin.solarchik.core.FeeProgress
import net.solardepin.solarchik.core.FeeWindow
import net.solardepin.solarchik.game.GameSave
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class GameSaveTest {
    private lateinit var ctx: Context
    private var now = 0L
    private val day0 = LocalDate.of(2026, 10, 1)

    private fun at(dayIndex: Int, hour: Int = 12) {
        now = day0.plusDays(dayIndex.toLong()).atTime(hour, 0).toInstant(ZoneOffset.UTC).toEpochMilli()
    }

    private fun save() = GameSave(ctx) { now }

    @Before fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        ctx.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE).edit().clear().commit()
        at(0)
    }

    @Test fun runUnlocksButDoesNotRaiseStreak() {
        val s = save()
        s.recordRun(1200, 1300)
        assertTrue(s.clockedToday())
        assertFalse(s.signedToday())
        assertEquals(0, s.streak)
        assertEquals(1, s.nextStreak())
    }

    @Test fun signedClockInRaisesStreakAndKeepsHistory() {
        for (i in 0..2) {
            at(i)
            val s = save()
            s.recordRun(1200, 1200)
            s.stampClock("Addr", "Sig$i", "devnet", "tx")
            assertEquals(i + 1, s.streak)
        }
        val s = save()
        assertEquals(listOf("2026-10-01", "2026-10-02", "2026-10-03"), s.liveStreak().clockDays)
        assertEquals(3, s.clockLog().size)
        // a missed UTC day resets on read
        at(4)
        assertEquals(0, save().streak)
        assertEquals(1, save().nextStreak())
    }

    @Test fun sevenDaysGiveActivatableWindowWithCountdown() {
        var granted: List<FeeWindow> = emptyList()
        for (i in 0..6) {
            at(i)
            val s = save()
            s.recordRun(1200, 1200)
            granted = s.stampClock("Addr", "Sig$i", "devnet", "tx")
        }
        assertEquals(listOf("h48-1"), granted.map { it.id })
        val s = save()
        assertTrue(s.feeProgress() is FeeProgress.Ready)
        val opened = now + 1000
        assertTrue(s.activateWindow())
        val p = s.feeProgress() as FeeProgress.Active
        assertEquals(48L * 3600_000L, p.leftMs)
        assertTrue(s.feeWindowCovers(opened))
        assertFalse(s.activateWindow())
    }

    @Test fun readsOldSaveWithoutCounters() {
        at(5)
        ctx.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE).edit()
            .putInt("streak", 9).putString("signedDay", "2026-10-05").commit()
        val st = save().liveStreak()
        assertEquals(9, st.streak)
        assertEquals(2, st.seven)
        assertEquals(9, st.thirty)
        assertEquals(9, st.clockDays.size)
    }
}
