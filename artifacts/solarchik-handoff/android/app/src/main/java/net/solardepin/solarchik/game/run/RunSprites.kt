package net.solardepin.solarchik.game.run

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Runner sprites. The hero frames are the project's own painted web frames (public/sprites/
 * hero-run-1..8, hero-jump-1..4), pre-upscaled offline 3x with premultiplied Lanczos, a
 * smoothed alpha edge and a light unsharp mask (tools/run-art/hero.py -> assets/art/hero).
 *
 * [prepareHero] scales every frame once to the exact on-screen pixel height (halving steps,
 * then one bilinear pass) and bakes a dark ink outline at device resolution, plus an
 * ALPHA_8 silhouette for the rim light. A frame then blits 1:1; nothing allocates per frame.
 * Bought robots run on their own 4-frame strips (assets/sprites/robots/<id>-run-N.webp).
 */
class RunSprites(private val assets: AssetManager) {
    /**
     * A frame ready to blit: [bmp] with the ink ring baked in, [pad] px of ring on each side, [rim] its
     * silhouette, [cx] the head/torso pivot as a fraction of the bitmap width (drawn at the feet x).
     */
    class Frame(val bmp: Bitmap, val pad: Int, val rim: Bitmap, val cx: Float = 0.5f)

    private val runSrc: List<Bitmap> by lazy { (1..8).mapNotNull { load("art/hero/run-$it.webp") } }
    private val jumpSrc: List<Bitmap> by lazy { (1..4).mapNotNull { load("art/hero/jump-$it.webp") } }
    private val slideSrc: Bitmap? by lazy { load("art/hero/slide.webp") }
    val mite: Bitmap? = load("sprites/foe-mite.png", maxH = 220)
    val drone: Bitmap? = load("sprites/foe-drone.png", maxH = 240)
    val buddy: Bitmap? = load("sprites/pet/buddy-talk-3.png", maxH = 160)

    /** Painted city art (skyline layers, facades, roof props, coins, boss). */
    val art = RunArt(assets)

    var run: List<Frame> = emptyList(); private set
    var jump: List<Frame> = emptyList(); private set
    var slide: Frame? = null; private set
    /** On-screen pixel height the frames are prepared for (0 = not yet). */
    var heroPx = 0; private set

    private val robotSrc = HashMap<String, List<Bitmap>>()
    private val robotFrames = HashMap<String, List<Frame>>()
    private val robotSlide = HashMap<String, Frame?>()

    /**
     * Scale and ink every hero frame for an on-screen body height of [px] device pixels.
     * 0.21.7: one common scale for the whole set (the tallest run frame = [px]) instead of every
     * frame stretched to the same height. The painted frames are cropped tight and differ 426–459 px,
     * so per-frame normalising made the robot pulse in size and drift sideways every step.
     */
    @Synchronized
    fun prepareHero(px: Int) {
        if (px <= 0 || px == heroPx) return
        heroPx = px
        val ref = runSrc.maxOfOrNull { it.height } ?: 1
        run = runSrc.map { frame(it, px * it.height / ref) }
        jump = jumpSrc.map { frame(it, px * it.height / ref) }
        slide = slideSrc?.let { frame(it, (px * SLIDE_H).roundToInt()) }
        robotFrames.clear()
        robotSlide.clear()
    }

    /** web SPR.robotRun(id): the bought robot's 4-frame run strip, prepared (empty if missing). */
    @Synchronized
    fun robotRun(id: String): List<Frame> {
        if (heroPx <= 0) return emptyList()
        return robotFrames.getOrPut(id) {
            val src = robotSources(id)
            val ref = src.maxOfOrNull { it.height } ?: 1
            src.map { frame(it, heroPx * it.height / ref) }
        }
    }

    /** A bought robot's slide pose: its first run frame leaned back, prepared. */
    @Synchronized
    fun robotSlide(id: String): Frame? {
        if (heroPx <= 0) return null
        return robotSlide.getOrPut(id) {
            val src = robotSources(id).firstOrNull() ?: return@getOrPut null
            val lean = leaned(src, 55f)
            frame(lean, (heroPx * SLIDE_H).roundToInt()).also { lean.recycle() }
        }
    }

    private fun robotSources(id: String): List<Bitmap> = robotSrc.getOrPut(id) {
        if (!ROBOT_ID.matches(id)) emptyList() else (1..4).mapNotNull { load("sprites/robots/$id-run-$it.webp") }
    }

