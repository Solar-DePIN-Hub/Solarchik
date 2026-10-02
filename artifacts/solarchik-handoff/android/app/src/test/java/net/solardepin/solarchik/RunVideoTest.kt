package net.solardepin.solarchik

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Looper
import android.view.View
import androidx.core.content.res.ResourcesCompat
import androidx.test.core.app.ApplicationProvider
import net.solardepin.solarchik.game.RunHud
import net.solardepin.solarchik.game.RunOverlay
import net.solardepin.solarchik.game.run.EnemyKind
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Input
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunRenderer
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunSounds
import net.solardepin.solarchik.game.run.RunSprites
import net.solardepin.solarchik.game.run.RunState
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.Duration

/**
 * Gameplay preview: consecutive 30 fps frames straight from the sim (bot player) + renderer + HUD,
 * plus an event log for the audio mix. Off unless -Prunvideo=DIR. Encode with tools/run-audio/video.py.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w914dp-h411dp-land-hdpi")
class RunVideoTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()

    @Test fun gameplayPreview() {
        val dirName = System.getProperty("solarchik.runvideo") ?: ""
        assumeTrue(dirName.isNotEmpty())
        val out = File(dirName).apply { deleteRecursively(); mkdirs() }
        val dm = ctx.resources.displayMetrics
        val w = dm.widthPixels
        val h = dm.heightPixels
        val r = RunRenderer(RunSprites(ctx.assets), ResourcesCompat.getFont(ctx, R.font.nunito_bold), ResourcesCompat.getFont(ctx, R.font.fredoka_semibold))
            .also { it.labels = net.solardepin.solarchik.game.runLabels(ctx) }
        val o = RunOverlay(ctx, object : RunOverlay.Actions {
            override fun pauseToggle() {}; override fun resume() {}; override fun yard() {}; override fun again() {}
            override fun sign() {}; override fun signBadge() {}; override fun share() {}; override fun yardSign() {}
            override fun musicToggle() {}; override fun mic() {}; override fun slideDown() {}; override fun slideUp() {}
        }).also {
            it.setMuted(false); it.setMicAvailable(true); it.animations = true
            it.onSunTarget = { x, y -> r.sunTargetX = x; r.sunTargetY = y }
        }
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val black = Paint()
        val log = StringBuilder()
        var frame = 0
        val fps = 30
        val looper = shadowOf(Looper.getMainLooper())

        fun render(s: RunState, clock: Double, fade: Double) {
            r.draw(c, w, h, s, clock)
            o.bind(RunHud.of(s))
            o.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
            o.layout(0, 0, w, h)
            o.draw(c)
            if (fade > 0) { black.color = Color.argb((fade.coerceIn(0.0, 1.0) * 255).toInt(), 0, 0, 0); c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), black) }
            File(out, "f%05d.jpg".format(frame)).outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 93, it) }
            frame++
            looper.idleFor(Duration.ofMillis(1000L / fps))
        }

        /** Plays [seconds] of [s] at 30 fps (2 sim ticks per frame), logging sound events at video time. */
        fun play(s: RunState, seconds: Double, fadeIn: Boolean, fadeOut: Boolean, inputFor: (RunState) -> Input, onEvents: (List<Ev>) -> Unit = {}) {
            val n = (seconds * fps).toInt()
            for (i in 0 until n) {
                repeat(2) {
                    val ev = RunSim.step(s, RunSim.TICK, inputFor(s))
                    val t = frame.toDouble() / fps
                    for (e in ev) log.append("%.3f,%s\n".format(java.util.Locale.ROOT, t, RunSounds.of(e)))
                    if (Ev.MILESTONE in ev) o.milestone((s.meters / RunSim.MILESTONE_M) * RunSim.MILESTONE_M)
                    onEvents(ev)
                }
                val fade = when {
                    fadeIn && i < 8 -> 1 - i / 8.0
                    fadeOut && i >= n - 8 -> (i - (n - 8) + 1) / 8.0
                    else -> 0.0
                }
                render(s, 100.0 + frame.toDouble() / fps, fade)
            }
        }

        val seed = RunSim.daySeed("2026-10-02")
        val slide = listOf(Input(slidePressed = true, slideHeld = true)) + List(26) { Input(slideHeld = true) }
        val mine = ArrayDeque<Input>()
        var wantSlide = false
        fun jmp(h: Int) = List(h) { Input(jumpPressed = it == 0, jumpHeld = true) }
        val follow = listOf(emptyList(), jmp(30), jmp(14)) +
            listOf(10, 16, 22, 28).flatMap { g -> listOf(30, 14).map { h -> jmp(h).take(g) + List((g - h).coerceAtLeast(0)) { Input() } + jmp(30) } }
        /** [seq] takes no hit and the bot still has a safe move right after it. */
        fun slideOk(s: RunState, seq: List<Input>): Boolean {
            val cp = Autopilot.copy(s)
            val hearts = cp.hearts
            for (inp in seq) { val ev = RunSim.step(cp, RunSim.TICK, inp); if (cp.hearts < hearts || Ev.HURT in ev || cp.phase != Phase.RUNNING) return false }
            return follow.any { Autopilot.isSafe(cp, it) }
        }
        /** The bot, but it prefers a slide whenever a slide is a safe answer (and slides on request). */
        fun show(s: RunState): Input {
            if (mine.isNotEmpty()) return mine.removeFirst()
            if (s.phase == Phase.RUNNING && s.grounded && s.slide <= 0) {
                val drone = s.enemies.any { !it.dead && it.kind == EnemyKind.DRONE && it.x - s.x in 0.0..420.0 }
                if (drone || wantSlide) {
                    for (wait in 0..30 step 2) {
                        val seq = List(wait) { Input() } + slide
                        if (slideOk(s, seq)) { wantSlide = false; Autopilot.reset(); mine.addAll(seq); return mine.removeFirst() }
                    }
                }
            }
            return Autopilot.input(s)
        }
        fun ff(s: RunState, until: (RunState) -> Boolean) {
            var g = 0
            while (g++ < 60 * 900 && !until(s)) RunSim.step(s, RunSim.TICK, show(s))
        }
        fun mark(t: String) = log.append("%.3f,%s\n".format(java.util.Locale.ROOT, frame.toDouble() / fps, t))
        Autopilot.reset()
        // A: golden hour from the countdown: GO, running, jumps, a slide on cue
        val a = RunSim.create(seed, goalMeters = 99_999)
        mark("start"); mark("music:golden")
        var fa = 0
        play(a, 6.0, fadeIn = true, fadeOut = true, inputFor = { s -> if (++fa == 2 * 30 * 4) wantSlide = true; show(s) })
        // B: same run a bit later (still golden hour): the first drone wave, slid under
        mine.clear(); Autopilot.reset()
        val b = RunSim.create(seed, goalMeters = 99_999)
        ff(b) { s -> s.enemies.any { !it.dead && it.kind == EnemyKind.DRONE && it.x - s.x in 650.0..900.0 } }
        mark("cut")
        play(b, 5.5, fadeIn = true, fadeOut = true, inputFor = { show(it) })
        // C: the maintenance drone: entrance, telegraph and beam ...
        mine.clear(); Autopilot.reset()
        ff(b) { s -> s.arenaX0 > 0 && s.x > s.arenaX0 - 260 && s.bossStage == 0 }
        mark("music:boss")
        play(b, 3.6, fadeIn = true, fadeOut = true, inputFor = { s -> s.hearts = maxOf(s.hearts, 2); show(s) })
        // ... then the last beam, OVERHEAT and the stomp
        mine.clear(); Autopilot.reset()
        ff(b) { s -> s.bossStage == 2 && s.bossShots == RunSim.BOSS_SHOTS - 1 && s.bossTele > 0 }
        mark("cut")
        val plan = ArrayDeque<Input>()
        fun bossInput(s: RunState): Input {
            if (plan.isNotEmpty()) return plan.removeFirst()
            if (s.bossStage == 3 && s.grounded && s.bossDowned == 0) {
                // a jump (+ optional double) that lands on the overheated drone
                for (wait in 0..20 step 4) for (hold in 4..18 step 2) for (dbl in listOf(-1, 10, 14, 18, 22, 26, 30)) {
                    val seq = ArrayList<Input>()
                    repeat(wait) { seq.add(Input()) }
                    for (k in 0 until 90) seq.add(Input(jumpPressed = k == 0 || k == dbl, jumpHeld = k < hold || (dbl >= 0 && k in dbl until dbl + 10)))
                    val cp = Autopilot.copy(s)
                    var ok = false
                    for (inp in seq) { if (Ev.DOWNED in RunSim.step(cp, RunSim.TICK, inp)) { ok = true; break }; if (cp.phase == Phase.DEAD) break }
                    if (ok) { plan.addAll(seq.take(wait + 50)); Autopilot.reset(); return plan.removeFirst() }
                }
            }
            return show(s)
        }
        play(b, 5.0, fadeIn = true, fadeOut = true, inputFor = { s -> s.hearts = maxOf(s.hearts, 2); bossInput(s) })
        File(out, "events.csv").writeText(log.toString())
        File(out, "info.txt").writeText("frames=$frame fps=$fps size=${w}x$h downed=${b.bossDowned} bossStage=${b.bossStage} hearts=${b.hearts} metersB=${b.meters}\n")
    }
}
