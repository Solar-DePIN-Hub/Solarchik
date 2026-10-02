package net.solardepin.solarchik

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.game.RunActivity
import net.solardepin.solarchik.game.RunGarage
import net.solardepin.solarchik.game.RunHud
import net.solardepin.solarchik.game.RunQuests
import net.solardepin.solarchik.game.RunResult
import net.solardepin.solarchik.game.RunStats
import net.solardepin.solarchik.game.run.ChapterId
import net.solardepin.solarchik.game.run.DeathKind
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/** Shop (RunGarage), daily quests + milestones (RunQuests) and the non-blocking CLOCK IN. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RunMetaTest {
    private lateinit var ctx: Context
    private var now = 0L
    private val day0 = LocalDate.of(2026, 10, 2)

    private fun at(dayIndex: Int) {
        now = day0.plusDays(dayIndex.toLong()).atTime(12, 0).toInstant(ZoneOffset.UTC).toEpochMilli()
    }

    @Before fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        ctx.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE).edit().clear().commit()
        at(0)
    }

    private fun run(m: Int = 300, suns: Int = 5, combo: Int = 2, stomps: Int = 0, grinds: Int = 0, unders: Int = 0) =
        RunStats(m, suns, combo, stomps, grinds, unders)

    // ---- shop ----

    @Test fun newPlayerStartsWithTheWebBalanceAndStarterGear() {
        val g = RunGarage(ctx)
        assertEquals(120, g.suns)
        assertEquals("flag", g.skin)
        assertEquals("stock", g.robot)
        assertEquals(20, RunGarage.SKINS.size)
        assertEquals(10, RunGarage.ROBOTS.size)
    }

    @Test fun buyEquipAndPersist() {
        val g = RunGarage(ctx)
        assertTrue(g.pickRobot("sunflower")) // 90
        assertEquals(30, g.suns)
        assertEquals("sunflower", g.robot)
        assertFalse("can't afford Midnight", g.pickRobot("midnight"))
        assertEquals("sunflower", RunGarage(ctx).robot) // persisted
        assertTrue(g.pickRobot("stock")) // owned: equip is free
        assertEquals(30, g.suns)
        assertTrue(g.pickRobot("sunflower"))
        assertEquals(30, g.suns)
        assertFalse(g.pickSkin("no-such-skin"))
    }

    @Test fun legacySkinsUnlockFromProgressLikeTheWeb() {
        val g = RunGarage(ctx)
        assertFalse(g.skinUnlocked("gold"))
        g.addSuns(40)
        assertTrue("gold: 40 suns collected", g.skinUnlocked("gold"))
        val prefs = ctx.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE)
        prefs.edit().putInt("bestDistance", 2000).putInt("runs", 8).commit()
        assertTrue(g.skinUnlocked("storm"))
        assertTrue(g.skinUnlocked("night"))
        assertTrue(g.skinUnlocked("ember"))
        assertTrue(g.pickSkin("night"))
        assertEquals(160, g.suns) // free
    }

    @Test fun rewardSunsAreSpendableButNotCollected() {
        val g = RunGarage(ctx)
        g.addReward(50)
        assertEquals(170, g.suns)
        assertEquals(0, g.totalSuns)
        assertFalse(g.skinUnlocked("gold"))
    }

    // ---- quests ----

    @Test fun todayHasTheWebMissionsPlusABounty() {
        val q = RunQuests(ctx, RunGarage(ctx)) { now }
        val ids = q.quests().map { it.id }
        assertEquals(listOf("clock", "suns", "combo"), ids.take(3))
        assertTrue(ids[3].startsWith("b_"))
        assertEquals(q.quests(), q.quests()) // stable within the day
    }

    @Test fun perRunQuestsNeedOneRunAndPayOnce() {
        val g = RunGarage(ctx)
        val q = RunQuests(ctx, g) { now }
        assertTrue(q.commit(run(suns = 20)).none { it.id == "suns" })
        assertTrue("two runs don't add up for a per-run quest", q.commit(run(suns = 20)).none { it.id == "suns" })
        val before = g.suns
        val got = q.commit(run(suns = 26))
        assertTrue(got.any { it.id == "suns" && it.suns == 20 })
        assertEquals(before + got.sumOf { it.suns }, g.suns)
        assertTrue(q.commit(run(suns = 30)).none { it.id == "suns" })
    }

    @Test fun bountiesAddUpOverTheDayAndTheChestPaysWhenAllAreDone() {
        val g = RunGarage(ctx)
        val q = RunQuests(ctx, g) { now }
        val b = q.quests()[3]
        val half = run(suns = b.target / 2 + 1, stomps = b.target / 2 + 1, grinds = b.target / 2 + 1, unders = b.target / 2 + 1)
        q.commit(half)
        assertFalse(q.done(b))
        q.commit(half)
        assertTrue(q.done(b))
        assertFalse(q.chestOpen())
        val all = q.commit(run(m = 2100, suns = 30, combo = 9))
        assertTrue(all.any { it.id == "chest" && it.suns == RunQuests.CHEST })
        assertTrue(q.chestOpen())
        // live progress for the in-run toast never pays
        val bal = g.suns
        q.liveDone(run(m = 2500))
        assertEquals(bal, g.suns)
    }

    @Test fun questsResetOnTheNextUtcDay() {
        val q = RunQuests(ctx, RunGarage(ctx)) { now }
        q.commit(run(suns = 30))
        assertTrue(q.done(q.quests()[1]))
        at(1)
        assertFalse(q.done(q.quests()[1]))
        assertEquals(0, q.progress(q.quests()[1]))
    }

    @Test fun milestonesPayOnceAndTheTrackMovesOn() {
        val g = RunGarage(ctx)
        val q = RunQuests(ctx, g) { now }
        ctx.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE).edit().putInt("bestDistance", 1300).commit()
        val bal = g.suns
        val ms = q.milestones()
        assertEquals(setOf("m_d600", "m_d1200"), ms.map { it.id }.toSet())
        assertEquals(bal + 90, g.suns)
        assertTrue(q.milestones().isEmpty())
        assertEquals(2000, q.nextMilestones().first { it.first.kind == "distance" }.first.target)
    }

    // ---- CLOCK IN does not end the run ----

    @Test fun clockUnlocksMidRunAndTheFinalDistanceIsRecorded() {
        val s = GameSave(ctx) { now }
        s.unlockClock(1200, 1500)
        assertTrue(s.clockedToday())
        assertEquals(0, s.runs) // the run is still going
        s.recordRun(1730, 2100)
        assertEquals(1730, s.todayDistance())
        assertEquals(1730, s.bestDistance)
        assertEquals(1, s.runs)
        assertTrue(s.clockedToday())
    }

    private fun hud(phase: Phase, meters: Int, suns: Int, clock: Boolean) = RunHud(
        hearts = if (phase == Phase.DEAD) 0 else 3, shield = 0, score = meters + suns * 10, meters = meters, combo = 0, phase = phase,
        countdown = 0.0, death = DeathKind.HIT, suns = suns, maxCombo = 3, bonus = false, bonusLeft = 0.0, grind = false,
        didBonus = false, chapter = ChapterId.STORM, announce = "", announceOn = false, clockOpen = clock, stomps = 2,
    )

    @Test fun runActivityKeepsRunningThroughClockInAndPaysAtTheEnd() {
        val a = Robolectric.buildActivity(RunActivity::class.java).setup().get()
        val save = GameSave(a)
        val garage = RunGarage(a)
        val bal = garage.suns
        a.onEvents(listOf(Ev.CLOCK), hud(Phase.RUNNING, 1200, 18, true))
        assertTrue("unlocked at once", save.clockedToday())
        assertFalse("the run is not over", a.isFinishing)
        a.onResult(RunResult(hud(Phase.DEAD, 1480, 27, true)))
        assertEquals(1480, save.bestDistance)
        assertTrue("run suns + quest rewards", garage.suns >= bal + 27 + 20)
        assertFalse(a.isFinishing)
    }
}
