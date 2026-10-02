package net.solardepin.solarchik.game.run

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/*
 * Roof run simulation, a line-for-line port of the web runner (src/lib/game/sim.ts on the
 * Solarchik web build). World units are the web's CSS pixels: x grows to the right, y grows
 * down, roofs sit on the bands 168/216/264 and a fall is past y 348. The step is fixed at
 * 1/60 s by the caller (RunLoop), exactly like the web requestAnimationFrame accumulator.
 *
 * Pure Kotlin on purpose (no android.*), so physics and generation are unit-tested on the JVM.
 * One RunState is owned by exactly one thread (the game thread); nothing here is synchronized.
 */

enum class PlatKind { ROOF, WIRE }
enum class EnemyKind { MITE, DRONE, BUSH }
enum class Phase { COUNTDOWN, RUNNING, DEAD }
enum class DeathKind { NONE, FALL, HIT }
enum class DayMod(val id: String) {
    CALM("calm"), WIND("wind"), GOLD("gold"), DRONES("drones"), WIRE("wire");

    companion object {
        fun of(id: String): DayMod = entries.firstOrNull { it.id == id } ?: CALM
    }
}

enum class Ev {
    JUMP, DOUBLE, LAND, COLLECT, GOLD, HURT, NEAR, COMBO, DEAD, TICK, STOMP, SHIELD, SLIDE,
    GRIND, BONUS, THUNDER, BOSS, CHAPTER, CLOCK,
    // city rules
    GUST, CRACK, ZAP, CHARGE, BEAM, DOWNED,
    // native 0.21.6 (sound/FX cues; no effect on play)
    SHATTER, OVERHEAT, MILESTONE,
}

enum class ChapterId { SUNRISE, VILLAGE, STORM, NIGHT, SERPENT }

class Chapter(val id: ChapterId, val label: String, val banner: String, val meters: Int)

class Plat(
    var x: Double,
    var y: Double,
    var w: Double,
    val kind: PlatKind,
    /** City rules: a cracked solar roof that gives way [RunSim.CRACK_TIME] s after it is first stood on. */
    val crumble: Boolean = false,
    /** City rules: a sparking cable (live on a fixed cycle, see [RunSim.wireLive]). */
    val live: Boolean = false,
    /** Seconds since first contact (crumble roofs), -1 untouched. */
    var crackT: Double = -1.0,
    /** Gave way: no longer solid; [fallY] is the presentation drop. */
    var fallen: Boolean = false,
    var fallY: Double = 0.0,
)

class Pick(
    var x: Double,
    var y: Double,
    val gold: Boolean,
    val shield: Boolean,
    val portal: Boolean = false,
    var taken: Boolean = false,
)

class Enemy(
    val kind: EnemyKind,
    var x: Double,
    var y: Double,
    var baseY: Double,
    var t: Double,
    var vx: Double,
    val boss: Boolean,
    var dead: Boolean = false,
    var near: Boolean = false,
    /** Hover bob amplitude / rate (city drone waves bob wider, out of phase). */
    var amp: Double = 0.0,
    var rate: Double = 0.0,
)

class Pop(var x: Double, var y: Double, val text: String, var life: Double)

class Particle(
    var x: Double,
    var y: Double,
    var vx: Double,
    var vy: Double,
    var life: Double,
    var r: Double,
    /** ARGB */
    val color: Int,
    val ring: Boolean = false,
    val streak: Boolean = false,
)

class Input(
    val jumpPressed: Boolean = false,
    val jumpHeld: Boolean = false,
    val slidePressed: Boolean = false,
    val slideHeld: Boolean = false,
)

/** One ghost sample every [RunSim.GHOST_DT] seconds of running time, in world units. */
class GhostSample(val x: Double, val y: Double, val grounded: Boolean)

class RunState(val seed: Int, val mod: DayMod, val goalMeters: Int) {
    var phase = Phase.COUNTDOWN
    var countdown = 1.2
    var x = 120.0
    var y = RunSim.BANDS[1]
    var vy = 0.0
    var grounded = true
    var hearts = RunSim.HEARTS
    var shield = 0
    var score = 0.0
    var suns = 0
    var stomps = 0
    var combo = 0
    var comboTimer = 0.0
    var maxCombo = 0
    var coyote = RunSim.COYOTE
    var jumpBuf = 0.0
    var airJumps = 1
    var jumpAge = 0.0
    var cutJump = false
    var invuln = 0.0
    var hitstop = 0.0
    var squash = 0.0
    var stretch = 0.0
    var shake = 0.0
    var flash = 0.0
    var runPhase = 0.0
    val plats = ArrayList<Plat>()
    val picks = ArrayList<Pick>()
    val enemies = ArrayList<Enemy>()
    val pops = ArrayList<Pop>()
    val particles = ArrayList<Particle>()
    var checkX = 120.0
    var checkY = RunSim.BANDS[1]
    var death = DeathKind.NONE
    var hasJumped = false
    /** First run on this phone: tutorial hints (HUD hint line, TAP bubble, SLIDE pop). */
    var tutorial = true
    var slid = false
    var distance = 0.0
    var fever = 0.0
    var spawnX = 0.0
    var lastBand = 1
    var rngState = if (seed == 0) 1 else seed
    var sinceHazard = 3
    var slide = 0.0
    var grind = false
    var bonus = false
    var bonusLeft = 0.0
    var didBonus = false
    var bossDone = false
    var stormT = 0.0
    var lightning = 0.0
    var slideHint = false
    var chapter = ChapterId.SUNRISE
    var announce = ""
    var announceLife = 0.0
    var clockSaid = false
    var clockOpen = false
    /** Seconds spent in RUNNING (drives the ghost tape). */
    var runTime = 0.0
    /** City effect particles (0.21.6, presentation only). Null in look-ahead copies and classic runs. */
    var fx: RunFx? = null
    /** Next city distance milestone (m), every [RunSim.MILESTONE_M]. */
    var nextMilestone = 250
    val ghost = ArrayList<GhostSample>()
    /** Native stats for daily quests (not in the web state; no effect on play). */
    var grinds = 0
    var unders = 0

    // ---- city rules (native 0.21.4; off when [classic] for the web-parity golden traces) ----
    var classic = false
    /** Wind gust: seconds to the next one, its warning and its blow (headwind + downdraft). */
    var gustNext = 9.0
    var gustWarn = 0.0
    var gustLeft = 0.0
    /** Mini-boss (a maintenance drone) every [RunSim.BOSS_EVERY] m on its own arena roof. */
    var bossNextX = RunSim.BOSS_EVERY * 10.0
    var arenaX0 = -1.0
    var arenaX1 = -1.0
    /** 0 none, 1 intro, 2 attacking, 3 overheated (stomp it), 4 leaving. */
    var bossStage = 0
    var bossT = 0.0
    var bossX = 0.0
    var bossY = 0.0
    var bossShots = 0
    /** Current shot: lane 0 low (jump it) / 1 high (slide under it); [bossTele] warning, [bossBeam] firing. */
    var bossLane = 0
    var bossTele = 0.0
    var bossBeam = 0.0
    var bossRest = 0.0
    var bossDowned = 0
    var bossHit = false

    /** Whole meters as the web HUD shows them (distance / 10, rounded). */
    val meters: Int get() = Math.round(distance / 10.0).toInt()
}

object RunSim {
    val BANDS = doubleArrayOf(168.0, 216.0, 264.0)
    const val HEARTS = 3

    val CHAPTERS = listOf(
        Chapter(ChapterId.SUNRISE, "Golden hour", "GOLDEN HOUR", 0),
        Chapter(ChapterId.VILLAGE, "Solar district", "SOLAR DISTRICT", 500),
        Chapter(ChapterId.STORM, "Storm", "STORM LINE", 1600),
        Chapter(ChapterId.NIGHT, "Night city", "NIGHT CITY", 2000),
        Chapter(ChapterId.SERPENT, "Skyline", "THE SKYLINE", 2500),
    )

    const val BOSS_BANNER = "MAINTENANCE DRONE"
    /** The tutorial hint line shows this long into the first run (then fades), or until a jump and a slide. */
    /** City milestone spacing (m): a chime and a pop, not a gameplay change. */
    const val MILESTONE_M = 250
    const val HINT_TIME = 4.5

    const val GRAVITY_UP = 1480.0
    const val GRAVITY_DOWN = 2400.0
    const val JUMP_V = -620.0
    const val DOUBLE_V = -680.0
    const val STOMP_V = -640.0
    const val TERMINAL = 1150.0
    const val SPEED0 = 188.0
    const val SPEED_CAP = 355.0
    const val COYOTE = 0.22
    const val BUFFER = 0.16
    const val FEET = 12.0
    const val FALL_Y = 348.0
    const val PW = 14.0
    const val PH = 62.0
    const val PH_SLIDE = 24.0
    const val SLIDE_TIME = 0.48
    const val TICK = 1.0 / 60.0
    const val GHOST_DT = 0.25
    const val GHOST_MAX = 480

