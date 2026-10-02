package net.solardepin.solarchik

import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Input
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.Plat
import net.solardepin.solarchik.game.run.PlatKind
import net.solardepin.solarchik.game.run.RunFx
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunSounds
import net.solardepin.solarchik.game.run.RunState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 0.21.6: the run's sound tables, music choice and pooled effects. */
class RunFxAudioTest {
    private fun running(classic: Boolean = false): RunState {
        val s = RunSim.create(7, classic = classic)
        while (s.phase == Phase.COUNTDOWN) RunSim.step(s, RunSim.TICK, Input())
        s.enemies.clear()
        return s
    }

    private fun live(fx: RunFx, kind: RunFx.Kind? = null): Int =
        (0 until RunFx.CAP).count { fx.t - fx.born[it] in 0.0..fx.life[it] && (kind == null || fx.kind[it] == kind.ordinal) }

    @Test fun everyEventHasAShippedClip() {
        val dir = File("src/main/assets/audio/sfx")
        for (ev in Ev.entries) {
            val name = RunSounds.of(ev)
            assertTrue("$ev -> $name has a gain", name in RunSounds.GAIN)
            assertTrue("$ev -> $name.ogg ships", File(dir, "$name.ogg").isFile)
        }
        for (name in RunSounds.GAIN.keys) assertTrue("$name.ogg", File(dir, "$name.ogg").length() > 1000)
        assertTrue(File(dir, "start.ogg").isFile) // played by RunActivity at the start
        for (t in RunSounds.TRACKS) assertTrue(File("src/main/assets/audio/music/$t.ogg").length() > 100_000)
        assertTrue(File("src/main/assets/licenses/AUDIO-CREDITS.txt").readText().contains("CC0"))
    }

    @Test fun totalAudioStaysSmall() {
        val bytes = File("src/main/assets/audio").walk().filter { it.isFile }.sumOf { it.length() }
        assertTrue("audio is $bytes bytes", bytes < 20_000_000)
    }

    @Test fun coinStreakClimbsAMajorScaleToTheOctave() {
        val rates = (0..10).map { RunSounds.coinRate(it) }
        assertEquals(1f, rates[0], 1e-4f)
        for (i in 1..7) assertTrue(rates[i] > rates[i - 1])
        assertEquals(2f, rates[7], 1e-4f)
        assertEquals(2f, rates[10], 1e-4f)
    }

    @Test fun musicFollowsTheRun() {
        val s = running()
        fun at(m: Double): Int { s.distance = m * 10; return RunSounds.trackOf(s) }
        assertEquals(RunSounds.GOLDEN, at(100.0))
        assertEquals(RunSounds.NIGHT, at(1000.0))
        assertEquals(RunSounds.NIGHT, at(1300.0))
        assertEquals(RunSounds.STORM, at(1800.0))
        assertEquals(RunSounds.GOLDEN, at(2300.0))
        assertEquals(RunSounds.GOLDEN, at(2500.0))
        s.distance = 1000.0
        s.bossStage = 2
        assertEquals(RunSounds.BOSS, RunSounds.trackOf(s))
        s.bossStage = 4 // flying off: back to the chapter music
        assertEquals(RunSounds.GOLDEN, RunSounds.trackOf(s))
    }

    @Test fun cityRunsCarryAnEffectPoolClassicDoesNot() {
        assertNotNull(running().fx)
        assertNull(running(classic = true).fx)
        assertNull(Autopilot.copy(running()).fx)
    }

    @Test fun landingKicksDustAndCoinsBurst() {
        val s = running()
        val fx = s.fx!!
        s.plats.clear(); s.plats.add(Plat(0.0, RunSim.BANDS[1], 1e6, PlatKind.ROOF))
        s.y = RunSim.BANDS[1] - 60; s.vy = 200.0; s.grounded = false
        var landed = false
        var n = 0
        while (!landed && n++ < 40) if (Ev.LAND in RunSim.step(s, RunSim.TICK, Input())) landed = true
        assertTrue(landed)
        assertTrue(live(fx, RunFx.Kind.DUST) >= 5)
        s.picks.clear()
        s.picks.add(net.solardepin.solarchik.game.run.Pick(s.x + 4, s.y - 40, gold = false, shield = false))
        var got = false
        repeat(5) { if (Ev.COLLECT in RunSim.step(s, RunSim.TICK, Input())) got = true }
        assertTrue(got)
        assertTrue(live(fx, RunFx.Kind.GLINT) >= 4)
        assertTrue(live(fx, RunFx.Kind.RING) >= 1)
    }

