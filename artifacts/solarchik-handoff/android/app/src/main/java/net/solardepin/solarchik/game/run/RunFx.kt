package net.solardepin.solarchik.game.run

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * Pooled effect particles for the city run (0.21.6): a fixed ring of [CAP] slots in flat arrays, no
 * allocation after construction. Motion is analytic (position = p0 + v·age + ½g·age²), so the
 * game step only writes new slots and the renderer evaluates whatever is alive at [t] (run time).
 * The sim emits into it; look-ahead copies of a run carry no pool (`RunState.fx = null`).
 */
class RunFx {
    /** FLY: a collected sun flying to the HUD counter (drawn in screen space by the renderer). */
    enum class Kind { DUST, SPARK, SHARD, GLINT, EMBER, SMOKE, RING, METAL, FLY }

    val kind = IntArray(CAP)
    val x = DoubleArray(CAP)
    val y = DoubleArray(CAP)
    val vx = DoubleArray(CAP)
    val vy = DoubleArray(CAP)
    val g = DoubleArray(CAP)
    val born = DoubleArray(CAP) { -99.0 }
    val life = DoubleArray(CAP)
    val size = DoubleArray(CAP)
    val spin = DoubleArray(CAP)
    val color = IntArray(CAP)
    private var head = 0
    private val rng = Random(7)

    /** Run time the pool is evaluated at (the sim keeps it at `RunState.runTime`). */
    var t = 0.0
    /** Rate limiters for continuous emitters (cable sparks, beam sparks). */
    var nextSpark = 0.0
    var nextBeam = 0.0
    var nextSmoke = 0.0
    var nextDust = 0.0

    fun add(k: Kind, px: Double, py: Double, pvx: Double, pvy: Double, lifeS: Double, sz: Double, col: Int, grav: Double = 0.0, sp: Double = 0.0) {
        val i = head
        head = (head + 1) % CAP
        kind[i] = k.ordinal; x[i] = px; y[i] = py; vx[i] = pvx; vy[i] = pvy; g[i] = grav
        born[i] = t; life[i] = lifeS; size[i] = sz; color[i] = col; spin[i] = sp
    }

    /** A radial burst: n particles at angles around [dir] ± [spread] (radians), speeds in [s0, s1]. */
    fun burst(k: Kind, px: Double, py: Double, n: Int, s0: Double, s1: Double, lifeS: Double, sz: Double, col: Int,
              dir: Double = -PI / 2, spread: Double = PI, grav: Double = 0.0) {
        for (j in 0 until n) {
            val a = dir + (rng.nextDouble() - 0.5) * 2 * spread
            val sp = s0 + rng.nextDouble() * (s1 - s0)
            add(k, px, py, cos(a) * sp, sin(a) * sp, lifeS * (0.7 + rng.nextDouble() * 0.6), sz * (0.7 + rng.nextDouble() * 0.6), col, grav,
                (rng.nextDouble() - 0.5) * 18)
        }
    }

    fun clear() { born.fill(-99.0); head = 0; nextSpark = 0.0; nextBeam = 0.0; nextSmoke = 0.0; nextDust = 0.0 }

    companion object {
        const val CAP = 512
        const val C_DUST = 0xFFC9B38E.toInt()
        const val C_SPARK = 0xFFFFD27A.toInt()
        const val C_ZAP = 0xFF9FE8FF.toInt()
        const val C_GLASS = 0xFFCFF2FF.toInt()
        const val C_EMBER = 0xFFFF8A3A.toInt()
        const val C_SMOKE = 0xFF4E4C58.toInt()
        const val C_GLINT = 0xFFFFF0B0.toInt()
        const val C_HIT = 0xFFFF6A4A.toInt()
        const val C_METAL = 0xFF5A6070.toInt()
    }
}