    // city rules
    /**
     * City pace (0.21.7 rebalance; the owner could not get far): start 205, a gentle ramp to 1500 m,
     * then the old steepness to the 410 cap (was 215 + 0.021/unit, capped by ~930 m).
     */
    const val CITY_SPEED0 = 205.0
    const val CITY_RAMP = 0.009
    const val CITY_RAMP_LATE = 0.02
    const val CITY_RAMP_KNEE = 15000.0
    const val CITY_CAP = 410.0
    /** City hitboxes (smaller than the drawn sprites, so near misses read as misses). */
    const val CITY_PW = 12.0
    /** Grace after a lost heart on city roofs (classic keeps 1.45 s). */
    const val CITY_INVULN = 1.8
    const val CITY_DIFF_FROM = 2000.0
    const val CITY_DIFF_SPAN = 16000.0
    const val CITY_CALM_TO = 3000.0
    const val CITY_DRONE_FROM = 4000.0
    const val CITY_WIRE_FROM = 4500.0
    const val CITY_CRUMBLE_FROM = 5500.0
    const val CITY_WAVE_FROM = 11000.0
    const val CITY_EASY_TO = 15000.0
    const val CRACK_TIME = 0.38
    const val WIRE_CYCLE = 2.2
    const val WIRE_WARN = 1.2
    const val WIRE_LIVE = 1.6
    const val GUST_WARN = 1.0
    const val GUST_TIME = 1.4
    const val GUST_SLOW = 0.75
    const val BOSS_EVERY = 1000
    const val ARENA_W = 4200.0
    const val BOSS_SHOTS = 5
    const val BOSS_TELE = 0.7
    const val BOSS_BEAM = 0.26
    const val BOSS_REST = 0.5
    const val BOSS_HOT = 1.9
    /** Beam boxes relative to the arena roof: low = jump it, high = slide under it. */
    val BEAM_LOW = doubleArrayOf(-26.0, -6.0)
    val BEAM_HIGH = doubleArrayOf(-70.0, -34.0)

    // particle colours (web hex strings as ARGB)
    const val C_DUST = 0xFFE8D9B0.toInt()
    private const val C_BLUE = 0xFF5AA8FF.toInt()
    const val C_GOLD = 0xFFFFD24A.toInt()
    private const val C_SLIDE = 0xFFC9D8FF.toInt()
    private const val C_SHIELD = 0xFF7EC8FF.toInt()
    private const val C_HIT = 0xFFE0564A.toInt()
    private const val C_FALL = 0xFFE8B931.toInt()
    private const val C_DRONE = 0xFF6EC8C4.toInt()
    private const val C_MITE = 0xFFC47A3A.toInt()
    private const val C_RING = 0xFFFFE27A.toInt()
    private const val C_WIND = 0xFFEFE2C4.toInt()
    private const val C_GRIND = 0xFF9AD0FF.toInt()
    const val C_HEAT_Y = 0xFFFFE34A.toInt()
    private const val C_HEAT_B = 0xFF3D7CFF.toInt()
    const val C_LAND = 0xFFCBB07A.toInt()
    private const val C_LAND_RING = 0xE6F3E2C4.toInt()
    const val C_SUN = 0xFFFFB703.toInt()
    private const val C_STREAK = 0xFFFFFDF8.toInt()
    private const val C_CLEAN = 0xFFD6F5A3.toInt()

    fun chapterAt(distance: Double): Chapter {
        val m = distance / 10
        var cur = CHAPTERS[0]
        for (c in CHAPTERS) if (m >= c.meters) cur = c
        return cur
    }

    /** mulberry32, bit-exact with the web (Math.imul / >>> semantics). */
    fun rngNext(state: Int): Int {
        var t = state + 0x6d2b79f5
        t = (t xor (t ushr 15)) * (t or 1)
        t = t xor (t + (t xor (t ushr 7)) * (t or 61))
        return t xor (t ushr 14)
    }

    fun rngValue(next: Int): Double = (next.toLong() and 0xFFFFFFFFL) / 4294967296.0

    private fun rand(s: RunState, a: Double, b: Double): Double {
        val n = rngNext(s.rngState)
        s.rngState = n
        return a + (b - a) * rngValue(n)
    }

    private fun chance(s: RunState, p: Double) = rand(s, 0.0, 1.0) < p

    fun speedAt(s: RunState): Double {
        val heat = if (s.fever > 0) 10.0 else 0.0
        val grind = if (s.grind) 18.0 else 0.0
        if (!s.classic) return min(CITY_CAP + 16, citySpeed(s.distance) + heat + grind)
        return min(SPEED_CAP + 16, SPEED0 + s.distance * 0.018 + heat + grind)
    }

    fun citySpeed(d: Double): Double =
        if (d < CITY_RAMP_KNEE) CITY_SPEED0 + d * CITY_RAMP
        else CITY_SPEED0 + CITY_RAMP_KNEE * CITY_RAMP + (d - CITY_RAMP_KNEE) * CITY_RAMP_LATE

    private fun feetOn(px: Double, p: Plat) = !p.fallen && px >= p.x - FEET && px <= p.x + p.w + FEET

    /** Sparking cable phase: 0 safe, 1 crackling (warning), 2 live (hurts). Fixed cycle per cable. */
    fun wireLive(s: RunState, p: Plat): Int {
        if (!p.live) return 0
        val t = ((s.runTime + p.x * 0.0037) % WIRE_CYCLE + WIRE_CYCLE) % WIRE_CYCLE
        return if (t >= WIRE_LIVE) 2 else if (t >= WIRE_WARN) 1 else 0
    }

    /** The boss beam box this step (null when not firing). */
    fun beamBox(s: RunState): Box? {
        if (s.bossBeam <= 0) return null
        val y0 = BANDS[1]
        val lane = if (s.bossLane == 0) BEAM_LOW else BEAM_HIGH
        return Box(s.x - 420, s.bossX - 30, y0 + lane[0], y0 + lane[1])
    }

    fun bossBox(s: RunState): Box = Box(s.bossX - 44, s.bossX + 44, s.bossY - 40, s.bossY + 4)

    class Box(val l: Double, val r: Double, val t: Double, val b: Double)

    fun playerBox(s: RunState): Box {
        val h = if (s.slide > 0) PH_SLIDE else PH
        val pw = if (s.classic) PW else CITY_PW
        return Box(s.x - pw, s.x + pw, s.y - h, s.y - 2)
    }

    fun enemyBox(e: Enemy, city: Boolean = false): Box = when (e.kind) {
        EnemyKind.BUSH -> Box(e.x - 24, e.x + 24, e.y - 20, e.y)
        EnemyKind.DRONE -> if (city) Box(e.x - 18, e.x + 18, e.y - 24, e.y + 4) else Box(e.x - 22, e.x + 22, e.y - 28, e.y + 6)
        EnemyKind.MITE -> if (city) Box(e.x - 20, e.x + 20, e.y - 28, e.y) else Box(e.x - 24, e.x + 24, e.y - 32, e.y)
    }

    private fun aabb(a: Box, b: Box) = a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t

    private fun fx() = Random.nextDouble()

    private fun emit(list: MutableList<Particle>, x: Double, y: Double, n: Int, color: Int, spread: Double = 90.0, speed: Double = 180.0) {
        for (i in 0 until n) {
            val a = -PI / 2 + (fx() - 0.5) * spread * (PI / 180)
            val sp = speed * (0.4 + fx() * 0.8)
            list.add(Particle(x, y, cos(a) * sp, sin(a) * sp, 0.28 + fx() * 0.35, 2.5 + fx() * 3.5, color))
        }
    }

    private fun emitRing(list: MutableList<Particle>, x: Double, y: Double, color: Int) {
        list.add(Particle(x, y, 0.0, -8.0, 0.34, 10.0, color, ring = true))
    }

    private fun addPlat(s: RunState, x: Double, y: Double, w: Double, kind: PlatKind = PlatKind.ROOF) {
        s.plats.add(Plat(x, y, w, kind))
    }

    private fun addEnemy(s: RunState, kind: EnemyKind, x: Double, y: Double, boss: Boolean = false) {
        val hover = if (kind == EnemyKind.DRONE) (if (boss) 56.0 else if (s.mod == DayMod.DRONES) 28.0 else 46.0) else 0.0
        val base = y - hover
        val t = rand(s, 0.0, PI * 2)
        val vx = if (kind == EnemyKind.MITE) (if (rand(s, 0.0, 1.0) < 0.5) -78.0 else 78.0) else 0.0
        s.enemies.add(Enemy(kind, x, base, base, t, vx, boss))
    }

    private fun dropSuns(s: RunState, x: Double, y: Double, w: Double) {
        val rich = s.mod == DayMod.GOLD
        val ax = x + w * 0.62
        s.picks.add(Pick(ax, y - 54, gold = rich && chance(s, 0.35), shield = false))
        if (chance(s, if (rich) 1.0 else 0.4)) {
            s.picks.add(Pick(ax + 34, y - 54, gold = rich && chance(s, 0.45), shield = false))
        }
        if (rich && chance(s, 0.5)) s.picks.add(Pick(ax - 36, y - 62, gold = true, shield = false))
    }

