package net.solardepin.solarchik.ui.roof

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.provider.Settings
import android.view.MotionEvent
import android.view.View
import net.solardepin.solarchik.ui.Ui
import java.util.Calendar
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * 0.22.0: the rooftop home scene on a Canvas. The static layers are one pre-rendered plate per sky
 * (assets/roof, rendered from the approved mockup code in tools/rooftop); this view adds everything
 * that moves or carries live data: Sol (breath, bob, blink), the antenna beacon (red waves on a new call),
 * the panels' gold pulse, the Slice ticker, the record plate, the CLOCK IN neon sign and punch clock,
 * the tour spotlight and the door fly-in. Animation is time-based on every vsync, so it is as smooth
 * at 90/120 Hz as at 60 Hz, and it stops while the screen is hidden.
 */
@SuppressLint("ViewConstructor")
class RooftopView(context: Context) : View(context) {
    data class TickerRow(val sym: String, val value: String, val up: Boolean?)

    var mood: RoofMood = RoofMood.DAY
        set(v) { if (field != v) { field = v; plateKey = ""; requestPlate() }; invalidate() }
    var bottomReservePx = 0f
        set(v) { if (field != v) { field = v; relayout() } }
    var cam = RoofCamera(1f, 0f, 0f, false)
        private set
    var lang = "en"
    var bestMeters = 0
    var punch = PunchState.NEED_RUN
    var streak = 0
    var callAlert = false
    var earned = false
    var tickerTitle = "SLICE"
    var tickerRight = ""
    var tickerRows: List<TickerRow> = emptyList()
    /** Tour spotlight target (null = no spotlight). */
    var spotlight: RoofObject? = null
        set(v) { field = v; spotSince = SystemClock.uptimeMillis(); invalidate() }
    var onObject: ((RoofObject) -> Unit)? = null
    var onCameraChanged: (() -> Unit)? = null
    /** Door fly-in progress 0..1 (driven by [flyIn]). */
    var fly = 0f
        private set

    private var running = false
    private val t0 = SystemClock.uptimeMillis()
    private var spotSince = 0L
    private var plate: Bitmap? = null
    private var sol: Bitmap? = null
    private var plateKey = ""
    private var loading = ""
    private val reduced: Boolean get() = runCatching {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }.getOrDefault(false)

    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    private val add = PorterDuffXfermode(PorterDuff.Mode.ADD)
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glowShaders = HashMap<Int, RadialGradient>()
    private val shaderM = android.graphics.Matrix()
    private val tmpR = RectF()
    private val path = Path()
    private var vignette: RadialGradient? = null
    private var vignetteKey = ""
    private var tap: Triple<Float, Float, Long>? = null

    init {
        isClickable = true
        isFocusable = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO // the overlay tags and the list menu carry the a11y labels
    }

    // ------------------------------------------------------------------ lifecycle

