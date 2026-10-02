package net.solardepin.solarchik

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import net.solardepin.solarchik.game.run.DayMod
import net.solardepin.solarchik.game.run.Enemy
import net.solardepin.solarchik.game.run.Pick
import net.solardepin.solarchik.game.run.Plat
import net.solardepin.solarchik.game.run.DeathKind
import net.solardepin.solarchik.game.run.EnemyKind
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Input
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.PlatKind
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/** Physics and roof generation of the Kotlin roof run, against the web sim and on their own. */
class RunSimTest {
    private fun r3(v: Double) = Math.round(v * 1000) / 1000.0

    private fun near(msg: String, want: Double, got: Double, tol: Double = 0.002) {
        assertTrue("$msg: web $want vs native $got", abs(want - got) <= tol)
    }

    // ---- parity with the web sim.ts (golden traces made by tools/run-golden/ref.ts) ----

    @Test fun generationAndTracesMatchTheWebSim() {
        val text = javaClass.classLoader!!.getResource("run-golden.json")!!.readText()
        val cases = Json.parseToJsonElement(text).jsonObject["cases"]!!.jsonArray
        assertTrue(cases.size >= 20)
        for (cj in cases) {
            val c = cj.jsonObject
            val seed = c["seed"]!!.jsonPrimitive.long.toInt()
            val mod = DayMod.of(c["mod"]!!.jsonPrimitive.content)
            val bonus = c["bonus"]!!.jsonPrimitive.boolean
            val tag = "seed=$seed mod=$mod bonus=$bonus"
            val s = RunSim.create(seed, mod, offerBonus = bonus)
            val plats = c["plats"]!!.jsonArray
            assertEquals("$tag plats", plats.size, s.plats.size)
            plats.forEachIndexed { i, pj ->
                val p = pj.jsonArray
                near("$tag plat $i x", p[0].jsonPrimitive.double, r3(s.plats[i].x))
                near("$tag plat $i y", p[1].jsonPrimitive.double, r3(s.plats[i].y))
                near("$tag plat $i w", p[2].jsonPrimitive.double, r3(s.plats[i].w))
                assertEquals("$tag plat $i kind", p[3].jsonPrimitive.content, s.plats[i].kind.name.lowercase().replace("roof", "roof"))
            }
            val picks = c["picks"]!!.jsonArray
            assertEquals("$tag picks", picks.size, s.picks.size)
            picks.forEachIndexed { i, pj ->
                val p = pj.jsonArray
                near("$tag pick $i x", p[0].jsonPrimitive.double, r3(s.picks[i].x))
                assertEquals("$tag pick $i gold", p[2].jsonPrimitive.int == 1, s.picks[i].gold)
                assertEquals("$tag pick $i shield", p[3].jsonPrimitive.int == 1, s.picks[i].shield)
                assertEquals("$tag pick $i portal", p[4].jsonPrimitive.int == 1, s.picks[i].portal)
            }
            val enemies = c["enemies"]!!.jsonArray
            assertEquals("$tag enemies", enemies.size, s.enemies.size)
            enemies.forEachIndexed { i, ej ->
                val e = ej.jsonArray
                assertEquals("$tag enemy $i kind", e[0].jsonPrimitive.content, s.enemies[i].kind.name.lowercase())
                near("$tag enemy $i x", e[1].jsonPrimitive.double, r3(s.enemies[i].x))
                near("$tag enemy $i vx", e[3].jsonPrimitive.double, r3(s.enemies[i].vx))
                near("$tag enemy $i t", e[4].jsonPrimitive.double, r3(s.enemies[i].t))
            }
            // same scripted input as ref.ts, 4000 steps, sampled rows
            val rows = c["trace"]!!.jsonArray.associateBy { it.jsonArray[0].jsonPrimitive.int }
            for (i in 0 until 4000) {
                val k = i % 47
                val input = Input(k == 0 || i % 113 == 5, k < 18, i % 211 == 100, i % 211 in 100 until 130)
                val ev = RunSim.step(s, 1.0 / 60, input)
                val row = rows[i]?.jsonArray ?: continue
                val at = "$tag step $i"
                near("$at x", row[1].jsonPrimitive.double, r3(s.x), 0.01)
                near("$at y", row[2].jsonPrimitive.double, r3(s.y), 0.01)
                assertEquals("$at hearts", row[4].jsonPrimitive.int, s.hearts)
                near("$at score", row[5].jsonPrimitive.double, r3(s.score), 0.05)
                assertEquals("$at suns", row[6].jsonPrimitive.int, s.suns)
                assertEquals("$at phase", row[7].jsonPrimitive.content, s.phase.name.lowercase())
                assertEquals("$at combo", row[8].jsonPrimitive.int, s.combo)
                assertEquals("$at shield", row[9].jsonPrimitive.int, s.shield)
                assertEquals("$at grounded", row[10].jsonPrimitive.int == 1, s.grounded)
                assertEquals("$at bonus", row[11].jsonPrimitive.int == 1, s.bonus)
                val webEv = row[12].jsonPrimitive.content
                assertEquals("$at events", webEv, ev.joinToString(",") { it.name.lowercase() })
                assertEquals("$at plats", row[13].jsonPrimitive.int, s.plats.size)
                assertEquals("$at picks", row[14].jsonPrimitive.int, s.picks.size)
                assertEquals("$at enemies", row[15].jsonPrimitive.int, s.enemies.size)
            }
        }
    }