    private fun timeAt(x: Double): Double {
        val k = 0.018
        val capX = (SPEED_CAP - SPEED0) / k
        if (x <= 0) return 0.0
        if (x <= capX) return ln((SPEED0 + k * x) / SPEED0) / k
        return ln(SPEED_CAP / SPEED0) / k + (x - capX) / SPEED_CAP
    }

    fun twoRows(x: Double): Boolean {
        val start = timeAt(1760.0)
        val t = timeAt(x)
        if (t < start) return false
        return floor((t - start) / 10).toInt() % 2 == 0
    }

    private fun standPlat(s: RunState): Plat? {
        var best: Plat? = null
        for (p in s.plats) {
            if (!feetOn(s.x, p) || abs(s.y - p.y) >= 22) continue
            if (best == null || abs(s.y - p.y) < abs(s.y - best.y)) best = p
        }
        return best
    }

    private fun landPlat(s: RunState, prevY: Double): Plat? {
        var best: Plat? = null
        for (p in s.plats) {
            if (!feetOn(s.x, p)) continue
            if (!(prevY <= p.y + 22 && s.y >= p.y - 2)) continue
            if (best == null || p.y < best.y) best = p
        }
        return best
    }

    private enum class Piece { PAIR, WIRE, MITE, DRONE, CALM }

    private fun pickPiece(s: RunState, x: Double): Piece {
        if (x < 980) return Piece.CALM
        val roll = rand(s, 0.0, 1.0)
        val drones = s.mod == DayMod.DRONES || x > 5200
        if (s.mod == DayMod.WIRE && roll < 0.38) return Piece.WIRE
        if (s.mod == DayMod.DRONES && drones && roll < 0.34) return Piece.DRONE
        if (roll < 0.28) return Piece.MITE
        if (roll < 0.62) return Piece.PAIR
        if (roll < 0.74 && drones) return Piece.DRONE
        if (s.mod == DayMod.WIRE && roll < 0.86) return Piece.WIRE
        return Piece.CALM
    }

    fun spawnChunk(s: RunState, fromX: Double, count: Int) {
        if (s.bonus) return
        if (!s.classic) {
            cityChunk(s, fromX, count)
            return
        }
        var x = fromX
        val band = s.lastBand
        for (i in 0 until count) {
            val dist = max(s.x, x)
            val diff = min(1.0, max(0.0, (dist - 3800) / 9000))
            val minGap = 92.0
            val maxGap = 114.0
            var gap = minGap + rand(s, 0.0, maxGap - minGap)
            gap = max(minGap, min(maxGap, gap))
            val w = max(210.0, min(320.0, 270 - diff * 24 + rand(s, -16.0, 18.0)))
            val lift = twoRows(x) && floor(x / 1400).toInt() % 2 == 1
            val y = if (lift) BANDS[0] else BANDS[1]
            when (pickPiece(s, x)) {
                Piece.PAIR -> {
                    val a = max(200.0, floor(w * 0.9))
                    val b = max(190.0, floor(w * 0.86))
                    addPlat(s, x, y, a)
                    dropSuns(s, x, y, a)
                    addPlat(s, x + a + gap, y, b)
                    dropSuns(s, x + a + gap, y, b)
                    x += a + gap + b + max(40.0, gap * 0.6)
                    s.sinceHazard += 1
                }
                Piece.WIRE -> {
                    addPlat(s, x, y, w)
                    dropSuns(s, x, y, w)
                    val ww = max(88.0, min(130.0, w * 0.28))
                    val lead = max(44.0, min(70.0, gap))
                    addPlat(s, x + w + lead, y, ww, PlatKind.WIRE)
                    x += w + lead + ww + 40
                    s.sinceHazard = 0
                }
                Piece.MITE -> {
                    addPlat(s, x, y, w)
                    dropSuns(s, x, y, w)
                    addEnemy(s, EnemyKind.MITE, x + w * 0.55, y)
                    x += w + gap
                    s.sinceHazard = 0
                }
                Piece.DRONE -> {
                    addPlat(s, x, y, w)
                    addEnemy(s, EnemyKind.DRONE, x + w * 0.62, y)
                    s.picks.add(Pick(x + w * 0.42, y - 58, gold = s.mod == DayMod.GOLD || chance(s, 0.2), shield = false))
                    x += w + gap
                    s.sinceHazard = 0
                }
                Piece.CALM -> {
                    addPlat(s, x, y, w)
                    dropSuns(s, x, y, w)
                    if (x > 4200 && chance(s, if (s.mod == DayMod.GOLD) 0.12 else 0.05)) {
                        s.picks.add(Pick(x + w * 0.5, y - 58, gold = false, shield = true))
                    }
                    x += w + gap
                    s.sinceHazard += 1
                }
            }
        }
        s.lastBand = band
        s.spawnX = x
    }

    // ---- city rules generator (native 0.21.4) ----

    private enum class CityPiece { CALM, PAIR, MITE, DRONE, WAVE, CRUMBLE, WIRE }

    /** 0 at 200 m, 1 from 1800 m on: gaps widen and roofs narrow with it (0.21.7: was 120 → 900 m). */
    fun cityDiff(x: Double) = min(1.0, max(0.0, (x - CITY_DIFF_FROM) / CITY_DIFF_SPAN))

    /**
     * Which hazard a roof carries (0.21.7: everything later, in world units = m x 10): calm roofs to
     * 300 m, mites/pairs from 300 m, drones 400 m, wires 450 m, crumbling roofs 550 m, drone waves
     * 1100 m, and about one roof in eight more stays calm until 1500 m. Day mods follow the same floors.
     */
    private fun cityPiece(s: RunState, x: Double): CityPiece {
        if (x < CITY_CALM_TO) return CityPiece.CALM
        val r = rand(s, 0.0, 1.0)
        if (s.mod == DayMod.WIRE && r < 0.3 && x > CITY_WIRE_FROM) return CityPiece.WIRE
        if (s.mod == DayMod.DRONES && r < 0.3 && x > CITY_DRONE_FROM) return if (x > CITY_WAVE_FROM && r < 0.15) CityPiece.WAVE else CityPiece.DRONE
        // extra breathers before 1500 m, taken from the crumble/wave share (the hardest roofs)
        if (x < CITY_EASY_TO && r >= 0.62 && r < 0.75) return CityPiece.CALM
        return when {
            r < 0.19 -> CityPiece.MITE
            r < 0.32 -> CityPiece.PAIR
            r < 0.45 && x > CITY_DRONE_FROM -> CityPiece.DRONE
            r < 0.59 && x > CITY_WAVE_FROM -> CityPiece.WAVE
            r < 0.75 && x > CITY_CRUMBLE_FROM -> CityPiece.CRUMBLE
            r < 0.86 && x > CITY_WIRE_FROM -> CityPiece.WIRE
            else -> CityPiece.CALM
        }
    }

    private fun addDrone(s: RunState, x: Double, y: Double, hover: Double, amp: Double, rate: Double, phase: Double) {
        val base = y - hover
        s.enemies.add(Enemy(EnemyKind.DRONE, x, base, base, phase, 0.0, false, amp = amp, rate = rate))
    }

