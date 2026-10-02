package net.solardepin.solarchik

import net.solardepin.solarchik.game.run.DayMod
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunSim
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 0.21.7 difficulty: a human-like bot (reacts up to ±[JITTER] frames off the centre of the safe
 * window, i.e. ±83 ms) on city rules. The owner could not get far; the rebalance must let an
 * ordinary player reach 1000 m on most days and keep the first 300 m hazard-free.
 */
class RunBalanceTest {
    private fun reach(seed: Int, limitM: Int): Int {
        Autopilot.reset()
        Autopilot.jitter = JITTER
        Autopilot.rng = java.util.Random(seed.toLong())
        try {
            val s = RunSim.create(seed, DayMod.CALM, goalMeters = 1200)
            var guard = 0
            while (s.meters < limitM && s.phase != Phase.DEAD && guard++ < 60 * 400) RunSim.step(s, RunSim.TICK, Autopilot.input(s))
            return s.meters
        } finally {
            Autopilot.jitter = 0
            Autopilot.reset()
        }
    }

    @Test fun humanLikeBotUsuallyReaches1000m() {
        val days = listOf("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06")
        val got = days.map { reach(RunSim.daySeed(it), 1000) }
        println("RunBalance jitter=$JITTER reach(m) per day: $got")
        assertTrue("reach $got", got.count { it >= 1000 } >= days.size * 2 / 3)
        assertTrue("reach $got", got.all { it >= 300 })
    }

    @Test fun firstRoofsAreCalm() {
        val s = RunSim.create(RunSim.daySeed("2026-10-02"), DayMod.CALM, goalMeters = 1200)
        // only the slow tutorial mite at 30 m (web createRun parity) before 300 m
        while (s.spawnX < 6000) RunSim.spawnChunk(s, s.spawnX, 8)
        val early = s.enemies.filter { it.x < RunSim.CITY_CALM_TO && it.x != 300.0 }
        assertTrue("foes before 300 m: ${early.map { it.x }}", early.isEmpty())
        assertTrue(s.plats.none { (it.crumble || it.live) && it.x < RunSim.CITY_CALM_TO })
    }

    private companion object {
        const val JITTER = 5
    }
}
