package net.solardepin.solarchik.ui.roof

import android.content.Context
import android.graphics.RectF
import java.util.Calendar
import java.util.TimeZone
import kotlin.math.PI
import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.tan

/**
 * 0.22.0 rooftop home: pure model shared by [RooftopView], [RooftopScreen] and the unit tests.
 * Everything is in the mockup's 1920×1200 design frame (tools/rooftop/scene.js); the static plates in
 * assets/roof were rendered from that code, so these numbers must stay in sync with it.
 */
object RoofFrame {
    const val W = 1920f
    const val H = 1200f

    /** Landscape plate: 2667 wide (20:9 at the frame height), frame x = -373.5 … 2293.5, y = 0 … 1200, 1 px per unit. */
    const val LAND_X0 = -373.5f
    const val LAND_W = 2667f

    /** Portrait plate: frame x 170 … 1810, y -2000 … 1900, rendered at 0.7 px per unit. */
    const val PORT_X0 = 170f
    const val PORT_Y0 = -2000f
    const val PORT_W = 1640f
    const val PORT_H = 3900f
    const val PORT_SCALE = 0.7f

    /** Sol sprite crop (assets/roof/roof_sol_*.webp): frame origin, 1 px per unit; feet at y 1012. */
    const val SOL_X0 = 812f
    const val SOL_Y0 = 562f
    const val SOL_FEET = 1012f
    const val SOL_CX = 960f

    /** The key range that must stay visible on a portrait phone. */
    const val KEY_X0 = 210f
    const val KEY_X1 = 1770f

    // Objects (hit areas and tour highlights), frame units.
    val ANTENNA = RectF(170f, 180f, 330f, 960f)
    val BEACON = floatArrayOf(250f, 200f)
    val PANELS = RectF(440f, 760f, 890f, 912f)
    val TICKER = RectF(1138f, 726f, 1344f, 940f)
    val TICKER_SCREEN = RectF(1152f, 760f, 1330f, 844f)
    val DOOR = RectF(1560f, 640f, 1748f, 984f)
    val PLATE = RectF(1424f, 690f, 1556f, 774f)
    val CLOCK = RectF(1430f, 788f, 1550f, 930f)
    val SOL = RectF(836f, 572f, 1084f, 1016f)
    val TOOLBOX = RectF(292f, 960f, 572f, 1096f)
    val INVERTER_LEDS = floatArrayOf(847f, 880f, 865f, 880f)
}

enum class RoofObject { DOOR, CLOCK, PLATE, SOL, TICKER, PANELS, ANTENNA, TOOLBOX }

enum class RoofMood { DAY, SUNSET, NIGHT }

/** screen = frame × [s] + ([tx], [ty]). */
data class RoofCamera(val s: Float, val tx: Float, val ty: Float, val portrait: Boolean) {
    fun x(fx: Float) = fx * s + tx
    fun y(fy: Float) = fy * s + ty
    fun rect(r: RectF, out: RectF = RectF()): RectF = out.apply { set(x(r.left), y(r.top), x(r.right), y(r.bottom)) }

    companion object {
        /**
         * Landscape (tablets, phones on their side): the frame fills the height and the plate extends sideways,
         * as in the approved mockup. Portrait: the key range x 210…1770 fills the width; the extra sky sits above
         * and the frame's floor edge lands [bottomReservePx] above the bottom (room for the run button).
         */
        fun fit(w: Int, h: Int, bottomReservePx: Float): RoofCamera {
            if (w <= 0 || h <= 0) return RoofCamera(1f, 0f, 0f, false)
            val sH = h / RoofFrame.H
            val sW = w / (RoofFrame.KEY_X1 - RoofFrame.KEY_X0)
            if (sH <= sW) {
                val s = max(sH, w / RoofFrame.LAND_W)
                return RoofCamera(s, w / 2f - 960f * s, (h - RoofFrame.H * s) / 2f, false)
            }
            val s = sW
            val tx = w / 2f - (RoofFrame.KEY_X0 + RoofFrame.KEY_X1) / 2f * s
            var ty = h - bottomReservePx - RoofFrame.H * s
            val top = RoofFrame.PORT_Y0 * s // frame y of the plate top must stay at or above the screen top
            val bottom = (RoofFrame.PORT_Y0 + RoofFrame.PORT_H) * s
            ty = min(ty, -top)
            ty = max(ty, h - bottom)
            return RoofCamera(s, tx, ty, true)
        }
    }
}

object RoofHit {
    private val order = listOf(RoofObject.CLOCK, RoofObject.DOOR, RoofObject.PLATE, RoofObject.SOL, RoofObject.TICKER, RoofObject.PANELS, RoofObject.ANTENNA, RoofObject.TOOLBOX)

    fun rectOf(o: RoofObject): RectF = when (o) {
        RoofObject.DOOR -> RoofFrame.DOOR
        RoofObject.CLOCK -> RoofFrame.CLOCK
        RoofObject.PLATE -> RoofFrame.PLATE
        RoofObject.SOL -> RoofFrame.SOL
        RoofObject.TICKER -> RoofFrame.TICKER
        RoofObject.PANELS -> RoofFrame.PANELS
        RoofObject.ANTENNA -> RoofFrame.ANTENNA
        RoofObject.TOOLBOX -> RoofFrame.TOOLBOX
    }