    private fun cityChunk(s: RunState, fromX: Double, count: Int) {
        var x = fromX
        var band = s.lastBand
        for (i in 0 until count) {
            val d = cityDiff(x)
            val gap = 104 + 70 * d + rand(s, 0.0, 30 + 20 * d)
            if (x >= s.bossNextX - 200) {
                // the maintenance drone's arena: one long flat roof, suns along it, no other foes
                addPlat(s, x, BANDS[1], ARENA_W)
                var sx = x + 260
                while (sx < x + ARENA_W - 200) {
                    s.picks.add(Pick(sx, BANDS[1] - 54, gold = false, shield = false))
                    sx += 210
                }
                s.arenaX0 = x
                s.arenaX1 = x + ARENA_W
                s.bossNextX += BOSS_EVERY * 10.0
                band = 1
                x += ARENA_W + gap
                continue
            }
            if (x > 2400 && chance(s, 0.4)) band = max(0, min(2, band + if (chance(s, 0.5)) -1 else 1))
            val y = BANDS[band]
            val w = max(140.0, min(300.0, 230 - 80 * d + rand(s, -20.0, 20.0)))
            when (cityPiece(s, x)) {
                CityPiece.PAIR -> {
                    val a = max(140.0, floor(w * 0.85))
                    val b = max(140.0, floor(w * 0.8))
                    val g2 = gap * 0.9
                    addPlat(s, x, y, a)
                    dropSuns(s, x, y, a)
                    addPlat(s, x + a + g2, y, b)
                    dropSuns(s, x + a + g2, y, b)
                    x += a + g2 + b + gap
                }
                CityPiece.MITE -> {
                    val ww = max(w, 190.0)
                    addPlat(s, x, y, ww)
                    dropSuns(s, x, y, ww)
                    addEnemy(s, EnemyKind.MITE, x + ww * 0.55, y)
                    s.enemies.last().vx *= 1.25
                    x += ww + gap
                }
                CityPiece.DRONE -> {
                    val ww = max(w, 200.0)
                    addPlat(s, x, y, ww)
                    // low (slide under) or high (stay down: a jump hits it)
                    if (chance(s, 0.6)) addDrone(s, x + ww * 0.6, y, 40.0, 6.0, 3.2, rand(s, 0.0, PI * 2))
                    else addDrone(s, x + ww * 0.6, y, 84.0, 6.0, 3.2, rand(s, 0.0, PI * 2))
                    s.picks.add(Pick(x + ww * 0.35, y - 54, gold = s.mod == DayMod.GOLD || chance(s, 0.2), shield = false))
                    x += ww + gap
                }
                CityPiece.WAVE -> {
                    val ww = max(280.0, w + 80)
                    addPlat(s, x, y, ww)
                    when ((rand(s, 0.0, 3.0)).toInt()) {
                        // a low row: hold the slide
                        0 -> for (k in 0 until 3) addDrone(s, x + 90 + k * 64.0, y, 40.0, 4.0, 3.0, k * 0.6)
                        // low then high: slide, then stay down
                        1 -> {
                            addDrone(s, x + 100, y, 40.0, 5.0, 3.2, 0.0)
                            addDrone(s, x + 100 + ww * 0.42, y, 84.0, 5.0, 3.2, 1.0)
                        }
                        // a bobbing pair, out of phase: read the rhythm
                        else -> {
                            addDrone(s, x + ww * 0.36, y, 62.0, 26.0, 2.6, 0.0)
                            addDrone(s, x + ww * 0.36 + 120, y, 62.0, 26.0, 2.6, PI)
                        }
                    }
                    s.picks.add(Pick(x + ww - 40, y - 54, gold = true, shield = false))
                    x += ww + gap
                }
                CityPiece.CRUMBLE -> {
                    val ww = max(140.0, min(190.0, w))
                    s.plats.add(Plat(x, y, ww, PlatKind.ROOF, crumble = true))
                    dropSuns(s, x, y, ww)
                    x += ww + gap * 0.85
                }
                CityPiece.WIRE -> {
                    val ww0 = max(170.0, w)
                    addPlat(s, x, y, ww0)
                    dropSuns(s, x, y, ww0)
                    val ww = max(96.0, min(140.0, w * 0.5))
                    val lead = max(50.0, min(76.0, gap * 0.6))
                    s.plats.add(Plat(x + ww0 + lead, y, ww, PlatKind.WIRE, live = x > 2000 && chance(s, 0.6)))
                    x += ww0 + lead + ww + 50
                }
                CityPiece.CALM -> {
                    addPlat(s, x, y, w)
                    dropSuns(s, x, y, w)
                    if (x > 6000 && chance(s, if (s.mod == DayMod.GOLD) 0.06 else 0.03)) {
                        s.picks.add(Pick(x + w * 0.5, y - 58, gold = false, shield = true))
                    }
                    x += w + gap
                }
            }
        }
        s.lastBand = band
        s.spawnX = x
    }

    /** City rules each step: gusts, cracking roofs, live cables and the maintenance drone. */
    private fun cityStep(s: RunState, dt: Double, prevY: Double, events: MutableList<Ev>) {
        // cracking solar roofs: start on first contact, give way after CRACK_TIME
        for (p in s.plats) {
            if (!p.crumble) continue
            if (p.fallen) {
                p.fallY += dt * 520
                continue
            }
            if (p.crackT < 0 && s.grounded && s.x >= p.x - FEET && s.x <= p.x + p.w + FEET && abs(s.y - p.y) < 2) {
                p.crackT = 0.0
                events.add(Ev.CRACK)
            } else if (p.crackT >= 0) {
                p.crackT += dt
                if (p.crackT >= CRACK_TIME) {
                    p.fallen = true
                    emit(s.particles, p.x + p.w * 0.5, p.y, 14, C_LAND, 160.0, 160.0)
                    events.add(Ev.SHATTER)
                    s.fx?.let { f ->
                        val n = (p.w / 9).toInt().coerceIn(12, 30)
                        for (k in 0 until n) {
                            val px = p.x + p.w * (k + 0.5) / n
                            f.burst(RunFx.Kind.SHARD, px, p.y - 4, 1, 60.0, 260.0, 1.1, 10.0, RunFx.C_GLASS, -PI / 2, 1.3, 1100.0)
                        }
                        f.burst(RunFx.Kind.GLINT, p.x + p.w * 0.5, p.y - 6, 8, 80.0, 200.0, 0.4, 5.0, RunFx.C_GLASS)
                        for (k in 0 until 4) f.burst(RunFx.Kind.DUST, p.x + p.w * (k + 0.5) / 4, p.y, 1, 20.0, 60.0, 0.8, 9.0, RunFx.C_DUST, -PI / 2, 1.0, -30.0)
                    }
                }
            }
        }
        // live cables
        if (s.grounded && s.grind && s.invuln <= 0) {
            val wire = s.plats.firstOrNull { it.kind == PlatKind.WIRE && feetOn(s.x, it) && abs(s.y - it.y) < 2 }
            if (wire != null && wireLive(s, wire) == 2) {
                events.add(Ev.ZAP)
                loseHeart(s, events, DeathKind.HIT)
                s.fx?.burst(RunFx.Kind.SPARK, s.x, s.y, 16, 150.0, 360.0, 0.4, 1.3, RunFx.C_ZAP, -PI / 2, 1.4, 900.0)
            }
        }
        s.fx?.let { f ->
            if (f.t >= f.nextSpark) {
                f.nextSpark = f.t + 0.05
                for (p in s.plats) {
                    if (p.kind != PlatKind.WIRE || p.x > s.x + 760 || p.x + p.w < s.x - 260) continue
                    val live = wireLive(s, p)
                    if (live == 0 || (live == 1 && fx() > 0.35)) continue
                    val px = p.x + fx() * p.w
                    f.burst(RunFx.Kind.SPARK, px, p.y, if (live == 2) 5 else 1, 80.0, 260.0, 0.36, 1.3, if (live == 2) RunFx.C_ZAP else RunFx.C_SPARK, -PI / 2, 1.3, 900.0)
                    if (live == 2) f.add(RunFx.Kind.GLINT, px, p.y, 0.0, 0.0, 0.14, 14.0, RunFx.C_ZAP)
                }
            }
            // running dust on fast roofs
            if (s.grounded && !s.grind && speedAt(s) > 300 && f.t >= f.nextDust) {
                f.nextDust = f.t + 0.11
                f.add(RunFx.Kind.DUST, s.x - 10, s.y - 2, -60.0 - fx() * 40, -20.0 - fx() * 20, 0.38, 3.5 + fx() * 2, RunFx.C_DUST, -20.0)
            }
        }
        // wind gusts: a warning, then a headwind with a downdraft (not during the boss)
        if (s.gustLeft > 0) {
            s.gustLeft = max(0.0, s.gustLeft - dt)
        } else if (s.gustWarn > 0) {
            s.gustWarn = max(0.0, s.gustWarn - dt)
            if (s.gustWarn <= 0) s.gustLeft = GUST_TIME
        } else if (s.x > 4000 && s.bossStage == 0) {
            s.gustNext -= dt
            if (s.gustNext <= 0) {
                s.gustNext = rand(s, 7.0, 12.0)
                s.gustWarn = GUST_WARN
                events.add(Ev.GUST)
                s.pops.add(Pop(s.x + 140, s.y - 120, "GUST", 0.9))
            }
        }
        bossStep(s, dt, prevY, events)
    }