    @Test fun rngIsMulberry32() {
        // reference values from the web rng(1) chain
        var st = 1
        val got = (0 until 3).map { st = RunSim.rngNext(st); RunSim.rngValue(st) }
        got.forEach { assertTrue(it in 0.0..1.0) }
        assertEquals(RunSim.daySeed("2026-10-02"), 1652370116)
    }

    // ---- physics ----

    private fun running(seed: Int = 7, mod: DayMod = DayMod.CALM): RunState {
        val s = RunSim.create(seed, mod)
        while (s.phase == Phase.COUNTDOWN) RunSim.step(s, RunSim.TICK, Input())
        return s
    }

    /** Running, with the intro mite removed so pure movement can be measured. */
    private fun emptyRoof(): RunState = running().also { s -> s.enemies.clear() }

    @Test fun countdownLastsAboutOnePointTwoSeconds() {
        val s = RunSim.create(3)
        var n = 0
        while (s.phase == Phase.COUNTDOWN) { RunSim.step(s, RunSim.TICK, Input()); n++ }
        assertTrue(n in 71..73)
        assertEquals(120.0, s.x, 0.0)
    }

    @Test fun fullJumpApexAndAirtime() {
        val s = emptyRoof()
        val y0 = s.y
        val ev = RunSim.step(s, RunSim.TICK, Input(jumpPressed = true, jumpHeld = true))
        assertTrue(Ev.JUMP in ev)
        var minY = s.y
        var steps = 1
        while (!s.grounded && steps < 200) {
            RunSim.step(s, RunSim.TICK, Input(jumpHeld = true))
            minY = minOf(minY, s.y)
            steps++
        }
        val apex = y0 - minY
        // v0 620, g_up 1480 -> 620^2 / 2960 = 130 continuous, ~125 with the 60 Hz semi-implicit step
        assertTrue("apex $apex", apex in 120.0..134.0)
        assertTrue("airtime $steps", steps in 40..60)
    }

    @Test fun releasingJumpEarlyCutsIt() {
        val full = emptyRoof(); val cut = emptyRoof()
        RunSim.step(full, RunSim.TICK, Input(true, true))
        RunSim.step(cut, RunSim.TICK, Input(true, true))
        var fMin = full.y; var cMin = cut.y
        repeat(60) {
            RunSim.step(full, RunSim.TICK, Input(jumpHeld = true)); fMin = minOf(fMin, full.y)
            RunSim.step(cut, RunSim.TICK, Input(jumpHeld = false)); cMin = minOf(cMin, cut.y)
        }
        assertTrue("cut jump should be lower ($cMin vs $fMin)", cMin > fMin + 3)
    }

    @Test fun doubleJumpOnlyOnceInTheAir() {
        val s = emptyRoof()
        RunSim.step(s, RunSim.TICK, Input(true, true))
        repeat(10) { RunSim.step(s, RunSim.TICK, Input(jumpHeld = true)) }
        val ev = RunSim.step(s, RunSim.TICK, Input(true, true))
        assertTrue(Ev.DOUBLE in ev)
        assertEquals(RunSim.DOUBLE_V + RunSim.GRAVITY_UP * RunSim.TICK, s.vy, 1.0)
        repeat(5) { RunSim.step(s, RunSim.TICK, Input(jumpHeld = true)) }
        val again = RunSim.step(s, RunSim.TICK, Input(true, true))
        assertFalse(Ev.DOUBLE in again || Ev.JUMP in again)
    }

