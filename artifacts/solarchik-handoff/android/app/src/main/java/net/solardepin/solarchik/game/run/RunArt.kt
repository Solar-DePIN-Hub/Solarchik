package net.solardepin.solarchik.game.run

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Painted raster art for the run (assets/art): four tileable parallax layers, the rooftop
 * kit (caps + one solar module with a separate glass layer), sun-coin spin frames, clouds
 * and the sun, packed in `props.webp` + `props.json` (rect + logical size per entry).
 *
 * Everything is pre-scaled once to the device scale ([prepare] with world units → pixels), so
 * a frame only blits 1:1 bitmaps. Roof glass is gradient-mapped to the equipped skin once per
 * skin. Mood tints (dusk / night / storm) are cached colour filters, rebuilt only when the
 * quantized mood changes. Nothing here allocates per frame.
 */
class RunArt(private val assets: AssetManager) {
    /** A pre-scaled bitmap and its size in world units. */
    class Img(val bmp: Bitmap, val w: Float, val h: Float)

    private class Entry(val rect: Rect, val lw: Float, val lh: Float)

    private val atlasSpec: Map<String, Entry> by lazy { readSpec() }
    private var scale = -1f
    private var skinKey: RunSkin? = null

    var far: Img? = null; private set
    var mid: Img? = null; private set
    var midLights: Img? = null; private set
    var near: Img? = null; private set
    var fg: Img? = null; private set
    var sun: Img? = null; private set
    val clouds = arrayOfNulls<Img>(3)
    val coins = arrayOfNulls<Img>(8)
    var roofLeft: Img? = null; private set
    var roofRight: Img? = null; private set
    /** Roof module with the glass already mapped to [skinKey]. */
    var roofMid: Img? = null; private set
    private var roofMidBase: Bitmap? = null
    private var roofGlass: Bitmap? = null

    val ready: Boolean get() = far != null && roofMid != null

    /** Pre-scale everything for [pxPerUnit] (device pixels per world unit) and [skin]. Cheap when unchanged. */
    fun prepare(pxPerUnit: Float, skin: RunSkin) {
        val k = (pxPerUnit * 20).roundToInt() / 20f // 5 % steps: no rebuild on tiny size changes
        if (k != scale) {
            scale = k
            try {
                loadLayers(k)
                loadProps(k)
            } catch (_: Throwable) {
                far = null
            }
            skinKey = null
        }
        if (skin != skinKey) {
            skinKey = skin
            roofMid = buildRoof(skin)
        }
    }

    /** Rooftop kit only (shop swatches): no parallax layers. Returns the module mapped to [skin]. */
    fun roofKit(pxPerUnit: Float, skin: RunSkin): Img? {
        if (roofLeft == null || propsScale != pxPerUnit) {
            propsScale = pxPerUnit
            try { loadProps(pxPerUnit) } catch (_: Throwable) { return null }
        }
        return buildRoof(skin)
    }
    private var propsScale = -1f

    // ---- mood tint ----
    private val filterCache = HashMap<Int, ColorMatrixColorFilter>()

    /**
     * Colour filter for a layer at [depth] (0 near … 1 far) under the current mood:
     * dusk warms and darkens, night goes deep blue, storm desaturates; far layers also sink
     * into the sky haze. Null in plain daylight on near layers.
     */
    fun moodFilter(dusk: Double, night: Double, storm: Boolean, depth: Double): ColorMatrixColorFilter? {
        val qd = (dusk * 8).roundToInt()
        val qn = (night * 8).roundToInt()
        val qz = (depth * 4).roundToInt()
        if (qd == 0 && qn == 0 && !storm) return null
        val key = qd or (qn shl 4) or (qz shl 8) or (if (storm) 1 shl 12 else 0)
        return filterCache.getOrPut(key) {
            val d = qd / 8f
            val n = qn / 8f
            val z = qz / 4f
            // multiply
            var r = 1f - 0.04f * d
            var g = 1f - 0.22f * d
            var b = 1f - 0.3f * d
            r *= 1f - 0.68f * n
            g *= 1f - 0.6f * n
            b *= 1f - 0.4f * n
            // haze towards the sky colour for far layers
            val haze = z * (0.18f * d + 0.32f * n)
            val hr = 210f * (1 - n) * (1 - d) + 200f * d * (1 - n) + 40f * n
            val hg = 230f * (1 - n) * (1 - d) + 120f * d * (1 - n) + 52f * n
            val hb = 245f * (1 - n) * (1 - d) + 110f * d * (1 - n) + 100f * n
            val cm = ColorMatrix(
                floatArrayOf(
                    r * (1 - haze), 0f, 0f, 0f, hr * haze + 6f * n,
                    0f, g * (1 - haze), 0f, 0f, hg * haze + 8f * n,
                    0f, 0f, b * (1 - haze), 0f, hb * haze + 18f * n,
                    0f, 0f, 0f, 1f, 0f,
                ),
            )
            if (storm) cm.postConcat(ColorMatrix().apply { setSaturation(0.55f) })
            ColorMatrixColorFilter(cm)
        }
    }