    private fun bossStep(s: RunState, dt: Double, prevY: Double, events: MutableList<Ev>) {
        val y0 = BANDS[1]
        if (s.bossStage == 0) {
            if (s.arenaX0 >= 0 && s.x >= s.arenaX0 + 60 && s.x < s.arenaX1 - 1200) {
                s.bossStage = 1
                s.bossT = 0.0
                s.bossShots = 0
                s.bossX = s.x + 620
                s.bossY = y0 - 150
                s.bossHit = false
                s.gustWarn = 0.0
                s.gustLeft = 0.0
                events.add(Ev.BOSS)
                s.announce = BOSS_BANNER
                s.announceLife = 1.0
            }
            return
        }
        s.bossT += dt
        val track = s.x + 330
        when (s.bossStage) {
            1 -> {
                s.bossX += (track - s.bossX) * min(1.0, dt * 3.5)
                s.bossY = y0 - 150 + sin(s.bossT * 2.4) * 6
                if (s.bossT > 1.0) {
                    s.bossStage = 2
                    nextShot(s, events)
                }
            }
            2 -> {
                s.bossX = track
                s.bossY = y0 - 150 + sin(s.bossT * 2.4) * 6
                if (s.bossTele > 0) {
                    s.bossTele -= dt
                    if (s.bossTele <= 0) {
                        s.bossTele = 0.0
                        s.bossBeam = BOSS_BEAM
                        s.shake = min(1.0, s.shake + 0.35)
                        events.add(Ev.BEAM)
                        s.fx?.let { f ->
                            val lane = if (s.bossLane == 0) BEAM_LOW else BEAM_HIGH
                            f.burst(RunFx.Kind.SPARK, s.bossX - 34, y0 + (lane[0] + lane[1]) / 2, 14, 120.0, 320.0, 0.35, 1.3, RunFx.C_SPARK, PI, 1.0, 600.0)
                            f.add(RunFx.Kind.RING, s.bossX - 34, y0 + (lane[0] + lane[1]) / 2, 200.0, 0.0, 0.3, 6.0, RunFx.C_EMBER)
                        }
                    }
                } else if (s.bossBeam > 0) {
                    val bb = beamBox(s)
                    val f = s.fx
                    if (f != null && bb != null && f.t >= f.nextBeam) {
                        f.nextBeam = f.t + 0.035
                        val py = (bb.t + bb.b) / 2
                        val px = bb.l + 120 + fx() * (bb.r - bb.l - 120)
                        f.burst(RunFx.Kind.SPARK, px, py + (fx() - 0.5) * 10, 2, 60.0, 200.0, 0.3, 1.0, RunFx.C_SPARK, -PI / 2, 1.4, 700.0)
                    }
                    if (bb != null && s.invuln <= 0 && aabb(playerBox(s), bb)) {
                        s.bossHit = true
                        loseHeart(s, events, DeathKind.HIT)
                    }
                    s.bossBeam -= dt
                    if (s.bossBeam <= 0) {
                        s.bossBeam = 0.0
                        s.bossShots += 1
                        if (s.bossShots >= BOSS_SHOTS) {
                            s.bossStage = 3
                            s.bossT = 0.0
                            s.pops.add(Pop(s.bossX, y0 - 140, "OVERHEAT", 1.0))
                            events.add(Ev.OVERHEAT)
                            s.fx?.let { f ->
                                f.burst(RunFx.Kind.SMOKE, s.bossX, s.bossY - 20, 6, 30.0, 80.0, 1.0, 14.0, RunFx.C_SMOKE, -PI / 2, 0.7, -80.0)
                                f.burst(RunFx.Kind.SPARK, s.bossX, s.bossY - 10, 10, 120.0, 300.0, 0.4, 1.2, RunFx.C_SPARK, -PI / 2, PI, 800.0)
                            }
                        } else {
                            s.bossRest = if (s.bossShots >= 2 && chance(s, 0.35)) 0.18 else BOSS_REST
                        }
                    }
                } else {
                    s.bossRest -= dt
                    if (s.bossRest <= 0) nextShot(s, events)
                }
            }
            3 -> {
                // overheated: sinks to roof height and stays put, the robot can stomp it
                s.bossY += ((y0 - 50) - s.bossY) * min(1.0, dt * 6)
                val pb = playerBox(s)
                val bb = bossBox(s)
                if (s.vy > 55 && prevY - 2 <= bb.t + 12 && aabb(pb, bb)) {
                    s.bossDowned += 1
                    s.vy = STOMP_V
                    s.grounded = false
                    s.airJumps = 1
                    s.hitstop = 0.08
                    s.shake = 1.0
                    s.score += 250
                    s.stomps += 1
                    events.add(Ev.DOWNED)
                    s.pops.removeAll { it.text == "OVERHEAT" }
                    s.pops.add(Pop(s.bossX, s.bossY - 60, "DRONE DOWN", 1.2))
                    emit(s.particles, s.bossX, s.bossY - 10, 26, C_DRONE, 300.0, 260.0)
                    emitRing(s.particles, s.bossX, s.bossY - 10, C_RING)
                    s.fx?.let { f ->
                        val bx = s.bossX
                        val by = s.bossY - 14
                        f.add(RunFx.Kind.RING, bx, by, 420.0, 0.0, 0.5, 12.0, RunFx.C_EMBER)
                        f.add(RunFx.Kind.RING, bx, by, 260.0, 0.0, 0.7, 8.0, RunFx.C_GLINT)
                        f.add(RunFx.Kind.GLINT, bx, by, 0.0, 0.0, 0.35, 130.0, RunFx.C_GLINT)
                        f.add(RunFx.Kind.GLINT, bx, by, 0.0, 0.0, 0.6, 80.0, RunFx.C_EMBER)
                        f.burst(RunFx.Kind.EMBER, bx, by, 40, 140.0, 460.0, 1.0, 4.5, RunFx.C_EMBER, -PI / 2, PI, 520.0)
                        f.burst(RunFx.Kind.SPARK, bx, by, 26, 220.0, 520.0, 0.5, 1.6, RunFx.C_SPARK, -PI / 2, PI, 700.0)
                        f.burst(RunFx.Kind.METAL, bx, by, 12, 140.0, 340.0, 1.4, 11.0, RunFx.C_METAL, -PI / 2, 1.2, 1000.0)
                        f.burst(RunFx.Kind.SMOKE, bx, by, 12, 30.0, 120.0, 1.6, 24.0, RunFx.C_SMOKE, -PI / 2, PI, -70.0)
                    }
                    for (k in 0 until 5) s.picks.add(Pick(s.bossX + 60 + k * 34, y0 - 70 - (k % 2) * 20, gold = true, shield = false))
                    s.bossStage = 4
                    s.bossT = 0.0
                } else if (s.bossT > BOSS_HOT || s.x > s.bossX + 90) {
                    s.bossStage = 4
                    s.bossT = 0.0
                }
            }
            else -> {
                s.bossY -= 260 * dt
                s.bossX += (speedAt(s) + 160) * dt
                if (s.bossT > 1.6) {
                    s.bossStage = 0
                    s.arenaX0 = -1.0
                    s.arenaX1 = -1.0
                }
            }
        }
    }

    private fun nextShot(s: RunState, events: MutableList<Ev>) {
        s.bossLane = if (chance(s, 0.5)) 0 else 1
        s.bossTele = BOSS_TELE
        s.bossBeam = 0.0
        events.add(Ev.CHARGE)
    }

    private fun spawnBoss(s: RunState) {
        val x = max(s.spawnX, s.x + 420)
        addPlat(s, x, BANDS[1], 1100.0)
        for (i in 0 until 7) addEnemy(s, EnemyKind.DRONE, x + 160 + i * 95, BANDS[1], true)
        s.spawnX = x + 1100 + 160
        s.lastBand = 1
        s.pops.add(Pop(x + 200, BANDS[1] - 110, "SERPENT", 1.4))
        s.bossDone = true
    }

    private fun fillBonusSuns(s: RunState) {
        var maxX = s.x + 70
        for (p in s.picks) if (!p.taken && !p.portal) maxX = max(maxX, p.x)
        var guard = 0
        while (maxX < s.x + 1800 && guard < 52) {
            guard += 1
            maxX += 34 + rand(s, 0.0, 16.0)
            val wave = sin(maxX * 0.014) * 72
            val y = max(102.0, min(278.0, 186 + wave))
            s.picks.add(Pick(maxX, y, gold = chance(s, 0.38), shield = false))
            if (chance(s, 0.5)) {
                s.picks.add(Pick(maxX + 10, max(102.0, min(278.0, 230 - wave * 0.7)), gold = chance(s, 0.22), shield = false))
            }
        }
    }

    private fun enterBonus(s: RunState, events: MutableList<Ev>) {
        s.bonus = true
        s.didBonus = true
        s.bonusLeft = 18.0
        s.fever = 2.4
        s.shield = 1
        s.slide = 0.0
        s.grind = false
        s.grounded = false
        s.plats.removeAll { it.x + it.w >= s.x - 20 }
        if (!s.classic && s.arenaX0 > s.x) {
            s.arenaX0 = -1.0
            s.arenaX1 = -1.0
            s.bossNextX -= BOSS_EVERY * 10.0
        }
        s.picks.clear()
        s.enemies.removeAll { it.x >= s.x - 40 }
        s.y = BANDS[0] + 8
        s.vy = -280.0
        s.airJumps = 1
        events.add(Ev.BONUS)
        s.announce = "SKY FLIGHT"
        s.announceLife = 2.6
        s.pops.add(Pop(s.x, s.y - 90, "FLY!", 1.3))
        fillBonusSuns(s)
        s.spawnX = s.x
    }

    private fun exitBonus(s: RunState) {
        s.bonus = false
        s.bonusLeft = 0.0
        if (s.classic) s.shield = 1
        s.fever = 1.15
        s.invuln = 1.4
        s.slide = 0.0
        s.grind = false
        s.pops.add(Pop(s.x, s.y - 88, "BACK TO ROOFS", 1.1))
        val landX = s.x - 180
        val landW = 1100.0
        s.plats.removeAll { it.x + it.w >= landX }
        addPlat(s, landX, BANDS[1], landW)
        s.y = BANDS[1]
        s.vy = 0.0
        s.grounded = true
        s.lastBand = 1
        s.checkX = s.x
        s.checkY = BANDS[1]
        s.spawnX = landX + landW
        s.picks.removeAll { it.x >= s.x - 20 }
        spawnChunk(s, s.spawnX, 16)
    }

