package net.solardepin.solarchik.game.run

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Painted solarpunk-city art for the run (assets/art):
 *  - three skyline layers (far / mid / near) as alpha masks plus window-light and neon masks,
 *    tinted per time of day by the renderer (Alto's-style atmospheric silhouettes);
 *  - three tileable building facades (+ lit-window masks) drawn with repeating shaders;
 *  - the parapet strip, rooftop props, solar modules (glass gradient-mapped per skin), the
 *    maintenance-drone boss, crack decal, sun-coin frames and stratus wisps (`city.webp` atlas).
 *
 * Everything is pre-scaled once per device scale ([prepare]); masks become ALPHA_8 bitmaps
 * that draw in the paint colour, so a time-of-day change never allocates. Mood colour filters
 * are cached per quantized mood.
 */
class RunArt(private val assets: AssetManager) {
    /** A pre-scaled bitmap and its size in world units. */
    class Img(val bmp: Bitmap, val w: Float, val h: Float)

    private class Entry(val rect: Rect, val lw: Float, val lh: Float)

    private val atlasSpec: Map<String, Entry> by lazy { readSpec() }
    private var scale = -1f
    private var skinKey: RunSkin? = null

    /** Skyline layers: [0] far, [1] mid, [2] near. Masks (ALPHA_8). */
    val layer = arrayOfNulls<Img>(3)
    val layerLit = arrayOfNulls<Img>(3)
    val layerNeon = arrayOfNulls<Img>(3)
    val facade = arrayOfNulls<Img>(3)
    val facadeShader = arrayOfNulls<BitmapShader>(3)
    val facadeLitShader = arrayOfNulls<BitmapShader>(3)
    var parapet: Img? = null; private set
    var parapetShader: BitmapShader? = null; private set
    var panel: Img? = null; private set
    var ac: Img? = null; private set
    var tank: Img? = null; private set
    var antenna: Img? = null; private set
    var vent: Img? = null; private set
    var planter: Img? = null; private set
    var boss: Img? = null; private set
    var crack: Img? = null; private set
    val coins = arrayOfNulls<Img>(8)
    val stratus = arrayOfNulls<Img>(2)
    /** Procedural masks: a soft radial glow, a vertical 0..1 ramp and film grain. */
    var glowMask: Bitmap? = null; private set
    var rampMask: Bitmap? = null; private set
    var grainShader: BitmapShader? = null; private set
    private var panelBase: Bitmap? = null
    private var panelGlass: Bitmap? = null

    val ready: Boolean get() = layer[0] != null && facadeShader[0] != null && panel != null && parapet != null
    /** Device pixels per world unit of the prepared set. */
    val pxPerUnit: Float get() = scale

    /** Pre-scale everything for [pxPerUnit] (device pixels per world unit) and [skin]. Cheap when unchanged. */
    fun prepare(pxPerUnit: Float, skin: RunSkin) {
        val k = (pxPerUnit * 20).roundToInt() / 20f // 5 % steps: no rebuild on tiny size changes
        if (k != scale) {
            scale = k
            try {
                loadLayers(k)
                loadAtlas(k)
                makeProcedural()
            } catch (_: Throwable) {
                layer[0] = null
            }
            skinKey = null
        }
        if (skin != skinKey) {
            skinKey = skin
            panel = buildPanel(skin)
        }
    }

    /** Shop swatches: the parapet, a facade and the skin's solar module at [pxPerUnit]. */
    fun roofKit(pxPerUnit: Float, skin: RunSkin): Img? {
        if (parapet == null || atlasScale != pxPerUnit) {
            atlasScale = pxPerUnit
            try { loadAtlas(pxPerUnit); facade[0] = tile("art/facade_a.webp", 128f, pxPerUnit) } catch (_: Throwable) { return null }
        }
        return buildPanel(skin)
    }
    private var atlasScale = -1f

    // ---- mood ----
    private val filterCache = HashMap<Int, ColorMatrixColorFilter>()

    /**
     * Colour grade for lit, near-field art (facades, rooftops, props, the hero's world):
     * golden hour warms, dusk goes rose and dim, night deep blue; storm desaturates.
     * [mood] is 0 golden … 1 dusk … 2 night. Cached per 1/12 step.
     */
    fun cityFilter(mood: Double, storm: Boolean): ColorMatrixColorFilter {
        val q = (mood * 12).roundToInt().coerceIn(0, 24)
        val key = q or (if (storm) 1 shl 8 else 0)
        return filterCache.getOrPut(key) {
            val m = q / 12f
            val d = m.coerceAtMost(1f)
            val n = (m - 1f).coerceAtLeast(0f)
            // golden-hour warmth fading into dusk rose and night blue
            var r = 1.04f - 0.16f * d - 0.5f * n
            var g = 0.96f - 0.26f * d - 0.38f * n
            var b = 0.88f - 0.18f * d - 0.12f * n
            val add = floatArrayOf(10f - 4f * d - 2f * n, 4f - 2f * d + 2f * n, 0f + 6f * d + 14f * n)
            if (storm) { r *= 0.8f; g *= 0.84f; b *= 0.92f }
            val cm = ColorMatrix(
                floatArrayOf(
                    r, 0f, 0f, 0f, add[0],
                    0f, g, 0f, 0f, add[1],
                    0f, 0f, b, 0f, add[2],
                    0f, 0f, 0f, 1f, 0f,
                ),
            )
            if (storm) cm.postConcat(ColorMatrix().apply { setSaturation(0.6f) }) else cm.postConcat(ColorMatrix().apply { setSaturation(0.9f) })
            ColorMatrixColorFilter(cm)
        }
    }

    // ---- loading ----
    private fun decode(path: String, sampleFor: Float): Bitmap? {
        val o = BitmapFactory.Options()
        o.inJustDecodeBounds = true
        assets.open(path).use { BitmapFactory.decodeStream(it, null, o) }
        o.inJustDecodeBounds = false
        var s = 1
        while (sampleFor > 0 && sampleFor * 2 <= 1f / s) s *= 2
        o.inSampleSize = s
        o.inPreferredConfig = Bitmap.Config.ARGB_8888
        return assets.open(path).use { BitmapFactory.decodeStream(it, null, o) }
    }

    private fun scaled(src: Bitmap, tw: Int, th: Int): Bitmap {
        if (src.width == tw && src.height == th) return src
        // big reductions in halving steps (bilinear alone aliases below 0.5x)
        var cur = src
        while (cur.width / 2 >= tw && cur.height / 2 >= th) {
            val nx = Bitmap.createScaledBitmap(cur, cur.width / 2, cur.height / 2, true)
            if (cur !== src) cur.recycle()
            cur = nx
        }
        val out = Bitmap.createScaledBitmap(cur, tw, th, true)
        if (cur !== src && cur !== out) cur.recycle()
        return out
    }

    private fun mask(b: Bitmap): Bitmap = b.extractAlpha().also { if (it !== b) b.recycle() }

    private fun maskLayer(path: String, lw: Float, k: Float): Img? {
        val src = decode(path, k * lw / 2560f) ?: return null
        val lh = lw * src.height.toFloat() / src.width
        val bmp = scaled(src, max(1, (lw * k).roundToInt()), max(1, (lh * k).roundToInt()))
        if (bmp !== src) src.recycle()
        return Img(mask(bmp), lw, lh)
    }

    private fun tile(path: String, lw: Float, k: Float, asMask: Boolean = false): Img? {
        val src = decode(path, 0f) ?: return null
        val lh = lw * src.height.toFloat() / src.width
        var bmp = scaled(src, max(1, (lw * k).roundToInt()), max(1, (lh * k).roundToInt()))
        if (bmp !== src) src.recycle()
        if (asMask) bmp = mask(bmp)
        return Img(bmp, lw, lh)
    }

    private fun loadLayers(k: Float) {
        val names = arrayOf("far", "mid", "near")
        for (i in 0 until 3) {
            layer[i] = maskLayer("art/city_${names[i]}.webp", LAYER_W, k)
            layerLit[i] = maskLayer("art/city_${names[i]}_lit.webp", LAYER_W, k)
            layerNeon[i] = maskLayer("art/city_${names[i]}_neon.webp", LAYER_W, k)
        }
        val fn = arrayOf("a", "b", "c")
        for (i in 0 until 3) {
            val f = tile("art/facade_${fn[i]}.webp", FACADE_W, k)
            facade[i] = f
            facadeShader[i] = f?.let { BitmapShader(it.bmp, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT) }
            val lit = tile("art/facade_${fn[i]}_lit.webp", FACADE_W, k, asMask = true)
            facadeLitShader[i] = lit?.let { BitmapShader(it.bmp, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT) }
        }
    }

    private fun readSpec(): Map<String, Entry> {
        val txt = assets.open("art/city.json").use { it.readBytes().toString(Charsets.UTF_8) }
        val o = JSONObject(txt)
        val out = HashMap<String, Entry>()
        for (name in o.keys()) {
            val a = o.getJSONArray(name)
            out[name] = Entry(Rect(a.getInt(0), a.getInt(1), a.getInt(0) + a.getInt(2), a.getInt(1) + a.getInt(3)), a.getDouble(4).toFloat(), a.getDouble(5).toFloat())
        }
        return out
    }

    private fun loadAtlas(k: Float) {
        val sheet = decode("art/city.webp", 0f) ?: return
        val spec = atlasSpec
        fun cut(name: String, asMask: Boolean = false): Img? {
            val e = spec[name] ?: return null
            val tw = max(1, (e.lw * k).roundToInt())
            val th = max(1, (e.lh * k).roundToInt())
            val piece = Bitmap.createBitmap(sheet, e.rect.left, e.rect.top, e.rect.width(), e.rect.height())
            var out = scaled(piece, tw, th)
            if (out !== piece) piece.recycle()
            if (asMask) out = mask(out)
            return Img(out, e.lw, e.lh)
        }
        for (i in 0 until 8) coins[i] = cut("coin_$i")
        for (i in 0 until 2) stratus[i] = cut("stratus_${i + 1}", asMask = true)
        val p = cut("parapet")
        parapet = p
        parapetShader = p?.let { BitmapShader(it.bmp, Shader.TileMode.REPEAT, Shader.TileMode.CLAMP) }
        panelBase = cut("panel")?.bmp
        panelGlass = cut("panel_glass")?.bmp
        ac = cut("ac"); tank = cut("tank"); antenna = cut("antenna"); vent = cut("vent"); planter = cut("planter")
        boss = cut("boss"); crack = cut("crack")
        sheet.recycle()
    }

    private fun makeProcedural() {
        if (glowMask == null) {
            val n = 128
            val px = IntArray(n * n)
            for (y in 0 until n) for (x in 0 until n) {
                val dx = (x - n / 2 + 0.5f) / (n / 2f)
                val dy = (y - n / 2 + 0.5f) / (n / 2f)
                val d = sqrt(dx * dx + dy * dy)
                val a = if (d >= 1f) 0f else exp(-d * d * 4.2f) * (1f - d)
                px[y * n + x] = ((a * 255).roundToInt().coerceIn(0, 255) shl 24) or 0xFFFFFF
            }
            glowMask = mask(Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888))
            val ramp = IntArray(256) { ((it * 255 / 255) shl 24) or 0xFFFFFF }
            rampMask = mask(Bitmap.createBitmap(ramp, 1, 256, Bitmap.Config.ARGB_8888))
            val g = 160
            val rnd = java.util.Random(7)
            val gp = IntArray(g * g) { (rnd.nextInt(256) shl 24) or 0xFFFFFF }
            grainShader = BitmapShader(mask(Bitmap.createBitmap(gp, g, g, Bitmap.Config.ARGB_8888)), Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
        }
    }

    private val cutPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    /** Panel base + glass gradient-mapped (luminance → skin deep / cell / highlight). */
    private fun buildPanel(skin: RunSkin): Img? {
        val base = panelBase ?: return null
        val glass = panelGlass ?: return Img(base, 56f, 34f)
        val out = base.copy(Bitmap.Config.ARGB_8888, true)
        val flag = skin == RunSkin.FLAG
        val cell = if (flag) 0xFF3A6FA8.toInt() else skin.cell
        val deep = if (flag) 0xFF1C3A68.toInt() else skin.deep
        val hi = mixRgb(if (flag) 0xFFB8D8F0.toInt() else skin.hi, 0xFFFFFFFF.toInt(), 0.25f)
        val lo = mixRgb(deep, 0xFF0A1020.toInt(), 0.45f)
        val px = IntArray(glass.width * glass.height)
        glass.getPixels(px, 0, glass.width, 0, 0, glass.width, glass.height)
        for (i in px.indices) {
            val c = px[i]
            val a = c ushr 24
            if (a == 0) continue
            val l = ((c shr 16) and 0xFF) / 255f
            val rgb = if (l < 0.3f) mixRgb(lo, deep, l / 0.3f) else if (l < 0.7f) mixRgb(deep, cell, (l - 0.3f) / 0.4f) else mixRgb(cell, hi, (l - 0.7f) / 0.3f)
            px[i] = (a shl 24) or (rgb and 0xFFFFFF)
        }
        val tinted = Bitmap.createBitmap(px, glass.width, glass.height, Bitmap.Config.ARGB_8888)
        Canvas(out).drawBitmap(tinted, 0f, 0f, cutPaint)
        tinted.recycle()
        return Img(out, 56f, 34f)
    }

    private fun mixRgb(a: Int, b: Int, t: Float): Int {
        val u = t.coerceIn(0f, 1f)
        fun ch(sh: Int) = (((a shr sh) and 0xFF) * (1 - u) + ((b shr sh) and 0xFF) * u).roundToInt()
        return (0xFF shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    companion object {
        /** Width of one tile of every skyline layer, in world units. */
        const val LAYER_W = 1280f
        /** Facade tile size in world units. */
        const val FACADE_W = 128f
        /** The parapet's walk line sits this far below its top. */
        const val ROOF_TOP = 4f
    }
}