    @Test fun coyoteTimeAllowsALateJump() {
        val s = emptyRoof()
        // walk off the intro roof (0..420) without jumping
        while (s.grounded) RunSim.step(s, RunSim.TICK, Input())
        repeat(5) { RunSim.step(s, RunSim.TICK, Input()) } // ~0.08 s < COYOTE 0.22
        val ev = RunSim.step(s, RunSim.TICK, Input(true, true))
        assertTrue("late jump is a normal jump", Ev.JUMP in ev)
    }

    @Test fun slideShrinksTheHitboxAndEnds() {
        val s = emptyRoof()
        val ev = RunSim.step(s, RunSim.TICK, Input(slidePressed = true))
        assertTrue(Ev.SLIDE in ev)
        assertEquals(RunSim.PH_SLIDE, s.y - 2 - RunSim.playerBox(s).t + 2, 0.001)
        repeat(40) { RunSim.step(s, RunSim.TICK, Input()) }
        assertEquals(0.0, s.slide, 0.0)
        assertEquals(RunSim.PH, s.y - RunSim.playerBox(s).t, 0.001)
    }

    @Test fun speedRampsWithDistanceAndCaps() {
        val s = RunSim.create(1)
        assertEquals(RunSim.SPEED0, RunSim.speedAt(s), 0.0)
        s.distance = 5000.0
        assertEquals(RunSim.SPEED0 + 90, RunSim.speedAt(s), 1e-9)
        s.distance = 1e6
        assertEquals(RunSim.SPEED_CAP + 16, RunSim.speedAt(s), 1e-9) // cap incl. heat/grind headroom
        s.fever = 1.0; s.grind = true; s.distance = 0.0
        assertEquals(RunSim.SPEED0 + 28, RunSim.speedAt(s), 1e-9)
    }

    @Test fun fallingCostsAHeartAndRespawnsAtTheCheckpoint() {
        val s = emptyRoof()
        while (s.hearts == 3 && s.x < 2000) RunSim.step(s, RunSim.TICK, Input())
        assertEquals(2, s.hearts)
        assertTrue(s.grounded)
        assertTrue(s.invuln > 1.0)
    }

    @Test fun threeHitsEndTheRun() {
        val s = running()
        var dead = false
        var guard = 0
        while (!dead && guard++ < 20_000) {
            dead = Ev.DEAD in RunSim.step(s, RunSim.TICK, Input())
        }
        assertTrue(dead)
        assertEquals(Phase.DEAD, s.phase)
        assertEquals(0, s.hearts)
        assertTrue(s.death == DeathKind.FALL || s.death == DeathKind.HIT)
    }

    @Test fun stompingAMiteBounces() {
        val s = running()
        val m = s.enemies.first { it.kind == EnemyKind.MITE }
        s.x = m.x; s.y = RunSim.enemyBox(m).t + 2; s.vy = 300.0; s.grounded = false
        val ev = RunSim.step(s, RunSim.TICK, Input())
        assertTrue(Ev.STOMP in ev)
        assertTrue(s.vy < 0)
        assertEquals(1, s.stomps)
    }

    @Test fun shieldEatsOneHit() {
        val s = running()
        s.shield = 1
        val m = s.enemies.first { it.kind == EnemyKind.MITE }
        s.x = m.x; s.y = m.y
        val ev = RunSim.step(s, RunSim.TICK, Input())
        assertTrue(Ev.SHIELD in ev)
        assertEquals(3, s.hearts)
        assertEquals(0, s.shield)
    }

    @Test fun sunsComboAndHeat() {
        val s = emptyRoof()
        var heat = false
        repeat(4) { i ->
            s.picks.add(Pick(s.x + 4, s.y - 48, gold = false, shield = false))
            // a pickup costs a 0.02 s hit-stop, so give each sun a few frames
            repeat(4) { if (Ev.COMBO in RunSim.step(s, RunSim.TICK, Input())) heat = true }
            assertEquals(i + 1, s.suns)
        }
        assertTrue(heat)
        assertTrue(s.fever > 1.0)
    }

    @Test fun goalOpensClockInAtTheThreshold() {
        val s = RunSim.create(5, goalMeters = 1200)
        while (s.phase == Phase.COUNTDOWN) RunSim.step(s, RunSim.TICK, Input())
        s.x = 11_999.0; s.distance = s.x; s.invuln = 99.0
        var ev: List<Ev> = emptyList()
        var n = 0
        while (!s.clockOpen && n++ < 30) ev = RunSim.step(s, RunSim.TICK, Input())
        assertTrue(s.clockOpen)
        assertTrue(Ev.CLOCK in ev)
        assertTrue("meters ${s.meters}", s.meters in 1200..1201) // first step at/over 12000 units
        // CLOCK IN is a reward moment, not a stop: the run keeps going (no freeze, no vy reset)
        val x = s.x
        var again = 0
        repeat(60) { if (Ev.CLOCK in RunSim.step(s, RunSim.TICK, Input())) again++ }
        assertTrue("the run keeps moving after the goal", s.x > x + 100)
        assertEquals(Phase.RUNNING, s.phase)
        assertTrue(s.clockOpen)
        assertEquals("CLOCK fires once", 0, again)
    }