    /** web createRun(seed, { mod, offerBonus, careBoost }) */
    fun create(seed: Int, mod: DayMod = DayMod.CALM, offerBonus: Boolean = false, careBoost: Boolean = false, goalMeters: Int = 1200, classic: Boolean = false): RunState {
        val s = RunState(seed, mod, goalMeters)
        s.classic = classic
        if (!classic) s.fx = RunFx()
        if (careBoost) s.shield = 1
        addPlat(s, 0.0, BANDS[1], 420.0)
        addEnemy(s, EnemyKind.MITE, 300.0, BANDS[1])
        s.enemies.lastOrNull()?.vx = -36.0
        addPlat(s, 534.0, BANDS[1], 250.0)
        addPlat(s, 890.0, BANDS[0], 230.0)
        addPlat(s, 1234.0, BANDS[1], 260.0)
        s.picks.add(Pick(210.0, BANDS[1] - 54, gold = false, shield = false))
        s.picks.add(Pick(244.0, BANDS[1] - 54, gold = false, shield = false))
        s.picks.add(Pick(640.0, BANDS[1] - 54, gold = mod == DayMod.GOLD, shield = false))
        s.picks.add(Pick(990.0, BANDS[0] - 54, gold = false, shield = false))
        s.picks.add(Pick(1024.0, BANDS[0] - 54, gold = false, shield = false))
        if (offerBonus) {
            s.picks.add(Pick(640.0, BANDS[1] - 48, gold = false, shield = false, portal = true))
            s.pops.add(Pop(640.0, BANDS[1] - 130, "FLY GATE", 3.2))
        }
        s.lastBand = 1
        s.spawnX = 1600.0
        spawnChunk(s, s.spawnX, 16)
        return s
    }

    private fun doJump(s: RunState, events: MutableList<Ev>, doubleJump: Boolean) {
        s.vy = if (doubleJump) DOUBLE_V else if (s.mod == DayMod.WIND) JUMP_V * 0.94 else JUMP_V
        s.grounded = false
        s.coyote = 0.0
        s.jumpBuf = 0.0
        s.jumpAge = 0.0
        s.cutJump = false
        s.stretch = 1.0
        s.squash = 0.0
        s.slide = 0.0
        s.grind = false
        s.hasJumped = true
        if (doubleJump) {
            s.airJumps = 0
            events.add(Ev.DOUBLE)
            emit(s.particles, s.x, s.y - 20, 12, C_BLUE, 240.0, 200.0)
            emit(s.particles, s.x, s.y - 24, 8, C_GOLD, 200.0, 160.0)
        } else {
            s.airJumps = 1
            events.add(Ev.JUMP)
            emit(s.particles, s.x, s.y, 6, C_DUST, 80.0, 90.0)
        }
    }

    private fun startSlide(s: RunState, events: MutableList<Ev>) {
        if (s.bonus) return
        if (s.slide > 0.12) return
        if (!s.grounded) return
        s.slide = SLIDE_TIME
        s.squash = 1.0
        s.jumpBuf = 0.0
        s.slid = true
        s.grind = false
        events.add(Ev.SLIDE)
        emit(s.particles, s.x, s.y, 8, C_SLIDE, 70.0, 70.0)
    }

    private fun loseHeart(s: RunState, events: MutableList<Ev>, why: DeathKind) {
        if (s.invuln > 0 || s.phase != Phase.RUNNING) return
        if (s.shield > 0 && why == DeathKind.HIT) {
            s.shield = 0
            s.invuln = 0.95
            s.shake = 0.4
            s.flash = 0.28
            events.add(Ev.SHIELD)
            emit(s.particles, s.x, s.y - 30, 16, C_SHIELD, 240.0, 200.0)
            s.fx?.let { f ->
                f.add(RunFx.Kind.RING, s.x, s.y - 30, 240.0, 0.0, 0.4, 7.0, RunFx.C_ZAP)
                f.burst(RunFx.Kind.GLINT, s.x, s.y - 30, 8, 120.0, 240.0, 0.4, 5.0, RunFx.C_ZAP)
            }
            s.pops.add(Pop(s.x, s.y - 80, "SHIELD", 0.55))
            return
        }
        val hit = why == DeathKind.HIT
        s.hearts -= 1
        s.death = why
        s.shake = min(1.0, s.shake + if (hit) 1.0 else 0.55)
        s.flash = if (hit) 0.72 else 0.22
        s.hitstop = if (hit) 0.05 else 0.03
        events.add(Ev.HURT)
        emit(s.particles, s.x, s.y - 30, 18, if (hit) C_HIT else C_FALL, 260.0, 220.0)
        if (hit) s.fx?.let { f ->
            f.burst(RunFx.Kind.SPARK, s.x, s.y - 30, 14, 160.0, 380.0, 0.35, 1.2, RunFx.C_HIT, -PI / 2, PI, 700.0)
            f.burst(RunFx.Kind.SMOKE, s.x, s.y - 30, 3, 20.0, 50.0, 0.7, 10.0, RunFx.C_SMOKE, -PI / 2, 0.8, -60.0)
        }
        if (hit) {
            s.grounded = false
            s.vy = -360.0
            s.x -= 26
            s.grind = false
        }
        if (s.hearts <= 0) {
            s.phase = Phase.DEAD
            s.grounded = false
            events.add(Ev.DEAD)
            return
        }
        s.combo = 0
        s.comboTimer = 0.0
        s.airJumps = 1
        s.coyote = COYOTE
        s.invuln = if (s.classic) 1.45 else CITY_INVULN
        s.slide = 0.0
        if (why == DeathKind.FALL) {
            // city rules: cracked roofs ahead of the checkpoint are whole again for the retry
            if (!s.classic) for (p in s.plats) if (p.crumble && p.x > s.checkX - 60) { p.fallen = false; p.crackT = -1.0; p.fallY = 0.0 }
            s.x = s.checkX + 22
            s.y = s.checkY
            s.vy = 0.0
            s.grounded = true
            s.grind = false
        }
    }

    private fun stomp(s: RunState, e: Enemy, events: MutableList<Ev>) {
        e.dead = true
        s.vy = STOMP_V
        s.grounded = false
        s.airJumps = 1
        s.squash = 0.7
        s.hitstop = 0.055
        s.shake = min(1.0, s.shake + 0.38)
        s.stomps += 1
        s.combo += 1
        s.maxCombo = max(s.maxCombo, s.combo)
        s.comboTimer = 1.9
        s.score += 32 + s.combo * 6
        s.pops.add(Pop(e.x, e.y - 44, if (s.combo > 1) "${s.combo}x" else "STOMP", 0.65))
        events.add(Ev.STOMP)
        if (s.combo == 4 || s.combo == 8 || s.combo == 12) {
            events.add(Ev.COMBO)
            s.fever = 1.4
        }
        emit(s.particles, e.x, e.y - 10, 16, if (e.kind == EnemyKind.DRONE) C_DRONE else C_MITE, 230.0, 220.0)
        emitRing(s.particles, e.x, e.y - 8, C_RING)
    }

