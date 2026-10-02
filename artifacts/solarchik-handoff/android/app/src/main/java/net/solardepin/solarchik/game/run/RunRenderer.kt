package net.solardepin.solarchik.game.run

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Canvas port of the web drawWorld (src/lib/game/draw.ts). Draws in the web's CSS-pixel space:
 * the canvas is scaled so the world is [LOGICAL_H] units tall and as wide as the screen aspect
 * allows, which on a 20:9 phone gives the same framing as the desktop browser.
 *
 * Only the game thread calls [draw] (or a test, on its own instance). Not thread-safe.
 */
class RunRenderer(
    private val spr: RunSprites,
    private val textFace: Typeface?,
    private val displayFace: Typeface?,
) {
    var reducedMotion = false

    /** Equipped roof skin and robot (set by the game thread before a run). */
    var skin: RunSkin = RunSkin.FLAG
    var robot: String = "stock"

    /** World units per screen height. */
    var logicalH = LOGICAL_H

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val bmpPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        colorFilter = PorterDuffColorFilter(0xFF1C140E.toInt(), PorterDuff.Mode.SRC_IN)
    }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        typeface = textFace ?: Typeface.DEFAULT_BOLD
    }
    private val tintPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    /** Additive-looking light (glows, rays, sparkles). */
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; xfermode = PorterDuffXfermode(PorterDuff.Mode.SCREEN) }
    private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER; style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND
    }
    private val rect = RectF()
    /** Mood filter for rooftops this frame (set in drawWorld). */
    private var moodRoof: android.graphics.ColorFilter? = null
    private val outlineCache = java.util.IdentityHashMap<Bitmap, Bitmap>()
    private val outlinePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    /** The sprite with a baked dark ink outline ([frac] of its height), cached per bitmap. */
    private fun outlined(img: Bitmap, frac: Double): Bitmap = outlineCache.getOrPut(img) {
        val p = max(2, (img.height * frac).toInt())
        val out = Bitmap.createBitmap(img.width + 2 * p, img.height + 2 * p, Bitmap.Config.ARGB_8888)
        val cv = Canvas(out)
        outlinePaint.colorFilter = PorterDuffColorFilter(0xFF1C140E.toInt(), PorterDuff.Mode.SRC_IN)
        for (k in 0 until 16) {
            val a = k * PI / 8
            cv.drawBitmap(img, (p + cos(a) * p).toFloat(), (p + sin(a) * p).toFloat(), outlinePaint)
        }
        outlinePaint.colorFilter = null
        cv.drawBitmap(img, p.toFloat(), p.toFloat(), outlinePaint)
        out
    }
    private val path = Path()
    private val path2 = Path()
    private var alpha = 1f

    // ---- presentation-only memory (never feeds back into the sim) ----
    private val popBorn = java.util.IdentityHashMap<Pop, Double>()
    private var deadAt = -1.0
    private var clockAt = -1.0
    private var lastHearts = -1
    private var hurtAt = -9.0
    private var landAt = -9.0
    private var wasGrounded = true

    // ---- small canvas helpers mirroring the 2D context calls the web uses ----

    private fun a255(a: Double): Int = (a.coerceIn(0.0, 1.0) * alpha * 255).toInt()

    private fun rgba(r: Int, g: Int, b: Int, a: Double): Int = Color.argb(a255(a), r, g, b)

    private fun color(argb: Int, extra: Double = 1.0): Int {
        val a = (Color.alpha(argb) / 255.0) * extra
        return (a255(a) shl 24) or (argb and 0xFFFFFF)
    }

    private fun solid(argb: Int, extra: Double = 1.0): Paint {
        fill.shader = null
        fill.color = color(argb, extra)
        return fill
    }

    private fun roundRect(c: Canvas, x: Double, y: Double, w: Double, h: Double, r: Double, p: Paint) {
        val rr = min(r, min(w / 2, h / 2)).toFloat()
        rect.set(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat())
        c.drawRoundRect(rect, rr, rr, p)
    }

    private fun oval(c: Canvas, cx: Double, cy: Double, rx: Double, ry: Double, p: Paint) {
        rect.set((cx - rx).toFloat(), (cy - ry).toFloat(), (cx + rx).toFloat(), (cy + ry).toFloat())
        c.drawOval(rect, p)
    }

    private fun ovalPath(cx: Double, cy: Double, rx: Double, ry: Double) {
        rect.set((cx - rx).toFloat(), (cy - ry).toFloat(), (cx + rx).toFloat(), (cy + ry).toFloat())
        path.addOval(rect, Path.Direction.CW)
    }

    private fun circle(c: Canvas, x: Double, y: Double, r: Double, p: Paint) = c.drawCircle(x.toFloat(), y.toFloat(), r.toFloat(), p)

    private fun hash(n: Double): Double {
        val x = sin(n * 127.1 + 311.7) * 43758.5453
        return x - floor(x)
    }

    private fun lerp(a: Double, b: Double, t: Double) = a + (b - a) * min(1.0, max(0.0, t))

    private fun mix3(a: DoubleArray, b: DoubleArray, t: Double) = doubleArrayOf(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))

    private fun rgb(v: DoubleArray): Int = Color.argb(a255(1.0), v[0].toInt(), v[1].toInt(), v[2].toInt())

    private fun d(vararg v: Int) = DoubleArray(v.size) { v[it].toDouble() }

    /** web blit(): feet-anchored sprite with squash / stretch / flip / rotation. */
    private fun blit(
        c: Canvas, img: Bitmap?, feetX: Double, feetY: Double, hgt: Double,
        squash: Double = 0.0, stretch: Double = 0.0, flip: Boolean = false, a: Double = 1.0, rot: Double = 0.0,
        shadow: Boolean = false, tint: Int = 0, tintA: Double = 0.0, outline: Double = 0.0,
    ): Boolean {
        if (img == null || img.width <= 0 || img.height <= 0) return false
        if (outline > 0) {
            // same feet/height as the bare sprite; the ink ring sits just outside it
            val o = outlined(img, outline)
            val pad = (o.height - img.height) / 2.0 * hgt / img.height
            return blit(c, o, feetX, feetY + pad, hgt + pad * 2, squash, stretch, flip, a, rot, shadow, tint, tintA)
        }
        val sy = 1 - squash * 0.34 + stretch * 0.28
        val sx = (1 + squash * 0.22 - stretch * 0.12) * if (flip) -1 else 1
        val dw = hgt * img.width / img.height
        c.save()
        c.translate(feetX.toFloat(), feetY.toFloat())
        c.scale(sx.toFloat(), sy.toFloat())
        if (rot != 0.0) {
            c.translate(0f, (-hgt * 0.46).toFloat())
            c.rotate(Math.toDegrees(rot).toFloat())
            c.translate(0f, (hgt * 0.46).toFloat())
        }
        rect.set((-dw / 2).toFloat(), (-hgt).toFloat(), (dw / 2).toFloat(), 0f)
        if (shadow) {
            // canvas shadowColor #1c140e, blur 0, offset (3, 4): a hard silhouette behind the sprite
            c.save()
            c.scale((1 / sx).toFloat(), (1 / sy).toFloat())
            c.translate(3f, 4f)
            c.scale(sx.toFloat(), sy.toFloat())
            shadowPaint.alpha = a255(a)
            c.drawBitmap(img, null, rect, shadowPaint)
            c.restore()
        }
        bmpPaint.alpha = a255(a)
        c.drawBitmap(img, null, rect, bmpPaint)
        if (tintA > 0) {
            tintPaint.colorFilter = PorterDuffColorFilter(tint or (0xFF shl 24), PorterDuff.Mode.SRC_IN)
            tintPaint.alpha = a255(tintA * a)
            c.drawBitmap(img, null, rect, tintPaint)
        }
        c.restore()
        return true
    }

    // ---- scenery (draw.ts helpers) ----

    private fun hillPath(w: Double, h: Double, base: Double, amp: Double, cam: Double, freq: Double, seed: Double): Path {
        path.reset()
        path.moveTo(-20f, (h + 20).toFloat())
        path.lineTo(-20f, base.toFloat())
        var x = -20.0
        while (x <= w + 24) {
            val y = base + sin((x + cam) * freq + seed) * amp + sin((x + cam) * freq * 2.3 + seed * 1.7) * amp * 0.35
            path.lineTo(x.toFloat(), y.toFloat())
            x += 18
        }
        path.lineTo((w + 24).toFloat(), (h + 20).toFloat())
        path.close()
        return path
    }

    private fun paintSun(c: Canvas, x: Double, y: Double, r: Double, t: Double) {
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        fill.shader = RadialGradient(x.toFloat(), y.toFloat(), (r * 2.1).toFloat(),
            intArrayOf(rgba(255, 214, 90, 0.4), rgba(255, 214, 90, 0.4), rgba(255, 190, 70, 0.0)),
            floatArrayOf(0f, (0.3 / 2.1).toFloat(), 1f), Shader.TileMode.CLAMP)
        circle(c, x, y, r * 2.1, fill)
        fill.shader = null
        c.save()
        c.translate(x.toFloat(), y.toFloat())
        stroke.color = rgba(255, 186, 60, 0.9)
        stroke.strokeWidth = max(3.0, r * 0.08).toFloat()
        stroke.strokeCap = Paint.Cap.ROUND
        val spin = t * 0.12
        for (i in 0 until 10) {
            val a = spin + (i / 10.0) * PI * 2
            c.drawLine((cos(a) * (r + 6)).toFloat(), (sin(a) * (r + 6)).toFloat(), (cos(a) * (r + 16)).toFloat(), (sin(a) * (r + 16)).toFloat(), stroke)
        }
        // web: two-circle radial gradient from (-.28r,-.32r) to the rim; offset single centre here
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        fill.shader = RadialGradient((-r * 0.28).toFloat(), (-r * 0.32).toFloat(), (r * 1.38).toFloat(),
            intArrayOf(color(0xFFFFF6C8.toInt()), color(0xFFFFD24A.toInt()), color(0xFFF0A31A.toInt())),
            floatArrayOf(0.06f, 0.42f, 1f), Shader.TileMode.CLAMP)
        circle(c, 0.0, 0.0, r, fill)
        fill.shader = null
        stroke.color = color(0xFFE09018.toInt())
        stroke.strokeWidth = max(2.5, r * 0.05).toFloat()
        circle(c, 0.0, 0.0, r, stroke)
        c.save()
        c.translate((-r * 0.28).toFloat(), (-r * 0.3).toFloat())
        c.rotate(Math.toDegrees(-0.6).toFloat())
        oval(c, 0.0, 0.0, r * 0.2, r * 0.12, solid(Color.WHITE, 0.7))
        c.restore()
        c.restore()
    }

    private fun puffCloud(c: Canvas, x: Double, y: Double, s: Double, a: Double) {
        if (a <= 0) return
        // soft belly shadow, puffy body, sunlit crown (hand-drawn cloud in three tones)
        path.reset()
        ovalPath(x + 2 * s, y + 9 * s, 44 * s, 11 * s)
        c.drawPath(path, solid(0xFFB9D3EA.toInt(), a * 0.55))
        path.reset()
        ovalPath(x, y, 38 * s, 16 * s)
        ovalPath(x - 24 * s, y + 4 * s, 22 * s, 12 * s)
        ovalPath(x + 26 * s, y + 3 * s, 20 * s, 11 * s)
        ovalPath(x - 8 * s, y - 10 * s, 20 * s, 14 * s)
        ovalPath(x + 12 * s, y - 8 * s, 16 * s, 12 * s)
        c.drawPath(path, solid(0xFFFFFDF8.toInt(), a))
        path.reset()
        ovalPath(x - 10 * s, y - 14 * s, 12 * s, 6 * s)
        ovalPath(x + 12 * s, y - 12 * s, 8 * s, 4 * s)
        c.drawPath(path, solid(Color.WHITE, a * 0.9))
    }

    /** Distant mountain range in aerial perspective (tinted toward the sky colour). */
    private fun paintRange(c: Canvas, w: Double, h: Double, cam: Double, tint: Int, a: Double) {
        path.reset()
        path.moveTo(-20f, (h * 0.7).toFloat())
        var x = -20.0
        while (x <= w + 30) {
            val u = (x + cam) * 0.0042
            val y = h * 0.6 - (abs(sin(u)) * 0.6 + abs(sin(u * 2.7 + 1.3)) * 0.3 + sin(u * 7.1) * 0.05) * h * 0.11
            path.lineTo(x.toFloat(), y.toFloat())
            x += 14
        }
        path.lineTo((w + 30).toFloat(), (h * 0.7).toFloat())
        path.close()
        c.drawPath(path, solid(tint, a))
    }

    /** A round storybook tree: trunk, three-tone canopy, rim light. */
    private fun tree(c: Canvas, x: Double, y: Double, s: Double, leaf: Int, dark: Int, light: Int, a: Double) {
        c.drawRect((x - 2.5 * s).toFloat(), (y - 16 * s).toFloat(), (x + 2.5 * s).toFloat(), y.toFloat(), solid(0xFF5A4030.toInt(), a))
        path.reset()
        ovalPath(x, y - 26 * s, 15 * s, 14 * s); ovalPath(x - 10 * s, y - 19 * s, 10 * s, 9 * s); ovalPath(x + 10 * s, y - 20 * s, 10 * s, 9 * s)
        c.drawPath(path, solid(dark, a))
        path.reset()
        ovalPath(x - 1 * s, y - 28 * s, 12 * s, 11 * s); ovalPath(x - 9 * s, y - 21 * s, 7 * s, 6 * s)
        c.drawPath(path, solid(leaf, a))
        oval(c, x - 4 * s, y - 33 * s, 5 * s, 3.4 * s, solid(light, a))
    }

    /** Foreground grass bank, flowers and fence posts sliding past faster than the roofs (depth). */
    private fun paintForeground(c: Canvas, w: Double, h: Double, cam: Double, night: Double) {
        val base = h + 2
        val dark = rgb(mix3(d(38, 92, 40), d(10, 22, 30), night))
        val mid = rgb(mix3(d(58, 128, 52), d(16, 32, 40), night))
        val tip = rgb(mix3(d(120, 190, 84), d(30, 52, 60), night))
        val off = cam * 1.35
        // the bank: a soft rolling strip along the bottom edge
        path.reset()
        path.moveTo(-20f, (base + 20).toFloat())
        var x = -20.0
        while (x <= w + 24) {
            val y = base - 16 - (sin((x + off) * 0.013) * 0.5 + 0.5) * 12 - sin((x + off) * 0.031 + 1.7) * 4
            path.lineTo(x.toFloat(), y.toFloat())
            x += 12
        }
        path.lineTo((w + 24).toFloat(), (base + 20).toFloat())
        path.close()
        c.drawPath(path, fill.also { it.shader = null; it.color = dark })
        // blades along the bank, two tones
        stroke.strokeCap = Paint.Cap.ROUND
        val step = 7.0
        val first = floor(off / step)
        var k = 0
        while (k < (w / step).toInt() + 6) {
            val wx = (first + k) * step
            val sx = wx - off
            val n = hash(wx * 0.37)
            val bh = 10 + n * 22
            val by = base - 16 - (sin(wx * 0.013) * 0.5 + 0.5) * 12 - sin(wx * 0.031 + 1.7) * 4 + 6
            val lean = (hash(wx * 0.11) - 0.5) * 10
            stroke.color = if (n > 0.6) tip else mid
            stroke.strokeWidth = (2.2 + n * 1.6).toFloat()
            path2.reset()
            path2.moveTo(sx.toFloat(), by.toFloat())
            path2.quadTo((sx + lean * 0.3).toFloat(), (by - bh * 0.6).toFloat(), (sx + lean).toFloat(), (by - bh).toFloat())
            c.drawPath(path2, stroke)
            k++
        }
        val span = w + 240
        for (i in 0 until 5) {
            val fx = ((i * 330 + 90 - off) % span + span) % span - 120
            val sc = 0.85 + hash(i + 40.0) * 0.45
            if (i % 2 == 0) {
                // a sunflower nodding in the wind
                val sy = base - 58 * sc
                stroke.color = dark; stroke.strokeWidth = (3.2 * sc).toFloat()
                path2.reset(); path2.moveTo(fx.toFloat(), base.toFloat()); path2.quadTo((fx - 4).toFloat(), (base - 30 * sc).toFloat(), fx.toFloat(), sy.toFloat())
                c.drawPath(path2, stroke)
                oval(c, fx - 9 * sc, base - 30 * sc, 7 * sc, 3.2 * sc, solid(mid))
                val petal = if (night > 0.5) 0xFF8A7020.toInt() else 0xFFFFC21A.toInt()
                for (pt in 0 until 12) {
                    val ang = pt * PI / 6
                    oval(c, fx + cos(ang) * 8.5 * sc, sy + sin(ang) * 8.5 * sc, 4.4 * sc, 4.4 * sc, solid(petal))
                }
                circle(c, fx, sy, 6.4 * sc, solid(0xFF5A3A1A.toInt()))
                circle(c, fx - 1.8 * sc, sy - 1.8 * sc, 2.0 * sc, solid(0xFF8A5A2A.toInt()))
            } else {
                // weathered fence post + rail
                val wood = if (night > 0.5) 0xFF2A2420.toInt() else 0xFF7A5638.toInt()
                roundRect(c, fx - 4, base - 44 * sc, 8.0 * sc, 48.0 * sc, 2.0, solid(wood))
                c.drawRect((fx - 34).toFloat(), (base - 31 * sc).toFloat(), (fx + 34).toFloat(), (base - 25 * sc).toFloat(), solid(wood))
                c.drawRect((fx - 3).toFloat(), (base - 44 * sc).toFloat(), (fx - 1).toFloat(), (base - 4 * sc).toFloat(), solid(Color.WHITE, 0.12))
            }
        }
    }

    /** Soft god rays from the sun (day only). */
    private fun paintRays(c: Canvas, sx: Double, sy: Double, len: Double, t: Double, a: Double) {
        if (a < 0.02) return
        c.save()
        c.translate(sx.toFloat(), sy.toFloat())
        c.rotate(Math.toDegrees(if (reducedMotion) 0.0 else t * 0.03).toFloat())
        for (i in 0 until 7) {
            val ang = i * PI * 2 / 7
            path.reset()
            path.moveTo(0f, 0f)
            path.lineTo((cos(ang - 0.09) * len).toFloat(), (sin(ang - 0.09) * len).toFloat())
            path.lineTo((cos(ang + 0.09) * len).toFloat(), (sin(ang + 0.09) * len).toFloat())
            path.close()
            glow.shader = RadialGradient(0f, 0f, len.toFloat(), intArrayOf(rgba(255, 240, 190, 0.16 * a), rgba(255, 240, 190, 0.0)), null, Shader.TileMode.CLAMP)
            c.drawPath(path, glow)
        }
        glow.shader = null
        c.restore()
    }

    /** Four-point sparkle. */
    private fun sparkle(c: Canvas, x: Double, y: Double, r: Double, rot: Double, col: Int, a: Double) {
        c.save()
        c.translate(x.toFloat(), y.toFloat())
        c.rotate(Math.toDegrees(rot).toFloat())
        path2.reset()
        path2.moveTo(0f, (-r).toFloat())
        path2.quadTo((r * 0.16).toFloat(), (-r * 0.16).toFloat(), r.toFloat(), 0f)
        path2.quadTo((r * 0.16).toFloat(), (r * 0.16).toFloat(), 0f, r.toFloat())
        path2.quadTo((-r * 0.16).toFloat(), (r * 0.16).toFloat(), (-r).toFloat(), 0f)
        path2.quadTo((-r * 0.16).toFloat(), (-r * 0.16).toFloat(), 0f, (-r).toFloat())
        path2.close()
        glow.shader = null
        glow.color = color(col, a)
        c.drawPath(path2, glow)
        c.restore()
    }

    private fun softGlow(c: Canvas, x: Double, y: Double, r: Double, col: Int, a: Double) {
        if (a <= 0.01 || r <= 0) return
        glow.shader = RadialGradient(x.toFloat(), y.toFloat(), r.toFloat(), intArrayOf(color(col, a), color(col, a * 0.35), color(col, 0.0)), floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP)
        circle(c, x, y, r, glow)
        glow.shader = null
    }

    private fun drawGroundPanel(c: Canvas, x: Double, y: Double, s: Double) {
        c.save()
        c.translate(x.toFloat(), y.toFloat())
        c.scale(s.toFloat(), s.toFloat())
        oval(c, 0.0, 4.0, 26.0, 4.0, solid(Color.rgb(16, 24, 12), 0.28))
        c.drawRect(-2f, -10f, 2f, 6f, solid(0xFF6A5038.toInt()))
        c.rotate(Math.toDegrees(-0.28).toFloat())
        roundRect(c, -30.0, -18.0, 60.0, 24.0, 3.0, solid(0xFFFFE34A.toInt()))
        roundRect(c, -26.0, -15.0, 52.0, 18.0, 2.0, solid(0xFF1248A8.toInt()))
        stroke.color = rgba(8, 20, 48, 0.45)
        stroke.strokeWidth = 1f
        stroke.strokeCap = Paint.Cap.BUTT
        for (i in 1 until 4) c.drawLine((-26 + i * 13).toFloat(), -15f, (-26 + i * 13).toFloat(), 3f, stroke)
        stroke.color = rgba(255, 255, 255, 0.35)
        c.drawLine(-26f, -6f, 26f, -6f, stroke)
        c.restore()
    }

    private fun cottageFallback(c: Canvas, x: Double, y: Double, s: Double, lit: Boolean) {
        c.save()
        c.translate(x.toFloat(), y.toFloat())
        c.scale(s.toFloat(), s.toFloat())
        oval(c, 0.0, 8.0, 36.0, 6.0, solid(Color.rgb(28, 20, 14), 0.28))
        c.drawRect(-28f, -28f, 28f, 8f, solid(0xFFCBB59A.toInt()))
        path.reset(); path.moveTo(-34f, -26f); path.lineTo(0f, -52f); path.lineTo(34f, -26f); path.close()
        c.drawPath(path, solid(0xFF1557C4.toInt()))
        c.drawRect(-16f, -12f, -6f, -2f, solid(if (lit) 0xFFFFD27A.toInt() else 0xFF6A5A48.toInt()))
        c.drawRect(-4f, -4f, 5f, 8f, solid(0xFF7A5340.toInt()))
        c.restore()
    }

    private fun pole(c: Canvas, x: Double, y: Double, hgt: Double) {
        c.drawRect((x - 2).toFloat(), (y - hgt).toFloat(), (x + 2).toFloat(), y.toFloat(), solid(0xFF4A372C.toInt()))
        c.drawRect((x - 10).toFloat(), (y - hgt).toFloat(), (x + 10).toFloat(), (y - hgt + 3).toFloat(), solid(0xFF3A2A22.toInt()))
    }

    private val artPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val artRect = RectF()

    /** Blit a pre-scaled art bitmap into world units. */
    private fun art(c: Canvas, img: RunArt.Img, x: Double, y: Double, w: Double = img.w.toDouble(), h: Double = img.h.toDouble(), a: Double = 1.0, filter: android.graphics.ColorFilter? = null) {
        artRect.set(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat())
        artPaint.alpha = a255(a)
        artPaint.colorFilter = filter
        c.drawBitmap(img.bmp, null, artRect, artPaint)
    }

    private val cloudNight = android.graphics.ColorMatrixColorFilter(android.graphics.ColorMatrix(floatArrayOf(
        0.42f, 0f, 0f, 0f, 18f, 0f, 0.46f, 0f, 0f, 22f, 0f, 0f, 0.6f, 0f, 46f, 0f, 0f, 0f, 1f, 0f,
    )))

    private fun cloud(c: Canvas, i: Int, x: Double, y: Double, scale: Double, a: Double, night: Double) {
        val img = spr.art.clouds[i] ?: return
        art(c, img, x, y, img.w * scale, img.h * scale, a = max(0.0, a), filter = if (night > 0.4) cloudNight else null)
    }

    /** A horizontally tiling parallax layer with its top at [top]. */
    private fun tileLayer(c: Canvas, img: RunArt.Img?, w: Double, top: Double, scroll: Double, filter: android.graphics.ColorFilter?, a: Double = 1.0) {
        if (img == null) return
        val lw = img.w.toDouble()
        var x = -(((scroll % lw) + lw) % lw)
        while (x < w) {
            art(c, img, x, top, lw + 0.5, img.h.toDouble(), a, filter)
            x += lw
        }
    }

    private fun drawWire(c: Canvas, x: Double, y: Double, w: Double, t: Double, live: Boolean) {
        stroke.color = color(if (live) 0xFF9AD8FF.toInt() else 0xFF5A6A78.toInt())
        stroke.strokeWidth = if (live) 4f else 3f
        stroke.strokeCap = Paint.Cap.ROUND
        path.reset()
        path.moveTo(x.toFloat(), y.toFloat())
        path.quadTo((x + w * 0.5).toFloat(), (y + 16).toFloat(), (x + w).toFloat(), y.toFloat())
        c.drawPath(path, stroke)
        if (live) {
            stroke.color = rgba(255, 227, 74, 0.45 + 0.25 * sin(t * 14))
            stroke.strokeWidth = 2f
            c.drawPath(path, stroke)
            for (i in 0 until 4) {
                val u = (t * 2.4 + i * 0.22) % 1
                circle(c, x + w * u, y + sin(u * PI) * 16, 2.2, solid(0xFFFFE34A.toInt(), 0.8))
            }
        }
        for (px in doubleArrayOf(x, x + w)) {
            roundRect(c, px - 4.5, y - 22, 9.0, 34.0, 3.0, solid(0xFF2A1E16.toInt()))
            roundRect(c, px - 3, y - 20.5, 6.0, 31.0, 2.0, solid(0xFFA8743F.toInt()))
            c.drawRect((px - 1.8).toFloat(), (y - 20).toFloat(), (px - 0.6).toFloat(), (y + 9).toFloat(), solid(0xFFE0B07A.toInt(), 0.7))
            roundRect(c, px - 3.5, y - 4, 7.0, 6.0, 2.0, solid(0xFFDCE6EE.toInt()))
        }
    }

    private fun drawPlat(c: Canvas, x: Double, y: Double, w: Double, thick: Double, t: Double, glow: Double, skin: RunSkin, kind: PlatKind, live: Boolean, dim: Double = 0.0) {
        if (kind == PlatKind.WIRE) {
            drawWire(c, x, y, w, t, live)
            return
        }
        val kit = spr.art
        val mod = kit.roofMid
        val lc = kit.roofLeft
        val rc = kit.roofRight
        if (mod != null && lc != null && rc != null) {
            // painted rooftop kit: caps inside the walkable span, modules stretched to fit evenly
            val top = y - RunArt.ROOF_TOP
            val f = moodRoof
            val span = max(8.0, w - 36)
            val n = max(1, Math.round(span / 64.0).toInt())
            val mw = span / n
            for (i in 0 until n) art(c, mod, x + 18 + i * mw, top, mw + 0.6, mod.h.toDouble(), filter = f)
            art(c, lc, x - 6, top, filter = f)
            art(c, rc, x + w - 18, top, filter = f)
            if (glow > 0) roundRect(c, x - 2, y - 8, w + 4, 14.0, 6.0, solid(skin.hi, 0.1 * glow))
            return
        }
        val flag = skin == RunSkin.FLAG
        val lip = if (flag) 0xFFF0C14D.toInt() else skin.lip
        val cell = if (flag) 0xFF6AAFD8.toInt() else skin.cell
        val deep = if (flag) 0xFF3E86C4.toInt() else skin.deep
        val hh = max(48.0, thick * 2.7)
        // a real rooftop: solar modules on an aluminium deck, a clay-tile eave, a shadow under
        val deckBot = y + hh * 0.56
        val frame = mixInt(0xFFCBD3DA.toInt(), lip, 0.35)
        val tile = mixInt(0xFFB65A34.toInt(), skin.band, 0.3)
        val tileDark = mixInt(tile, 0xFF2A1810.toInt(), 0.45)
        val tileHi = mixInt(tile, 0xFFFFE2C0.toInt(), 0.35)
        // soft shadow under the roof
        fill.color = Color.BLACK
        fill.shader = LinearGradient(0f, (y + hh - 6).toFloat(), 0f, (y + hh + 34).toFloat(), rgba(16, 30, 16, 0.3), rgba(16, 30, 16, 0.0), Shader.TileMode.CLAMP)
        roundRect(c, x + 2, y + hh - 6, w - 4, 40.0, 18.0, fill)
        fill.shader = null
        // ink silhouette
        roundRect(c, x - 6, y - 6, w + 12, hh + 11, 12.0, solid(0xFF2A1E16.toInt()))
        // clay-tile eave: one row of barrel tiles with rounded ends
        roundRect(c, x - 3, deckBot - 2, w + 6, y + hh - deckBot + 2, 9.0, solid(tileDark))
        c.save()
        rect.set((x - 3).toFloat(), (deckBot - 2).toFloat(), (x + w + 3).toFloat(), (y + hh).toFloat())
        c.clipRect(rect)
        val tw = 17.0
        val tBot = y + hh - 2.5
        var tx = x - 3
        var ti = 0
        while (tx < x + w + 3) {
            roundRect(c, tx + 1, deckBot - 10, tw - 2, tBot - deckBot + 10, (tw - 2) / 2, solid(if (ti % 2 == 0) tile else mixInt(tile, tileDark, 0.18)))
            roundRect(c, tx + 3.5, deckBot, 3.0, (tBot - deckBot) * 0.62, 1.5, solid(tileHi, 0.8))
            tx += tw; ti++
        }
        c.restore()
        // gutter
        c.drawRect((x - 4).toFloat(), (deckBot - 3).toFloat(), (x + w + 4).toFloat(), (deckBot + 1.5).toFloat(), solid(mixInt(frame, 0xFF1C140E.toInt(), 0.35)))
        // deck + modules
        roundRect(c, x - 1, y - 3, w + 2, deckBot - y + 1, 7.0, solid(frame))
        val n = max(1, Math.round(w / 62.0).toInt())
        val gap = 4.0
        val mw = (w - 8 - (n - 1) * gap) / n
        val mTop = y + 0.5
        val mBot = deckBot - 3.5
        fill.color = Color.BLACK
        fill.shader = LinearGradient(0f, mTop.toFloat(), 0f, mBot.toFloat(), color(mixInt(cell, Color.WHITE, 0.12)), color(deep), Shader.TileMode.CLAMP)
        fill.color = Color.argb(a255(1.0), 255, 255, 255)
        stroke.color = color(skin.grid, 0.85)
        stroke.strokeWidth = 1f
        stroke.strokeCap = Paint.Cap.BUTT
        for (m in 0 until n) {
            val mx = x + 4 + m * (mw + gap)
            rect.set(mx.toFloat(), mTop.toFloat(), (mx + mw).toFloat(), mBot.toFloat())
            c.drawRoundRect(rect, 2.5f, 2.5f, fill)
            val cols = max(2, Math.round(mw / 13).toInt())
            for (k in 1 until cols) {
                val lx = (mx + mw * k / cols).toFloat()
                c.drawLine(lx, mTop.toFloat(), lx, mBot.toFloat(), stroke)
            }
            val my = ((mTop + mBot) / 2).toFloat()
            c.drawLine(mx.toFloat(), my, (mx + mw).toFloat(), my, stroke)
        }
        fill.shader = null
        // glint sweep across the glass
        if (!reducedMotion) {
            c.save()
            rect.set(x.toFloat(), mTop.toFloat(), (x + w).toFloat(), mBot.toFloat())
            c.clipRect(rect)
            val gx = x + ((t * 140 + x * 0.37) % (w + 200)) - 100
            path.reset()
            path.moveTo(gx.toFloat(), mTop.toFloat()); path.lineTo((gx + 30).toFloat(), mTop.toFloat())
            path.lineTo((gx + 14).toFloat(), mBot.toFloat()); path.lineTo((gx - 16).toFloat(), mBot.toFloat()); path.close()
            c.drawPath(path, solid(Color.WHITE, 0.32))
            path.reset()
            path.moveTo((gx + 38).toFloat(), mTop.toFloat()); path.lineTo((gx + 46).toFloat(), mTop.toFloat())
            path.lineTo((gx + 30).toFloat(), mBot.toFloat()); path.lineTo((gx + 22).toFloat(), mBot.toFloat()); path.close()
            c.drawPath(path, solid(Color.WHITE, 0.2))
            c.restore()
        }
        // ridge highlight where the feet land
        c.drawRect((x + 3).toFloat(), (y - 2.5).toFloat(), (x + w - 3).toFloat(), (y - 0.5).toFloat(), solid(Color.WHITE, 0.55))
        // dusk/night: the roof falls into the scene's light, the glass keeps a cool sheen
        if (dim > 0.01) {
            roundRect(c, x - 6, y - 6, w + 12, hh + 11, 12.0, solid(Color.rgb(14, 20, 48), dim))
            c.drawRect((x + 3).toFloat(), (y - 2.5).toFloat(), (x + w - 3).toFloat(), (y - 0.5).toFloat(), solid(0xFFBFD8FF.toInt(), 0.5 * dim))
        }
        if (glow > 0) roundRect(c, x - 2, y - 8, w + 4, 14.0, 6.0, solid(skin.hi, 0.12 * glow))
    }

    private fun mixInt(a: Int, b: Int, t: Double): Int {
        val u = t.coerceIn(0.0, 1.0)
        fun ch(sh: Int) = (((a shr sh) and 0xFF) * (1 - u) + ((b shr sh) and 0xFF) * u).toInt()
        return Color.rgb(ch(16), ch(8), ch(0))
    }

    private fun drawPortal(c: Canvas, x: Double, y: Double, t: Double) {
        val bob = sin(t * 3.2 + x * 0.02) * 3
        c.save()
        c.translate(x.toFloat(), (y + bob).toFloat())
        val pulse = 0.72 + 0.28 * sin(t * 5)
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        // circular halo clipped to a tall ellipse, as the web fills ellipse(34, 72) with it
        fill.shader = RadialGradient(0f, 0f, 78f,
            intArrayOf(rgba(255, 227, 74, 0.62 * pulse), rgba(255, 227, 74, 0.62 * pulse), rgba(21, 87, 196, 0.4 * pulse), rgba(21, 87, 196, 0.0)),
            floatArrayOf(0f, 6f / 78f, 0.42f, 1f), Shader.TileMode.CLAMP)
        oval(c, 0.0, 0.0, 34.0, 72.0, fill)
        fill.shader = null
        rect.set(-22f, -58f, 22f, 58f)
        stroke.color = color(0xFFFFE34A.toInt()); stroke.strokeWidth = 5f
        c.drawOval(rect, stroke)
        stroke.color = color(0xFF1557C4.toInt()); stroke.strokeWidth = 3f
        c.drawOval(rect, stroke)
        circle(c, 0.0, 0.0, 10.0, solid(0xFFFFF6C4.toInt()))
        circle(c, 0.0, 0.0, 5.5, solid(0xFFF0A24A.toInt()))
        text.typeface = textFace ?: Typeface.DEFAULT_BOLD
        text.textSize = 13f
        text.color = color(0xFF143A8C.toInt())
        c.drawText("FLY", 0f, -70f - (text.ascent() + text.descent()) / 2, text)
        c.restore()
    }

    private fun drawPickup(c: Canvas, x: Double, y: Double, gold: Boolean, shield: Boolean, t: Double, portal: Boolean) {
        if (portal) {
            drawPortal(c, x, y, t)
            return
        }
        val bob = sin(t * 3.4 + x * 0.02) * 5
        c.save()
        c.translate(x.toFloat(), (y + bob).toFloat())
        if (shield) {
            fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
            fill.shader = RadialGradient(0f, 0f, 20f, intArrayOf(rgba(160, 220, 255, 0.9), rgba(160, 220, 255, 0.9), rgba(160, 220, 255, 0.0)),
                floatArrayOf(0f, 0.1f, 1f), Shader.TileMode.CLAMP)
            circle(c, 0.0, 0.0, 20.0, fill)
            fill.shader = null
            path.reset()
            path.moveTo(0f, -13f); path.lineTo(11f, -3f); path.lineTo(7f, 12f); path.lineTo(-7f, 12f); path.lineTo(-11f, -3f); path.close()
            c.drawPath(path, solid(0xFF8FD0EF.toInt()))
            circle(c, -3.0, -3.0, 3.0, solid(Color.WHITE, 0.55))
            c.restore()
            return
        }
        val r = if (gold) 17.5 else 15.0
        c.restore()
        val frames = spr.art.coins
        if (frames[0] != null) {
            val yy = y + bob
            softGlow(c, x, yy, r * 2.3, if (gold) 0xFFFFD24A.toInt() else 0xFFFFB347.toInt(), if (gold) 0.6 else 0.4)
            val fi = if (reducedMotion) 0 else COIN_SHIMMER[((floor(t * 8 + x * 0.05).toInt() % 8) + 8) % 8] // turn and back, never edge-on
            val img = frames[fi] ?: frames[0]!!
            val size = 48.0 * r / 15.0 // coin face radius 16 of a 48 box
            art(c, img, x - size / 2, yy - size / 2, size, size)
            val gl = (t * 0.7 + hash(x * 0.01)) % 1.0
            if (gl < 0.12 && !reducedMotion) sparkle(c, x + r * 0.5, yy - r * 0.6, 7 * sin(gl / 0.12 * PI), gl * 6, 0xFFFFFFFF.toInt(), 0.9)
            return
        }
        val yy = y + bob
        softGlow(c, x, yy, r * 2.4, if (gold) 0xFFFFD24A.toInt() else 0xFFFFB347.toInt(), 0.5)
        c.save()
        c.translate(x.toFloat(), yy.toFloat())
        val spin = if (reducedMotion) 1.0 else 0.72 + 0.28 * abs(cos(t * 2.6 + x * 0.05))
        // rays
        c.save()
        c.rotate(Math.toDegrees(t * 1.2 + x).toFloat())
        stroke.color = color(if (gold) 0xFFFFE27A.toInt() else 0xFFFFC04A.toInt(), 0.85)
        stroke.strokeWidth = 2.4f; stroke.strokeCap = Paint.Cap.ROUND
        for (k in 0 until 8) {
            val a = k * PI / 4
            c.drawLine((cos(a) * (r + 2)).toFloat(), (sin(a) * (r + 2)).toFloat(), (cos(a) * (r + 6)).toFloat(), (sin(a) * (r + 6)).toFloat(), stroke)
        }
        c.restore()
        c.scale(spin.toFloat(), 1f)
        circle(c, 0.0, 2.5, r + 1.5, solid(0xFF8A4A10.toInt()))
        circle(c, 0.0, 0.0, r + 1.5, solid(0xFF1C140E.toInt()))
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        fill.shader = RadialGradient((-r * 0.25).toFloat(), (-r * 0.3).toFloat(), (r * 1.15).toFloat(),
            intArrayOf(color(0xFFFFF6C4.toInt()), color(if (gold) 0xFFFFC44A.toInt() else 0xFFF0A24A.toInt()), color(0xFFD47A28.toInt())),
            floatArrayOf(0.05f, 0.55f, 1f), Shader.TileMode.CLAMP)
        circle(c, 0.0, 0.0, r * 0.84, fill)
        fill.shader = null
        stroke.color = color(0xFFFFF2B0.toInt(), 0.7); stroke.strokeWidth = 1.4f
        circle(c, 0.0, 0.0, r * 0.52, stroke)
        oval(c, -r * 0.3, -r * 0.36, r * 0.22, r * 0.12, solid(Color.WHITE, 0.8))
        c.restore()
        val gl = (t * 0.7 + hash(x * 0.01)) % 1.0
        if (gl < 0.12 && !reducedMotion) sparkle(c, x + r * 0.5, yy - r * 0.6, 7 * sin(gl / 0.12 * PI), gl * 6, 0xFFFFFFFF.toInt(), 0.9)
    }

    private fun drawBush(c: Canvas, x: Double, y: Double, t: Double) {
        c.save()
        c.translate(x.toFloat(), y.toFloat())
        c.rotate(Math.toDegrees(sin(t * 2.1) * 0.04).toFloat())
        oval(c, 0.0, 2.0, 28.0, 6.0, solid(Color.rgb(20, 16, 10), 0.25))
        path.reset()
        ovalPath(-14.0, -16.0, 16.0, 14.0); ovalPath(14.0, -16.0, 16.0, 14.0); ovalPath(0.0, -28.0, 18.0, 16.0)
        c.drawPath(path, solid(0xFF2F5A32.toInt()))
        path.reset()
        ovalPath(-6.0, -22.0, 10.0, 8.0); ovalPath(8.0, -20.0, 9.0, 7.0)
        c.drawPath(path, solid(0xFF3F7340.toInt()))
        if (floor(t * 2).toInt() % 8 != 0) {
            oval(c, -8.0, -30.0, 3.2, 3.6, solid(0xFFF2D27A.toInt()))
            oval(c, 8.0, -30.0, 3.2, 3.6, solid(0xFFF2D27A.toInt()))
            circle(c, -8.0, -30.0, 1.4, solid(0xFF1A1410.toInt()))
            circle(c, 8.0, -30.0, 1.4, solid(0xFF1A1410.toInt()))
        }
        c.restore()
    }

    private fun paintStars(c: Canvas, w: Double, h: Double, t: Double, a: Double) {
        if (a < 0.04) return
        for (i in 0 until 42) {
            val px = hash(i + 3.0) * w
            val py = hash(i + 17.0) * h * 0.55
            val tw = 0.45 + 0.55 * abs(sin(t * (0.7 + hash(i.toDouble()) * 1.4) + i))
            circle(c, px, py, 0.7 + hash(i + 4.0) * 1.6, solid(Color.rgb(255, 244, 210), a * a * tw))
        }
    }

    private fun paintAurora(c: Canvas, w: Double, h: Double, t: Double, a: Double) {
        if (a < 0.05) return
        for (k in 0 until 2) {
            val base = h * (0.13 + k * 0.09)
            val (r, g, b) = if (k == 0) Triple(60, 150, 255) else Triple(120, 230, 170)
            // a hanging curtain: bright crest fading down, blended as light (web colours)
            path.reset()
            var x = -20.0
            while (x <= w + 20) {
                val y = base + sin(x * 0.008 + t * 0.35 + k) * 22
                if (x == -20.0) path.moveTo(x.toFloat(), y.toFloat()) else path.lineTo(x.toFloat(), y.toFloat())
                x += 16
            }
            x -= 16
            while (x >= -20.0) {
                val y = base + sin(x * 0.008 + t * 0.35 + k) * 22 + h * 0.075 + sin(x * 0.021 + t * 0.6 + k * 2) * h * 0.03
                path.lineTo(x.toFloat(), y.toFloat())
                x -= 16
            }
            path.close()
            glow.style = Paint.Style.FILL
            glow.color = Color.BLACK
            glow.shader = LinearGradient(0f, (base - 22).toFloat(), 0f, (base + h * 0.12).toFloat(),
                intArrayOf(rgba(r, g, b, 0.3 * a), rgba(r, g, b, 0.08 * a), rgba(r, g, b, 0.0)), floatArrayOf(0f, 0.4f, 1f), Shader.TileMode.CLAMP)
            c.drawPath(path, glow)
            glow.shader = null
            // soft vertical folds: dense overlapping streaks, brighter near the crest
            glow.style = Paint.Style.STROKE
            glow.strokeCap = Paint.Cap.BUTT
            val step = max(3.0, w / 300)
            glow.strokeWidth = (step * 1.6).toFloat()
            var rx = 0.0
            while (rx <= w) {
                val y0 = base + sin(rx * 0.008 + t * 0.35 + k) * 22
                val wob = sin(rx * 0.019 + t * 0.9 + k * 3) * 0.5 + 0.5
                val wob2 = sin(rx * 0.0071 - t * 0.4 + k) * 0.5 + 0.5
                val len = h * (0.03 + 0.08 * wob * wob2)
                glow.color = rgba(r, g, b, (0.03 + 0.07 * wob) * a)
                c.drawLine(rx.toFloat(), y0.toFloat(), rx.toFloat(), (y0 + len).toFloat(), glow)
                glow.color = rgba(r, g, b, (0.03 + 0.09 * wob * wob2) * a)
                c.drawLine(rx.toFloat(), y0.toFloat(), rx.toFloat(), (y0 + len * 0.45).toFloat(), glow)
                rx += step
            }
            // bright crest
            path2.reset()
            var cx = -20.0
            while (cx <= w + 20) {
                val y = base + sin(cx * 0.008 + t * 0.35 + k) * 22
                if (cx == -20.0) path2.moveTo(cx.toFloat(), y.toFloat()) else path2.lineTo(cx.toFloat(), y.toFloat())
                cx += 16
            }
            glow.style = Paint.Style.STROKE; glow.strokeWidth = 3f
            glow.color = rgba(r, g, b, 0.45 * a)
            c.drawPath(path2, glow)
            glow.style = Paint.Style.FILL
        }
        glow.style = Paint.Style.FILL
    }

    private fun paintSky(c: Canvas, w: Double, h: Double, mood: Double) {
        val dusk = min(1.0, mood)
        val night = max(0.0, mood - 1)
        val top = mix3(d(126, 206, 255), mix3(d(55, 62, 130), d(8, 14, 38), night), dusk)
        val mid = mix3(d(186, 230, 255), mix3(d(220, 110, 90), d(28, 42, 92), night), dusk)
        val bot = mix3(d(214, 242, 196), mix3(d(120, 70, 80), d(18, 28, 52), night), dusk)
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        fill.shader = LinearGradient(0f, 0f, 0f, h.toFloat(), intArrayOf(rgb(top), rgb(mid), rgb(bot)), floatArrayOf(0f, 0.42f, 1f), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), fill)
        fill.shader = null
    }

    private fun paintGardenSky(c: Canvas, w: Double, h: Double, t: Double) {
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        fill.shader = LinearGradient(0f, 0f, 0f, h.toFloat(),
            intArrayOf(0xFF1A5FB8.toInt(), 0xFF4AA7E8.toInt(), 0xFF9FD6FF.toInt(), 0xFFFFE08A.toInt(), 0xFFF7C45A.toInt()),
            floatArrayOf(0f, 0.32f, 0.58f, 0.82f, 1f), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), fill)
        fill.shader = null
        paintSun(c, w * 0.78, h * 0.14, min(h * 0.14, 86.0), t)
        for (i in 0 until 16) {
            val px = ((hash(i + 4.0) * w + t * (22 + hash(i.toDouble()) * 30)) % (w + 50)) - 20
            val py = hash(i + 11.0) * h * 0.7
            circle(c, px, py, 5 + hash(i.toDouble()) * 11, solid(Color.rgb(255, 227, 74), 0.28))
        }
    }

    private fun paintRain(c: Canvas, w: Double, h: Double, t: Double) {
        stroke.color = rgba(190, 214, 255, 0.28)
        stroke.strokeWidth = 1.2f
        stroke.strokeCap = Paint.Cap.ROUND
        for (i in 0 until 46) {
            val px = ((hash(i.toDouble()) * w + t * 420) % (w + 40)) - 20
            val py = ((hash(i + 8.0) * h + t * 760) % (h + 30)) - 10
            c.drawLine(px.toFloat(), py.toFloat(), (px + 7).toFloat(), (py + 18).toFloat(), stroke)
        }
    }

    private fun paintBolt(c: Canvas, w: Double, h: Double, seed: Int, a: Double) {
        if (a < 0.04) return
        path.reset()
        var x = w * (0.2 + hash(seed.toDouble()) * 0.6)
        var y = 0.0
        path.moveTo(x.toFloat(), 0f)
        while (y < h * 0.72) {
            x += (hash(seed + y) - 0.5) * 38
            y += 18 + hash(seed + y + 3) * 22
            path.lineTo(x.toFloat(), y.toFloat())
        }
        stroke.strokeJoin = Paint.Join.ROUND
        stroke.color = color(0xFFE8F2FF.toInt(), a); stroke.strokeWidth = 2.4f
        c.drawPath(path, stroke)
        stroke.color = rgba(255, 227, 74, 0.55 * a); stroke.strokeWidth = 1f
        c.drawPath(path, stroke)
    }

    private fun paintMotes(c: Canvas, w: Double, h: Double, t: Double) {
        if (reducedMotion) return
        for (i in 0 until 12) {
            val px = ((hash(i + 2.0) * w + t * (8 + hash(i.toDouble()) * 18)) % (w + 40)) - 20
            val py = hash(i + 9.0) * h * 0.7 + sin(t * 0.6 + i) * 10
            circle(c, px, py, 1.1 + hash(i + 3.0) * 1.4, solid(Color.rgb(255, 236, 200), 0.35))
        }
    }

    private fun paintVignette(c: Canvas, w: Double, h: Double) {
        val r = h * 0.85
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        fill.shader = RadialGradient((w * 0.5).toFloat(), (h * 0.48).toFloat(), r.toFloat(),
            intArrayOf(Color.argb(0, 20, 12, 8), Color.argb(0, 20, 12, 8), Color.argb(71, 20, 12, 8)),
            floatArrayOf(0f, (0.2 / 0.85).toFloat(), 1f), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), fill)
        fill.shader = null
    }

    private fun heroGlow(c: Canvas, x: Double, y: Double, size: Double, charged: Boolean) {
        val rr = size * if (charged) 0.7 else 0.48
        val cy = y - size * 0.42
        val inner = (6 / rr).toFloat()
        fill.shader = if (charged) {
            RadialGradient(x.toFloat(), (y - size * 0.4).toFloat(), rr.toFloat(),
                intArrayOf(rgba(120, 190, 255, 0.45), rgba(120, 190, 255, 0.45), rgba(255, 210, 60, 0.22), rgba(255, 170, 80, 0.0)),
                floatArrayOf(0f, inner, 0.45f, 1f), Shader.TileMode.CLAMP)
        } else {
            RadialGradient(x.toFloat(), (y - size * 0.4).toFloat(), rr.toFloat(),
                intArrayOf(rgba(255, 200, 120, 0.22), rgba(255, 200, 120, 0.22), rgba(255, 170, 80, 0.0)),
                floatArrayOf(0f, inner, 1f), Shader.TileMode.CLAMP)
        }
        circle(c, x, cy, rr, fill)
        fill.shader = null
    }

    private fun drawHero(c: Canvas, feetX: Double, feetY: Double, size: Double, phase: Double, grounded: Boolean, squash: Double, stretch: Double, vy: Double, rot: Double, a: Double, shadow: Boolean, hurt: Double = 0.0, clock: Double = 0.0) {
        // web drawHero: a bought robot runs on its own 4-frame strip (frame 4 in the air)
        val strip = if (robot != "stock") spr.robotRun(robot) else emptyList()
        val frame = if (strip.size >= 2) {
            if (!grounded) strip[min(3, strip.size - 1)] else strip[((floor(phase).toInt() % strip.size) + strip.size) % strip.size]
        } else {
            spr.heroFrame(grounded, vy, phase, squash)
        }
        val wobble = if (hurt > 0 && !reducedMotion) sin(hurt * 40) * 0.18 * hurt else 0.0
        if (!blit(c, frame, feetX, feetY, size, squash, stretch, a = a, rot = rot + wobble, shadow = shadow, tint = 0xFF4830, tintA = hurt * 0.6, outline = 0.026)) {
            circle(c, feetX, feetY - size / 2, size / 3, solid(0xFF7AD1FF.toInt(), a))
        }
        // the head panel catches the sun now and then
        val gl = (clock * 0.55) % 1.0
        if (gl < 0.14 && !reducedMotion && a > 0.5) {
            val hs = 1 - squash * 0.34 + stretch * 0.28
            sparkle(c, feetX + size * 0.08, feetY - size * hs * 0.94, size * 0.09 * sin(gl / 0.14 * PI), gl * 8, 0xFFFFFFFF.toInt(), 0.95)
        }
    }

    /**
     * One frame. [wPx]/[hPx] is the surface; [clock] the wall clock in seconds (animation phase).
     * The world is drawn in logical units; the HUD lives in Android views on top (like the DOM HUD).
     */
    fun draw(c: Canvas, wPx: Int, hPx: Int, s: RunState, clock: Double, skin: RunSkin = this.skin) {
        val k = hPx / logicalH
        spr.art.prepare(k.toFloat(), skin)
        c.save()
        c.scale(k.toFloat(), k.toFloat())
        drawWorld(c, wPx / k, logicalH, s, clock, skin)
        c.restore()
    }

    /** Presentation memory for a new run (no sim state). */
    fun reset() {
        popBorn.clear()
        deadAt = -1.0
        clockAt = -1.0
        lastHearts = -1
        hurtAt = -9.0
        landAt = -9.0
        wasGrounded = true
    }

    private fun track(s: RunState, clock: Double) {
        if (s.phase == Phase.COUNTDOWN && s.countdown > 1.1) reset()
        if (lastHearts >= 0 && s.hearts < lastHearts) hurtAt = clock
        lastHearts = s.hearts
        if (s.grounded && !wasGrounded) landAt = clock
        wasGrounded = s.grounded
        if (s.phase == Phase.DEAD && deadAt < 0) deadAt = clock
        if (s.phase != Phase.DEAD) deadAt = -1.0
        if (s.clockOpen && clockAt < 0) clockAt = clock
        if (!s.clockOpen) clockAt = -1.0
        if (popBorn.size > 64) popBorn.keys.retainAll(s.pops.toSet())
        for (p in s.pops) popBorn.getOrPut(p) { clock }
    }

    private fun drawWorld(c: Canvas, w: Double, h: Double, s: RunState, clock: Double, skin: RunSkin) {
        alpha = 1f
        track(s, clock)
        val trauma = if (reducedMotion) 0.0 else s.shake * s.shake
        val ox = sin(clock * 41.2) * 14 * trauma
        val oy = cos(clock * 33.7) * 10 * trauma
        val mood = if (s.bonus) 0.0 else RunSim.moodAt(s.distance)
        val dusk = min(1.0, mood)
        val night = max(0.0, mood - 1)
        val storming = !s.bonus && s.distance > 16000
        if (s.bonus) paintGardenSky(c, w, h, clock) else paintSky(c, w, h, mood)
        if (storming) {
            c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(8, 16, 40), 0.2 + 0.08 * sin(s.stormT * 1.4)))
        }
        paintStars(c, w, h, clock, if (s.bonus) 0.0 else night * 0.9)
        paintAurora(c, w, h, clock, if (s.bonus) 0.0 else max(0.0, night - 0.15))

        c.save()
        val fallLook = if (s.phase == Phase.DEAD && s.death == DeathKind.FALL && !reducedMotion) 78.0 else 0.0
        c.translate(ox.toFloat(), (oy - fallLook).toFloat())
        if (s.hearts == 1 && s.phase == Phase.RUNNING && !reducedMotion) {
            c.translate((w * 0.5).toFloat(), (h * 0.55).toFloat())
            c.scale(1.045f, 1.045f)
            c.translate((-w * 0.5).toFloat(), (-h * 0.55).toFloat())
        }

        // drawn ~1.6x the web size for phone readability; the sim hitbox (PW/PH) is unchanged
        val heroH = min(h * 0.2, 136.0)
        val hillTop = h * 0.87
        val playTop = h * 0.52
        val playBot = hillTop - 14
        fun sy(wy: Double) = playTop + ((wy - 140) / 150) * (playBot - playTop)

        val spd = RunSim.speedAt(s)
        val look = spd * 0.18
        val camX = s.x - w * 0.27 + look
        val sunX = w * 0.84
        val sunY = h * (0.13 + dusk * 0.06)

        if (!s.bonus) {
            if (night > 0.35) {
                softGlow(c, w * 0.14, h * 0.12, 46.0, 0xFFE6ECFF.toInt(), min(0.5, night * 0.4))
                circle(c, w * 0.14, h * 0.12, 11.0, solid(Color.rgb(230, 236, 255), min(0.85, night * 0.7)))
            }
            val day = max(0.0, 1 - night * 1.1)
            paintRays(c, sunX, sunY, h * 0.75, clock, day * (1 - dusk * 0.5))
            val kit = spr.art
            if (kit.ready) {
                val sunImg = kit.sun
                if (sunImg != null && day > 0.02) {
                    val sr = min(h * 0.075, 58.0) / 54.0 * 110.0 // art disc radius 54 of a 220 box
                    art(c, sunImg, sunX - sr, sunY - sr, sr * 2, sr * 2, a = day)
                }
                cloud(c, 0, ((-camX * 0.08) % (w + 300)) - 60, h * 0.08, 1.15, 0.95 - night * 0.45, night)
                cloud(c, 1, ((-camX * 0.12 + 420) % (w + 300)) - 40, h * 0.22, 0.9, 0.85 - night * 0.4, night)
                cloud(c, 2, ((-camX * 0.07 + 880) % (w + 280)) - 40, h * 0.05, 0.85, 0.9 - night * 0.4, night)
                val farF = kit.moodFilter(dusk, night, storming, 1.0)
                val midF = kit.moodFilter(dusk, night, storming, 0.6)
                val nearF = kit.moodFilter(dusk, night, storming, 0.25)
                moodRoof = kit.moodFilter(dusk * 0.5, night * 0.55, storming, 0.0)
                tileLayer(c, kit.far, w, h * 0.3, camX * 0.05, farF)
                tileLayer(c, kit.mid, w, h * 0.42, camX * 0.16, midF)
                // village windows light up from dusk
                val lit = min(1.0, max(0.0, dusk - 0.35) * 1.2 + night * 0.6)
                if (lit > 0.02) tileLayer(c, kit.midLights, w, h * 0.42, camX * 0.16, null, lit)
                tileLayer(c, kit.near, w, h - kit.near!!.h + 6, camX * 0.32, nearF)
            } else {
                alpha = day.toFloat()
                if (alpha > 0) paintSun(c, sunX, sunY, min(h * 0.075, 58.0), clock)
                alpha = 1f
                puffCloud(c, ((-camX * 0.08) % (w + 260)) + 40, h * 0.14, 1.85, 0.9 - night * 0.35)
                puffCloud(c, ((-camX * 0.12 + 420) % (w + 300)) + 20, h * 0.28, 1.35, 0.75 - night * 0.25)
                paintRange(c, w, h, camX * 0.05, rgb(mix3(d(150, 190, 214), mix3(d(120, 92, 130), d(30, 40, 78), night), dusk)), 0.75)
                c.drawPath(hillPath(w, h, h * 0.72, h * 0.038, camX * 0.28, 0.008, 1.1), fill.also { it.shader = null; it.color = rgb(mix3(d(118, 196, 78), d(32, 58, 70), max(dusk * 0.7, night))) })
                c.drawPath(hillPath(w, h, h * 0.86, h * 0.028, camX * 0.48, 0.011, 2.2), fill.also { it.color = rgb(mix3(d(72, 168, 64), d(24, 48, 52), max(dusk * 0.6, night))) })
            }
        } else {
            if (spr.art.ready) {
                cloud(c, 0, ((-camX * 0.16) % (w + 300)) - 40, h * 0.12, 1.1, 0.75, 0.0)
                cloud(c, 1, ((-camX * 0.22 + 420) % (w + 300)) - 40, h * 0.28, 0.9, 0.6, 0.0)
                cloud(c, 2, ((-camX * 0.12 + 880) % (w + 280)) - 40, h * 0.08, 1.0, 0.65, 0.0)
                cloud(c, 1, ((-camX * 0.19 + 180) % (w + 300)) - 40, h * 0.44, 0.75, 0.45, 0.0)
            } else {
                puffCloud(c, ((-camX * 0.16) % (w + 260)) + 40, h * 0.18, 1.35, 0.7)
                puffCloud(c, ((-camX * 0.22 + 420) % (w + 300)) + 20, h * 0.32, 1.05, 0.55)
            }
        }

        paintMotes(c, w, h, clock)
        if (storming && !reducedMotion) paintRain(c, w, h, clock)

        val thick = max(16.0, h * 0.028)
        if (!s.bonus) {
            for (p in s.plats) {
                val x = p.x - camX
                if (x + p.w < -40 || x > w + 40) continue
                val live = s.grind && s.grounded && s.x >= p.x - 12 && s.x <= p.x + p.w + 12 && p.kind == PlatKind.WIRE
                drawPlat(c, x, sy(p.y), p.w, thick, clock, s.fever + night * 0.45, skin, p.kind, live, dim = dusk * 0.12 + night * 0.3)
            }
        }

        val bosses = s.enemies.filter { it.boss && !it.dead }.sortedBy { it.x }
        if (bosses.size > 1) {
            path.reset()
            bosses.forEachIndexed { i, e ->
                val bx = (e.x - camX).toFloat()
                val by = (sy(e.y) - 18).toFloat()
                if (i == 0) path.moveTo(bx, by) else path.lineTo(bx, by)
            }
            stroke.strokeCap = Paint.Cap.ROUND
            stroke.strokeJoin = Paint.Join.ROUND
            stroke.color = rgba(80, 180, 255, 0.55); stroke.strokeWidth = 5f
            c.drawPath(path, stroke)
            stroke.color = rgba(255, 227, 74, 0.35); stroke.strokeWidth = 2f
            c.drawPath(path, stroke)
        }

        for (e in s.enemies) {
            if (e.dead) continue
            val x = e.x - camX
            if (x < -50 || x > w + 50) continue
            val ey = sy(e.y)
            when (e.kind) {
                EnemyKind.BUSH -> drawBush(c, x, ey, clock + e.t)
                EnemyKind.MITE -> {
                    val step = sin(e.t * 16)
                    val dir = if (e.vx >= 0) 1 else -1
                    val feet = ey - 6 + max(0.0, -step) * 3
                    oval(c, x - dir * 2, ey - 1, 12.0, 3.0, solid(Color.rgb(16, 10, 8), 0.28))
                    // kicked-up dust behind the scuttling mite
                    if (!reducedMotion) for (k in 0 until 3) {
                        val u = (e.t * 3 + k / 3.0) % 1.0
                        circle(c, x - dir * (10 + u * 18), ey - 3 - u * 8, 2.0 + u * 3, solid(0xFFE8D9B0.toInt(), 0.45 * (1 - u)))
                    }
                    val breathe = if (reducedMotion) 0.0 else 0.08 * (0.5 + 0.5 * sin(clock * 5 + e.x * 0.03))
                    if (!blit(c, spr.mite, x, feet, 56.0, squash = max(0.0, -step) * 0.7, stretch = max(0.0, step) * 0.35 + breathe, flip = dir > 0, rot = dir * 0.14, outline = 0.035)) {
                        oval(c, x, feet - 12, 16.0, 10.0, solid(0xFF8A4A28.toInt()))
                    }
                }
                EnemyKind.DRONE -> {
                    val size = if (e.boss) 82.0 else 70.0
                    val hoverBob = if (reducedMotion) 0.0 else sin(clock * 3.1 + e.x * 0.02) * 3
                    // scan light under the drone + blinking beacon
                    fill.color = Color.BLACK
                    fill.shader = LinearGradient(0f, (ey - 8).toFloat(), 0f, (ey + 70).toFloat(), rgba(150, 220, 255, 0.28), rgba(150, 220, 255, 0.0), Shader.TileMode.CLAMP)
                    path.reset()
                    path.moveTo((x - 8).toFloat(), (ey - 8).toFloat()); path.lineTo((x + 8).toFloat(), (ey - 8).toFloat())
                    path.lineTo((x + 30).toFloat(), (ey + 70).toFloat()); path.lineTo((x - 30).toFloat(), (ey + 70).toFloat()); path.close()
                    c.drawPath(path, fill)
                    fill.shader = null
                    if (!blit(c, spr.drone, x, ey + hoverBob, size, outline = 0.03)) oval(c, x, ey - 20, if (e.boss) 26.0 else 22.0, 16.0, solid(if (e.boss) 0xFF2A88C8.toInt() else 0xFF3D6A6A.toInt()))
                    // rotor blur
                    if (!reducedMotion) oval(c, x, ey - size * 0.86, size * 0.42, 3.0 + abs(sin(clock * 40)) * 2, solid(Color.WHITE, 0.28))
                    if (floor(clock * 2.5 + e.x * 0.01).toInt() % 2 == 0) softGlow(c, x, ey - size * 0.45, 10.0, 0xFFFF4A3A.toInt(), 0.9)
                    if (e.boss) circle(c, x, ey - 18, 16.0, solid(Color.rgb(255, 227, 74), 0.35))
                }
            }
        }

        val hx0 = s.x - camX
        val hy0 = sy(s.y) - 6 - heroH * 0.45
        for (pick in s.picks) {
            if (pick.taken) continue
            val x = pick.x - camX
            if (x < -30 || x > w + 30) continue
            val py = sy(pick.y)
            // magnet trail while the fever pulls suns in
            if (s.fever > 0 && !pick.portal && !pick.shield) {
                val dx = hx0 - x
                val dy = hy0 - py
                val dist = kotlin.math.sqrt(dx * dx + dy * dy)
                if (dist < 260 && dist > 1) {
                    for (t in 1..4) {
                        val u = t * 0.07
                        circle(c, x - dx / dist * t * 9, py - dy / dist * t * 9, 9.0 - t * 1.6, solid(0xFFFFD24A.toInt(), 0.32 - u))
                    }
                }
            }
            drawPickup(c, x, py, pick.gold, pick.shield, clock, pick.portal)
        }

        for (p in s.particles) {
            val a = max(0.0, p.life / 0.5)
            if (p.ring) {
                stroke.color = color(p.color, a); stroke.strokeWidth = 2.2f + (1 - a.toFloat()) * 2f
                circle(c, p.x - camX, sy(p.y), p.r, stroke)
            } else if (p.streak) {
                stroke.color = color(p.color, a); stroke.strokeWidth = 5f; stroke.strokeCap = Paint.Cap.ROUND
                c.drawLine((p.x - camX + 8).toFloat(), sy(p.y).toFloat(), (p.x - camX - 46).toFloat(), sy(p.y).toFloat(), stroke)
            } else if (p.color == RunSim.C_SUN || p.color == RunSim.C_GOLD || p.color == RunSim.C_HEAT_Y) {
                // pickup burst: twinkling sparkles instead of dots
                sparkle(c, p.x - camX, sy(p.y), p.r * 2.2, p.life * 9 + p.x, p.color, a)
            } else if (p.color == RunSim.C_DUST || p.color == RunSim.C_LAND) {
                // soft dust puffs that swell as they fade
                circle(c, p.x - camX, sy(p.y), p.r * (1.6 - a * 0.6), solid(p.color, a * 0.7))
            } else {
                circle(c, p.x - camX, sy(p.y), p.r, solid(p.color, a))
            }
        }

        if (!reducedMotion && spd > 230) {
            val dens = min(0.22, (spd - 230) / 850)
            val n = if (spd > 320) 9 else 6
            stroke.strokeCap = Paint.Cap.ROUND
            stroke.strokeWidth = 2.2f
            for (i in 0 until n) {
                val yy = h * 0.28 + i * h * 0.07
                val len = 26 + (i % 3) * 22 + (spd - 220) * 0.08
                val sx = ((clock * spd * 0.55 + i * 90) % (w + 80)) - 40
                stroke.color = if (i % 2 == 0) rgba(255, 220, 40, dens) else rgba(80, 150, 255, dens)
                c.drawLine(sx.toFloat(), yy.toFloat(), (sx + len).toFloat(), yy.toFloat(), stroke)
            }
        }

        val blink = s.invuln > 0 && floor(clock * 16).toInt() % 2 == 0
        val hx = s.x - camX
        val hy = sy(s.y) - 6
        val sliding = s.slide > 0 && s.grounded
        if (s.phase == Phase.RUNNING && s.grounded && !s.bonus && !reducedMotion) {
            // running dust: little puffs kicked back from the feet
            for (k in 0 until 3) {
                val u = (s.runPhase * 0.25 + k / 3.0) % 1.0
                circle(c, hx - 10 - u * 34, hy - 2 - u * 10, 2.5 + u * (if (sliding) 7 else 4), solid(0xFFE8D9B0.toInt(), (if (sliding) 0.6 else 0.35) * (1 - u)))
            }
            if (sliding) {
                stroke.strokeCap = Paint.Cap.ROUND; stroke.strokeWidth = 2f
                for (k in 0 until 4) {
                    val u = (clock * 6 + k * 0.25) % 1.0
                    stroke.color = rgba(255, 220, 120, 0.8 * (1 - u))
                    c.drawLine((hx - 6 - u * 30).toFloat(), (hy - 1 - k * 2).toFloat(), (hx - 14 - u * 30).toFloat(), (hy - 3 - k * 2 - u * 6).toFloat(), stroke)
                }
            }
        }
        // landing ring
        val sinceLand = clock - landAt
        if (sinceLand in 0.0..0.25 && s.phase == Phase.RUNNING && !reducedMotion) {
            val u = sinceLand / 0.25
            stroke.color = rgba(255, 246, 220, 0.5 * (1 - u)); stroke.strokeWidth = 2.5f
            oval(c, hx, hy + 1, 14 + u * 30, 3 + u * 5, stroke)
        }
        if (!blink || s.phase == Phase.COUNTDOWN) {
            val rot = if (s.bonus) max(-0.5, min(0.55, s.vy / 860)) else if (sliding) -0.22 else if (!s.grounded) max(-0.12, min(0.12, s.vy / 3000)) else 0.0
            val charged = s.fever > 0 || s.combo >= 4 || s.grind
            // presentation squash/stretch on top of the sim's: a landing squish, a take-off stretch
            val landU = (clock - landAt) / 0.2
            val landSq = if (landU in 0.0..1.0 && !sliding && !reducedMotion) 0.3 * (1 - landU) * (1 - landU) else 0.0
            val air = if (!s.grounded && !s.bonus && !reducedMotion) (if (s.vy < 0) min(0.42, -s.vy / 1500) else min(0.16, s.vy / 4000)) else 0.0
            val squash = if (sliding) 1.0 else min(0.55, s.squash + landSq)
            val stretch = if (sliding) 0.0 else min(1.0, s.stretch + air)
            // contact shadow on the roof below, shrinking with height
            val below = if (s.grounded || s.bonus) null else s.plats.filter { it.kind == PlatKind.ROOF && s.x >= it.x && s.x <= it.x + it.w && it.y >= s.y }.minByOrNull { it.y }
            val groundY = if (below != null) sy(below.y) - 6 else hy
            val shY = if (s.grounded) 1.0 else if (below == null) 0.0 else max(0.35, 1 - (groundY - hy) / 260)
            if (shY > 0) oval(c, hx, groundY + 3, heroH * 0.26 * shY, 8.0 * shY, solid(Color.rgb(22, 14, 10), 0.3 * shY))
            heroGlow(c, hx, hy, heroH, charged)
            // red flinch: from the heart that was just lost, or straight from the sim's hit flash
            val hurt = max(max(0.0, 1 - (clock - hurtAt) / 0.45), if (s.flash > 0.3) min(1.0, s.flash / 0.72) else 0.0)
            // sliding: a low, wide tuck so the art clears drones the way the 24-unit slide box does
            drawHero(c, hx, hy, heroH * if (sliding) 0.5 else 1.0, s.runPhase, s.grounded, squash, stretch, s.vy, rot, 1.0, shadow = true, hurt = hurt, clock = clock)
            if (s.shield > 0) {
                // shield bubble (native: the web shows the shield only in the HUD)
                val cy = hy - heroH * 0.48
                val pulse = 0.85 + 0.15 * sin(clock * 4)
                softGlow(c, hx, cy, heroH * 0.68, 0xFF8FD0EF.toInt(), 0.18 * pulse)
                stroke.color = rgba(190, 236, 255, 0.55 * pulse); stroke.strokeWidth = 2.4f
                circle(c, hx, cy, heroH * 0.6, stroke)
                stroke.color = rgba(255, 255, 255, 0.5); stroke.strokeWidth = 3f
                rect.set((hx - heroH * 0.5).toFloat(), (cy - heroH * 0.5).toFloat(), (hx + heroH * 0.5).toFloat(), (cy + heroH * 0.5).toFloat())
                c.drawArc(rect, 200f, 50f, false, stroke)
            }
        }

        drawPops(c, s, camX, h, clock, ::sy)

        val intro = s.plats.firstOrNull { it.kind == PlatKind.ROOF && it.x < 40 }
        val lip = if (intro != null) intro.x + intro.w else 1020.0
        if (!s.bonus && s.phase == Phase.RUNNING && s.grounded && s.x > lip - 380 && s.x < lip - 18) {
            val gx = lip - 28 - camX
            if (gx > 48 && gx < w - 36) {
                val pulse = 0.72 + sin(clock * 5) * 0.18
                val iy = sy(intro?.y ?: 216.0)
                roundRect(c, gx - 42, iy - 126, 84.0, 34.0, 16.0, solid(Color.rgb(26, 20, 16), 0.72 * pulse))
                text.typeface = displayFace ?: textFace ?: Typeface.DEFAULT_BOLD
                text.textSize = max(18.0, h * 0.03).toFloat()
                text.color = color(0xFFF6EAD8.toInt(), pulse)
                c.drawText("TAP", gx.toFloat(), (iy - 109).toFloat() - (text.ascent() + text.descent()) / 2, text)
            }
        }

        if (!s.bonus) {
            val fgImg = spr.art.fg
            if (spr.art.ready && fgImg != null) tileLayer(c, fgImg, w, h - fgImg.h + 18, camX * 1.35, spr.art.moodFilter(dusk * 0.7, night * 0.85, storming, 0.0))
            else paintForeground(c, w, h, camX, max(dusk * 0.5, night))
        }

        if (s.fever > 0) {
            c.drawRect((-ox).toFloat(), (-oy).toFloat(), (w - ox).toFloat(), (h - oy).toFloat(), solid(Color.rgb(255, 210, 40), 0.07 * s.fever))
            c.drawRect((-ox).toFloat(), (-oy).toFloat(), (w - ox).toFloat(), (h - oy).toFloat(), solid(Color.rgb(30, 90, 220), 0.05 * s.fever))
        }
        c.restore()

        // warm key light from the sun side (colour grade)
        if (!s.bonus) {
            val day = max(0.0, 1 - night * 1.1)
            softGlow(c, sunX, sunY, h * 1.1, if (dusk > 0.5) 0xFFFF9A5A.toInt() else 0xFFFFE8B0.toInt(), 0.16 * day)
        }
        if (clockAt >= 0) paintClockMoment(c, w, h, clock - clockAt, hx + ox, hy - heroH * 0.5 + oy)
        if (s.lightning > 0 && !s.bonus) {
            c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(230, 240, 255), s.lightning * 0.42))
            paintBolt(c, w, h, s.distance.toInt(), s.lightning)
        }
        if (s.flash > 0) c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(255, 72, 48), s.flash * 0.32))
        paintVignette(c, w, h)
        if (s.hearts == 1 && s.phase == Phase.RUNNING) c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(8, 16, 28), 0.18))
        // transitions: fade in from black on the countdown, settle darker on the game over
        if (s.phase == Phase.COUNTDOWN && s.countdown > 0.9 && !reducedMotion) {
            c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(6, 10, 16), min(1.0, (s.countdown - 0.9) / 0.3)))
        }
        if (deadAt >= 0) {
            val u = min(1.0, (clock - deadAt) / 0.7)
            c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(8, 12, 20), 0.28 * u))
        }
    }

    /** Score / combo pops: elastic pop-in, outlined game text, combos bigger and hotter. */
    private fun drawPops(c: Canvas, s: RunState, camX: Double, h: Double, clock: Double, sy: (Double) -> Double) {
        val base = max(22.0, h * 0.048)
        text.typeface = displayFace ?: textFace ?: Typeface.DEFAULT_BOLD
        outline.typeface = text.typeface
        for (pop in s.pops) {
            val py = sy(pop.y) - 34 // clear of the larger hero art
            if (py < 78 || py > h - 24) continue
            val age = clock - (popBorn[pop] ?: clock)
            val a = min(1.0, pop.life * 2)
            val big = pop.text.endsWith("x") || pop.text.contains("HEAT") || pop.text == "1200"
            val scale = (if (big) 1.45 else 1.0) * when {
                reducedMotion -> 1.0
                age < 0.09 -> 0.5 + age / 0.09 * 0.8
                age < 0.2 -> 1.3 - (age - 0.09) / 0.11 * 0.3
                else -> 1.0
            }
            text.textSize = (base * scale).toFloat()
            outline.textSize = text.textSize
            outline.strokeWidth = (text.textSize * 0.2f)
            val mid = (text.ascent() + text.descent()) / 2
            val x = (pop.x - camX).toFloat()
            val y = py.toFloat() - mid
            outline.color = color(0xFF143A8C.toInt(), a)
            c.drawText(pop.text, x, y + 2, outline)
            c.drawText(pop.text, x, y, outline)
            text.color = color(if (big) 0xFFFF9A2A.toInt() else 0xFFFFE34A.toInt(), a)
            c.drawText(pop.text, x, y, text)
            if (big) {
                text.color = color(0xFFFFF6C4.toInt(), a * 0.55)
                c.save(); c.clipRect(x - 400f, y + text.ascent(), x + 400f, y + text.ascent() * 0.55f)
                c.drawText(pop.text, x, y, text)
                c.restore()
            }
        }
    }

    /** CLOCK IN unlocked: a golden shockwave and confetti around the hero (the run keeps going). */
    private fun paintClockMoment(c: Canvas, w: Double, h: Double, t: Double, x: Double, y: Double) {
        if (t > 1.8 || reducedMotion) return
        val u = t / 1.8
        stroke.color = rgba(255, 227, 74, 0.8 * (1 - u)); stroke.strokeWidth = (10 * (1 - u) + 2).toFloat()
        circle(c, x, y, 40 + u * w * 0.5, stroke)
        stroke.color = rgba(255, 255, 255, 0.6 * (1 - u)); stroke.strokeWidth = 3f
        circle(c, x, y, 20 + u * w * 0.35, stroke)
        val cols = intArrayOf(0xFFFFE34A.toInt(), 0xFF1557C4.toInt(), 0xFFFF7A3A.toInt(), 0xFF6FBF4A.toInt(), 0xFFFFFFFF.toInt())
        for (i in 0 until 46) {
            val ang = hash(i + 0.5) * PI * 2
            val sp = 220 + hash(i + 7.0) * 420
            val px = x + cos(ang) * sp * t
            val py = y + sin(ang) * sp * t * 0.7 + 380 * t * t
            c.save()
            c.translate(px.toFloat(), py.toFloat())
            c.rotate(Math.toDegrees(t * (6 + hash(i + 2.0) * 10) + i).toFloat())
            c.scale(1f, abs(cos(t * 9 + i)).toFloat() + 0.2f)
            c.drawRect(-5f, -3f, 5f, 3f, solid(cols[i % cols.size], 1 - u * u))
            c.restore()
        }
        softGlow(c, x, y, 160.0, 0xFFFFE34A.toInt(), 0.5 * (1 - u))
    }

    companion object {
        /** World units per screen height (the desktop browser frame in the reference shot). */
        const val LOGICAL_H = 680.0
        private val COIN_SHIMMER = intArrayOf(0, 1, 2, 1, 0, 7, 6, 7)
    }
}