    /** Object under a screen point; every target is grown to at least [minPx] (48 dp) around its centre. */
    fun at(cam: RoofCamera, x: Float, y: Float, minPx: Float): RoofObject? {
        val r = RectF()
        for (o in order) {
            cam.rect(rectOf(o), r)
            if (r.width() < minPx) r.inset(-(minPx - r.width()) / 2f, 0f)
            if (r.height() < minPx) r.inset(0f, -(minPx - r.height()) / 2f)
            if (r.contains(x, y)) return o
        }
        return null
    }
}

/** Sky from the device clock: sunrise/sunset from the date and the time zone (no location permission). */
object RoofSky {
    fun mood(nowMs: Long, tz: TimeZone = TimeZone.getDefault(), latitude: Double = 48.0): RoofMood {
        val cal = Calendar.getInstance(tz).apply { timeInMillis = nowMs }
        val minutes = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        val (rise, set) = sunTimes(cal.get(Calendar.DAY_OF_YEAR), tz.getOffset(nowMs) / 60_000.0, tz.rawOffset / 3_600_000.0 * 15.0, latitude)
        return when {
            minutes < rise - 30 || minutes > set + 45 -> RoofMood.NIGHT
            minutes < rise + 50 || minutes > set - 75 -> RoofMood.SUNSET
            else -> RoofMood.DAY
        }
    }

    /** Local sunrise / sunset in minutes after midnight (NOAA approximation; polar days clamp). */
    fun sunTimes(dayOfYear: Int, offsetMin: Double, longitude: Double, latitude: Double): Pair<Double, Double> {
        val g = 2 * PI / 365.0 * (dayOfYear - 1)
        val eqTime = 229.18 * (0.000075 + 0.001868 * cos(g) - 0.032077 * sin(g) - 0.014615 * cos(2 * g) - 0.040849 * sin(2 * g))
        val decl = 0.006918 - 0.399912 * cos(g) + 0.070257 * sin(g) - 0.006758 * cos(2 * g) + 0.000907 * sin(2 * g) - 0.002697 * cos(3 * g) + 0.00148 * sin(3 * g)
        val lat = latitude * PI / 180
        val c = (cos(90.833 * PI / 180) / (cos(lat) * cos(decl)) - tan(lat) * tan(decl)).coerceIn(-1.0, 1.0)
        val ha = acos(c) * 180 / PI
        val noon = 720 - 4 * longitude - eqTime + offsetMin
        return (noon - 4 * ha) to (noon + 4 * ha)
    }
}

/** The punch clock by the stair-hut door: glows and ticks until today's CLOCK IN is signed. */
enum class PunchState {
    /** Today's run (1200 m) is not done yet. */
    NEED_RUN,
    /** The run unlocked today's CLOCK IN; it waits for the signature. */
    READY,
    /** Signed today: calm, shows the streak. */
    DONE;

    val glowing: Boolean get() = this != DONE

    companion object {
        fun of(clockedToday: Boolean, signedToday: Boolean): PunchState = when {
            signedToday -> DONE
            clockedToday -> READY
            else -> NEED_RUN
        }
    }
}

/** Small key/value store so the tour logic is testable without Android prefs. */
interface RoofKv {
    fun bool(key: String): Boolean
    fun put(key: String, v: Boolean)
    fun int(key: String): Int
    fun putInt(key: String, v: Int)
}

class PrefsKv(ctx: Context) : RoofKv {
    private val p = ctx.applicationContext.getSharedPreferences("solarchik-roof", Context.MODE_PRIVATE)
    override fun bool(key: String) = p.getBoolean(key, false)
    override fun put(key: String, v: Boolean) { p.edit().putBoolean(key, v).apply() }
    override fun int(key: String) = p.getInt(key, 0)
    override fun putInt(key: String, v: Int) { p.edit().putInt(key, v).apply() }
}

/**
 * Guided tour state. New players are offered the tour once, on the first rooftop visit (skippable);
 * players who already had progress before 0.22.0 are not interrupted. Replay is always available
 * from the "?" button and the list menu.
 */
class RoofTour(private val kv: RoofKv) {
    enum class Variant { FULL, JUDGES }

    val offered: Boolean get() = kv.bool(K_OFFERED)
    val completed: Boolean get() = kv.bool(K_DONE)
    val visits: Int get() = kv.int(K_VISITS)

    /** Called once per rooftop visit; true when the first-launch offer should be shown now. */
    fun onRoofVisit(isNewPlayer: Boolean): Boolean {
        kv.putInt(K_VISITS, visits + 1)
        if (offered) return false
        kv.put(K_OFFERED, true)
        return isNewPlayer
    }

    /** First rooftop visits show the long labels (title + sub-line + leader line). */
    fun longLabels(): Boolean = visits <= 3

    fun finish(completedAll: Boolean) {
        kv.put(K_OFFERED, true)
        if (completedAll) kv.put(K_DONE, true)
    }

    companion object {
        const val K_OFFERED = "tour_offered"
        const val K_DONE = "tour_done"
        const val K_VISITS = "roof_visits"
    }
}