    /** One fixed step. Mutates [s]; returns the sound/feedback events of this step. */
    fun step(s: RunState, dtRaw: Double, input: Input): List<Ev> {
        val events = ArrayList<Ev>(4)
        val dt = min(dtRaw, 0.05)

        s.squash = max(0.0, s.squash - dt * 5.5)
        s.stretch = max(0.0, s.stretch - dt * 4.2)
        s.shake = max(0.0, s.shake - dt * 2.4)
        s.flash = max(0.0, s.flash - dt * 3.2)
        s.lightning = max(0.0, s.lightning - dt * 2.8)
        s.invuln = max(0.0, s.invuln - dt)
        s.fever = max(0.0, s.fever - dt)
        s.comboTimer = max(0.0, s.comboTimer - dt)
        s.slide = max(0.0, s.slide - dt)
        s.announceLife = max(0.0, s.announceLife - dt)
        if (s.comboTimer <= 0 && s.combo > 0) s.combo = 0

        val popIt = s.pops.iterator()
        while (popIt.hasNext()) {
            val p = popIt.next()
            p.life -= dt
            p.y -= 42 * dt
            if (p.life <= 0) popIt.remove()
        }
        val partIt = s.particles.iterator()
        while (partIt.hasNext()) {
            val p = partIt.next()
            p.life -= dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            if (p.ring) p.r += 70 * dt else p.vy += 520 * dt
            if (p.life <= 0) partIt.remove()
        }
        if (s.particles.size > 160) s.particles.subList(0, s.particles.size - 160).clear()

        for (e in s.enemies) {
            if (e.dead) continue
            e.t += dt
            if (e.kind == EnemyKind.DRONE) {
                val amp = if (e.amp > 0) e.amp else if (e.boss) 14.0 else 10.0
                e.y = e.baseY + sin(e.t * (if (e.rate > 0) e.rate else if (e.boss) 2.2 else 3.2) + e.x * 0.01) * amp
            } else if (e.kind == EnemyKind.MITE) {
                val plat = s.plats.firstOrNull { it.kind != PlatKind.WIRE && !it.fallen && e.x >= it.x - 6 && e.x <= it.x + it.w + 6 }
                if (plat != null) {
                    e.y = plat.y
                    e.baseY = plat.y
                    if (e.vx == 0.0) e.vx = if (e.t > PI) -78.0 else 78.0
                    e.x += e.vx * dt
                    if (e.x < plat.x + 24) {
                        e.x = plat.x + 24
                        e.vx = abs(e.vx)
                    } else if (e.x > plat.x + plat.w - 24) {
                        e.x = plat.x + plat.w - 24
                        e.vx = -abs(e.vx)
                    }
                }
            }
        }

        if (s.phase == Phase.DEAD) {
            if (!s.grounded) {
                s.vy = min(TERMINAL, s.vy + GRAVITY_DOWN * dt)
                s.y += s.vy * dt
            }
            return events
        }

        if (s.phase == Phase.COUNTDOWN) {
            s.countdown -= dt
            if (input.jumpPressed) s.jumpBuf = BUFFER
            if (input.slidePressed) startSlide(s, events)
            if (s.countdown <= 0) {
                s.phase = Phase.RUNNING
                s.countdown = 0.0
                events.add(Ev.TICK)
            }
            return events
        }

        // CLOCK IN at the goal is a reward moment, not a stop: the run keeps going.

        if (s.hitstop > 0) {
            s.hitstop -= dt
            if (input.jumpPressed) s.jumpBuf = BUFFER
            return events
        }

        if (s.bonus) {
            s.bonusLeft -= dt
            if (s.bonusLeft <= 0) exitBonus(s)
        }

        val storming = !s.bonus && (if (s.classic) s.distance > 16000 else cityStormAt(s.distance) > 0.5)
        if (storming) {
            s.stormT += dt
            if (s.stormT > 3.6) {
                s.stormT = 0.0
                s.lightning = 0.55
                events.add(Ev.THUNDER)
            }
        }

        val spd = speedAt(s)
        s.x += spd * dt * (if (s.gustLeft > 0) GUST_SLOW else 1.0)
        if (s.mod == DayMod.WIND) s.x += 18 * dt
        s.distance = s.x
        s.runPhase += dt * (if (s.grounded) 6.4 + spd * 0.006 else 3.0)
        s.runTime += dt
        s.fx?.t = s.runTime
        val want = (s.runTime / GHOST_DT).toInt()
        if (s.ghost.size <= want && s.ghost.size < GHOST_MAX) s.ghost.add(GhostSample(s.x, s.y, s.grounded))

        if (!s.bonus) {
            val ch = chapterAt(s.distance)
            if (ch.id != s.chapter) {
                s.chapter = ch.id
                s.announce = ch.banner
                s.announceLife = 1.7
                events.add(Ev.CHAPTER)
                s.pops.add(Pop(s.x, s.y - 100, ch.banner, 1.15))
            }
            if (!s.clockSaid && s.distance / 10 >= s.goalMeters) {
                s.clockSaid = true
                s.clockOpen = true
                s.shake = 1.0
                s.hitstop = max(s.hitstop, 0.08)
                s.announce = ""
                s.announceLife = 0.0
                s.pops.add(Pop(s.x, s.y - 88, s.goalMeters.toString(), 0.7))
                events.add(Ev.CLOCK)
            }
            if (!s.classic && s.distance / 10 >= s.nextMilestone) {
                val m = s.nextMilestone
                s.nextMilestone += MILESTONE_M
                if (m != s.goalMeters) {
                    events.add(Ev.MILESTONE) // the HUD shows the banner (RunHud.meters)
                    s.fx?.let { f -> f.add(RunFx.Kind.RING, s.x, s.y - 30, 260.0, 0.0, 0.45, 8.0, RunFx.C_GLINT) }
                }
            }
        }

        if (s.mod == DayMod.WIND && s.grounded && s.phase == Phase.RUNNING && fx() < 0.55) {
            s.particles.add(Particle(s.x - 12, s.y - 6, -90 - fx() * 40, -16 - fx() * 24, 0.28, 1.6 + fx() * 1.6, C_WIND))
        }

        if ((s.fever > 0 || s.grind) && s.grounded) {
            val c = if (s.grind) C_GRIND else if (fx() < 0.5) C_HEAT_Y else C_HEAT_B
            s.particles.add(Particle(s.x - 10, s.y - 8, -20.0, -30 - fx() * 40, 0.18, 2 + fx() * 2, c))
        }

        if (s.classic && !s.bonus && !s.bossDone && s.x > 25000) {
            spawnBoss(s)
            events.add(Ev.BOSS)
        }

        if (!s.slideHint && !s.bonus && (s.classic || s.tutorial)) {
            val drone = s.enemies.firstOrNull { !it.dead && it.kind == EnemyKind.DRONE && it.x > s.x && it.x < s.x + 300 }
            if (drone != null) {
                s.slideHint = true
                s.pops.add(Pop(drone.x, drone.y - 36, "SLIDE", 1.35))
            }
        }

        val prevYStep = s.y
        if (s.spawnX < s.x + 2800) spawnChunk(s, s.spawnX, 8)
        if (!s.bonus && s.phase == Phase.RUNNING) {
            val roofAhead = s.plats.any { it.x + it.w > s.x + 240 }
            if (!roofAhead) {
                val x0 = s.x - 60
                addPlat(s, x0, BANDS[1], 520.0)
                s.lastBand = 1
                s.spawnX = x0 + 520
                spawnChunk(s, s.spawnX, 12)
            }
        }

        if (s.bonus) {
            s.slide = 0.0
            s.grind = false
            s.grounded = false
            s.fever = max(s.fever, 1.35)
            if (input.jumpPressed) {
                s.vy = -520.0
                s.stretch = 1.0
                s.jumpAge = 0.0
                events.add(Ev.JUMP)
                emit(s.particles, s.x - 8, s.y - 8, 8, C_HEAT_Y, 110.0, 90.0)
            }
            s.jumpAge += dt
            s.vy = min(720.0, s.vy + 1380 * dt)
            s.y += s.vy * dt
            if (s.y < 88) {
                s.y = 88.0
                s.vy = max(0.0, s.vy)
            }
            if (s.y > 292) {
                s.y = 292.0
                s.vy = min(0.0, s.vy)
            }
            emit(s.particles, s.x - 16, s.y - 22, 2, if (fx() < 0.5) C_HEAT_Y else C_SHIELD, 70.0, 40.0)
            fillBonusSuns(s)
        } else {
            if (input.slideHeld && s.grounded) {
                if (s.slide <= 0) startSlide(s, events) else s.slide = max(s.slide, 0.2)
            } else if (input.slidePressed) {
                startSlide(s, events)
            }

            if (input.jumpPressed) s.jumpBuf = BUFFER else s.jumpBuf = max(0.0, s.jumpBuf - dt)

            s.coyote = if (s.grounded) COYOTE else max(0.0, s.coyote - dt)
            if (s.grounded) s.airJumps = 1

            if (s.slide > 0 && s.jumpBuf > 0 && s.coyote > 0) s.jumpBuf = 0.0

            if (s.jumpBuf > 0 && s.coyote > 0 && s.slide <= 0) {
                doJump(s, events, false)
            } else if (s.jumpBuf > 0 && !s.grounded && s.airJumps > 0) {
                doJump(s, events, true)
            }

            val prevY = s.y
            if (s.grounded) {
                s.vy = 0.0
                val stand = standPlat(s)
                if (stand != null) {
                    s.y = stand.y
                    if (!stand.crumble) {
                        s.checkX = stand.x + min(40.0, stand.w * 0.2)
                        s.checkY = stand.y
                    }
                    s.grind = stand.kind == PlatKind.WIRE
                } else {
                    s.grounded = false
                    s.grind = false
                }
            }

            if (s.grind && s.grounded) s.score += dt * 55

            if (!s.grounded) {
                s.jumpAge += dt
                var g = if (s.vy < 0) GRAVITY_UP else GRAVITY_DOWN
                if (s.mod == DayMod.WIND && s.vy < 0) g *= 1.22
                if (s.gustLeft > 0) g *= 1.25
                if (s.vy < 0 && !input.jumpHeld && !s.cutJump && s.jumpAge > 0.28) {
                    s.vy *= 0.55
                    s.cutJump = true
                }
                if (abs(s.vy) < 46) g *= 0.62
                s.vy = min(TERMINAL, s.vy + g * dt)
                s.y += s.vy * dt
            }

            var stomped = false
            if (s.invuln <= 0 && s.slide <= 0) {
                val pb = playerBox(s)
                for (e in s.enemies) {
                    if (e.dead || e.kind == EnemyKind.BUSH) continue
                    val eb = enemyBox(e, !s.classic)
                    val fromAbove = prevY - 2 <= eb.t + 10
                    if (s.vy > 55 && fromAbove && aabb(pb, eb)) {
                        stomp(s, e, events)
                        stomped = true
                        break
                    }
                }
            }

            if (!s.grounded && !stomped && s.vy > 18) {
                val land = landPlat(s, prevY)
                if (land != null) {
                    val wire = land.kind == PlatKind.WIRE
                    s.y = land.y
                    s.vy = 0.0
                    s.grounded = true
                    s.coyote = COYOTE
                    s.airJumps = 1
                    s.squash = 1.0
                    s.stretch = 0.0
                    s.grind = wire
                    if (!land.crumble) {
                        s.checkX = land.x + min(40.0, land.w * 0.2)
                        s.checkY = land.y
                    }
                    events.add(if (wire) Ev.GRIND else Ev.LAND)
                    if (wire) s.grinds += 1
                    emit(s.particles, s.x, s.y, 8, if (wire) C_SHIELD else C_LAND, 80.0, 90.0)
                    emitRing(s.particles, s.x, s.y, if (wire) C_SHIELD else C_LAND_RING)
                    s.fx?.let { f ->
                        if (wire) f.burst(RunFx.Kind.SPARK, s.x, s.y, 8, 120.0, 280.0, 0.32, 1.1, RunFx.C_ZAP, -PI / 2, 1.2, 900.0)
                        else {
                            f.burst(RunFx.Kind.DUST, s.x - 10, s.y - 4, 6, 60.0, 150.0, 0.6, 12.0, RunFx.C_DUST, PI, 0.4, -50.0)
                            f.burst(RunFx.Kind.DUST, s.x + 10, s.y - 4, 5, 50.0, 130.0, 0.55, 11.0, RunFx.C_DUST, 0.0, 0.4, -50.0)
                        }
                    }
                    if (wire) {
                        s.score += 40
                        s.pops.add(Pop(s.x, s.y - 70, "GRIND", 0.6))
                    } else if (s.x - land.x < 28) {
                        s.score += 16
                        s.pops.add(Pop(s.x, s.y - 70, "NICE", 0.55))
                    }
                }
            }
        }

        if (!s.classic && !s.bonus && s.phase == Phase.RUNNING) cityStep(s, dt, prevYStep, events)

        if (s.fever > 0) {
            for (pick in s.picks) {
                if (pick.taken) continue
                val dx = s.x - pick.x
                val dy = s.y - 40 - pick.y
                val d2 = dx * dx + dy * dy
                if (d2 < 130 * 130 && d2 > 4) {
                    val d = sqrt(d2)
                    pick.x += (dx / d) * dt * 280
                    pick.y += (dy / d) * dt * 280
                }
            }
        }

        var i = 0
        while (i < s.picks.size) {
            val pick = s.picks[i++]
            if (pick.taken) continue
            if (pick.portal && !s.bonus) {
                if (abs(pick.x - s.x) < 52) {
                    pick.taken = true
                    enterBonus(s, events)
                    break // enterBonus rebuilt the pick list
                }
                continue
            }
            val dx = pick.x - s.x
            val dy = pick.y - (s.y - 48)
            val hit = if (s.bonus) 70.0 else 56.0
            if (dx * dx + dy * dy < hit * hit) {
                pick.taken = true
                if (pick.shield) {
                    s.shield = 1
                    events.add(Ev.SHIELD)
                    s.pops.add(Pop(pick.x, pick.y - 10, "SHIELD", 0.7))
                    emit(s.particles, pick.x, pick.y, 14, C_SHIELD, 200.0, 170.0)
                } else {
                    s.suns += 1
                    s.combo += 1
                    s.maxCombo = max(s.maxCombo, s.combo)
                    s.comboTimer = 1.85
                    val mult = 1 + min(8, s.combo) * 0.35
                    s.score += Math.round((if (pick.gold) 40 else 16) * mult).toDouble()
                    s.pops.add(Pop(s.x, s.y - 72, if (pick.gold) "+SUN" else "+1", 0.55))
                    events.add(if (pick.gold) Ev.GOLD else Ev.COLLECT)
                    s.fx?.let { f ->
                        val col = if (pick.shield) RunFx.C_ZAP else RunFx.C_GLINT
                        f.burst(RunFx.Kind.GLINT, pick.x, pick.y, if (pick.gold) 9 else 6, 70.0, 180.0, 0.42, if (pick.gold) 7.0 else 5.5, col)
                        f.add(RunFx.Kind.RING, pick.x, pick.y, 150.0, 0.0, 0.28, 5.0, col)
                        if (!pick.shield) f.add(RunFx.Kind.FLY, pick.x, pick.y, 0.0, 0.0, 0.55, if (pick.gold) 1.2 else 1.0, col)
                    }
                    if (s.combo == 4 || s.combo == 8 || s.combo == 12) {
                        events.add(Ev.COMBO)
                        s.fever = 1.4
                        s.pops.add(Pop(s.x, s.y - 96, "${s.combo}x HEAT", 0.85))
                    }
                    emit(s.particles, pick.x, pick.y, if (pick.gold) 16 else 9, if (pick.gold) C_GOLD else C_SUN, 200.0, 160.0)
                }
                s.hitstop = max(s.hitstop, 0.02)
            }
        }

        if (s.invuln <= 0 && s.phase == Phase.RUNNING) {
            val pb = playerBox(s)
            for (e in s.enemies) {
                if (e.dead) continue
                val eb = enemyBox(e, !s.classic)
                if (aabb(pb, eb)) {
                    loseHeart(s, events, DeathKind.HIT)
                    break
                }
                if ((e.kind == EnemyKind.MITE || e.kind == EnemyKind.DRONE) && !e.near && abs(e.x - s.x) <= 18 && abs(e.y - s.y) < 90) {
                    e.near = true
                    s.hitstop = max(s.hitstop, 0.034)
                    s.shake = min(1.0, s.shake + 0.28)
                    s.score += 8
                    s.particles.add(Particle(s.x - 6, s.y - 28, -70.0, 0.0, 0.18, 2.0, C_STREAK, streak = true))
                    s.pops.add(Pop(s.x, s.y - 78, "CLOSE", 0.4))
                    events.add(Ev.NEAR)
                }
                val ducked = s.slide > 0 && e.kind == EnemyKind.DRONE && abs(e.x - s.x) < 28 && pb.t > eb.b - 4
                if (ducked && !e.near) {
                    e.near = true
                    events.add(Ev.NEAR)
                    s.score += 22
                    s.pops.add(Pop(e.x, e.y - 36, "UNDER", 0.5))
                    s.unders += 1
                }
                if (!s.grounded && s.vy >= 0 && pb.b < eb.t && pb.r > eb.l && pb.l < eb.r && !e.near) {
                    e.near = true
                    events.add(Ev.NEAR)
                    s.score += if (e.kind == EnemyKind.BUSH) 18 else 12
                    s.pops.add(Pop(e.x, e.y - 36, "CLEAN", 0.5))
                    emit(s.particles, e.x, e.y - 20, 6, C_CLEAN, 140.0, 100.0)
                }
            }
        }

        if (!s.bonus && !s.grounded && s.y > FALL_Y) loseHeart(s, events, DeathKind.FALL)

        s.score += dt * (2.2 + s.combo * 0.6 + speedAt(s) * 0.01)

        val cull = min(s.x, s.checkX) - 700
        s.plats.removeAll { it.x + it.w <= cull }
        s.picks.removeAll { it.x <= cull || it.taken }
        s.enemies.removeAll { it.x <= cull || it.dead }
        return events
    }