    @Test fun canopyShattersIntoShards() {
        val s = running()
        s.plats.clear()
        s.plats.add(Plat(s.x - 40, s.y, 400.0, PlatKind.ROOF, crumble = true))
        var shattered = false
        repeat(60) { if (Ev.SHATTER in RunSim.step(s, RunSim.TICK, Input())) shattered = true }
        assertTrue(shattered)
        assertTrue(live(s.fx!!, RunFx.Kind.SHARD) >= 12)
    }

    @Test fun liveCablesSpark() {
        val s = running()
        s.plats.clear()
        s.plats.add(Plat(0.0, RunSim.BANDS[1], 1e6, PlatKind.ROOF))
        s.plats.add(Plat(s.x + 200, RunSim.BANDS[0], 400.0, PlatKind.WIRE, live = true))
        val wire = s.plats[1]
        s.y = RunSim.BANDS[1]; s.grounded = true
        var n = 0
        while (RunSim.wireLive(s, wire) != 2 && n++ < 500) RunSim.step(s, RunSim.TICK, Input())
        repeat(10) { RunSim.step(s, RunSim.TICK, Input()) }
        assertTrue(live(s.fx!!, RunFx.Kind.SPARK) >= 3)
    }

    @Test fun milestonesChimeEvery250mButNotOnTheGoal() {
        val s = running()
        s.plats.clear(); s.plats.add(Plat(0.0, RunSim.BANDS[1], 1e7, PlatKind.ROOF))
        s.y = RunSim.BANDS[1]; s.grounded = true
        val at = ArrayList<Int>()
        var guard = 0
        while (s.meters < 1300 && guard++ < 60 * 400) {
            val ev = RunSim.step(s, RunSim.TICK, Input())
            if (Ev.MILESTONE in ev) at.add(s.meters)
            s.hearts = 3; s.invuln = 1.0
            if (s.gustLeft > 0 || s.gustWarn > 0) { s.gustLeft = 0.0; s.gustWarn = 0.0 }
        }
        assertEquals(listOf(250, 500, 750, 1000, 1250), at.map { (it / 250) * 250 })
    }

    @Test fun overheatAndDownedAreCuedWithEffects() {
        val s = running()
        s.plats.clear(); s.plats.add(Plat(0.0, RunSim.BANDS[1], 1e6, PlatKind.ROOF))
        s.y = RunSim.BANDS[1]; s.grounded = true
        s.arenaX0 = s.x - 100; s.arenaX1 = s.x + 6000
        var overheat = false
        var guard = 0
        while (s.bossStage != 3 && guard++ < 60 * 30) {
            if (Ev.OVERHEAT in RunSim.step(s, RunSim.TICK, Input())) overheat = true
            s.hearts = 3; s.invuln = 1.0
        }
        assertTrue(overheat)
        s.bossX = s.x; s.bossY = RunSim.BANDS[1] - 50; s.invuln = 9.0
        s.y = RunSim.bossBox(s).t + 2; s.vy = 300.0; s.grounded = false
        assertTrue(Ev.DOWNED in RunSim.step(s, RunSim.TICK, Input()))
        val fx = s.fx!!
        assertTrue(live(fx, RunFx.Kind.EMBER) >= 20)
        assertTrue(live(fx, RunFx.Kind.METAL) >= 8)
    }

    @Test fun poolNeverGrows() {
        val fx = RunFx()
        repeat(5000) { fx.add(RunFx.Kind.SPARK, it.toDouble(), 0.0, 0.0, 0.0, 1.0, 1.0, 0) }
        assertEquals(RunFx.CAP, fx.born.size)
        assertEquals(RunFx.CAP, live(fx))
    }
}