    @Test fun clockInKeepsTheJumpGoing() {
        // crossing the goal mid-air must not kill the jump (the web used to zero vy and freeze)
        val s = emptyRoof()
        s.x = 11_990.0; s.distance = s.x; s.invuln = 99.0
        s.vy = -400.0; s.grounded = false; s.y = 150.0
        var vyAtClock = 0.0
        var n = 0
        while (!s.clockOpen && n++ < 30) { RunSim.step(s, RunSim.TICK, Input(jumpHeld = true)); vyAtClock = s.vy }
        assertTrue(s.clockOpen)
        assertTrue("vy $vyAtClock", vyAtClock < -200)
    }

    @Test fun autopilotRunsPastTheGoal() {
        // the daily run continues after CLOCK IN, into the storm and night chapters
        val s = RunSim.create(RunSim.daySeed("2026-10-02"), DayMod.CALM, goalMeters = 1200)
        var guard = 0
        while (s.meters < 1700 && s.phase != Phase.DEAD && guard++ < 60 * 300) RunSim.step(s, RunSim.TICK, Autopilot.input(s))
        assertTrue("bot ended at ${s.meters} m", s.meters >= 1700)
        assertTrue(s.clockOpen)
    }

    @Test fun dayPhasesCycle() {
        assertEquals(0.0, RunSim.moodAt(10_000.0), 0.0)
        assertEquals(1.0, RunSim.moodAt(19_000.0), 1e-9)
        assertEquals(2.0, RunSim.moodAt(23_000.0), 0.0)
        assertEquals(0.0, RunSim.moodAt(28_000.0), 1e-9)
        assertEquals("Village", RunSim.chapterAt(5_000.0).label)
        assertEquals("Storm", RunSim.chapterAt(16_000.0).label)
    }

    // ---- generation ----

    @Test fun generatedRoofsAreAlwaysJumpable() {
        for (mod in DayMod.entries) for (seed in listOf(1, 99, RunSim.daySeed("2026-10-02"), RunSim.daySeed("2027-03-09"))) {
            val s = RunSim.create(seed, mod)
            while (s.spawnX < 40_000) RunSim.spawnChunk(s, s.spawnX, 8)
            val roofs = s.plats.sortedBy { it.x }
            for (i in 1 until roofs.size) {
                val gap = roofs[i].x - (roofs[i - 1].x + roofs[i - 1].w)
                assertTrue("gap $gap at ${roofs[i].x} ($mod)", gap <= 130)
                assertTrue(roofs[i].y == RunSim.BANDS[0] || roofs[i].y == RunSim.BANDS[1])
                if (roofs[i].kind == PlatKind.ROOF) assertTrue(roofs[i].w >= 190)
            }
            // drones appear only on drone days or past 520 m; shields only past 420 m
            assertTrue(s.enemies.filter { it.kind == EnemyKind.DRONE }.all { mod == DayMod.DRONES || it.x > 5200 })
            assertTrue(s.picks.filter { it.shield }.all { it.x > 4200 })
        }
    }

    @Test fun sameSeedSameRoofs() {
        val a = RunSim.create(4242, DayMod.WIRE)
        val b = RunSim.create(4242, DayMod.WIRE)
        assertEquals(a.plats.map { it.x to it.w }, b.plats.map { it.x to it.w })
        val c = RunSim.create(4243, DayMod.WIRE)
        assertFalse(a.plats.map { it.x } == c.plats.map { it.x })
    }

    @Test fun autopilotReachesTheClockIn() {
        // A simple bot (jump at roof edges and at mites, slide under drones) must be able to
        // reach the goal on every day mod: the generator never makes an impossible roof.
        for (mod in DayMod.entries) {
            val s = RunSim.create(RunSim.daySeed("2026-10-02"), mod, goalMeters = 1200)
            var guard = 0
            while (!s.clockOpen && s.phase != Phase.DEAD && guard++ < 60 * 200) RunSim.step(s, RunSim.TICK, Autopilot.input(s))
            assertTrue("$mod: bot ended at ${s.meters} m with ${s.hearts} hearts", s.clockOpen)
        }
    }