    /** Sky mood: 0 day, 1 dusk, 2 night, then back to day. Cycle 2800 m (web moodAt). */
    fun moodAt(distance: Double): Double {
        val m = distance / 10
        val cycle = 2800.0
        val t = ((m % cycle) + cycle) % cycle
        return when {
            t < 1600 -> 0.0
            t < 1900 -> (t - 1600) / 300
            t < 2200 -> 1 + (t - 1900) / 300
            t < 2500 -> 2.0
            else -> 2 - ((t - 2500) / 300) * 2
        }
    }

    /**
     * City rules sky (native 0.21.4): golden hour, dusk from 450 m, night from 750 m (the 1200 m
     * CLOCK IN lands under neon), dawn back to golden hour by 2400 m. Same 0..2 scale as [moodAt].
     */
    /**
     * City storm line, 0..1: a squall over 1600–2200 m of every 2400 m cycle (rolls in and out over 80 m).
     * Classic rules keep the web's endless storm past 1600 m.
     */
    fun cityStormAt(distance: Double): Double {
        val t = (((distance / 10) % 2400.0) + 2400.0) % 2400.0
        return when {
            t < 1560 || t >= 2200 -> 0.0
            t < 1640 -> (t - 1560) / 80
            t < 2120 -> 1.0
            else -> (2200 - t) / 80
        }
    }

    fun cityMoodAt(distance: Double): Double {
        val m = distance / 10
        val cycle = 2400.0
        val t = ((m % cycle) + cycle) % cycle
        return when {
            t < 450 -> 0.0
            t < 750 -> (t - 450) / 300
            t < 1050 -> 1 + (t - 750) / 300
            t < 1900 -> 2.0
            else -> 2 - ((t - 1900) / 500) * 2
        }
    }

    /** web daySeed: FNV-1a of the UTC day key, as uint32 (returned as the same 32 bits). */
    fun daySeed(key: String): Int {
        var h = 2166136261L.toInt()
        for (ch in key) {
            h = h xor ch.code
            h *= 16777619
        }
        return h
    }
}
