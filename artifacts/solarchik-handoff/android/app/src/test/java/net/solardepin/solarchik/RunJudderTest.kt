package net.solardepin.solarchik

import net.solardepin.solarchik.game.Interp

import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunSim
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

/**
 * 0.21.9 "two robots in the run": the sim steps at a fixed 60 Hz, the screen refreshes at its own rate.
 * This replays RunView's accumulator loop on the real sim with real display timings and measures how
 * unevenly the city scrolls past the robot per displayed frame (RMS error of the per-frame scroll vs. the
 * true speed). Without interpolation a 90/120 Hz screen (and a 60 Hz one with frame-time jitter) shows the
 * same position twice and then jumps: the doubled / ghosting robot. With interpolation it is smooth.
 */
class RunJudderTest {
    private data class Result(val rmsPx: Double, val repeats: Int, val frames: Int)

    private fun replay(frameMs: (Int) -> Double, interp: Boolean): Result {
        val s = RunSim.create(7)
        while (s.phase != Phase.RUNNING) RunSim.step(s, RunSim.TICK, Autopilot.input(s))
        repeat(120) { RunSim.step(s, RunSim.TICK, Autopilot.input(s)) }
        var acc = 0.0
        var prevX = s.x
        val shown = ArrayList<Double>()
        val dts = ArrayList<Double>()
        var f = 0
        while (f < 600 && s.phase == Phase.RUNNING) {
            val dt = frameMs(f) / 1000.0
            acc += dt
            var steps = 0
            while (acc >= RunSim.TICK && steps < 3) {
                prevX = s.x
                RunSim.step(s, RunSim.TICK, Autopilot.input(s))
                acc -= RunSim.TICK; steps++
            }
            if (steps >= 3) acc = 0.0
            val a = Interp.alpha(acc, RunSim.TICK)
            shown += if (interp && Interp.continuous(prevX, s.x, 0.0, 0.0)) Interp.lerp(prevX, s.x, a) else s.x
            dts += dt
            f++
        }
        // per-frame scroll vs. the local mean speed (a 9-frame window): uneven steps show up as error
        var sq = 0.0; var n = 0; var repeats = 0
        for (i in 5 until shown.size - 5) {
            val d = shown[i] - shown[i - 1]
            if (d == 0.0) repeats++
            val v = (shown[i + 4] - shown[i - 5]) / (dts.subList(i - 4, i + 5).sum())
            val e = d - v * dts[i]
            sq += e * e; n++
        }
        return Result(sqrt(sq / n), repeats, n)
    }

    @Test fun interpolationRemovesTheJudder() {
        val cases = linkedMapOf<String, (Int) -> Double>(
            "60 Hz" to { _ -> 1000.0 / 60 },
            "60 Hz +-2 ms jitter" to { i -> 1000.0 / 60 + (if (i % 3 == 0) 2.0 else if (i % 3 == 1) -2.0 else 0.0) },
            "90 Hz" to { _ -> 1000.0 / 90 },
            "120 Hz" to { _ -> 1000.0 / 120 },
        )
        for ((name, ms) in cases) {
            val before = replay(ms, interp = false)
            val after = replay(ms, interp = true)
            println("JUDDER $name: before rms=${"%.2f".format(before.rmsPx)} units, frozen frames ${before.repeats}/${before.frames}; " +
                "after rms=${"%.2f".format(after.rmsPx)} units, frozen ${after.repeats}/${after.frames}")
            // exactly 60 Hz keeps a few float-rounding repeats (acc hovering at one tick) either way
            assertTrue("$name: frozen frames with interpolation", after.repeats <= before.repeats && after.repeats * 30 <= after.frames)
            if (before.rmsPx > 0.5) assertTrue("$name: judder not reduced", after.rmsPx < before.rmsPx / 3)
        }
    }
}