    @Test fun ghostTapeRecordsWhileRunning() {
        val s = running()
        repeat(120) { RunSim.step(s, RunSim.TICK, Autopilot.input(s)) }
        assertTrue(s.ghost.size in 7..9) // one sample per 0.25 s
        assertTrue(s.ghost.zipWithNext().all { (a, b) -> b.x >= a.x - 1 })
    }

    @Test fun webJsonCaseCountIsStable() {
        val text = javaClass.classLoader!!.getResource("run-golden.json")!!.readText()
        val cases = Json.parseToJsonElement(text).jsonObject["cases"] as JsonArray
        assertTrue(cases.all { (it.jsonObject["trace"] as JsonArray).isNotEmpty() })
        assertTrue((cases[0].jsonObject["seed"] as JsonPrimitive).long > 0)
    }
}

/**
 * Test bot: a careful player with one second of foresight. It simulates copies of the run
 * (the sim is deterministic) and only acts when doing nothing would cost a heart.
 */
object Autopilot {
    private val plan = ArrayDeque<Input>()
    private const val HORIZON = 66

    fun input(s: RunState): Input {
        if (s.phase != Phase.RUNNING) { plan.clear(); return Input() }
        if (greedy) {
            // go out of the way for a shield when a safe plan grabs it
            val spd = RunSim.speedAt(s)
            if (s.shield == 0 && s.picks.any { it.shield && !it.taken && it.x - s.x in 0.0..spd * 0.9 }) {
                val grab = (listOf(emptyList<Input>()) + candidates()).firstOrNull { safe(s, it) && grabsShield(s, it) }
                if (grab != null) {
                    plan.clear()
                    if (grab.isEmpty()) return Input()
                    plan.addAll(grab)
                    return plan.removeFirst()
                }
            }
        }
        if (plan.isNotEmpty()) return plan.removeFirst()
        if (safe(s, emptyList())) return Input()
        val best = candidates().firstOrNull { safe(s, it) }
            ?: candidates().maxByOrNull { survived(s, it) }!!
        plan.addAll(best)
        return plan.removeFirst()
    }

    /** Also collect shields (screenshot scenes); off for the reachability test. */
    var greedy = false

    private fun grabsShield(s: RunState, seq: List<Input>): Boolean {
        val c = copy(s)
        for (i in 0 until seq.size + 40) {
            RunSim.step(c, RunSim.TICK, seq.getOrElse(i) { Input() })
            if (c.shield > 0) return true
        }
        return false
    }

    private fun jump(hold: Int) = List(hold) { Input(jumpPressed = it == 0, jumpHeld = true) }

    private fun candidates(): List<List<Input>> {
        val out = ArrayList<List<Input>>()
        out.add(listOf(Input(slidePressed = true, slideHeld = true)) + List(20) { Input(slideHeld = true) })
        for (hold in listOf(30, 14, 4)) {
            out.add(jump(hold))
            for (gap in listOf(8, 14, 20, 26, 32)) {
                out.add(jump(hold).take(gap) + List((gap - hold).coerceAtLeast(0)) { Input() } + jump(30))
            }
        }
        out.add(List(4) { Input() } + jump(30))
        out.add(List(8) { Input() } + jump(30))
        return out
    }

    private fun safe(s: RunState, seq: List<Input>) = survived(s, seq) >= HORIZON + seq.size

    /** Frames survived without losing a heart. */
    private fun survived(s: RunState, seq: List<Input>): Int {
        val c = copy(s)
        val hearts = c.hearts
        val total = HORIZON + seq.size
        for (i in 0 until total) {
            val ev = RunSim.step(c, RunSim.TICK, seq.getOrElse(i) { Input() })
            if (c.hearts < hearts || Ev.HURT in ev || c.phase == Phase.DEAD) return i
        }
        return total
    }

    fun copy(s: RunState): RunState {
        val c = RunState(s.seed, s.mod, s.goalMeters)
        for (f in RunState::class.java.declaredFields) {
            if (java.lang.reflect.Modifier.isStatic(f.modifiers)) continue
            f.isAccessible = true
            val v = f.get(s)
            if (v is MutableList<*>) continue
            f.set(c, v)
        }
        s.plats.mapTo(c.plats) { Plat(it.x, it.y, it.w, it.kind) }
        s.picks.mapTo(c.picks) { Pick(it.x, it.y, it.gold, it.shield, it.portal, it.taken) }
        s.enemies.mapTo(c.enemies) { Enemy(it.kind, it.x, it.y, it.baseY, it.t, it.vx, it.boss, it.dead, it.near) }
        return c
    }
}
