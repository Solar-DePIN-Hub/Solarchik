package net.solardepin.solarchik

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.BitmapFactory
import android.view.View
import androidx.core.content.res.ResourcesCompat
import net.solardepin.solarchik.game.RunHud
import net.solardepin.solarchik.game.RunOverlay
import androidx.test.core.app.ApplicationProvider
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunRenderer
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunSprites
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Diagnostic: one live renderer drawing a long run at tablet size (SM-X210) past 2300 m. -Prunlong=DIR */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w1280dp-h800dp-land-hdpi")
class RunLongRenderTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()

    /**
     * 0.21.8 (owner: "past ~1500 m the background turns into a blue grid with black dots" on the
     * SM-X210 tablet): one live renderer through night, the storm roll-in (1560 m) and the second
     * drone arena (2000 m) at tablet size; every ALPHA_8 mask is word aligned, frames stay drawn.
     */
    @Test fun tabletLongRunRendersAndMasksAligned() {
        val dm = ctx.resources.displayMetrics
        val w = dm.widthPixels; val h = dm.heightPixels
        val sprites = RunSprites(ctx.assets)
        val r = RunRenderer(sprites, ResourcesCompat.getFont(ctx, R.font.nunito_bold), ResourcesCompat.getFont(ctx, R.font.fredoka_semibold))
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val s = RunSim.create(RunSim.daySeed("2026-10-02"), goalMeters = 99_999)
        val out = File(System.getProperty("solarchik.runshots") ?: "build/screens-run").apply { mkdirs() }
        var next = 13_000.0
        var n = 0
        var shots = 0
        while (s.distance < 22_500 && n++ < 60 * 1500 && s.phase != Phase.DEAD) {
            RunSim.step(s, RunSim.TICK, Autopilot.input(s))
            if (s.distance < next) continue
            next += 500
            r.draw(c, w, h, s, 100.0 + n / 60.0)
            // the frame is a real picture (not blank / one flat colour)
            val px = IntArray(64) { bmp.getPixel((it % 8) * (w / 8) + 5, (it / 8) * (h / 8) + 5) }
            assertTrue("frame at ${s.meters} m is flat", px.toSet().size > 8)
            if (shots < 3 && s.distance > 15_800) { shots++; File(out, "60-tablet-storm-$shots.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        }
        assertTrue("reached the storm line: ${s.meters} m", s.distance > 16_500)
        val art = sprites.art
        val masks = (art.layer + art.layerLit + art.layerNeon + art.layerLitGlow + art.layerNeonGlow + art.stratus).filterNotNull()
        assertTrue(masks.isNotEmpty())
        for (m in masks) {
            assertEquals(Bitmap.Config.ALPHA_8, m.bmp.config)
            assertEquals("mask width ${m.bmp.width} is word aligned", 0, m.bmp.width % 4)
        }
    }

    private fun overlay(): RunOverlay = RunOverlay(ctx, object : RunOverlay.Actions {
        override fun pauseToggle() {}; override fun resume() {}; override fun yard() {}; override fun again() {}
        override fun sign() {}; override fun signBadge() {}; override fun share() {}; override fun yardSign() {}
        override fun musicToggle() {}; override fun mic() {}; override fun slideDown() {}; override fun slideUp() {}
    }).also {
        it.buddy.setImageBitmap(ctx.assets.open("sprites/pet/buddy-talk-3.png").use { s -> BitmapFactory.decodeStream(s) })
        it.setMuted(false); it.setMicAvailable(true); it.animations = false
    }

    /** The CLOCK IN moment (1200 m, inside the drone arena) at tablet size, with Sol's caption up. */
    @Test fun tabletClockMoment() {
        val dm = ctx.resources.displayMetrics
        val w = dm.widthPixels; val h = dm.heightPixels
        val r = RunRenderer(RunSprites(ctx.assets), ResourcesCompat.getFont(ctx, R.font.nunito_bold), ResourcesCompat.getFont(ctx, R.font.fredoka_semibold))
            .also { it.labels = net.solardepin.solarchik.game.runLabels(ctx) }
        val out = File(System.getProperty("solarchik.runshots") ?: "build/screens-run").apply { mkdirs() }
        val s = RunSim.create(RunSim.daySeed("2026-10-02"))
        var n = 0
        while (!s.clockOpen && n++ < 60 * 300) RunSim.step(s, RunSim.TICK, Autopilot.input(s))
        assertTrue(s.clockOpen)
        repeat(30) { RunSim.step(s, RunSim.TICK, Autopilot.input(s)) }
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        r.draw(c, w, h, s, 99.0); r.draw(c, w, h, s, 100.0)
        val o = overlay()
        o.bind(RunHud.of(s))
        o.setClock(RunOverlay.ClockUi(open = true, wallet = true))
        o.celebrateClock()
        o.setCaption(ctx.getString(R.string.run_clock_unlocked))
        o.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        o.layout(0, 0, w, h)
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        o.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        o.layout(0, 0, w, h)
        o.draw(c)
        File(out, "61-tablet-clock-in.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun longRunTablet() {
        val dir = System.getProperty("solarchik.runlong") ?: ""
        assumeTrue(dir.isNotEmpty())
        val out = File(dir).apply { mkdirs() }
        val dm = ctx.resources.displayMetrics
        val w = dm.widthPixels; val h = dm.heightPixels
        val r = RunRenderer(RunSprites(ctx.assets), ResourcesCompat.getFont(ctx, R.font.nunito_bold), ResourcesCompat.getFont(ctx, R.font.fredoka_semibold))
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val s = RunSim.create(RunSim.daySeed("2026-10-02"), goalMeters = 99_999)
        var frame = 0
        val log = StringBuilder("size ${w}x$h\n")
        val from = (System.getProperty("solarchik.runlongFrom") ?: "13500").toDouble()
        val to = (System.getProperty("solarchik.runlongTo") ?: "23500").toDouble()
        var n = 0
        while (s.distance < to && n++ < 60 * 2000) {
            if (s.phase == Phase.DEAD) { log.append("dead at ${s.distance}\n"); break }
            RunSim.step(s, RunSim.TICK, Autopilot.input(s))
            if (s.distance < from || n % 2 != 0) continue
            r.draw(c, w, h, s, 100.0 + frame / 30.0)
            if (frame % 6 == 0) File(out, "f%05d_%05d.jpg".format(frame, s.distance.toInt() / 10)).outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
            frame++
        }
        log.append("frames $frame end ${s.distance}\n")
        File(out, "log.txt").writeText(log.toString())
    }
}
