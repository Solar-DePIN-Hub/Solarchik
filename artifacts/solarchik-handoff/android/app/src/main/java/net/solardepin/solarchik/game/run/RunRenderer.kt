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
import kotlin.math.roundToInt
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
    /** Locale strings for the sim's English in-world words (see runLabels); empty = English. */
    var labels: Map<String, String> = emptyMap()
    /** Where collected suns fly to: the HUD suns chip centre, as fractions of the view (set by the UI). */
    @Volatile var sunTargetX = 0.28
    @Volatile var sunTargetY = 0.083

    private fun label(t: String): String = labels[t] ?: if (t.endsWith(" HEAT")) t.removeSuffix("HEAT") + (labels["HEAT"] ?: "HEAT") else t

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
        val gm = spr.art.glowMask
        if (gm != null) {
            glowBmp.color = color(col, min(1.0, a * 1.15))
            artRect.set((x - r).toFloat(), (y - r).toFloat(), (x + r).toFloat(), (y + r).toFloat())
            c.drawBitmap(gm, null, artRect, glowBmp)
            return
        }
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

    private fun cloud(c: Canvas, i: Int, x: Double, y: Double, scale: Double, a: Double, col: Int) {
        val img = spr.art.stratus[i % 2] ?: return
        maskPaint.color = color(col, max(0.0, a))
        artRect.set(x.toFloat(), y.toFloat(), (x + img.w * scale).toFloat(), (y + img.h * scale).toFloat())
        c.drawBitmap(img.bmp, null, artRect, maskPaint)
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
        c.drawText(label("FLY"), 0f, -70f - (text.ascent() + text.descent()) / 2, text)
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
            softGlow(c, x, yy, r * 4.2, if (gold) 0xFFFFC23A.toInt() else 0xFFFFA040.toInt(), (if (gold) 0.26 else 0.16) * (0.8 + 0.2 * sin(t * 4 + x * 0.03)))
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

    private fun paintRain(c: Canvas, w: Double, h: Double, t: Double, k: Double = 1.0, city: Boolean = false) {
        stroke.strokeCap = Paint.Cap.ROUND
        if (!city) {
            stroke.color = rgba(190, 214, 255, 0.28)
            stroke.strokeWidth = 1.2f
            for (i in 0 until 46) {
                val px = ((hash(i.toDouble()) * w + t * 420) % (w + 40)) - 20
                val py = ((hash(i + 8.0) * h + t * 760) % (h + 30)) - 10
                c.drawLine(px.toFloat(), py.toFloat(), (px + 7).toFloat(), (py + 18).toFloat(), stroke)
            }
            return
        }
        // city storm: two depths of wind-driven rain, the near streaks catching the light
        for (i in 0 until 90) {
            val near = i % 3 == 0
            val sp = if (near) 1.0 else 0.72
            val px = ((hash(i.toDouble()) * (w + 120) - t * 300 * sp) % (w + 120) + w + 120) % (w + 120) - 60
            val py = ((hash(i + 8.0) * h + t * 980 * sp) % (h + 40)) - 20
            val len = if (near) 26.0 else 15.0
            stroke.color = if (near) rgba(214, 238, 255, 0.55 * k) else rgba(170, 210, 236, 0.32 * k)
            stroke.strokeWidth = if (near) 1.6f else 1.1f
            c.drawLine(px.toFloat(), py.toFloat(), (px - len * 0.32).toFloat(), (py + len).toFloat(), stroke)
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

    private var vignetteShader: Shader? = null
    private var vignetteKey = 0.0
    private fun paintVignette(c: Canvas, w: Double, h: Double, strength: Double = 1.0) {
        if (vignetteShader == null || vignetteKey != w * 10000 + h) {
            vignetteKey = w * 10000 + h
            val r = h * 0.85
            vignetteShader = RadialGradient((w * 0.5).toFloat(), (h * 0.48).toFloat(), r.toFloat(),
                intArrayOf(Color.argb(0, 12, 10, 16), Color.argb(0, 12, 10, 16), Color.argb(110, 12, 10, 16)),
                floatArrayOf(0f, (0.3 / 0.85).toFloat(), 1f), Shader.TileMode.CLAMP)
        }
        fill.color = Color.argb((255 * strength.coerceIn(0.0, 1.0)).toInt(), 0, 0, 0)
        fill.shader = vignetteShader
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), fill)
        fill.shader = null
    }

    private var glowShader: Shader? = null
    private var glowKey = ""

    /** Soft warm glow behind the hero. The gradient is built once per size (it was allocated every frame). */
    private fun heroGlow(c: Canvas, x: Double, y: Double, size: Double, charged: Boolean) {
        val rr = size * if (charged) 0.7 else 0.48
        val cy = y - size * 0.42
        val key = "$charged|${(rr * 4).roundToInt()}"
        if (key != glowKey || glowShader == null) {
            glowKey = key
            val inner = (6 / rr).toFloat()
            glowShader = if (charged) {
                RadialGradient(0f, 0f, rr.toFloat(),
                    intArrayOf(rgba(120, 190, 255, 0.45), rgba(120, 190, 255, 0.45), rgba(255, 210, 60, 0.22), rgba(255, 170, 80, 0.0)),
                    floatArrayOf(0f, inner, 0.45f, 1f), Shader.TileMode.CLAMP)
            } else {
                RadialGradient(0f, 0f, rr.toFloat(),
                    intArrayOf(rgba(255, 200, 120, 0.22), rgba(255, 200, 120, 0.22), rgba(255, 170, 80, 0.0)),
                    floatArrayOf(0f, inner, 1f), Shader.TileMode.CLAMP)
            }
        }
        c.save()
        c.translate(x.toFloat(), (y - size * 0.4).toFloat())
        fill.shader = glowShader
        circle(c, 0.0, cy - (y - size * 0.4), rr, fill)
        fill.shader = null
        c.restore()
    }

    private val hurtRed = PorterDuffColorFilter(0xFFFF4830.toInt(), PorterDuff.Mode.SRC_IN)
    private val hurtWhite = PorterDuffColorFilter(0xFFFFFFFF.toInt(), PorterDuff.Mode.SRC_IN)

    private fun drawHero(
        c: Canvas, feetX: Double, feetY: Double, size: Double, phase: Double, grounded: Boolean, squash: Double, stretch: Double, vy: Double,
        rot: Double, a: Double, shadow: Boolean, hurt: Double = 0.0, clock: Double = 0.0, sliding: Boolean = false, landing: Boolean = false,
        rimCol: Int = 0, rimA: Double = 0.0,
    ) {
        // web drawHero: a bought robot runs on its own 4-frame strip (frame 4 in the air)
        val strip = if (robot != "stock") spr.robotRun(robot) else emptyList()
        val robo = strip.size >= 2
        val f = when {
            sliding -> if (robo) spr.robotSlide(robot) else spr.slide
            robo -> if (!grounded) strip[min(3, strip.size - 1)] else strip[((floor(phase).toInt() % strip.size) + strip.size) % strip.size]
            else -> spr.heroFrame(grounded, vy, phase, squash, landing)
        }
        val wobble = if (hurt > 0 && !reducedMotion) sin(hurt * 40) * 0.18 * hurt else 0.0
        if (f == null || kNow <= 0) {
            circle(c, feetX, feetY - size / 2, size / 3, solid(0xFF7AD1FF.toInt(), a))
            return
        }
        // prepared at the exact on-screen height: logical size = pixels x (size / prepared body px).
        // One scale for every frame and a fixed head pivot (Frame.cx) keep the robot from pulsing/drifting.
        val sc = size / heroHNow
        val perPx = if (spr.heroPx > 0) size / spr.heroPx else sc / kNow
        val hgt = f.bmp.height * perPx
        val pad = f.pad * perPx
        val sy = 1 - squash * 0.34 + stretch * 0.28
        val sx = 1 + squash * 0.22 - stretch * 0.12
        val dw = hgt * f.bmp.width / f.bmp.height
        c.save()
        c.translate(feetX.toFloat(), (feetY + pad).toFloat())
        c.scale(sx.toFloat(), sy.toFloat())
        val r = rot + wobble
        if (r != 0.0) {
            c.translate(0f, (-hgt * 0.46).toFloat())
            c.rotate(Math.toDegrees(r).toFloat())
            c.translate(0f, (hgt * 0.46).toFloat())
        }
        rect.set((-dw * f.cx).toFloat(), (-hgt).toFloat(), (dw * (1 - f.cx)).toFloat(), 0f)
        if (shadow) {
            c.save()
            c.translate(3f, 4f)
            shadowPaint.alpha = a255(a * 0.55)
            c.drawBitmap(f.bmp, null, rect, shadowPaint)
            c.restore()
        }
        if (rimA > 0) {
            // rim light from the sun / city glow: the silhouette offset up and towards the light
            c.save()
            c.translate((1.0 * sc).toFloat(), (-0.8 * sc).toFloat())
            maskPaint.color = color(rimCol, rimA * a)
            c.drawBitmap(f.rim, null, rect, maskPaint)
            c.restore()
        }
        bmpPaint.alpha = a255(a)
        c.drawBitmap(f.bmp, null, rect, bmpPaint)
        if (hurt > 0) {
            tintPaint.colorFilter = if (hurt > 0.82) hurtWhite else hurtRed
            tintPaint.alpha = a255((if (hurt > 0.82) 0.85 else hurt * 0.6) * a)
            c.drawBitmap(f.bmp, null, rect, tintPaint)
        }
        c.restore()
        // the head panel catches the sun now and then
        val gl = (clock * 0.55) % 1.0
        if (gl < 0.14 && !reducedMotion && a > 0.5 && !sliding) {
            val hs = 1 - squash * 0.34 + stretch * 0.28
            sparkle(c, feetX + size * 0.08, feetY - size * hs * 0.94, size * 0.09 * sin(gl / 0.14 * PI), gl * 8, 0xFFFFFFFF.toInt(), 0.95)
        }
    }

    // ---- solarpunk city (0.21.4) ----

    private var kNow = 0.0
    private var heroHNow = 136.0
    private val mat = android.graphics.Matrix()
    /** ALPHA_8 masks draw in the paint colour. */
    private val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val bloomPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.SCREEN) }
    private val glowBmp = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.SCREEN) }
    private val facadePaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val litPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val grainPaint = Paint()
    private val skyCache = HashMap<Int, Shader>()
    private var skyCacheH = -1.0

    /** Time-of-day keyframes: golden hour, dusk, night (see [P_TOP] … [P_NEON]). */
    private val keys = arrayOf(
        intArrayOf(0xFF3A4870.toInt(), 0xFFC48A78.toInt(), 0xFFF6C88C.toInt(), 0xFFC4968C.toInt(), 0xFF846068.toInt(), 0xFF463848.toInt(), 0xFFF0BC8C.toInt(), 0xFFFFECBE.toInt(), 0xFFFFC890.toInt(), 0xFFFFC0A0.toInt(), 0, 0),
        intArrayOf(0xFF1C1E46.toInt(), 0xFF6E4068.toInt(), 0xFFE88468.toInt(), 0xFF745070.toInt(), 0xFF483456.toInt(), 0xFF241E36.toInt(), 0xFFC4707C.toInt(), 0xFFFFAA78.toInt(), 0xFFFF968C.toInt(), 0xFFDC8C94.toInt(), 150, 120),
        intArrayOf(0xFF060A1C.toInt(), 0xFF101838.toInt(), 0xFF2C3060.toInt(), 0xFF1E2446.toInt(), 0xFF141A34.toInt(), 0xFF0A0E20.toInt(), 0xFF2C3868.toInt(), 0xFFDCE6FF.toInt(), 0xFF78D2FF.toInt(), 0xFF3C466E.toInt(), 255, 255),
    )
    private val pal = IntArray(12)

    private fun lerpArgb(a: Int, b: Int, t: Double): Int {
        val u = t.coerceIn(0.0, 1.0)
        fun ch(sh: Int) = (((a shr sh) and 0xFF) * (1 - u) + ((b shr sh) and 0xFF) * u).toInt()
        return (0xFF shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    /** Storm line keyframe: deep indigo sky, teal horizon glow, cool rim, teal haze (see [P_TOP] … [P_CLOUD]). */
    private val stormKey = intArrayOf(
        0xFF0C1230.toInt(), 0xFF142C4C.toInt(), 0xFF1F5A6E.toInt(), 0xFF1E3E52.toInt(), 0xFF13283E.toInt(), 0xFF0A1628.toInt(),
        0xFF285A6C.toInt(), 0xFF9FD8E8.toInt(), 0xFFA8E8F8.toInt(), 0xFF35566E.toInt(),
    )
    private var stormNow = 0.0

    private fun palette(mood: Double, storm: Double, flash: Double = 0.0) {
        val m = mood.coerceIn(0.0, 2.0)
        val i = min(1, floor(m).toInt())
        val t = m - i
        stormNow = storm
        for (k in 0 until 10) {
            var v = lerpArgb(keys[i][k], keys[i + 1][k], t)
            if (storm > 0) v = lerpArgb(v, stormKey[k], storm * 0.9)
            // a lightning flash lights the skyline layers and the haze from behind
            if (flash > 0 && k in P_FAR..P_FOG) v = lerpArgb(v, 0xFF5A7EA0.toInt(), flash * (0.42 - (k - P_FAR) * 0.1))
            pal[k] = v
        }
        pal[P_LIT] = (keys[i][P_LIT] + (keys[i + 1][P_LIT] - keys[i][P_LIT]) * t).toInt()
        pal[P_NEON] = (keys[i][P_NEON] + (keys[i + 1][P_NEON] - keys[i][P_NEON]) * t).toInt()
        // the city keeps its warm windows and neon on under the storm
        if (storm > 0) {
            pal[P_LIT] = max(pal[P_LIT], (215 * storm).toInt())
            pal[P_NEON] = max(pal[P_NEON], (170 * storm).toInt())
        }
    }

    /** An ALPHA_8 skyline tile repeated across the screen, tinted [col]. */
    private fun maskTile(c: Canvas, img: RunArt.Img?, w: Double, top: Double, scroll: Double, col: Int, a: Double, paint: Paint = maskPaint) {
        if (img == null || a <= 0.01) return
        val lw = img.w.toDouble()
        var x = -(((scroll % lw) + lw) % lw)
        paint.color = color(col, a)
        while (x < w) {
            artRect.set(x.toFloat(), top.toFloat(), (x + lw + 0.5).toFloat(), (top + img.h).toFloat())
            c.drawBitmap(img.bmp, null, artRect, paint)
            x += lw
        }
    }

    /** Vertical fade [a0] → [a1] of [col] over a rectangle (the shared ramp mask, no shader). */
    private fun rampRect(c: Canvas, x0: Double, y0: Double, x1: Double, y1: Double, col: Int, a0: Double, a1: Double) {
        val ramp = spr.art.rampMask ?: return
        if (a1 > a0) {
            maskPaint.color = color(col, a1)
            if (a0 > 0) c.drawRect(x0.toFloat(), y0.toFloat(), x1.toFloat(), y1.toFloat(), solid(col, a0))
            artRect.set(x0.toFloat(), y0.toFloat(), x1.toFloat(), y1.toFloat())
            maskPaint.alpha = a255(a1 - a0)
            c.drawBitmap(ramp, null, artRect, maskPaint)
        } else {
            c.save()
            c.scale(1f, -1f, 0f, ((y0 + y1) / 2).toFloat())
            rampRect(c, x0, y0, x1, y1, col, a1, a0)
            c.restore()
        }
    }

    private fun paintCitySky(c: Canvas, w: Double, h: Double, mood: Double, camX: Double, clock: Double, flash: Double = 0.0) {
        // 0.21.8: bounded (the storm roll-in and lightning made a new gradient nearly every frame)
        if (skyCacheH != h || skyCache.size > 64) { skyCache.clear(); skyCacheH = h }
        val key = (mood * 16).toInt() + ((stormNow * 8).roundToInt() shl 6) + (((pal[P_HOR] and 0xFF) shr 2) shl 10)
        val sh = skyCache.getOrPut(key) {
            LinearGradient(0f, 0f, 0f, h.toFloat(), intArrayOf(pal[P_TOP], pal[P_MID], pal[P_HOR], pal[P_HOR]), floatArrayOf(0f, 0.4f, 0.66f, 1f), Shader.TileMode.CLAMP)
        }
        fill.color = Color.BLACK
        fill.shader = sh
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), fill)
        fill.shader = null
        val dusk = min(1.0, mood)
        val night = max(0.0, mood - 1)
        val clear = 1 - stormNow
        if (flash > 0.01) c.drawRect(0f, 0f, w.toFloat(), (h * 0.75).toFloat(), solid(0xFFA8CCE8.toInt(), flash * 0.4 * stormNow))
        // stars and the moon come out after dusk (hidden behind the storm deck)
        paintStars(c, w, h, clock, night * 0.95 * clear)
        if (night > 0.15 && clear > 0.05) {
            val mx = w * 0.2; val my = h * 0.14
            softGlow(c, mx, my, h * 0.2, 0xFFB8C8FF.toInt(), 0.35 * night * clear)
            circle(c, mx, my, h * 0.028, solid(0xFFE6ECFF.toInt(), min(1.0, night * 1.2) * clear))
            circle(c, mx + h * 0.008, my - h * 0.006, h * 0.024, solid(pal[P_TOP], min(0.9, night) * clear))
        }
        // a low sun sinking into the skyline, its glow washing the haze
        val sunA = (1 - night * 1.25).coerceIn(0.0, 1.0) * clear
        if (sunA > 0.01) {
            val sx = w * 0.72
            val syy = h * (0.36 + 0.16 * dusk)
            softGlow(c, sx, syy, h * 0.62, pal[P_SUN], 0.42 * sunA)
            softGlow(c, sx, syy, h * 0.2, pal[P_SUN], 0.55 * sunA)
            circle(c, sx, syy, h * 0.05, solid(pal[P_SUN], sunA))
        }
        // stratus wisps catching the light
        val ca = 0.55 - night * 0.25
        cloud(c, 0, ((-camX * 0.03 - clock * 3) % (w + 700) + w + 700) % (w + 700) - 600, h * 0.12, 1.3, ca, pal[P_CLOUD])
        cloud(c, 1, ((-camX * 0.05 - clock * 2 + 640) % (w + 700) + w + 700) % (w + 700) - 600, h * 0.24, 1.0, ca * 0.8, pal[P_CLOUD])
        if (stormNow > 0.02) {
            // the storm deck: low, fast, layered cloud bands, their undersides lit by the city
            val sa = stormNow
            for (k in 0 until 4) {
                val sp = 9.0 + k * 5
                val x = ((-camX * (0.04 + k * 0.02) - clock * sp + k * 410) % (w + 700) + w + 700) % (w + 700) - 600
                cloud(c, k % 2, x, h * (0.04 + k * 0.07), 1.5 - k * 0.12, (0.75 - k * 0.1) * sa, if (k % 2 == 0) 0xFF22344E.toInt() else 0xFF2C4A62.toInt())
            }
            // 0.21.8: the glow fades in AND out (it ended in a hard horizontal edge at 0.42 h)
            rampRect(c, 0.0, h * 0.18, w, h * 0.32, 0xFF3A7484.toInt(), 0.0, 0.16 * sa)
            rampRect(c, 0.0, h * 0.32, w, h * 0.5, 0xFF3A7484.toInt(), 0.16 * sa, 0.0)
        }
    }

    private fun paintCityLayers(c: Canvas, w: Double, h: Double, camX: Double, clock: Double, lift: Double = 0.0) {
        val art = spr.art
        val lit = pal[P_LIT] / 255.0
        val neon = pal[P_NEON] / 255.0
        val tops = doubleArrayOf(h * 0.3 + lift * 0.2, h * 0.4 + lift * 0.35, h * 0.53 + lift * 0.55)
        val par = doubleArrayOf(0.06, 0.14, 0.3)
        for (i in 0 until 3) {
            val img = art.layer[i] ?: continue
            val top = tops[i]
            val col = pal[P_FAR + i]
            // depth of field: the far skyline is drawn from its soft copy
            maskTile(c, art.layerSoft[i] ?: img, w, top, camX * par[i], col, 1.0)
            c.drawRect(0f, (top + img.h - 0.5).toFloat(), w.toFloat(), h.toFloat(), solid(col))
            // bloom: a blurred, screen-blended halo under the window light and neon
            if (lit > 0.02) {
                maskTile(c, art.layerLitGlow[i], w, top, camX * par[i], 0xFFFFB060.toInt(), min(1.0, lit * (0.9 + 0.2 * i)), bloomPaint)
                maskTile(c, art.layerLit[i], w, top, camX * par[i], 0xFFFFC478.toInt(), lit * (0.7 + 0.1 * i))
            }
            if (neon > 0.02) {
                val nc = if (i == 1) 0xFFFF6EC8.toInt() else 0xFF6EE6FF.toInt()
                maskTile(c, art.layerNeonGlow[i], w, top, camX * par[i], nc, min(1.0, neon * 1.3), bloomPaint)
                maskTile(c, art.layerNeon[i], w, top, camX * par[i], nc, neon)
            }
            // atmospheric fog settling between the layers
            rampRect(c, 0.0, top + img.h * 0.35, w, top + img.h, pal[P_FOG], 0.0, 0.5 - i * 0.08)
            c.drawRect(0f, (top + img.h).toFloat(), w.toFloat(), h.toFloat(), solid(pal[P_FOG], 0.5 - i * 0.08))
            if (i == 0) paintShafts(c, w, h, clock)
        }
        // the street far below, glimpsed between the buildings
        val st = h - 30
        val nightLit = lit
        rampRect(c, 0.0, st - 30, w, h, 0xFF8A5A40.toInt(), 0.0, 0.18 + 0.3 * nightLit)
        for (i in 0 until 16) {
            val speed = 40 + (i % 4) * 26
            val x = ((i * 113.7 + clock * speed * (if (i % 2 == 0) 1 else -1) - camX * 0.85) % (w + 60) + w + 60) % (w + 60) - 30
            val yy = h - 7 - (i % 3) * 4.5
            c.drawRect(x.toFloat(), yy.toFloat(), (x + 4).toFloat(), (yy + 1.6).toFloat(), solid(if (i % 2 == 0) 0xFFFFF0D0.toInt() else 0xFFFF5040.toInt(), 0.35 + 0.55 * nightLit))
        }
    }

    /** Volumetric light: long soft beams fanning from the low sun through the haze. */
    private fun paintShafts(c: Canvas, w: Double, h: Double, clock: Double) {
        val night = pal[P_NEON] / 255.0
        val a = (1 - night * 1.4).coerceIn(0.0, 1.0)
        val gm = spr.art.glowMask ?: return
        if (a <= 0.02 || reducedMotion && a < 0.1) return
        val sx = w * 0.72
        val sy = h * 0.4
        glowBmp.color = color(pal[P_SUN], 0.11 * a)
        for (i in 0 until 5) {
            val ang = 128.0 + i * 11 + sin(clock * 0.12 + i * 1.7) * 2.5
            val len = h * (1.0 + 0.25 * hash(i + 1.0))
            val wid = h * (0.07 + 0.06 * hash(i + 5.0))
            c.save()
            c.translate(sx.toFloat(), sy.toFloat())
            c.rotate(ang.toFloat())
            artRect.set((-len * 0.1).toFloat(), (-wid / 2).toFloat(), len.toFloat(), (wid / 2).toFloat())
            c.drawBitmap(gm, null, artRect, glowBmp)
            c.restore()
        }
    }

    private fun shaderAt(sh: Shader, x: Double, y: Double) {
        val k = spr.art.pxPerUnit
        mat.setScale(1f / k, 1f / k)
        mat.postTranslate(x.toFloat(), y.toFloat())
        sh.setLocalMatrix(mat)
    }

    /** A city building: its rooftop is the walkable roof, the facade drops to the street. */
    private fun drawBuilding(c: Canvas, p: Plat, x: Double, ys: Double, h: Double, cf: android.graphics.ColorFilter?) {
        val art = spr.art
        val top = ys - RunArt.ROOF_TOP
        val bx0 = x - 3
        val bx1 = x + p.w + 3
        val seed = hash(p.x * 0.0137 + 3.1)
        val style = (seed * 3).toInt().coerceIn(0, 2)
        val fTop = top + 15
        if (p.w <= LONG_ROOF) {
            drawFacade(c, bx0, bx1, fTop, h, seed, style, cf)
        } else {
            // 0.21.8: a long roof (the drone arena is 4200 units) reads as a row of distinct buildings,
            // not one endless window grid (owner, SM-X210: "the background turns into a blue grid")
            var sx = p.x
            val end = p.x + p.w
            while (sx < end) {
                val sSeed = hash(sx * 0.0137 + 3.1)
                val segW = min(end - sx, 460 + sSeed * 260)
                val x0 = max(bx0, sx - (p.x - x) - if (sx == p.x) 3.0 else 0.0)
                val x1 = min(bx1, sx + segW - (p.x - x) + if (sx + segW >= end) 3.0 else 0.0)
                if (x1 > -40 && x0 < viewW + 40) {
                    val st = (sSeed * 3).toInt().coerceIn(0, 2)
                    drawFacade(c, x0, x1, fTop, h, sSeed, st, cf)
                    if (sx + segW < end) c.drawRect((x1 - 5).toFloat(), fTop.toFloat(), x1.toFloat(), (h + 4).toFloat(), solid(0xFF06050A.toInt(), 0.55))
                }
                sx += segW
            }
        }
        // rooftop props behind the walk line
        val back = top + 2
        val panel = art.panel
        val w = p.w
        if (seed < 0.72 && panel != null) {
            val step = 52.0
            val n = max(1, ((w - 20) / step).toInt())
            val x0 = x + (w - n * step) / 2 + 2
            for (i in 0 until n) art(c, panel, x0 + i * step, back - panel.h * 0.85, panel.w * 0.85, panel.h * 0.85, filter = cf)
        } else {
            val pl = art.planter
            val acu = art.ac
            var px = x + 12
            var i = 0
            while (px < x + w - 50) {
                val img = if ((i + (seed * 10).toInt()) % 3 == 1) acu else pl
                if (img != null) { art(c, img, px, back - img.h, filter = cf); px += img.w + 10 } else px += 50
                i++
            }
        }
        val tall = hash(p.x * 0.031 + 7.7)
        if (tall < 0.45 && w > 180) {
            val img = if (tall < 0.22) art.tank else art.antenna
            if (img != null) art(c, img, if (tall < 0.22) x + w - img.w - 14 else x + 14, back - img.h + 2, filter = cf)
        } else if (tall > 0.8) {
            art.vent?.let { art(c, it, x + w * 0.5, back - it.h, filter = cf) }
        }
        // parapet: the edge the robot runs along
        val ps = art.parapetShader
        if (ps != null) {
            shaderAt(ps, bx0, top)
            facadePaint.shader = ps
            facadePaint.colorFilter = cf
            c.drawRect(bx0.toFloat(), top.toFloat(), bx1.toFloat(), (top + 18).toFloat(), facadePaint)
            facadePaint.shader = null
        }
        c.drawRect(bx0.toFloat(), top.toFloat(), bx1.toFloat(), (top + 1.2).toFloat(), solid(pal[P_RIM], 0.45))
    }

    /** A facade block [x0]..[x1] from [fTop] down to the street: painted tile, lit windows, rim and shadow. */
    private fun drawFacade(c: Canvas, x0: Double, x1: Double, fTop: Double, h: Double, seed: Double, style: Int, cf: android.graphics.ColorFilter?) {
        val art = spr.art
        val fs = art.facadeShader[style]
        if (fs != null) {
            shaderAt(fs, x0 + seed * 40, fTop)
            facadePaint.shader = fs
            facadePaint.colorFilter = cf
            c.drawRect(x0.toFloat(), fTop.toFloat(), x1.toFloat(), (h + 4).toFloat(), facadePaint)
            facadePaint.shader = null
        }
        val lit = pal[P_LIT] / 255.0
        val ls = art.facadeLitShader[style]
        if (ls != null && lit > 0.02) {
            shaderAt(ls, x0 + seed * 40, fTop)
            litPaint.shader = ls
            litPaint.color = color(0xFFFFC27A.toInt(), lit * 0.9)
            c.drawRect(x0.toFloat(), fTop.toFloat(), x1.toFloat(), (h + 4).toFloat(), litPaint)
            litPaint.shader = null
        }
        // form: rim light on the sun side, shadow on the far side, a dark band under the cornice
        val night = (pal[P_NEON] / 255.0)
        c.drawRect(x0.toFloat(), fTop.toFloat(), (x0 + 2.5).toFloat(), (h + 4).toFloat(), solid(pal[P_RIM], 0.32 * (1 - night * 0.4)))
        for (k in 0 until 3) c.drawRect((x1 - 4 - k * 4).toFloat(), fTop.toFloat(), (x1 - k * 4).toFloat(), (h + 4).toFloat(), solid(0xFF0A0810.toInt(), 0.1 + 0.06 * k))
        c.drawRect(x0.toFloat(), fTop.toFloat(), x1.toFloat(), (fTop + 4).toFloat(), solid(0xFF0A0810.toInt(), 0.35))
    }

    /** City rules: a cracked solar-glass canopy bridge that gives way after a landing. */
    private fun drawCanopy(c: Canvas, p: Plat, x: Double, ys: Double, clock: Double, cf: android.graphics.ColorFilter?, unitY: Double) {
        val art = spr.art
        val stress = if (p.crackT >= 0) min(1.0, p.crackT / RunSim.CRACK_TIME) else 0.0
        var a = 1.0
        c.save()
        if (p.fallen) {
            a = max(0.0, 1 - p.fallY / 260)
            c.translate(0f, (p.fallY * unitY).toFloat())
            c.rotate((p.fallY * 0.03).toFloat(), (x + p.w / 2).toFloat(), ys.toFloat())
        } else if (stress > 0 && !reducedMotion) {
            c.translate((sin(clock * 70) * 1.4 * stress).toFloat(), (stress * 2).toFloat())
        }
        if (a <= 0.01) { c.restore(); return }
        alpha = a.toFloat()
        val panel = art.panel
        if (panel != null) {
            val n = max(1, Math.round(p.w / 50.0).toInt())
            val pw = p.w / n
            for (i in 0 until n) art(c, panel, x + i * pw - 1, ys - 22, pw + 2, 26.0, a = a, filter = cf)
        }
        // steel beam + truss, hazard chevrons at the ends
        c.drawRect((x - 3).toFloat(), (ys + 1).toFloat(), (x + p.w + 3).toFloat(), (ys + 7).toFloat(), solid(0xFF3A424C.toInt()))
        c.drawRect((x - 3).toFloat(), (ys + 1).toFloat(), (x + p.w + 3).toFloat(), (ys + 2.2).toFloat(), solid(pal[P_RIM], 0.6))
        stroke.color = color(0xFF2A3038.toInt()); stroke.strokeWidth = 1.4f; stroke.strokeCap = Paint.Cap.BUTT
        var tx = x
        while (tx < x + p.w - 10) {
            c.drawLine(tx.toFloat(), (ys + 7).toFloat(), (tx + 10).toFloat(), (ys + 15).toFloat(), stroke)
            c.drawLine((tx + 10).toFloat(), (ys + 15).toFloat(), (tx + 20).toFloat(), (ys + 7).toFloat(), stroke)
            tx += 20
        }
        c.drawRect(x.toFloat(), (ys + 14.3).toFloat(), (x + p.w).toFloat(), (ys + 15.7).toFloat(), solid(0xFF2A3038.toInt()))
        for (ex in doubleArrayOf(x - 3, x + p.w - 11)) for (k in 0 until 2) {
            c.drawRect((ex + k * 7).toFloat(), (ys + 2.2).toFloat(), (ex + k * 7 + 3.5).toFloat(), (ys + 7).toFloat(), solid(0xFFE8B830.toInt(), 0.9))
        }
        // hazard read at any hour: an amber LED strip along the deck edge and a glass sheen
        c.drawRect(x.toFloat(), (ys - 22).toFloat(), (x + p.w).toFloat(), (ys + 1).toFloat(), solid(pal[P_RIM], 0.16 * a))
        line(c, x, ys + 3.4, x + p.w, ys + 3.4, 0xFFFFB648.toInt(), 1.8, (0.75 + 0.25 * stress) * a)
        // cracks spread as it takes the weight
        val cr = art.crack
        if (cr != null) {
            val ca = 0.25 + 0.75 * stress
            var cx = x + 8
            var i = 0
            while (cx < x + p.w - 30) {
                art(c, cr, cx, ys - 20 + (i % 2) * 3, cr.w * 0.8, cr.h * 0.8, a = ca * a)
                cx += 64; i++
            }
        }
        alpha = 1f
        c.restore()
    }

    /** City cable between two steel poles; sparking cables crackle, then arc while live. */
    private fun drawCityWire(c: Canvas, x: Double, y: Double, w: Double, t: Double, grinding: Boolean, state: Int) {
        val sag = 14.0
        path.reset()
        path.moveTo(x.toFloat(), y.toFloat())
        path.quadTo((x + w * 0.5).toFloat(), (y + sag).toFloat(), (x + w).toFloat(), y.toFloat())
        stroke.strokeCap = Paint.Cap.ROUND
        stroke.color = color(0xFF1E2228.toInt()); stroke.strokeWidth = 3.4f
        c.drawPath(path, stroke)
        stroke.color = color(if (state == 2) 0xFFB8E8FF.toInt() else if (grinding) 0xFF9AD8FF.toInt() else 0xFF6A7480.toInt()); stroke.strokeWidth = 1.4f
        c.drawPath(path, stroke)
        fun at(u: Double) = y + 4 * sag * u * (1 - u) * 0.5 * 2 * 0.5 * 2
        if (state == 1 && !reducedMotion) {
            // crackling: a few sparks hopping along the cable
            for (i in 0 until 3) {
                if (hash(floor(t * 14) + i * 7.0) < 0.55) continue
                val u = hash(floor(t * 14) * 1.3 + i)
                sparkle(c, x + w * u, at(u), 5.0, t * 9, 0xFFFFD27A.toInt(), 0.9)
            }
        } else if (state == 2) {
            // live: an electric arc dancing along the whole span
            softGlow(c, x + w / 2, y + sag * 0.5, w * 0.6, 0xFF8ACFFF.toInt(), 0.35)
            path2.reset()
            val seg = 10
            for (i in 0..seg) {
                val u = i / seg.toDouble()
                val jy = if (i == 0 || i == seg) 0.0 else (hash(floor(t * 30) + i * 3.3) - 0.5) * 12
                if (i == 0) path2.moveTo((x + w * u).toFloat(), (at(u) + jy).toFloat()) else path2.lineTo((x + w * u).toFloat(), (at(u) + jy).toFloat())
            }
            stroke.color = color(0xFF9AD8FF.toInt(), 0.8); stroke.strokeWidth = 3f
            c.drawPath(path2, stroke)
            stroke.color = color(Color.WHITE, 0.95); stroke.strokeWidth = 1.2f
            c.drawPath(path2, stroke)
        }
        for (px in doubleArrayOf(x, x + w)) {
            c.drawRect((px - 2.6).toFloat(), (y - 26).toFloat(), (px + 2.6).toFloat(), (y + 60).toFloat(), solid(0xFF262B32.toInt()))
            c.drawRect((px - 2.6).toFloat(), (y - 26).toFloat(), (px - 1.4).toFloat(), (y + 60).toFloat(), solid(pal[P_RIM], 0.5))
            c.drawRect((px - 6).toFloat(), (y - 4).toFloat(), (px + 6).toFloat(), (y - 1).toFloat(), solid(0xFF3A424C.toInt()))
            if (state >= 1) circle(c, px, y - 28, 2.4, solid(if (state == 2) 0xFFFF4A3A.toInt() else 0xFFFFB03A.toInt(), if (floor(t * 6).toInt() % 2 == 0) 1.0 else 0.4))
        }
    }

    /** The maintenance drone: body ([front] false) or its telegraph + beam ([front] true). */
    // ---- 0.21.6 effects and creature life ----

    private val fxKinds = RunFx.Kind.values()

    /** Draws the live [RunFx] pool (analytic motion evaluated at fx.t), no allocation. */
    private fun drawFx(c: Canvas, fx: RunFx, camX: Double, sy: (Double) -> Double) {
        val t = fx.t
        val kinds = fxKinds
        for (i in 0 until RunFx.CAP) {
            val age = t - fx.born[i]
            val life = fx.life[i]
            if (age < 0 || age >= life) continue
            val u = age / life
            val k = kinds[fx.kind[i]]
            if (k == RunFx.Kind.FLY) continue
            val wx = fx.x[i] + fx.vx[i] * age
            val wy = fx.y[i] + fx.vy[i] * age + 0.5 * fx.g[i] * age * age
            val x = wx - camX
            val y = sy(wy)
            val col = fx.color[i]
            val sz = fx.size[i]
            when (k) {
                RunFx.Kind.DUST -> circle(c, x, y, sz * (1 + u * 1.3), solid(col, 0.7 * (1 - u) * (1 - u * 0.3)))
                RunFx.Kind.SMOKE -> circle(c, x, y, sz * (1 + u * 1.6), solid(col, 0.34 * (1 - u) * min(1.0, u * 5)))
                RunFx.Kind.SPARK -> {
                    val vx = fx.vx[i]
                    val vy = fx.vy[i] + fx.g[i] * age
                    val tx = x - vx * 0.035
                    val ty = sy(wy - vy * 0.035)
                    line(c, x, y, tx, ty, col, sz * 2.4, 0.55 * (1 - u))
                    line(c, x, y, tx * 0.5 + x * 0.5, ty * 0.5 + y * 0.5, Color.WHITE, sz * 1.1, 1 - u)
                }
                RunFx.Kind.SHARD, RunFx.Kind.METAL -> {
                    val rot = fx.spin[i] * age
                    c.save()
                    c.translate(x.toFloat(), y.toFloat())
                    c.rotate(Math.toDegrees(rot).toFloat())
                    // flat shards flip as they tumble: scale one axis by cos
                    c.scale(1f, (0.35 + 0.65 * abs(cos(rot * 1.7))).toFloat())
                    path2.reset()
                    if (k == RunFx.Kind.SHARD) {
                        path2.moveTo(0f, (-sz).toFloat()); path2.lineTo((sz * 0.6).toFloat(), (sz * 0.5).toFloat()); path2.lineTo((-sz * 0.5).toFloat(), (sz * 0.3).toFloat()); path2.close()
                        val a = if (u > 0.7) (1 - u) / 0.3 else 1.0
                        glow.shader = null
                        glow.color = color(col, 0.75 * a)
                        c.drawPath(path2, glow)
                        line(c, 0.0, -sz, sz * 0.6, sz * 0.5, Color.WHITE, 1.3, 0.85 * a)
                    } else {
                        rect.set((-sz * 0.6).toFloat(), (-sz * 0.3).toFloat(), (sz * 0.6).toFloat(), (sz * 0.3).toFloat())
                        val a = if (u > 0.75) (1 - u) / 0.25 else 1.0
                        c.drawRect(rect, solid(col, a))
                        line(c, -sz * 0.6, -sz * 0.3, sz * 0.6, -sz * 0.3, 0xFFB8C0CC.toInt(), 1.2, a)
                    }
                    c.restore()
                }
                RunFx.Kind.GLINT -> {
                    if (sz > 30) softGlow(c, x, y, sz * (0.6 + u), col, 0.9 * (1 - u))
                    else {
                        sparkle(c, x, y, sz * (1.1 - u * 0.6), fx.spin[i] * age + i, col, 1 - u * u)
                        circle(c, x, y, sz * 0.25, solid(Color.WHITE, 1 - u))
                    }
                }
                RunFx.Kind.EMBER -> {
                    val r = sz * (1 - u * 0.5)
                    circle(c, x, y, r * 2.2, solid(col, 0.25 * (1 - u)))
                    circle(c, x, y, r, solid(lerpArgb(0xFFFFE6A0.toInt(), col, u * 1.5), 1 - u * 0.6))
                }
                RunFx.Kind.RING -> {
                    stroke.color = color(col, 0.8 * (1 - u)); stroke.strokeWidth = (1.2 + 3 * (1 - u)).toFloat()
                    circle(c, x, y, sz + fx.vx[i] * age, stroke)
                }
                RunFx.Kind.FLY -> {}
            }
        }
    }

    /** Collected suns arcing up into the HUD counter (screen space, after the world transform). */
    private fun drawFlights(c: Canvas, fx: RunFx, camX: Double, sy: (Double) -> Double, w: Double, h: Double) {
        val frame = spr.art.coins[0] ?: return
        val tx = sunTargetX * w
        val ty = sunTargetY * h
        for (i in 0 until RunFx.CAP) {
            if (fx.kind[i] != RunFx.Kind.FLY.ordinal) continue
            val age = fx.t - fx.born[i]
            if (age < 0 || age >= fx.life[i]) continue
            val u = age / fx.life[i]
            val x0 = fx.x[i] - camX
            val y0 = sy(fx.y[i])
            for (g in 2 downTo 0) {
                val v = max(0.0, u - g * 0.045)
                val e = v * v * (3 - 2 * v)
                val px = x0 + (tx - x0) * e
                val py = y0 + (ty - y0) * e - sin(v * PI) * 70
                val size = 34.0 * fx.size[i] * (1 - 0.45 * e)
                if (g > 0) { circle(c, px, py, size * 0.22, solid(fx.color[i], 0.35 / g * (1 - u))); continue }
                softGlow(c, px, py, size * 1.3, 0xFFFFC23A.toInt(), 0.55)
                art(c, frame, px - size / 2, py - size / 2, size, size)
            }
        }
    }

    /** Rain splashes on the visible roofs while it storms (stateless: hashed per roof and cycle). */
    private fun paintSplashes(c: Canvas, s: RunState, camX: Double, w: Double, sy: (Double) -> Double, clock: Double, k: Double) {
        stroke.strokeCap = Paint.Cap.ROUND
        for (p in s.plats) {
            if (p.kind == PlatKind.WIRE || p.fallen) continue
            val x0 = p.x - camX
            if (x0 + p.w < 0 || x0 > w) continue
            val y = sy(p.y) - 1
            val n = (p.w / 70).toInt().coerceIn(2, 9)
            for (j in 0 until n) {
                val ph = clock * 2.6 + hash(p.x * 0.01 + j * 7.1)
                val cyc = floor(ph)
                val u = ph - cyc
                if (u > 0.32) continue
                val v = u / 0.32
                val sx = x0 + hash(p.x + j * 13.3 + cyc * 3.7) * p.w
                if (sx < -10 || sx > w + 10) continue
                val a = 0.85 * k * (1 - v)
                stroke.color = rgba(220, 240, 255, a); stroke.strokeWidth = 1.6f
                oval(c, sx, y, 4 + v * 13, 1.2 + v * 3, stroke)
                // two droplets kicked up
                val up = sin(v * PI) * 9
                circle(c, sx - 2 - v * 7, y - up, 1.2, solid(Color.rgb(220, 240, 255), a))
                circle(c, sx + 2 + v * 6, y - up * 0.8, 1.0, solid(Color.rgb(220, 240, 255), a))
            }
        }
    }

    /** City speed lines: pale streaks that thicken and multiply with speed. */
    private fun paintSpeedLines(c: Canvas, w: Double, h: Double, clock: Double, spd: Double) {
        // only at real speed, only in the frame's top and bottom bands (never across the action)
        val k = min(1.0, (spd - 360) / 120)
        val n = 3 + (k * 5).toInt()
        stroke.strokeCap = Paint.Cap.ROUND
        for (i in 0 until n) {
            val band = hash(i * 3.1)
            val yy = if (i % 2 == 0) h * (0.14 + band * 0.12) else h * (0.8 + band * 0.14)
            val len = 50 + hash(i + 0.5) * 60 + k * 70
            val v = spd * (1.6 + hash(i + 9.0))
            val sx = w + 60 - ((clock * v + hash(i + 2.0) * (w + 300)) % (w + 300))
            stroke.color = rgba(240, 246, 255, (0.09 + 0.13 * k) * (0.6 + 0.4 * hash(i + 4.0)))
            stroke.strokeWidth = (1.0 + k * 0.8).toFloat()
            c.drawLine(sx.toFloat(), yy.toFloat(), (sx + len).toFloat(), yy.toFloat(), stroke)
        }
    }

    private var hitShader: Shader? = null
    private var hitKey = 0.0
    /** Red hit vignette: the frame's edges flush red, the centre stays clear. */
    private fun paintHitVignette(c: Canvas, w: Double, h: Double, a: Double) {
        if (a <= 0.01) return
        if (hitShader == null || hitKey != w * 10000 + h) {
            hitKey = w * 10000 + h
            val r = kotlin.math.hypot(w * 0.5, h * 0.5)
            hitShader = RadialGradient((w * 0.5).toFloat(), (h * 0.5).toFloat(), r.toFloat(),
                intArrayOf(Color.argb(0, 255, 40, 30), Color.argb(0, 255, 40, 30), Color.argb(150, 230, 30, 20), Color.argb(230, 150, 10, 10)),
                floatArrayOf(0f, 0.42f, 0.78f, 1f), Shader.TileMode.CLAMP)
        }
        fill.color = Color.argb((255 * a.coerceIn(0.0, 1.0) * alpha).toInt(), 0, 0, 0)
        fill.shader = hitShader
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), fill)
        fill.shader = null
    }

    private val srcRect = android.graphics.Rect()
    /**
     * Mite walk cycle from the single painted sprite: the leg strip is cut in two (front pair / back
     * pair) and each half swings on its hip line in opposite phase, while the shell bobs and rocks.
     */
    private fun drawMiteWalk(c: Canvas, img: Bitmap, x: Double, feet: Double, hgt: Double, phase: Double, flip: Boolean, breathe: Double, clock: Double) {
        val iw = img.width
        val ih = img.height
        val dw = hgt * iw / ih
        val hip = 0.6 // leg strip starts here (fraction of height)
        val sw = sin(phase)
        val bob = abs(cos(phase)) * 2.2
        c.save()
        c.translate(x.toFloat(), feet.toFloat())
        if (flip) c.scale(-1f, 1f)
        val hipY = -hgt * (1 - hip)
        for (half in 0..1) {
            val swing = (if (half == 0) sw else -sw) * 0.32
            srcRect.set(if (half == 0) 0 else iw / 2, (ih * hip).toInt(), if (half == 0) iw / 2 else iw, ih)
            c.save()
            // skew about the hip line: the feet swing, the hips stay
            c.translate(0f, hipY.toFloat())
            c.skew(swing.toFloat(), 0f)
            c.translate(0f, (-hipY).toFloat())
            // the lifted pair rises a touch
            val lift = max(0.0, if (half == 0) sw else -sw) * 2.0
            rect.set((if (half == 0) -dw / 2 else 0.0).toFloat(), (hipY - lift).toFloat(), (if (half == 0) 0.0 else dw / 2).toFloat(), (-lift).toFloat())
            bmpPaint.alpha = a255(1.0)
            c.drawBitmap(img, srcRect, rect, bmpPaint)
            c.restore()
        }
        // shell: bob, breathe and rock with the step
        c.save()
        c.translate(0f, (-bob).toFloat())
        c.rotate((sw * 3.5 - 6).toFloat(), 0f, (-hgt * 0.5).toFloat())
        val sy = 1 + breathe * 0.25
        c.scale(1f, sy.toFloat(), 0f, hipY.toFloat())
        srcRect.set(0, 0, iw, (ih * (hip + 0.08)).toInt())
        rect.set((-dw / 2).toFloat(), (-hgt).toFloat(), (dw / 2).toFloat(), (-hgt * (1 - hip - 0.08)).toFloat())
        c.drawBitmap(img, srcRect, rect, bmpPaint)
        // the eye glints every couple of seconds
        val g = (clock * 0.6) % 1.0
        if (g < 0.12) softGlow(c, -dw * 0.4, -hgt * 0.47, 9.0, 0xFFFF4A3A.toInt(), 0.9 * (1 - g / 0.12))
        c.restore()
        c.restore()
    }

    /** Drone life: spinning rotor (blur disc + a foreshortened blade), blinking beacon, flickering eyes. */
    private fun drawDroneLife(c: Canvas, x: Double, feet: Double, size: Double, tilt: Double, clock: Double) {
        c.save()
        c.rotate(Math.toDegrees(tilt).toFloat(), x.toFloat(), (feet - size * 0.46).toFloat())
        val ry = feet - size * 0.93
        val rw = size * 0.44
        oval(c, x, ry, rw, 3.2, solid(Color.WHITE, 0.22))
        // two blades seen edge-on: their projected length runs cos(angle)
        for (b in 0..1) {
            val ang = clock * 38 + b * PI / 2
            val ext = cos(ang) * rw
            line(c, x - ext, ry + sin(ang) * 1.6, x + ext, ry - sin(ang) * 1.6, 0xFF1E3A44.toInt(), 2.2, 0.55)
        }
        // beacon: a double blink every 1.2 s
        val bt = (clock / 1.2) % 1.0
        if (bt < 0.06 || (bt > 0.14 && bt < 0.2)) {
            softGlow(c, x, ry - 6, 11.0, 0xFFFF4A3A.toInt(), 0.95)
            circle(c, x, ry - 6, 2.2, solid(0xFFFFD0C0.toInt()))
        }
        // eyes pulse; an arc flickers now and then
        val eye = 0.35 + 0.25 * sin(clock * 6.0)
        softGlow(c, x - size * 0.18, feet - size * 0.42, 9.0, 0xFF6EF0FF.toInt(), eye)
        softGlow(c, x + size * 0.12, feet - size * 0.42, 9.0, 0xFF6EF0FF.toInt(), eye)
        val arc = floor(clock * 7).toInt()
        if (hash(arc.toDouble()) > 0.72) {
            val side = if (hash(arc + 0.5) > 0.5) 1 else -1
            val ax = x + side * size * 0.48
            val ay = feet - size * (0.25 + hash(arc + 1.5) * 0.4)
            path2.reset(); path2.moveTo(ax.toFloat(), ay.toFloat())
            path2.lineTo((ax + side * 7).toFloat(), (ay + 4).toFloat()); path2.lineTo((ax + side * 4).toFloat(), (ay + 9).toFloat()); path2.lineTo((ax + side * 12).toFloat(), (ay + 13).toFloat())
            stroke.color = rgba(150, 240, 255, 0.9); stroke.strokeWidth = 1.6f; stroke.strokeJoin = Paint.Join.ROUND
            c.drawPath(path2, stroke)
        }
        c.restore()
    }

    /** Boss life: rotor blades, wingtip nav lights, a chasing panel strip and thruster heat. */
    private fun drawBossLife(c: Canvas, bx: Double, by: Double, bw: Double, bh: Double, clock: Double, charge: Double, hot: Boolean) {
        for ((j, rx) in doubleArrayOf(-bw * 0.38, bw * 0.38).withIndex()) {
            val ang = clock * 44 + j
            val ext = cos(ang) * bw * 0.13
            line(c, bx + rx - ext, by - bh * 0.38, bx + rx + ext, by - bh * 0.38, 0xFF2A2A30.toInt(), 2.0, 0.6)
        }
        // nav lights: red left, green right, alternating
        val on = floor(clock * 2.2).toInt() % 2 == 0
        softGlow(c, bx - bw * 0.47, by - bh * 0.3, 10.0, 0xFFFF3A2A.toInt(), if (on) 0.95 else 0.15)
        softGlow(c, bx + bw * 0.47, by - bh * 0.3, 10.0, 0xFF3AFF7A.toInt(), if (on) 0.15 else 0.95)
        // panel strip: a light chases across the hull, faster while charging
        val n = 5
        val pos = (clock * (2.0 + charge * 8)) % n
        for (i in 0 until n) {
            val px = bx - bw * 0.16 + i * bw * 0.08
            val lit = max(0.0, 1 - abs(i - pos) * 0.9)
            circle(c, px, by - bh * 0.24, 1.8, solid(if (hot) 0xFFFF7A3A.toInt() else 0xFFFFD27A.toInt(), 0.25 + 0.75 * lit))
        }
        // thruster heat under the hull
        val th = 0.35 + 0.2 * sin(clock * 23) + charge * 0.25
        softGlow(c, bx - bw * 0.1, by + bh * 0.3, 14.0, 0xFF8AD8FF.toInt(), th)
        softGlow(c, bx + bw * 0.1, by + bh * 0.3, 14.0, 0xFF8AD8FF.toInt(), th)
    }

    private fun drawBoss(c: Canvas, s: RunState, camX: Double, w: Double, sy: (Double) -> Double, clock: Double, front: Boolean) {
        if (s.bossStage == 0) return
        val img = spr.art.boss ?: return
        val bx = s.bossX - camX
        val by = sy(s.bossY)
        val y0 = RunSim.BANDS[1]
        val lane = if (s.bossLane == 0) RunSim.BEAM_LOW else RunSim.BEAM_HIGH
        val yt = sy(y0 + lane[0])
        val yb = sy(y0 + lane[1])
        val ey = by + 2.0 // the emitter under the hull
        if (!front) {
            // drawn 1.45x (was 0.95x) so the mini-boss reads as a boss on a phone; anchored so the hull
            // top (0.31 of the art above its centre) stays where it was, on the sim's stomp box
            val bw = img.w * 1.45
            val bh = img.h * 1.45
            val hy = by + (bh - img.h * 0.95) * 0.31
            val hot = s.bossStage == 3
            val charging = s.bossStage == 2 && s.bossTele > 0
            val recoil = if (s.bossBeam > 0) -5.0 * min(1.0, s.bossBeam / 0.15) else 0.0
            val tilt = if (hot) sin(clock * 9) * 4 + 8 else sin(clock * 2.1) * 2 + recoil
            // charging: a growing shiver
            val jit = if (charging && !reducedMotion) (1 - s.bossTele / RunSim.BOSS_TELE) * 2.5 else 0.0
            c.save()
            c.translate((sin(clock * 71) * jit).toFloat(), (cos(clock * 83) * jit).toFloat())
            c.rotate(tilt.toFloat(), bx.toFloat(), hy.toFloat())
            softGlow(c, bx, hy + bh * 0.1, bh * 0.9, if (hot) 0xFFFF6A3A.toInt() else 0xFFFFC870.toInt(), if (hot) 0.4 else 0.18)
            art(c, img, bx - bw / 2, hy - bh * 0.55, bw, bh, filter = spr.art.cityFilter(if (s.classic) 0.0 else RunSim.cityMoodAt(s.distance), if (s.classic) 0.0 else RunSim.cityStormAt(s.distance)))
            // rotor blur and a charging eye
            if (!reducedMotion) for (rx in doubleArrayOf(-bw * 0.38, bw * 0.38)) oval(c, bx + rx, hy - bh * 0.38, bw * 0.13, 2.0 + abs(sin(clock * 50)) * 1.5, solid(Color.WHITE, 0.35))
            val charge = if (s.bossTele > 0) 1 - s.bossTele / RunSim.BOSS_TELE else if (s.bossBeam > 0) 1.0 else 0.2
            if (!reducedMotion) drawBossLife(c, bx, hy, bw, bh, clock, charge, hot)
            softGlow(c, bx, hy - bh * 0.08, 18 + 26 * charge, 0xFFFF5A2A.toInt(), 0.5 + 0.5 * charge)
            if (hot && !reducedMotion) {
                for (k in 0 until 6) {
                    val u = (clock * 0.9 + k / 6.0) % 1.0
                    circle(c, bx - 10 + hash(k + 2.0) * 20 - u * 20, hy - bh * 0.4 - u * 60, 6 + u * 14, solid(0xFF3A3A40.toInt(), 0.45 * (1 - u)))
                }
                if (floor(clock * 12).toInt() % 3 == 0) sparkle(c, bx + 20, hy, 8.0, clock * 7, 0xFFFFD27A.toInt(), 0.9)
            }
            c.restore()
            // telegraph: the lane lights up, with a jump / slide cue on the robot's side
            if (s.bossStage == 2 && s.bossTele > 0) {
                val blink = if (floor(clock * 10).toInt() % 2 == 0) 1.0 else 0.55
                val u = 1 - s.bossTele / RunSim.BOSS_TELE
                c.drawRect(0f, yt.toFloat(), (bx - 30).toFloat(), yb.toFloat(), solid(0xFFFF3A2A.toInt(), (0.16 + 0.24 * u) * blink))
                line(c, 0.0, yt, bx - 30, yt, 0xFFFF6A4A.toInt(), 1.5, 0.75 * blink)
                line(c, 0.0, yb, bx - 30, yb, 0xFFFF6A4A.toInt(), 1.5, 0.75 * blink)
                stroke.color = color(0xFFFFB08A.toInt(), 0.9 * blink); stroke.strokeWidth = 2.5f; stroke.strokeCap = Paint.Cap.BUTT
                var dx = bx - 40
                while (dx > 0) { c.drawLine(dx.toFloat(), ((yt + yb) / 2).toFloat(), (dx - 12).toFloat(), ((yt + yb) / 2).toFloat(), stroke); dx -= 22 }
                // the cue sits just ahead of the robot: up = jump the low beam, down = slide under the high one
                val cx = w * 0.32
                val cy = if (s.bossLane == 0) yt - 34 else yb + 30
                circle(c, cx, cy, 19.0, solid(0xFF1A1418.toInt(), 0.62))
                path.reset()
                if (s.bossLane == 0) { path.moveTo((cx - 9).toFloat(), (cy + 5).toFloat()); path.lineTo(cx.toFloat(), (cy - 6).toFloat()); path.lineTo((cx + 9).toFloat(), (cy + 5).toFloat()) }
                else { path.moveTo((cx - 9).toFloat(), (cy - 5).toFloat()); path.lineTo(cx.toFloat(), (cy + 6).toFloat()); path.lineTo((cx + 9).toFloat(), (cy - 5).toFloat()) }
                stroke.color = color(0xFFFFE0C0.toInt(), blink); stroke.strokeWidth = 4f; stroke.strokeCap = Paint.Cap.ROUND; stroke.strokeJoin = Paint.Join.ROUND
                c.drawPath(path, stroke)
            }
            return
        }
        if (s.bossBeam > 0) {
            val fl = 0.85 + 0.15 * sin(clock * 80)
            val mid = (yt + yb) / 2
            val half = (yb - yt) / 2
            c.drawRect(0f, (yt - 6).toFloat(), (bx - 24).toFloat(), (yb + 6).toFloat(), solid(0xFFFF5A2A.toInt(), 0.35 * fl))
            c.drawRect(0f, yt.toFloat(), (bx - 24).toFloat(), yb.toFloat(), solid(0xFFFF8A4A.toInt(), 0.75 * fl))
            c.drawRect(0f, (mid - half * 0.4).toFloat(), (bx - 24).toFloat(), (mid + half * 0.4).toFloat(), solid(0xFFFFF4E0.toInt(), 0.95))
            softGlow(c, bx - 30, mid, 44.0, 0xFFFFB070.toInt(), 0.9)
            // bloom: soft glows strung along the beam, flickering
            if (!reducedMotion) {
                var gx = bx - 90
                var k = 0
                while (gx > -40) {
                    softGlow(c, gx, mid, half * 3.2 + hash(k + floor(clock * 30)) * 10, 0xFFFF7A3A.toInt(), 0.28)
                    gx -= 110; k++
                }
            }
            line(c, bx - 30, ey, bx - 30, mid, 0xFFFF8A4A.toInt(), 3.0, 0.8)
        }
    }

    private fun line(c: Canvas, x0: Double, y0: Double, x1: Double, y1: Double, col: Int, wd: Double, a: Double) {
        stroke.color = color(col, a); stroke.strokeWidth = wd.toFloat(); stroke.strokeCap = Paint.Cap.ROUND
        c.drawLine(x0.toFloat(), y0.toFloat(), x1.toFloat(), y1.toFloat(), stroke)
    }

    /** Wind gust: faint streaks while it builds, a hard headwind of streaks while it blows. */
    private fun paintGust(c: Canvas, s: RunState, w: Double, h: Double, clock: Double) {
        if (reducedMotion) return
        val build = if (s.gustWarn > 0) 1 - s.gustWarn / RunSim.GUST_WARN else 0.0
        val blow = if (s.gustLeft > 0) 1.0 else 0.0
        val a = max(build * 0.35, blow * 0.6)
        if (a <= 0.01) return
        stroke.strokeCap = Paint.Cap.ROUND
        val n = if (blow > 0) 22 else 10
        for (i in 0 until n) {
            val sp = 700 + hash(i + 1.0) * 500
            val x = w - ((clock * sp + hash(i + 3.0) * 900) % (w + 260)) + 60
            val y = h * (0.12 + 0.76 * hash(i + 9.0)) + sin(clock * 3 + i) * 6
            val len = 50 + hash(i + 4.0) * 90
            stroke.color = color(0xFFF2EEE6.toInt(), a * (0.5 + 0.5 * hash(i + 6.0)))
            stroke.strokeWidth = (1.2 + hash(i + 7.0) * 1.6).toFloat()
            c.drawLine(x.toFloat(), y.toFloat(), (x + len).toFloat(), (y - len * 0.06).toFloat(), stroke)
        }
        if (blow > 0) for (i in 0 until 6) {
            // leaves and grit tumbling past
            val x = w - ((clock * 820 + i * 211) % (w + 100)) + 20
            val y = h * (0.3 + 0.5 * hash(i + 21.0)) + sin(clock * 9 + i) * 14
            c.save(); c.translate(x.toFloat(), y.toFloat()); c.rotate((clock * 500 + i * 60).toFloat())
            c.drawRect(-3f, -1.5f, 3f, 1.5f, solid(if (i % 2 == 0) 0xFF6A7A4A.toInt() else 0xFF8A6A48.toInt(), 0.85))
            c.restore()
        }
    }

    private var grainT = -1
    /** Subtle film grain over the frame (a tiled noise mask, re-seeded ~12x per second). */
    private fun paintGrain(c: Canvas, w: Double, h: Double, clock: Double) {
        val g = spr.art.grainShader ?: return
        val k = spr.art.pxPerUnit
        val step = if (reducedMotion) 0 else (clock * 12).toInt()
        if (step != grainT) {
            grainT = step
            mat.setScale(1f / k, 1f / k)
            mat.postTranslate((hash(step * 1.3) * 160).toFloat(), (hash(step * 2.7) * 160).toFloat())
            g.setLocalMatrix(mat)
        }
        grainPaint.shader = g
        grainPaint.color = Color.argb(a255(0.07), 255, 255, 255)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), grainPaint)
        grainPaint.color = Color.argb(a255(0.06), 0, 0, 0)
        c.save(); c.translate(37f, 53f)
        c.drawRect(-37f, -53f, w.toFloat(), h.toFloat(), grainPaint)
        c.restore()
        grainPaint.shader = null
    }

    /**
     * One frame. [wPx]/[hPx] is the surface; [clock] the wall clock in seconds (animation phase).
     * The world is drawn in logical units; the HUD lives in Android views on top (like the DOM HUD).
     */
    fun draw(c: Canvas, wPx: Int, hPx: Int, s: RunState, clock: Double, skin: RunSkin = this.skin) {
        val k = hPx / logicalH
        spr.art.prepare(k.toFloat(), skin)
        kNow = k
        heroHNow = min(logicalH * HERO_FRAC, HERO_H)
        spr.prepareHero(Math.round(heroHNow * k).toInt())
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

    private var camT = -1.0
    private var camLift = 0.0

    /** Logical width of the frame being drawn (culling for long roofs). */
    private var viewW = 2000.0

    private fun drawWorld(c: Canvas, w: Double, h: Double, s: RunState, clock: Double, skin: RunSkin) {
        viewW = w
        alpha = 1f
        track(s, clock)
        val trauma = if (reducedMotion) 0.0 else s.shake * s.shake
        val ox = sin(clock * 41.2) * 14 * trauma
        val oy = cos(clock * 33.7) * 10 * trauma
        val city = spr.art.ready
        val mood = if (s.bonus) 0.0 else if (s.classic) RunSim.moodAt(s.distance) else RunSim.cityMoodAt(s.distance)
        val dusk = min(1.0, mood)
        val night = max(0.0, mood - 1)
        val stormK = if (s.bonus) 0.0 else if (s.classic || !spr.art.ready) (if (s.distance > 16000) 1.0 else 0.0) else RunSim.cityStormAt(s.distance)
        val storming = stormK > 0.01
        val flash = if (s.bonus) 0.0 else s.lightning / 0.55
        // drawn ~1.6x the web size for phone readability; the sim hitbox (PW/PH) is unchanged
        val heroH = min(h * HERO_FRAC, HERO_H)
        val spd = RunSim.speedAt(s)
        val look = spd * 0.18
        val camX = s.x - w * 0.27 + look
        if (city) palette(mood, stormK, flash * stormK)
        if (s.bonus) paintGardenSky(c, w, h, clock)
        else if (city) paintCitySky(c, w, h, mood, camX, clock, flash)
        else paintSky(c, w, h, mood)
        if (storming && !city) {
            c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(8, 16, 40), 0.2 + 0.08 * sin(s.stormT * 1.4)))
        }
        if (!city) {
            paintStars(c, w, h, clock, if (s.bonus) 0.0 else night * 0.9)
            paintAurora(c, w, h, clock, if (s.bonus) 0.0 else max(0.0, night - 0.15))
        }

        c.save()
        val fallLook = if (s.phase == Phase.DEAD && s.death == DeathKind.FALL && !reducedMotion) 78.0 else 0.0
        c.translate(ox.toFloat(), (oy - fallLook).toFloat())
        if (s.hearts == 1 && s.phase == Phase.RUNNING && !reducedMotion) {
            c.translate((w * 0.5).toFloat(), (h * 0.55).toFloat())
            c.scale(1.045f, 1.045f)
            c.translate((-w * 0.5).toFloat(), (-h * 0.55).toFloat())
        }

        val hillTop = h * 0.87
        val playTop = h * 0.52
        val playBot = hillTop - 14
        fun sy0(wy: Double) = playTop + ((wy - 140) / 150) * (playBot - playTop)
        // camera lift: on a high (double) jump the world eases down so the robot stays clear of the HUD
        // (the HUD chips end ~0.125h down and the robot stretches on take-off: aim its head at ~0.26h,
        // never above ~0.2h)
        val headroom = h * 0.28 + heroH
        val liftRaw = if (s.bonus) 0.0 else max(0.0, headroom - sy0(s.y))
        val liftWant = liftRaw * liftRaw / (liftRaw + h * 0.05)
        // smooth follow: rises quickly with a jump, settles slowly after it (snaps on cuts: respawn,
        // a new run, a jump in time); never lags so far that the robot reaches the HUD
        val camDt = clock - camT
        camT = clock
        camLift = if (camDt <= 0 || camDt > 0.25 || reducedMotion) liftWant
        else camLift + (liftWant - camLift) * (1 - kotlin.math.exp(-camDt * (if (liftWant > camLift) 14.0 else 5.0)))
        camLift = max(camLift, liftRaw - h * 0.06)
        val lift = camLift
        fun sy(wy: Double) = sy0(wy) + lift
        val sunX = w * 0.84
        val sunY = h * (0.13 + dusk * 0.06)

        if (!s.bonus) {
            if (city) {
                paintCityLayers(c, w, h, camX, clock, lift)
            } else {
                if (night > 0.35) {
                    softGlow(c, w * 0.14, h * 0.12, 46.0, 0xFFE6ECFF.toInt(), min(0.5, night * 0.4))
                    circle(c, w * 0.14, h * 0.12, 11.0, solid(Color.rgb(230, 236, 255), min(0.85, night * 0.7)))
                }
                val day = max(0.0, 1 - night * 1.1)
                paintRays(c, sunX, sunY, h * 0.75, clock, day * (1 - dusk * 0.5))
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
            if (city) {
                cloud(c, 0, ((-camX * 0.16) % (w + 600)) - 120, h * 0.12, 1.1, 0.75, Color.WHITE)
                cloud(c, 1, ((-camX * 0.22 + 420) % (w + 600)) - 120, h * 0.3, 0.9, 0.6, Color.WHITE)
                cloud(c, 0, ((-camX * 0.12 + 880) % (w + 600)) - 120, h * 0.5, 1.0, 0.5, Color.WHITE)
            } else {
                puffCloud(c, ((-camX * 0.16) % (w + 260)) + 40, h * 0.18, 1.35, 0.7)
                puffCloud(c, ((-camX * 0.22 + 420) % (w + 300)) + 20, h * 0.32, 1.05, 0.55)
            }
        }

        if (!city || mood < 0.6) paintMotes(c, w, h, clock)
        if (storming && !reducedMotion) paintRain(c, w, h, clock, if (city) stormK else 1.0, city)

        val thick = max(16.0, h * 0.028)
        if (!s.bonus) {
            val cf = if (city) spr.art.cityFilter(mood, stormK) else null
            for (p in s.plats) {
                val x = p.x - camX
                if (x + p.w < -40 || x > w + 40) continue
                val live = s.grind && s.grounded && s.x >= p.x - 12 && s.x <= p.x + p.w + 12 && p.kind == PlatKind.WIRE
                if (!city) {
                    drawPlat(c, x, sy(p.y), p.w, thick, clock, s.fever + night * 0.45, skin, p.kind, live, dim = dusk * 0.12 + night * 0.3)
                } else if (p.kind == PlatKind.WIRE) {
                    drawCityWire(c, x, sy(p.y), p.w, clock, live, if (p.live) RunSim.wireLive(s, p) else -1)
                } else if (p.crumble) {
                    drawCanopy(c, p, x, sy(p.y), clock, cf, (playBot - playTop) / 150)
                } else {
                    drawBuilding(c, p, x, sy(p.y), h, cf)
                }
            }
            if (city) {
                // the street is far below: the facades sink into haze
                rampRect(c, 0.0, h * 0.8, w, h + 2, pal[P_FOG], 0.0, 0.62)
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
                    val mite = spr.mite
                    if (mite == null) {
                        oval(c, x, feet - 12, 16.0, 10.0, solid(0xFF8A4A28.toInt()))
                    } else if (city && !reducedMotion) {
                        drawMiteWalk(c, outlined(mite, 0.035), x, ey - 6, 58.0, e.t * 16, dir > 0, breathe, clock + e.x * 0.01)
                    } else {
                        blit(c, mite, x, feet, 56.0, squash = max(0.0, -step) * 0.7, stretch = max(0.0, step) * 0.35 + breathe, flip = dir > 0, rot = dir * 0.14, outline = 0.035)
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
                    // tilt: leans into its bob (nose down while sinking) and sways in the wind
                    val tilt = if (reducedMotion || !city) 0.0 else cos(clock * 3.1 + e.x * 0.02) * 0.09 + sin(clock * 1.3 + e.x * 0.05) * 0.05
                    if (!blit(c, spr.drone, x, ey + hoverBob, size, rot = tilt, outline = 0.03)) oval(c, x, ey - 20, if (e.boss) 26.0 else 22.0, 16.0, solid(if (e.boss) 0xFF2A88C8.toInt() else 0xFF3D6A6A.toInt()))
                    if (city && !reducedMotion) {
                        drawDroneLife(c, x, ey + hoverBob, size, tilt, clock + e.x * 0.013)
                    } else {
                        // rotor blur
                        if (!reducedMotion) oval(c, x, ey - size * 0.86, size * 0.42, 3.0 + abs(sin(clock * 40)) * 2, solid(Color.WHITE, 0.28))
                        if (floor(clock * 2.5 + e.x * 0.01).toInt() % 2 == 0) softGlow(c, x, ey - size * 0.45, 10.0, 0xFFFF4A3A.toInt(), 0.9)
                    }
                    if (e.boss) circle(c, x, ey - 18, 16.0, solid(Color.rgb(255, 227, 74), 0.35))
                }
            }
        }

        if (!s.bonus && !s.classic) drawBoss(c, s, camX, w, ::sy, clock, false)

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

        val fxp = s.fx
        if (fxp != null && city && !s.bonus) drawFx(c, fxp, camX, ::sy)
        if (storming && city && !s.bonus && !reducedMotion) paintSplashes(c, s, camX, w, ::sy, clock, stormK)

        if (city && !s.bonus) {
            if (!reducedMotion && !storming && spd > 360) paintSpeedLines(c, w, h, clock, spd)
        } else if (!reducedMotion && spd > 230) {
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
            // grounded: leans into the run as the speed climbs
            val lean = if (reducedMotion) 0.0 else max(0.0, min(0.09, (spd - 220) / 2200))
            val rot = if (s.bonus) max(-0.5, min(0.55, s.vy / 860)) else if (sliding) -0.22 else if (!s.grounded) max(-0.12, min(0.12, s.vy / 3000)) else lean
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
            // sliding: the leaned-back slide pose, low enough to clear drones like the 24-unit slide box
            val landing = s.grounded && !sliding && clock - landAt in 0.0..0.09
            val slideSq = if (sliding) 0.15 else squash
            val slideRot = if (sliding) 0.0 else rot
            drawHero(c, hx, hy, heroH, s.runPhase, s.grounded, slideSq, if (sliding) 0.0 else stretch, s.vy, slideRot, 1.0, shadow = true, hurt = hurt, clock = clock,
                sliding = sliding, landing = landing, rimCol = if (city) pal[P_RIM] else 0, rimA = if (city) 0.85 else 0.0)
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

        if (!s.bonus && !s.classic) drawBoss(c, s, camX, w, ::sy, clock, true)
        if (!s.classic) paintGust(c, s, w, h, clock)

        drawPops(c, s, camX, h, clock, ::sy)

        val intro = s.plats.firstOrNull { it.kind == PlatKind.ROOF && it.x < 40 }
        val lip = if (intro != null) intro.x + intro.w else 1020.0
        if (s.tutorial && !s.bonus && s.phase == Phase.RUNNING && s.grounded && s.x > lip - 380 && s.x < lip - 18) {
            val gx = lip - 28 - camX
            if (gx > 48 && gx < w - 36) {
                val pulse = 0.72 + sin(clock * 5) * 0.18
                val iy = sy(intro?.y ?: 216.0)
                roundRect(c, gx - 42, iy - 126, 84.0, 34.0, 16.0, solid(Color.rgb(26, 20, 16), 0.72 * pulse))
                text.typeface = displayFace ?: textFace ?: Typeface.DEFAULT_BOLD
                text.textSize = max(18.0, h * 0.03).toFloat()
                text.color = color(0xFFF6EAD8.toInt(), pulse)
                c.drawText(label("TAP"), gx.toFloat(), (iy - 109).toFloat() - (text.ascent() + text.descent()) / 2, text)
            }
        }

        if (!s.bonus && !city) paintForeground(c, w, h, camX, max(dusk * 0.5, night))

        if (s.fever > 0) {
            c.drawRect((-ox).toFloat(), (-oy).toFloat(), (w - ox).toFloat(), (h - oy).toFloat(), solid(Color.rgb(255, 210, 40), 0.07 * s.fever))
            c.drawRect((-ox).toFloat(), (-oy).toFloat(), (w - ox).toFloat(), (h - oy).toFloat(), solid(Color.rgb(30, 90, 220), 0.05 * s.fever))
        }
        c.restore()
        if (fxp != null && city && !s.bonus && !reducedMotion) drawFlights(c, fxp, camX, ::sy, w, h)

        // warm key light from the sun side (colour grade)
        if (!s.bonus && !city) {
            val day = max(0.0, 1 - night * 1.1)
            softGlow(c, sunX, sunY, h * 1.1, if (dusk > 0.5) 0xFFFF9A5A.toInt() else 0xFFFFE8B0.toInt(), 0.16 * day)
        }
        if (clockAt >= 0) paintClockMoment(c, w, h, clock - clockAt, hx + ox, hy - heroH * 0.5 + oy)
        if (s.lightning > 0 && !s.bonus) {
            c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(230, 240, 255), s.lightning * (if (spr.art.ready && !s.classic) 0.18 else 0.42)))
            paintBolt(c, w, h, s.distance.toInt(), s.lightning)
        }
        if (s.flash > 0) {
            if (city) {
                c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(255, 72, 48), s.flash * 0.05))
                paintHitVignette(c, w, h, min(1.0, s.flash * 1.2))
            } else c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(255, 72, 48), s.flash * 0.32))
        }
        // beam glow: the whole frame warms while the boss fires
        if (city && s.bossBeam > 0 && !s.bonus) c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(0xFFFF7A3A.toInt(), 0.07 + 0.03 * sin(clock * 60)))
        if (city && !s.bonus) paintGrain(c, w, h, clock)
        paintVignette(c, w, h, if (city) 0.8 + night * 0.4 else 0.65)
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
    private val popXY = DoubleArray(POP_SLOTS * 3)

    private fun drawPops(c: Canvas, s: RunState, camX: Double, h: Double, clock: Double, sy: (Double) -> Double) {
        val base = max(22.0, h * 0.048)
        text.typeface = displayFace ?: textFace ?: Typeface.DEFAULT_BOLD
        outline.typeface = text.typeface
        var placed = 0
        for (pop in s.pops) {
            var py = sy(pop.y) - 34 // clear of the larger hero art
            // pops born on the same spot (NICE + "+1") stack instead of printing over each other
            val px = pop.x - camX
            val txt = label(pop.text)
            val half = txt.length * base * 0.34
            var guard = 0
            var k = 0
            while (k < placed && guard < 6) {
                if (abs(popXY[k * 3] - px) < popXY[k * 3 + 2] + half && abs(popXY[k * 3 + 1] - py) < base * 0.95) { py = popXY[k * 3 + 1] - base * 1.0; guard++; k = 0 } else k++
            }
            if (placed < POP_SLOTS) { popXY[placed * 3] = px; popXY[placed * 3 + 1] = py; popXY[placed * 3 + 2] = half; placed++ }
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
            c.drawText(txt, x, y + 2, outline)
            c.drawText(txt, x, y, outline)
            text.color = color(if (big) 0xFFFF9A2A.toInt() else 0xFFFFE34A.toInt(), a)
            c.drawText(txt, x, y, text)
            if (big) {
                text.color = color(0xFFFFF6C4.toInt(), a * 0.55)
                c.save(); c.clipRect(x - 400f, y + text.ascent(), x + 400f, y + text.ascent() * 0.55f)
                c.drawText(txt, x, y, text)
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
        /**
         * Hero body height in logical units (0.21.7: 106, was 136 = 20 % of the screen, much larger than
         * the sim's 62-unit hitbox drawn at ~92 units, so hits looked unfair and the robot crowded the roofs).
         */
        const val HERO_H = 106.0
        const val HERO_FRAC = 0.156
        /** 0.21.8: roofs wider than this are drawn as several facade blocks (world units). */
        const val LONG_ROOF = 900.0
        // palette slots
        private const val POP_SLOTS = 24
        private const val P_TOP = 0
        private const val P_MID = 1
        private const val P_HOR = 2
        private const val P_FAR = 3
        private const val P_FOG = 6
        private const val P_SUN = 7
        private const val P_RIM = 8
        private const val P_CLOUD = 9
        private const val P_LIT = 10
        private const val P_NEON = 11
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