    fun start() { running = true; invalidate() }
    fun stop() { running = false }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        relayout()
    }

    private fun relayout() {
        cam = RoofCamera.fit(width, height, bottomReservePx)
        vignetteKey = ""
        requestPlate()
        onCameraChanged?.invoke()
        invalidate()
    }

    private fun moodName() = when (mood) { RoofMood.DAY -> "day"; RoofMood.SUNSET -> "sunset"; RoofMood.NIGHT -> "night" }

    /** Decodes the plate for the current sky + orientation off the UI thread (one plate in memory). */
    private fun requestPlate() {
        if (width == 0) return
        val key = (if (cam.portrait) "port" else "land") + "_" + moodName()
        if (key == plateKey || key == loading) return
        loading = key
        val app = context.applicationContext
        val solKey = moodName()
        Thread {
            val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
            val p = runCatching { app.assets.open("roof/roof_$key.webp").use { BitmapFactory.decodeStream(it, null, opts) } }.getOrNull()
            val s = runCatching { app.assets.open("roof/roof_sol_$solKey.webp").use { BitmapFactory.decodeStream(it, null, opts) } }.getOrNull()
            post {
                if (loading != key) return@post
                loading = ""
                plate = p
                sol = s
                plateKey = key
                invalidate()
            }
        }.apply { name = "roof-plate"; priority = Thread.NORM_PRIORITY - 1 }.start()
    }

    val ready: Boolean get() = plate != null && plateKey.isNotEmpty()

    // ------------------------------------------------------------------ input

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (fly > 0f) return true
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> return true
            MotionEvent.ACTION_UP -> {
                val o = RoofHit.at(cam, e.x, e.y, resources.displayMetrics.density * 48f)
                if (o != null) {
                    tap = Triple(e.x, e.y, SystemClock.uptimeMillis())
                    performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                    invalidate()
                    onObject?.invoke(o)
                }
                performClick()
                return true
            }
        }
        return super.onTouchEvent(e)
    }

    override fun performClick(): Boolean { super.performClick(); return true }

    /** Screen rect of an object (tags, tour card placement). */
    fun screenRect(o: RoofObject, out: RectF = RectF()): RectF = cam.rect(RoofHit.rectOf(o), out)

    /** The camera dollies into the door (≈0.5 s), the doorway light floods the screen, then [done]. */
    fun flyIn(done: () -> Unit) {
        if (reduced) { done(); return }
        val start = SystemClock.uptimeMillis()
        val dur = 520L
        val step = object : Runnable {
            override fun run() {
                val p = ((SystemClock.uptimeMillis() - start) / dur.toFloat()).coerceIn(0f, 1f)
                fly = p
                invalidate()
                if (p < 1f) postOnAnimation(this) else done()
            }
        }
        postOnAnimation(step)
    }

    fun resetFly() { fly = 0f; invalidate() }

    // ------------------------------------------------------------------ drawing

    private fun sec(): Double = (SystemClock.uptimeMillis() - t0) / 1000.0

    override fun onDraw(c: Canvas) {
        val t = if (reduced) 0.4 else sec()
        val p = plate
        c.drawColor(skyTop())
        c.save()
        if (fly > 0f) {
            val e = easeInOut(fly)
            val dx = cam.x((RoofFrame.DOOR.left + RoofFrame.DOOR.right) / 2f)
            val dy = cam.y((RoofFrame.DOOR.top + RoofFrame.DOOR.bottom) / 2f)
            val z = 1f + 3.2f * e
            c.translate((width / 2f - dx) * e, (height / 2f - dy) * e)
            c.scale(z, z, dx, dy)
        }
        if (p != null) {
            if (cam.portrait) tmpR.set(cam.x(RoofFrame.PORT_X0), cam.y(RoofFrame.PORT_Y0), cam.x(RoofFrame.PORT_X0 + RoofFrame.PORT_W), cam.y(RoofFrame.PORT_Y0 + RoofFrame.PORT_H))
            else tmpR.set(cam.x(RoofFrame.LAND_X0), cam.y(0f), cam.x(RoofFrame.LAND_X0 + RoofFrame.LAND_W), cam.y(RoofFrame.H))
            c.drawBitmap(p, null, tmpR, bmpPaint)
            c.save()
            c.translate(cam.tx, cam.ty)
            c.scale(cam.s, cam.s)
            drawRecord(c)
            drawTicker(c)
            drawPanelsGold(c, t)
            drawNeonSign(c, t)
            drawPunchClock(c, t)
            drawSol(c, t)
            drawBeacon(c, t)
            c.restore()
        }
        c.restore()
        drawVignette(c)
        drawSpotlight(c, t)
        drawTap(c)
        if (fly > 0f) {
            val fl = ((fly - 0.45f) / 0.55f).coerceIn(0f, 1f)
            fill.shader = null
            fill.color = Color.argb((235 * fl).toInt(), 255, 214, 150)
            c.drawRect(0f, 0f, width.toFloat(), height.toFloat(), fill)
        }
        if (running && !reduced || fly > 0f || tap != null) postInvalidateOnAnimation()
    }

    private fun skyTop(): Int = when (mood) {
        RoofMood.DAY -> 0xFF1A4C9C.toInt()
        RoofMood.SUNSET -> 0xFF151A40.toInt()
        RoofMood.NIGHT -> 0xFF03060F.toInt()
    }

    /** Colour as the mockup's scene grade would leave it (props are multiplied + tinted at sunset/night). */
    private fun graded(c: Int): Int {
        val (mul, tint, ta) = when (mood) {
            RoofMood.DAY -> return c
            RoofMood.SUNSET -> Triple(0xFFFFC6A4.toInt(), 0xFFFF8A4A.toInt(), 0.10f)
            RoofMood.NIGHT -> Triple(0xFF5B6896.toInt(), 0xFF1A2A5A.toInt(), 0.18f)
        }
        fun ch(v: Int, m: Int, ti: Int) = (v * m / 255f * (1 - ta) + ti * ta).toInt().coerceIn(0, 255)
        return Color.argb(Color.alpha(c), ch(Color.red(c), Color.red(mul), Color.red(tint)), ch(Color.green(c), Color.green(mul), Color.green(tint)), ch(Color.blue(c), Color.blue(mul), Color.blue(tint)))
    }

    private fun glow(c: Canvas, cx: Float, cy: Float, r: Float, color: Int, a: Float, additive: Boolean = true) {
        if (a <= 0f || r <= 0f) return
        val key = color or 0xFF000000.toInt()
        val sh = glowShaders.getOrPut(key) {
            RadialGradient(0f, 0f, 1f, intArrayOf(key, Ui.withAlpha(key, 0x73), Ui.withAlpha(key, 0)), floatArrayOf(0f, 0.35f, 1f), Shader.TileMode.CLAMP)
        }
        shaderM.setScale(r, r)
        shaderM.postTranslate(cx, cy)
        sh.setLocalMatrix(shaderM)
        glowPaint.shader = sh
        glowPaint.alpha = (255 * a.coerceIn(0f, 1f)).toInt()
        glowPaint.xfermode = if (additive) add else null
        c.drawCircle(cx, cy, r, glowPaint)
        glowPaint.xfermode = null
    }

    private fun drawSol(c: Canvas, t: Double) {
        val b = sol ?: return
        val ph = sin(t * 2 * PI / 2.6)
        val bob = (ph * 5).toFloat()
        val breath = (1 + ph * 0.006).toFloat()
        c.save()
        c.scale(1f / breath, breath, RoofFrame.SOL_CX, RoofFrame.SOL_FEET)
        c.translate(RoofFrame.SOL_X0, RoofFrame.SOL_Y0 - bob)
        c.drawBitmap(b, 0f, 0f, bmpPaint)
        // blink: the screen eyes close for ~120 ms, twice every ~7 s
        val bt = t % 7.0
        if (!reduced && (bt in 1.05..1.17 || bt in 4.6..4.72)) {
            fill.shader = null
            fill.color = graded(0xFF0D1219.toInt())
            for (ex in floatArrayOf(151.4f, 202.8f)) {
                tmpR.set(ex - 17.5f, 208.5f - 11.4f, ex + 17.5f, 208.5f + 11.4f)
                c.drawOval(tmpR, fill)
            }
            stroke.color = 0xFF8FE9FF.toInt()
            stroke.strokeWidth = 3.4f
            for (ex in floatArrayOf(151.4f, 202.8f)) {
                path.reset(); path.moveTo(ex - 10.6f, 210.8f); path.quadTo(ex, 214.2f, ex + 10.6f, 210.8f)
                c.drawPath(path, stroke)
            }
        }
        c.restore()
        if (mood != RoofMood.DAY) glow(c, 993f, 779f - bob, 90f, 0xFF6FE0FF.toInt(), if (mood == RoofMood.NIGHT) 0.16f else 0.08f)
    }

    private fun drawBeacon(c: Canvas, t: Double) {
        val bx = RoofFrame.BEACON[0]
        val by = RoofFrame.BEACON[1]
        if (callAlert) {
            val on = (t % 1.0) < 0.5
            glow(c, bx, by, if (on) 80f else 40f, 0xFFFF4030.toInt(), if (on) 0.85f else 0.3f)
            glow(c, bx, by, 14f, 0xFFFFD0C0.toInt(), if (on) 1f else 0.4f)
            stroke.strokeWidth = 3f
            for (k in 0 until 3) {
                val u = ((t * 0.8 + k / 3.0) % 1.0).toFloat()
                stroke.color = Color.argb((255 * (1 - u) * 0.7f).toInt(), 255, 110, 90)
                val r = 20f + u * 90f
                tmpR.set(bx - r, by - r, bx + r, by + r)
                c.drawArc(tmpR, -45f, 90f, false, stroke)
                c.drawArc(tmpR, 135f, 90f, false, stroke)
            }
        } else {
            val on = (t % 2.4) < 0.35
            glow(c, bx, by, 34f, 0xFFFF4A3A.toInt(), if (on) (if (mood == RoofMood.DAY) 0.35f else 0.7f) else 0.12f)
            glow(c, bx, by, 8f, 0xFFFFC0B0.toInt(), if (on) 0.8f else 0.25f)
        }
    }

    private val sparkRng = java.util.Random(3).let { r -> FloatArray(27) { r.nextFloat() } }

    private fun drawPanelsGold(c: Canvas, t: Double) {
        if (!earned) return
        val pulse = (0.75 + 0.25 * sin(t * 2 * PI / 1.6)).toFloat()
        val x0 = 455f; val x1 = 815f; val top = 772f; val bot = 858f
        val pw = (x1 - x0 - 20f) / 3f
        fill.shader = LinearGradient(0f, top, 0f, bot, 0xFFFFCE50.toInt(), 0xE6F0821E.toInt(), Shader.TileMode.CLAMP)
        fill.alpha = (255 * 0.62f * pulse).toInt()
        for (i in 0 until 3) {
            val px = x0 + i * (pw + 10f)
            path.reset()
            path.moveTo(px + 9f, top + 3f); path.lineTo(px + pw - 9f, top + 3f); path.lineTo(px + pw - 3f, bot - 3f); path.lineTo(px + 3f, bot - 3f); path.close()
            c.drawPath(path, fill)
        }
        fill.shader = null
        fill.alpha = 255
        glow(c, (x0 + x1) / 2f, (top + bot) / 2f, 300f, 0xFFFFB840.toInt(), 0.32f * pulse)
        for (i in 0 until 9) {
            val sx = x0 + sparkRng[i * 3] * (x1 - x0)
            val sy = top - 10f - sparkRng[i * 3 + 1] * 60f - ((t * 40 + i * 30) % 60).toFloat()
            sparkle(c, sx, sy, 7f + sparkRng[i * 3 + 2] * 7f, 0.9f * pulse)
        }
    }

    private fun sparkle(c: Canvas, cx: Float, cy: Float, r: Float, a: Float) {
        fill.shader = null
        fill.color = Color.argb((255 * a).toInt(), 255, 236, 170)
        path.reset()
        path.moveTo(cx, cy - r); path.quadTo(cx, cy, cx + r, cy); path.quadTo(cx, cy, cx, cy + r); path.quadTo(cx, cy, cx - r, cy); path.quadTo(cx, cy, cx, cy - r)
        c.drawPath(path, fill)
    }

    private fun drawRecord(c: Canvas) {
        val px = 1424f; val py = 690f; val pw = 132f
        text.reset(); text.isAntiAlias = true
        text.typeface = Ui.tfExtra()
        text.textSize = 12.5f
        text.letterSpacing = 0.2f
        text.textAlign = Paint.Align.CENTER
        text.color = graded(Color.argb(191, 255, 255, 255))
        c.drawText(if (lang == "uk") "РЕКОРД" else "BEST RUN", px + pw / 2 + 1, py + 25 + 4.5f, text)
        text.letterSpacing = 0f
        text.typeface = Ui.tfDisplay()
        val rec = RoofText.meters(bestMeters, lang)
        var fs = 25f
        text.textSize = fs
        while (text.measureText(rec) > pw - 26 && fs > 14) { fs -= 1f; text.textSize = fs }
        text.color = graded(Color.WHITE)
        c.drawText(rec, px + pw / 2, py + 55 + fs * 0.36f, text)
    }

    private fun drawTicker(c: Canvas) {
        val x0 = 1146f; val x1 = 1336f; val top = 742f
        val alpha = when (mood) { RoofMood.DAY -> 1f; RoofMood.SUNSET -> 0.85f; RoofMood.NIGHT -> 0.95f }
        text.reset(); text.isAntiAlias = true
        text.typeface = Ui.tfExtra()
        text.textSize = 12.5f
        text.textAlign = Paint.Align.LEFT
        text.color = Ui.withAlpha(Ui.GOLD, (255 * alpha).toInt())
        c.drawText(tickerTitle, x0 + 10, top + 3 + 4.5f, text)
        text.textAlign = Paint.Align.RIGHT
        text.color = Ui.withAlpha(Ui.GOLD, (166 * alpha).toInt())
        c.drawText(tickerRight, x1 - 10, top + 3 + 4.5f, text)
        tickerRows.take(3).forEachIndexed { i, r ->
            val y = top + 34 + i * 25
            text.textSize = 16f
            text.textAlign = Paint.Align.LEFT
            text.color = Color.argb((255 * alpha).toInt(), 0xE9, 0xEE, 0xF3)
            c.drawText(r.sym, x0 + 14, y + 6f, text)
            val col = when (r.up) { true -> Ui.GREEN; false -> Ui.RED; null -> Ui.MUTED }
            fill.shader = null
            fill.color = Ui.withAlpha(col, (255 * alpha).toInt())
            if (r.up != null) {
                path.reset()
                if (r.up) { path.moveTo(x1 - 92, y + 5); path.lineTo(x1 - 84, y - 6); path.lineTo(x1 - 76, y + 5) }
                else { path.moveTo(x1 - 92, y - 5); path.lineTo(x1 - 84, y + 6); path.lineTo(x1 - 76, y - 5) }
                path.close()
                c.drawPath(path, fill)
            }
            text.textAlign = Paint.Align.RIGHT
            text.color = fill.color
            c.drawText(r.value, x1 - 14, y + 6f, text)
        }
    }

    /** Neon "CLOCK IN" over the stair-hut door: magenta and flickering until today is signed, calm Solana green after. */
    private fun drawNeonSign(c: Canvas, t: Double) {
        val cx = 1612f; val cy = 584f
        val pending = punch.glowing
        val base = if (pending) 0xFFFF4FA3.toInt() else 0xFF14F195.toInt()
        val core = if (pending) 0xFFFFE3F1.toInt() else 0xFFD8FFEE.toInt()
        var level = if (!pending) 0.62f else {
            val beat = if (punch == PunchState.READY) 1.1 else 1.6
            val p = (0.78 + 0.22 * sin(t * 2 * PI / beat)).toFloat()
            // a short neon stutter every ~6 s
            val st = t % 6.2
            if (!reduced && (st in 2.0..2.06 || st in 2.12..2.16)) p * 0.35f else p
        }
        if (mood == RoofMood.DAY) level *= 0.9f
        // backing rail + panel
        fill.shader = null
        fill.color = graded(0xFF2A2F37.toInt())
        c.drawRect(cx - 120, cy - 33, cx - 116, cy + 33, fill)
        c.drawRect(cx + 116, cy - 33, cx + 120, cy + 33, fill)
        fill.color = Color.argb(if (mood == RoofMood.DAY) 215 else 190, 16, 12, 24)
        tmpR.set(cx - 138, cy - 28, cx + 138, cy + 28)
        c.drawRoundRect(tmpR, 10f, 10f, fill)
        stroke.color = Color.argb(70, 255, 255, 255); stroke.strokeWidth = 1.2f
        c.drawRoundRect(tmpR, 10f, 10f, stroke)
        glow(c, cx, cy, 190f, base, (if (mood == RoofMood.DAY) 0.18f else 0.34f) * level)
        text.reset(); text.isAntiAlias = true
        text.typeface = Ui.tfExtra()
        text.textSize = 38f
        text.letterSpacing = 0.12f
        text.textAlign = Paint.Align.CENTER
        val label = "CLOCK IN"
        // tube glow (two shadow passes), then the hot core
        text.color = Ui.withAlpha(base, (255 * level).toInt())
        text.setShadowLayer(16f, 0f, 0f, Ui.withAlpha(base, (255 * level).toInt()))
        c.drawText(label, cx, cy + 13.5f, text)
        text.setShadowLayer(5f, 0f, 0f, Ui.withAlpha(base, (255 * min(1f, level * 1.2f)).toInt()))
        text.color = Ui.blend(base, core, 0.55f * level + 0.2f)
        c.drawText(label, cx, cy + 13.5f, text)
        text.clearShadowLayer()
    }

    /** Wall punch clock left of the door: real local time, a ticking second hand and a blinking lamp while today is open. */
    private fun drawPunchClock(c: Canvas, t: Double) {
        val x0 = 1438f; val y0 = 792f; val x1 = 1548f; val y1 = 916f
        val pending = punch.glowing
        // shadow + housing
        fill.shader = null
        fill.color = Color.argb(70, 0, 0, 0)
        tmpR.set(x0 + 3, y0 + 5, x1 + 3, y1 + 5); c.drawRoundRect(tmpR, 9f, 9f, fill)
        fill.shader = LinearGradient(0f, y0, 0f, y1, graded(0xFF67707B.toInt()), graded(0xFF2C3239.toInt()), Shader.TileMode.CLAMP)
        tmpR.set(x0, y0, x1, y1); c.drawRoundRect(tmpR, 9f, 9f, fill)
        fill.shader = null
        fill.color = graded(Color.argb(110, 255, 255, 255)); c.drawRect(x0 + 6, y0 + 1, x1 - 6, y0 + 2.5f, fill)
        // dial
        val dcx = 1474f; val dcy = 838f; val r = 27f
        fill.color = graded(0xFFB9C0C8.toInt()); c.drawCircle(dcx, dcy, r + 3, fill)
        fill.color = graded(0xFFF6F1E6.toInt()); c.drawCircle(dcx, dcy, r, fill)
        stroke.color = graded(0xFF2A2F36.toInt())
        for (i in 0 until 12) {
            val a = i * PI / 6
            stroke.strokeWidth = if (i % 3 == 0) 2.6f else 1.4f
            val r0 = if (i % 3 == 0) r - 7 else r - 5
            c.drawLine(dcx + (sin(a) * r0).toFloat(), dcy - (cos(a) * r0).toFloat(), dcx + (sin(a) * (r - 2)).toFloat(), dcy - (cos(a) * (r - 2)).toFloat(), stroke)
        }
        val cal = Calendar.getInstance()
        val hr = cal.get(Calendar.HOUR) + cal.get(Calendar.MINUTE) / 60.0
        val mn = cal.get(Calendar.MINUTE) + cal.get(Calendar.SECOND) / 60.0
        stroke.strokeWidth = 3.4f
        hand(c, dcx, dcy, hr / 12 * 2 * PI, r * 0.52f)
        stroke.strokeWidth = 2.4f
        hand(c, dcx, dcy, mn / 60 * 2 * PI, r * 0.8f)
        if (pending) {
            // the second hand ticks (with a tiny overshoot) while today's CLOCK IN is open
            val s = cal.get(Calendar.SECOND)
            val frac = (SystemClock.uptimeMillis() % 1000) / 1000.0
            val kick = if (frac < 0.12) sin(frac / 0.12 * PI) * 0.05 else 0.0
            stroke.color = 0xFFE5484D.toInt(); stroke.strokeWidth = 1.5f
            hand(c, dcx, dcy, (s + kick) / 60 * 2 * PI, r * 0.86f)
        }
        fill.color = graded(0xFF2A2F36.toInt()); c.drawCircle(dcx, dcy, 2.6f, fill)
        // status window: streak once signed, a blinking lamp before
        val lx0 = 1510f; val ly0 = 816f; val lx1 = 1540f; val ly1 = 860f
        fill.color = 0xFF0B1410.toInt()
        tmpR.set(lx0, ly0, lx1, ly1); c.drawRoundRect(tmpR, 4f, 4f, fill)
        if (pending) {
            val on = reduced || (t % 1.0) < 0.55
            val col = if (punch == PunchState.READY) 0xFFFFB547.toInt() else 0xFFFF4FA3.toInt()
            fill.color = if (on) col else Ui.withAlpha(col, 0x55)
            c.drawCircle((lx0 + lx1) / 2, ly0 + 13, 5f, fill)
            if (on) glow(c, (lx0 + lx1) / 2, ly0 + 13, 16f, col, 0.7f)
            text.reset(); text.isAntiAlias = true; text.typeface = Ui.tfExtra(); text.textSize = 9.5f; text.textAlign = Paint.Align.CENTER
            text.color = Ui.withAlpha(col, 0xCC)
            c.drawText("IN", (lx0 + lx1) / 2, ly1 - 8, text)
        } else {
            text.reset(); text.isAntiAlias = true; text.typeface = Ui.tfDisplay(); text.textAlign = Paint.Align.CENTER
            val s = streak.coerceAtLeast(1).toString()
            text.textSize = if (s.length > 2) 12f else 17f
            text.color = 0xFF7DFFB8.toInt()
            text.setShadowLayer(6f, 0f, 0f, 0xAA14F195.toInt())
            c.drawText(s, (lx0 + lx1) / 2, ly0 + 24, text)
            text.clearShadowLayer()
            text.typeface = Ui.tfExtra(); text.textSize = 8f; text.color = 0xCC7DFFB8.toInt()
            c.drawText(if (lang == "uk") "ДНІВ" else "DAYS", (lx0 + lx1) / 2, ly1 - 7, text)
        }
        // card slot + a time card waiting in it (stamped green once signed)
        fill.color = 0xFF14181D.toInt()
        tmpR.set(x0 + 14, 892f, x1 - 14, 899f); c.drawRoundRect(tmpR, 2f, 2f, fill)
        fill.color = graded(if (pending) 0xFFF1E3C2.toInt() else 0xFFE3F5E8.toInt())
        tmpR.set(x0 + 30, 873f, x1 - 30, 894f); c.drawRect(tmpR, fill)
        stroke.color = graded(0x55785A2A); stroke.strokeWidth = 0.8f
        c.drawLine(x0 + 33, 879f, x1 - 33, 879f, stroke); c.drawLine(x0 + 33, 884f, x1 - 40, 884f, stroke)
        if (!pending) {
            stroke.color = 0xFF1FA463.toInt(); stroke.strokeWidth = 2.6f
            path.reset(); path.moveTo(1484f, 884f); path.lineTo(1489f, 889f); path.lineTo(1498f, 877f)
            c.drawPath(path, stroke)
        }
        if (pending) glow(c, (x0 + x1) / 2, (y0 + y1) / 2, 110f, if (punch == PunchState.READY) 0xFFFFB547.toInt() else 0xFFFF4FA3.toInt(), (if (mood == RoofMood.DAY) 0.10f else 0.2f) * (0.7f + 0.3f * sin(t * 2 * PI / 1.4).toFloat()))
    }

    private fun hand(c: Canvas, cx: Float, cy: Float, a: Double, len: Float) {
        c.drawLine(cx, cy, cx + (sin(a) * len).toFloat(), cy - (cos(a) * len).toFloat(), stroke)
    }

    private fun drawVignette(c: Canvas) {
        val key = "${width}x$height-$mood"
        if (key != vignetteKey) {
            vignetteKey = key
            val cx = width / 2f
            val cy = cam.y(RoofFrame.H * 0.55f)
            val r = max(width, height) * 0.75f
            val a = if (mood == RoofMood.NIGHT) 0.45f else 0.22f
            vignette = RadialGradient(cx, cy, r, intArrayOf(0, 0, Color.argb((255 * a).toInt(), 4, 6, 14)), floatArrayOf(0f, 0.52f, 1f), Shader.TileMode.CLAMP)
        }
        fill.shader = vignette
        fill.alpha = 255
        c.drawRect(0f, 0f, width.toFloat(), height.toFloat(), fill)
        fill.shader = null
    }

    private fun drawSpotlight(c: Canvas, t: Double) {
        val o = spotlight ?: return
        val k = ((SystemClock.uptimeMillis() - spotSince) / 260f).coerceIn(0f, 1f)
        screenRect(o, tmpR)
        val pad = 14f * resources.displayMetrics.density
        tmpR.inset(-pad, -pad)
        val cx = tmpR.centerX(); val cy = tmpR.centerY()
        val rad = max(tmpR.width(), tmpR.height()) / 2f
        val rr = max(rad, 40f * resources.displayMetrics.density)
        path.reset()
        path.fillType = Path.FillType.EVEN_ODD
        path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        path.addCircle(cx, cy, rr, Path.Direction.CW)
        fill.shader = null
        fill.color = Color.argb((150 * k).toInt(), 3, 8, 16)
        c.drawPath(path, fill)
        path.fillType = Path.FillType.WINDING
        val pulse = if (reduced) 0f else ((t * 0.9) % 1.0).toFloat()
        stroke.color = Color.argb((235 * k).toInt(), 255, 214, 110); stroke.strokeWidth = 3f * resources.displayMetrics.density
        c.drawCircle(cx, cy, rr, stroke)
        stroke.color = Color.argb((160 * (1 - pulse) * k).toInt(), 255, 214, 110); stroke.strokeWidth = 2f * resources.displayMetrics.density
        c.drawCircle(cx, cy, rr + pulse * 22f * resources.displayMetrics.density, stroke)
    }

    private fun drawTap(c: Canvas) {
        val (x, y, at) = tap ?: return
        val u = (SystemClock.uptimeMillis() - at) / 420f
        if (u >= 1f) { tap = null; return }
        val d = resources.displayMetrics.density
        stroke.color = Color.argb((242 * (1 - u)).toInt(), 255, 224, 140); stroke.strokeWidth = 3f * d
        c.drawCircle(x, y, 14f * d + u * 46f * d, stroke)
    }

    companion object {
        fun easeInOut(t: Float): Float = if (t < 0.5f) 4 * t * t * t else 1 - Math.pow((-2.0 * t + 2), 3.0).toFloat() / 2
    }
}

object RoofText {
    /** "1 548 м" / "1,548 m". */
    fun meters(m: Int, lang: String): String =
        if (lang == "uk") String.format(java.util.Locale.US, "%,d", m).replace(",", "\u202F") + " м"
        else String.format(java.util.Locale.US, "%,d m", m)

    fun pct(v: Double, lang: String): String {
        val s = String.format(java.util.Locale.US, "%+.1f%%", v)
        return if (lang == "uk") s.replace('.', ',').replace("-", "−") else s.replace("-", "−")
    }

    fun usd(v: Double, lang: String): String =
        if (lang == "uk") "$" + String.format(java.util.Locale.US, "%,.0f", v).replace(",", "\u202F") else "$" + String.format(java.util.Locale.US, "%,.0f", v)
}
