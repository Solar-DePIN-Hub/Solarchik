package net.solardepin.solarchik.game.run

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
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

    /** World units per screen height. */
    var logicalH = LOGICAL_H
    /** Ghost tape from an earlier day (world units), drawn as a faded robot. */
    var ghost: List<GhostSample> = emptyList()

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
    private val rect = RectF()
    private val path = Path()
    private var alpha = 1f

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
        shadow: Boolean = false,
    ): Boolean {
        if (img == null || img.width <= 0 || img.height <= 0) return false
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
        path.reset()
        ovalPath(x, y, 38 * s, 16 * s)
        ovalPath(x - 22 * s, y + 4 * s, 22 * s, 12 * s)
        ovalPath(x + 24 * s, y + 3 * s, 20 * s, 11 * s)
        c.drawPath(path, solid(0xFFFFFDF8.toInt(), a))
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
        c.drawRect((x - 3).toFloat(), (y - 18).toFloat(), (x + 2).toFloat(), (y + 4).toFloat(), solid(0xFF3A2A22.toInt()))
        c.drawRect((x + w - 2).toFloat(), (y - 18).toFloat(), (x + w + 3).toFloat(), (y + 4).toFloat(), solid(0xFF3A2A22.toInt()))
    }

    private fun drawPlat(c: Canvas, x: Double, y: Double, w: Double, thick: Double, t: Double, glow: Double, skin: RunSkin, kind: PlatKind, live: Boolean) {
        if (kind == PlatKind.WIRE) {
            drawWire(c, x, y, w, t, live)
            return
        }
        val flag = skin == RunSkin.FLAG
        val lip = if (flag) 0xFFF0C14D.toInt() else skin.lip
        val cell = if (flag) 0xFF6AAFD8.toInt() else skin.cell
        val deep = if (flag) 0xFF3E86C4.toInt() else skin.deep
        val hh = max(48.0, thick * 2.7)
        val r = hh * 0.48
        roundRect(c, x + 4, y + 8, w, hh, r, solid(Color.rgb(40, 70, 40), 0.16))
        roundRect(c, x - 4, y - 5, w + 8, hh + 10, r + 3, solid(0xFF3A2C22.toInt()))
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        fill.shader = LinearGradient(0f, y.toFloat(), 0f, (y + hh).toFloat(), color(cell), color(deep), Shader.TileMode.CLAMP)
        fill.color = Color.argb(a255(1.0), 255, 255, 255)
        roundRect(c, x, y - 1, w, hh, r, fill)
        fill.shader = null
        roundRect(c, x, y - 1, w, hh * 0.4, r, solid(lip))
        c.drawRect((x + 5).toFloat(), (y + hh * 0.26).toFloat(), (x + w - 5).toFloat(), (y + hh * 0.38).toFloat(), solid(cell))
        roundRect(c, x + 16, y + 4, min(72.0, w * 0.24), max(5.0, hh * 0.1), 6.0, solid(Color.WHITE, 0.55))
        stroke.color = rgba(255, 255, 255, 0.28)
        stroke.strokeWidth = 2f
        stroke.strokeCap = Paint.Cap.ROUND
        val seams = max(1, floor(w / 120).toInt())
        for (i in 1 until seams) {
            val sx = (x + (w * i) / seams).toFloat()
            c.drawLine(sx, (y + hh * 0.42).toFloat(), sx, (y + hh * 0.72).toFloat(), stroke)
        }
        if (glow > 0) roundRect(c, x - 2, y - 8, w + 4, 14.0, 6.0, solid(skin.hi, 0.12 * glow))
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
        val r = if (gold) 14.0 else 12.0
        circle(c, 0.0, 0.0, r, solid(0xFF1C140E.toInt()))
        c.rotate(Math.toDegrees(sin(t * 1.6 + x) * 0.15).toFloat())
        fill.color = Color.BLACK // shader alpha is multiplied by the paint alpha
        fill.shader = RadialGradient((-r * 0.2).toFloat(), (-r * 0.2).toFloat(), (r * 1.05).toFloat(),
            intArrayOf(color(0xFFFFF6C4.toInt()), color(if (gold) 0xFFFFC44A.toInt() else 0xFFF0A24A.toInt()), color(0xFFD47A28.toInt())),
            floatArrayOf(0.05f, 0.55f, 1f), Shader.TileMode.CLAMP)
        circle(c, 0.0, 0.0, r * 0.72, fill)
        fill.shader = null
        c.restore()
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
        stroke.strokeWidth = 18f
        stroke.strokeCap = Paint.Cap.ROUND
        stroke.strokeJoin = Paint.Join.ROUND
        for (k in 0 until 2) {
            stroke.color = if (k == 0) rgba(40, 120, 255, 0.55 * a * 0.45) else rgba(255, 210, 40, 0.4 * a * 0.45)
            path.reset()
            var x = -20.0
            while (x <= w + 20) {
                val y = h * (0.16 + k * 0.08) + sin(x * 0.008 + t * 0.35 + k) * 22
                if (x == -20.0) path.moveTo(x.toFloat(), y.toFloat()) else path.lineTo(x.toFloat(), y.toFloat())
                x += 16
            }
            c.drawPath(path, stroke)
        }
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

    private fun drawHero(c: Canvas, feetX: Double, feetY: Double, size: Double, phase: Double, grounded: Boolean, squash: Double, stretch: Double, vy: Double, rot: Double, a: Double, shadow: Boolean) {
        val frame = spr.heroFrame(grounded, vy, phase, squash)
        if (!blit(c, frame, feetX, feetY, size, squash, stretch, a = a, rot = rot, shadow = shadow)) {
            circle(c, feetX, feetY - size / 2, size / 3, solid(0xFF7AD1FF.toInt(), a))
        }
    }

    /**
     * One frame. [wPx]/[hPx] is the surface; [clock] the wall clock in seconds (animation phase).
     * The world is drawn in logical units; the HUD lives in Android views on top (like the DOM HUD).
     */
    fun draw(c: Canvas, wPx: Int, hPx: Int, s: RunState, clock: Double, skin: RunSkin = RunSkin.FLAG) {
        val k = hPx / logicalH
        c.save()
        c.scale(k.toFloat(), k.toFloat())
        drawWorld(c, wPx / k, logicalH, s, clock, skin)
        c.restore()
    }

    private fun drawWorld(c: Canvas, w: Double, h: Double, s: RunState, clock: Double, skin: RunSkin) {
        alpha = 1f
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

        val heroH = min(h * 0.125, 84.0)
        val hillTop = h * 0.87
        val playTop = h * 0.52
        val playBot = hillTop - 14
        fun sy(wy: Double) = playTop + ((wy - 140) / 150) * (playBot - playTop)

        val spd = RunSim.speedAt(s)
        val look = spd * 0.18
        val camX = s.x - w * 0.27 + look

        if (!s.bonus) {
            if (night > 0.35) circle(c, w * 0.14, h * 0.12, 11.0, solid(Color.rgb(230, 236, 255), min(0.85, night * 0.7)))
            puffCloud(c, ((-camX * 0.08) % (w + 260)) + 40, h * 0.14, 1.85, 0.9 - night * 0.35)
            puffCloud(c, ((-camX * 0.12 + 420) % (w + 300)) + 20, h * 0.28, 1.35, 0.75 - night * 0.25)
            puffCloud(c, ((-camX * 0.07 + 880) % (w + 240)) + 10, h * 0.1, 1.6, 0.85 - night * 0.3)
            alpha = max(0.0, 1 - night * 1.1).toFloat()
            if (alpha > 0) paintSun(c, w * 0.84, h * (0.13 + dusk * 0.06), min(h * 0.075, 58.0), clock)
            alpha = 1f

            c.drawPath(hillPath(w, h, h * 0.64, h * 0.03, camX * 0.1, 0.005, 0.4), fill.also { it.shader = null; it.color = rgb(mix3(d(155, 184, 178), d(40, 55, 90), max(dusk, night))) })
            c.drawPath(hillPath(w, h, h * 0.72, h * 0.038, camX * 0.28, 0.008, 1.1), fill.also { it.color = rgb(mix3(d(118, 196, 78), d(32, 58, 70), max(dusk * 0.7, night))) })
            c.drawPath(hillPath(w, h, h * 0.86, h * 0.028, camX * 0.48, 0.011, 2.2), fill.also { it.color = rgb(mix3(d(72, 168, 64), d(24, 48, 52), max(dusk * 0.6, night))) })

            val housePar = camX * 0.32
            val polePar = camX * 0.4
            val px = DoubleArray(4)
            for (i in 0 until 4) {
                px[i] = ((i * 360 - polePar) % (w + 280) + w + 280) % (w + 280) - 20
                pole(c, px[i], h - 8, 26.0)
            }
            stroke.color = rgba(42, 30, 22, 0.28)
            stroke.strokeWidth = 1f
            for (i in 0 until 3) {
                val ax = px[i]
                val bx = px[i + 1]
                if (bx - ax > 320) continue
                path.reset()
                path.moveTo(ax.toFloat(), (h - 8 - 26).toFloat())
                path.quadTo(((ax + bx) / 2).toFloat(), (h - 8 - 38).toFloat(), bx.toFloat(), (h - 8 - 26).toFloat())
                c.drawPath(path, stroke)
            }
            val houses = arrayOf(spr.cottage, spr.greenhouse)
            for (i in houses.indices) {
                val span = w + 520
                val hx = ((i * 640 - housePar) % span + span) % span - 40
                val feet = h - 4
                oval(c, hx, feet - 1, 16.0, 3.5, solid(Color.rgb(18, 28, 14), 0.2))
                if (!blit(c, houses[i], hx, feet, 42.0)) cottageFallback(c, hx, feet, 0.24, i == 0)
            }
            for (i in 0 until 4) {
                val span = w + 200
                val gx = ((i * 280 - housePar * 1.15 + 120) % span + span) % span - 20
                drawGroundPanel(c, gx, h - 2, 0.72)
            }
        } else {
            puffCloud(c, ((-camX * 0.16) % (w + 260)) + 40, h * 0.18, 1.35, 0.7)
            puffCloud(c, ((-camX * 0.22 + 420) % (w + 300)) + 20, h * 0.32, 1.05, 0.55)
            puffCloud(c, ((-camX * 0.12 + 880) % (w + 240)) + 10, h * 0.12, 1.2, 0.62)
            puffCloud(c, ((-camX * 0.19 + 180) % (w + 280)) + 30, h * 0.46, 0.9, 0.4)
        }

        paintMotes(c, w, h, clock)
        if (storming && !reducedMotion) paintRain(c, w, h, clock)

        val thick = max(16.0, h * 0.028)
        if (!s.bonus) {
            for (p in s.plats) {
                val x = p.x - camX
                if (x + p.w < -40 || x > w + 40) continue
                val live = s.grind && s.grounded && s.x >= p.x - 12 && s.x <= p.x + p.w + 12 && p.kind == PlatKind.WIRE
                drawPlat(c, x, sy(p.y), p.w, thick, clock, s.fever + night * 0.45, skin, p.kind, live)
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
                    if (!blit(c, spr.mite, x, feet, 44.0, squash = max(0.0, -step) * 0.7, stretch = max(0.0, step) * 0.35, flip = dir > 0, rot = dir * 0.14)) {
                        oval(c, x, feet - 12, 16.0, 10.0, solid(0xFF8A4A28.toInt()))
                    }
                }
                EnemyKind.DRONE -> {
                    val size = if (e.boss) 74.0 else 62.0
                    if (!blit(c, spr.drone, x, ey, size)) oval(c, x, ey - 20, if (e.boss) 26.0 else 22.0, 16.0, solid(if (e.boss) 0xFF2A88C8.toInt() else 0xFF3D6A6A.toInt()))
                    if (e.boss) circle(c, x, ey - 18, 16.0, solid(Color.rgb(255, 227, 74), 0.35))
                }
            }
        }

        for (pick in s.picks) {
            if (pick.taken) continue
            val x = pick.x - camX
            if (x < -30 || x > w + 30) continue
            drawPickup(c, x, sy(pick.y), pick.gold, pick.shield, clock, pick.portal)
        }

        for (p in s.particles) {
            val a = max(0.0, p.life / 0.5)
            if (p.ring) {
                stroke.color = color(p.color, a); stroke.strokeWidth = 2.2f
                circle(c, p.x - camX, sy(p.y), p.r, stroke)
            } else if (p.streak) {
                stroke.color = color(p.color, a); stroke.strokeWidth = 5f; stroke.strokeCap = Paint.Cap.ROUND
                c.drawLine((p.x - camX + 8).toFloat(), sy(p.y).toFloat(), (p.x - camX - 46).toFloat(), sy(p.y).toFloat(), stroke)
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

        // native extra: yesterday's ghost robot (the web keeps a tape but never draws it)
        drawGhost(c, s, camX, w, heroH, ::sy, clock)

        val blink = s.invuln > 0 && floor(clock * 16).toInt() % 2 == 0
        if (!blink || s.phase == Phase.COUNTDOWN) {
            val hx = s.x - camX
            val hy = sy(s.y) - 6
            val sliding = s.slide > 0 && s.grounded
            val rot = if (s.bonus) max(-0.5, min(0.55, s.vy / 860)) else 0.0
            val charged = s.fever > 0 || s.combo >= 4 || s.grind
            val squash = if (sliding) max(s.squash, 0.92) else s.squash
            val stretch = if (sliding) 0.0 else s.stretch
            oval(c, hx, hy + 3, heroH * 0.22, 6.0, solid(Color.rgb(22, 14, 10), 0.28))
            heroGlow(c, hx, hy, heroH, charged)
            drawHero(c, hx, hy, heroH * if (sliding) 0.78 else 1.0, s.runPhase, s.grounded, squash, stretch, s.vy, rot, 1.0, shadow = true)
        }

        text.typeface = textFace ?: Typeface.DEFAULT_BOLD
        text.textSize = max(16.0, h * 0.028).toFloat()
        val mid = (text.ascent() + text.descent()) / 2
        for (pop in s.pops) {
            val py = sy(pop.y)
            if (py < 78 || py > h - 24) continue
            val a = min(1.0, pop.life * 2)
            text.color = color(0xFF143A8C.toInt(), a)
            c.drawText(pop.text, (pop.x - camX + 1).toFloat(), (py + 1).toFloat() - mid, text)
            text.color = color(0xFFFFE34A.toInt(), a)
            c.drawText(pop.text, (pop.x - camX).toFloat(), py.toFloat() - mid, text)
        }

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

        if (s.fever > 0) {
            c.drawRect((-ox).toFloat(), (-oy).toFloat(), (w - ox).toFloat(), (h - oy).toFloat(), solid(Color.rgb(255, 210, 40), 0.07 * s.fever))
            c.drawRect((-ox).toFloat(), (-oy).toFloat(), (w - ox).toFloat(), (h - oy).toFloat(), solid(Color.rgb(30, 90, 220), 0.05 * s.fever))
        }
        c.restore()

        if (s.lightning > 0 && !s.bonus) {
            c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(230, 240, 255), s.lightning * 0.42))
            paintBolt(c, w, h, s.distance.toInt(), s.lightning)
        }
        if (s.flash > 0) c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(255, 72, 48), s.flash * 0.32))
        paintVignette(c, w, h)
        if (s.hearts == 1 && s.phase == Phase.RUNNING) c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), solid(Color.rgb(8, 16, 28), 0.18))
    }

    private fun drawGhost(c: Canvas, s: RunState, camX: Double, w: Double, heroH: Double, sy: (Double) -> Double, clock: Double) {
        if (ghost.size < 2 || s.bonus || s.phase == Phase.COUNTDOWN) return
        val f = s.runTime / RunSim.GHOST_DT
        val i = f.toInt()
        if (i >= ghost.size - 1) return
        val g0 = ghost[i]
        val g1 = ghost[i + 1]
        val u = f - i
        val gx = g0.x + (g1.x - g0.x) * u
        val gy = g0.y + (g1.y - g0.y) * u
        val x = gx - camX
        if (x < -60 || x > w + 60) return
        drawHero(c, x, sy(gy) - 6, heroH, clock * 9, g0.grounded, 0.0, 0.0, (g1.y - g0.y) / RunSim.GHOST_DT, 0.0, 0.32, shadow = false)
    }

    companion object {
        /** World units per screen height (the desktop browser frame in the reference shot). */
        const val LOGICAL_H = 680.0
    }
}

/** Web skins.ts palette (cell, deep, lip, hi). FLAG is the default run skin. */
enum class RunSkin(val cell: Int, val deep: Int, val lip: Int, val hi: Int) {
    FLAG(0xFF1557C4.toInt(), 0xFF0E3FA0.toInt(), 0xFFFFE34A.toInt(), 0xFFFFF6A8.toInt()),
    GOLD(0xFFE8B931.toInt(), 0xFFC49218.toInt(), 0xFFFFF4B0.toInt(), 0xFFFFFDF0.toInt()),
    MOSS(0xFF2F6A32.toInt(), 0xFF1D4520.toInt(), 0xFFB7E07A.toInt(), 0xFFE8F7C8.toInt()),
    FROST(0xFF6EC4D4.toInt(), 0xFF2F7A8C.toInt(), 0xFFE8FBFF.toInt(), 0xFFFFFFFF.toInt()),
    STORM(0xFF1A3A6A.toInt(), 0xFF0D2448.toInt(), 0xFF7EC8FF.toInt(), 0xFFD6F0FF.toInt()),
    NIGHT(0xFF1B1650.toInt(), 0xFF0E0A32.toInt(), 0xFFC9A6FF.toInt(), 0xFFF0E6FF.toInt()),
}