    /**
     * web heroFrame: jump frames for take-off / rise / apex / fall, the crouch for a landing,
     * the 8-frame cycle on the ground (advanced [RUN_RATE]x the sim's runPhase so the stride
     * matches the faster city speeds).
     */
    fun heroFrame(grounded: Boolean, vy: Double, runPhase: Double, squash: Double, landing: Boolean = false): Frame? {
        if (!grounded && jump.size == 4) {
            if (squash > 0.4 && vy >= 0) return jump[0]
            if (vy < -220) return jump[1]
            if (vy < 80) return jump[2]
            return jump[3]
        }
        if (landing && jump.size == 4) return jump[0]
        if (run.isEmpty()) return null
        val n = run.size
        val i = ((Math.floor(runPhase * RUN_RATE).toInt() % n) + n) % n
        return run[i]
    }

    private val ink = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        colorFilter = PorterDuffColorFilter(INK, PorterDuff.Mode.SRC_IN)
    }
    private val plain = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    private fun frame(src: Bitmap, bodyPx: Int): Frame {
        val h = max(8, bodyPx)
        val w = max(4, (src.width.toFloat() * h / src.height).roundToInt())
        var cur = src
        while (cur.height / 2 >= h) {
            val nx = Bitmap.createScaledBitmap(cur, cur.width / 2, cur.height / 2, true)
            if (cur !== src) cur.recycle()
            cur = nx
        }
        val body = Bitmap.createScaledBitmap(cur, w, h, true)
        if (cur !== src && cur !== body) cur.recycle()
        // 0.21.7: a thinner, even ink line (12 offsets at 1.3 %, was a 16-blit 2.2 % ring that read
        // as a brown smudge on small screens).
        val p = max(2, (h * OUTLINE).roundToInt())
        val out = Bitmap.createBitmap(w + 2 * p, h + 2 * p, Bitmap.Config.ARGB_8888)
        val cv = Canvas(out)
        for (k in 0 until 12) {
            val a = k * PI / 6
            cv.drawBitmap(body, (p + cos(a) * p).toFloat(), (p + sin(a) * p).toFloat(), ink)
        }
        cv.drawBitmap(body, p.toFloat(), p.toFloat(), plain)
        val cx = (p + pivotX(body)) / out.width
        if (body !== src) body.recycle()
        return Frame(out, p, out.extractAlpha(), cx)
    }

    /** Alpha-weighted x centre of the top 45 % (head + panel): the point that must not wobble. */
    private fun pivotX(b: Bitmap): Float {
        val w = b.width
        val rows = max(1, (b.height * 0.45f).roundToInt())
        val px = IntArray(w)
        var sum = 0.0
        var wx = 0.0
        for (y in 0 until rows) {
            b.getPixels(px, 0, w, 0, y, w, 1)
            for (x in 0 until w) {
                val a = px[x] ushr 24
                if (a > 40) { sum += a; wx += a.toDouble() * x }
            }
        }
        return if (sum > 0) (wx / sum).toFloat() else w / 2f
    }

    private fun leaned(src: Bitmap, deg: Float): Bitmap {
        val r = Math.toRadians(deg.toDouble())
        val c = kotlin.math.abs(cos(r)); val s = kotlin.math.abs(sin(r))
        val w = (src.width * c + src.height * s).roundToInt()
        val h = (src.width * s + src.height * c).roundToInt()
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val cv = Canvas(out)
        cv.translate(w / 2f, h / 2f)
        cv.rotate(-deg)
        cv.drawBitmap(src, -src.width / 2f, -src.height / 2f, plain)
        return out
    }

    private companion object {
        val ROBOT_ID = Regex("^[a-z]+$")
        /** Slide pose height as a fraction of the standing body. */
        const val SLIDE_H = 0.5f
        const val RUN_RATE = 1.5
        const val OUTLINE = 0.013f
        const val INK = 0xFF141826.toInt()
    }

    private fun load(path: String, maxH: Int = 0): Bitmap? = try {
        val opts = BitmapFactory.Options()
        if (maxH > 0) {
            opts.inJustDecodeBounds = true
            assets.open(path).use { BitmapFactory.decodeStream(it, null, opts) }
            var sample = 1
            while (opts.outHeight / (sample * 2) >= maxH) sample *= 2
            opts.inJustDecodeBounds = false
            opts.inSampleSize = sample
        }
        assets.open(path).use { BitmapFactory.decodeStream(it, null, opts) }
    } catch (_: Throwable) {
        null
    }
}