/** Web skins.ts SKIN_PAL (cell, deep, lip, hi, band, grid) for every shop skin. FLAG is the default. */
enum class RunSkin(val id: String, val cell: Int, val deep: Int, val lip: Int, val hi: Int, val band: Int, val grid: Int) {
    FLAG("flag", 0xFF1557C4.toInt(), 0xFF0E3FA0.toInt(), 0xFFFFE34A.toInt(), 0xFFFFF6A8.toInt(), 0xFFF2C400.toInt(), 0x59FFD628.toInt()),
    GOLD("gold", 0xFFE8B931.toInt(), 0xFFC49218.toInt(), 0xFFFFF4B0.toInt(), 0xFFFFFDF0.toInt(), 0xFF8A5A12.toInt(), 0x73FFFFDC.toInt()),
    MOSS("moss", 0xFF2F6A32.toInt(), 0xFF1D4520.toInt(), 0xFFB7E07A.toInt(), 0xFFE8F7C8.toInt(), 0xFF1A3A1C.toInt(), 0x66B7E07A.toInt()),
    FROST("frost", 0xFF6EC4D4.toInt(), 0xFF2F7A8C.toInt(), 0xFFE8FBFF.toInt(), 0xFFFFFFFF.toInt(), 0xFF1D4C58.toInt(), 0x73E8FBFF.toInt()),
    STORM("storm", 0xFF1A3A6A.toInt(), 0xFF0D2448.toInt(), 0xFF7EC8FF.toInt(), 0xFFD6F0FF.toInt(), 0xFF143056.toInt(), 0x667EC8FF.toInt()),
    CHERRY("cherry", 0xFFC43A58.toInt(), 0xFF8A1E38.toInt(), 0xFFFFB0C4.toInt(), 0xFFFFE4EC.toInt(), 0xFF5A1424.toInt(), 0x66FFB0C4.toInt()),
    COPPER("copper", 0xFFB45A2A.toInt(), 0xFF7A3414.toInt(), 0xFFFFC08A.toInt(), 0xFFFFE8CC.toInt(), 0xFF4A220E.toInt(), 0x66FFC08A.toInt()),
    NIGHT("night", 0xFF1B1650.toInt(), 0xFF0E0A32.toInt(), 0xFFC9A6FF.toInt(), 0xFFF0E6FF.toInt(), 0xFF2A1F6A.toInt(), 0x59B48CFF.toInt()),
    LIME("lime", 0xFF6AA31A.toInt(), 0xFF3E6A0C.toInt(), 0xFFD8FF6A.toInt(), 0xFFF4FFC8.toInt(), 0xFF2A4408.toInt(), 0x66D8FF6A.toInt()),
    EMBER("ember", 0xFF8A2A18.toInt(), 0xFF5A140C.toInt(), 0xFFFF8A3A.toInt(), 0xFFFFD0A0.toInt(), 0xFF3A100C.toInt(), 0x66FFA03C.toInt()),
    OCEAN("ocean", 0xFF0E6E72.toInt(), 0xFF084448.toInt(), 0xFF7EF0EA.toInt(), 0xFFD8FFFC.toInt(), 0xFF063438.toInt(), 0x667EF0EA.toInt()),
    SAND("sand", 0xFFD2B07A.toInt(), 0xFFA07A48.toInt(), 0xFFFFF0CC.toInt(), 0xFFFFFAF0.toInt(), 0xFF6A4E28.toInt(), 0x73FFF0CC.toInt()),
    VIOLET("violet", 0xFF5A2A8A.toInt(), 0xFF38185C.toInt(), 0xFFD8B0FF.toInt(), 0xFFF4E8FF.toInt(), 0xFF241038.toInt(), 0x66D8B0FF.toInt()),
    CARBON("carbon", 0xFF2A3036.toInt(), 0xFF14181C.toInt(), 0xFFC8D2D8.toInt(), 0xFFF0F4F6.toInt(), 0xFF0C1014.toInt(), 0x59C8D2D8.toInt()),
    ROSE("rose", 0xFFC46A7A.toInt(), 0xFF8A3E4C.toInt(), 0xFFFFD0D8.toInt(), 0xFFFFF0F2.toInt(), 0xFF5A2430.toInt(), 0x66FFD0D8.toInt()),
    MINT("mint", 0xFF3EAA88.toInt(), 0xFF22705A.toInt(), 0xFFB8FFE4.toInt(), 0xFFECFFF6.toInt(), 0xFF164838.toInt(), 0x66B8FFE4.toInt()),
    SUNSET("sunset", 0xFFE07038.toInt(), 0xFFA04018.toInt(), 0xFFFFD08A.toInt(), 0xFFFFF0D0.toInt(), 0xFF5A220C.toInt(), 0x66FFD08A.toInt()),
    POLAR("polar", 0xFFD8E8F4.toInt(), 0xFF7A98B0.toInt(), 0xFFFFFFFF.toInt(), 0xFFFFFFFF.toInt(), 0xFF3A5060.toInt(), 0x80FFFFFF.toInt()),
    MAGMA("magma", 0xFF4A120C.toInt(), 0xFF240808.toInt(), 0xFFFF6A22.toInt(), 0xFFFFC080.toInt(), 0xFF1A0604.toInt(), 0x73FF6A22.toInt()),
    PRISM("prism", 0xFF2A6AD4.toInt(), 0xFF6A1EA8.toInt(), 0xFF7EF0D4.toInt(), 0xFFFFF4A8.toInt(), 0xFF1A1048.toInt(), 0x737EF0D4.toInt());

    companion object {
        fun of(id: String?): RunSkin = entries.firstOrNull { it.id == id } ?: FLAG
    }
}