    // ---- loading ----
    private fun decode(path: String, sampleFor: Float): Bitmap? {
        val o = BitmapFactory.Options()
        o.inJustDecodeBounds = true
        assets.open(path).use { BitmapFactory.decodeStream(it, null, o) }
        o.inJustDecodeBounds = false
        // sources are authored at 2-3 px per unit: subsample when the screen needs far less
        var s = 1
        while (sampleFor > 0 && sampleFor * 2 <= 1f / s) s *= 2
        o.inSampleSize = s
        o.inPreferredConfig = Bitmap.Config.ARGB_8888
        return assets.open(path).use { BitmapFactory.decodeStream(it, null, o) }
    }

    private fun layer(path: String, lw: Float, k: Float): Img? {
        val src = decode(path, k * lw / 2560f) ?: return null
        val tw = max(1, (lw * k).roundToInt())
        val th = max(1, (lw * k * src.height / src.width).roundToInt())
        val bmp = if (src.width == tw && src.height == th) src else Bitmap.createScaledBitmap(src, tw, th, true).also { if (it !== src) src.recycle() }
        return Img(bmp, lw, lw * src.height.toFloat() / src.width)
    }

    private fun loadLayers(k: Float) {
        far = layer("art/bg_far.webp", LAYER_W, k)
        mid = layer("art/bg_mid.webp", LAYER_W, k)
        midLights = layer("art/bg_mid_lights.webp", LAYER_W, k)
        near = layer("art/bg_near.webp", LAYER_W, k)
        fg = layer("art/bg_fg.webp", LAYER_W, k)
    }

    private fun readSpec(): Map<String, Entry> {
        val txt = assets.open("art/props.json").use { it.readBytes().toString(Charsets.UTF_8) }
        val o = JSONObject(txt)
        val out = HashMap<String, Entry>()
        for (name in o.keys()) {
            val a = o.getJSONArray(name)
            out[name] = Entry(Rect(a.getInt(0), a.getInt(1), a.getInt(0) + a.getInt(2), a.getInt(1) + a.getInt(3)), a.getDouble(4).toFloat(), a.getDouble(5).toFloat())
        }
        return out
    }

    private fun loadProps(k: Float) {
        val sheet = decode("art/props.webp", 0f) ?: return
        val spec = atlasSpec
        fun cut(name: String): Img? {
            val e = spec[name] ?: return null
            val tw = max(1, (e.lw * k).roundToInt())
            val th = max(1, (e.lh * k).roundToInt())
            val out = Bitmap.createBitmap(tw, th, Bitmap.Config.ARGB_8888)
            Canvas(out).drawBitmap(sheet, e.rect, Rect(0, 0, tw, th), cutPaint)
            return Img(out, e.lw, e.lh)
        }
        for (i in 0 until 8) coins[i] = cut("coin_$i")
        for (i in 0 until 3) clouds[i] = cut("cloud_${i + 1}")
        sun = cut("sun")
        roofLeft = cut("roof_left")
        roofRight = cut("roof_right")
        roofMidBase = cut("roof_mid")?.bmp
        roofGlass = cut("roof_mid_glass")?.bmp
        sheet.recycle()
    }

    private val cutPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    /** Base module + glass gradient-mapped (luminance → skin deep / cell / highlight). */
    private fun buildRoof(skin: RunSkin): Img? {
        val base = roofMidBase ?: return null
        val glass = roofGlass ?: return Img(base, 64f, 80f)
        val out = base.copy(Bitmap.Config.ARGB_8888, true)
        val flag = skin == RunSkin.FLAG
        val cell = if (flag) 0xFF5AA6E0.toInt() else skin.cell
        val deep = if (flag) 0xFF2A5FA8.toInt() else skin.deep
        val hi = mixRgb(if (flag) 0xFFCFEFFF.toInt() else skin.hi, 0xFFFFFFFF.toInt(), 0.35f)
        val lo = mixRgb(deep, 0xFF0A1020.toInt(), 0.35f)
        val px = IntArray(glass.width * glass.height)
        glass.getPixels(px, 0, glass.width, 0, 0, glass.width, glass.height)
        for (i in px.indices) {
            val c = px[i]
            val a = c ushr 24
            if (a == 0) continue
            val l = ((c shr 16) and 0xFF) / 255f
            val rgb = if (l < 0.45f) mixRgb(lo, deep, l / 0.45f) else if (l < 0.75f) mixRgb(deep, cell, (l - 0.45f) / 0.3f) else mixRgb(cell, hi, (l - 0.75f) / 0.25f)
            px[i] = (a shl 24) or (rgb and 0xFFFFFF)
        }
        val tinted = Bitmap.createBitmap(px, glass.width, glass.height, Bitmap.Config.ARGB_8888)
        Canvas(out).drawBitmap(tinted, 0f, 0f, cutPaint)
        tinted.recycle()
        return Img(out, 64f, 80f)
    }

    private fun mixRgb(a: Int, b: Int, t: Float): Int {
        val u = t.coerceIn(0f, 1f)
        fun ch(sh: Int) = (((a shr sh) and 0xFF) * (1 - u) + ((b shr sh) and 0xFF) * u).roundToInt()
        return (0xFF shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    companion object {
        /** Width of one tile of every parallax layer, in world units. */
        const val LAYER_W = 1280f
        /** Rooftop art: the walk surface sits this far below the bitmap top. */
        const val ROOF_TOP = 6f
    }
}
