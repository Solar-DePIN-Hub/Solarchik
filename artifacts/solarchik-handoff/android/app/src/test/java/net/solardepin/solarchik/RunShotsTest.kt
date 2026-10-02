package net.solardepin.solarchik

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.view.View
import androidx.core.content.res.ResourcesCompat
import androidx.test.core.app.ApplicationProvider
import net.solardepin.solarchik.game.RunHud
import net.solardepin.solarchik.game.RunOverlay
import net.solardepin.solarchik.game.run.DayMod
import net.solardepin.solarchik.game.run.EnemyKind
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Input
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.PlatKind
import net.solardepin.solarchik.game.run.RunRenderer
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunSprites
import net.solardepin.solarchik.game.run.RunState
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Renders real run frames (sim + Canvas renderer + HUD overlay) to PNG, one per mechanic, so the
 * native run can be compared with the web game. Output: -Dsolarchik.runshots=dir.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w914dp-h411dp-land-xxhdpi")
class RunShotsTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()
    private val outDir = File(System.getProperty("solarchik.runshots") ?: "build/screens-run").apply { mkdirs() }
    private val seed = RunSim.daySeed("2026-10-02")

    private fun renderer() = RunRenderer(
        RunSprites(ctx.assets),
        ResourcesCompat.getFont(ctx, R.font.nunito_bold),
        ResourcesCompat.getFont(ctx, R.font.fredoka_semibold),
    )

    private fun overlay(): RunOverlay = RunOverlay(ctx, object : RunOverlay.Actions {
        override fun pauseToggle() {}
        override fun resume() {}
        override fun yard() {}
        override fun again() {}
        override fun sign() {}
        override fun musicToggle() {}
        override fun mic() {}
        override fun slideDown() {}
        override fun slideUp() {}
    }).also {
        it.buddy.setImageBitmap(ctx.assets.open("sprites/pet/buddy-talk-3.png").use { s -> BitmapFactory.decodeStream(s) })
        it.setMuted(false)
        it.setMicAvailable(true)
    }

    private fun shot(name: String, s: RunState, at: Double = s.runTime + 1.3, hud: Boolean = true, scale: Int = 1, prep: (RunOverlay) -> Unit = {}): Bitmap {
        // the hero blinks while invulnerable (16 Hz); show a frame where it is drawn
        val clock = if (Math.floor(at * 16).toInt() % 2 == 0) at + 1.0 / 16 else at
        val dm = ctx.resources.displayMetrics
        val w = dm.widthPixels / scale
        val h = dm.heightPixels / scale
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        renderer().draw(c, w, h, s, clock)
        if (hud) {
            val o = overlay()
            o.bind(RunHud.of(s))
            prep(o)
            o.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
            o.layout(0, 0, w, h)
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            o.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
            o.layout(0, 0, w, h)
            o.draw(c)
        }
        File(outDir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return bmp
    }

    private fun stepUntil(s: RunState, max: Int = 60 * 400, bot: Boolean = true, cond: (RunState) -> Boolean): Boolean {
        var n = 0
        while (n++ < max) {
            if (cond(s)) return true
            RunSim.step(s, RunSim.TICK, if (bot) Autopilot.input(s) else Input())
            if (s.phase == Phase.DEAD) return cond(s)
        }
        return false
    }

    private fun inView(s: RunState, x: Double, from: Double = -120.0, to: Double = 700.0) = x - s.x in from..to

    @Test fun startAndCountdown() {
        val s = RunSim.create(seed)
        repeat(20) { RunSim.step(s, RunSim.TICK, Input()) }
        shot("01-countdown", s, at = 0.4)
        val go = RunSim.create(seed)
        repeat(60) { RunSim.step(go, RunSim.TICK, Input()) }
        shot("02-countdown-go", go, at = 1.0)
    }

    @Test fun introTapHintLikeTheReference() {
        // the reference shot: 26 m, TAP hint at the intro roof lip, a mite, suns ahead; the web
        // player had the pet-care shield, which ate the intro mite ("SHIELD")
        val s = RunSim.create(seed, careBoost = true)
        assertTrue(stepUntil(s, bot = false) { it.meters >= 26 })
        shot("03-intro-tap", s)
        // and at the web desktop framing for a 1:1 look against the reference crop
        shot("03b-intro-tap-halfres", s, scale = 2)
    }

    @Test fun midRunSunsAndEnemy() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s) { st ->
            st.meters > 160 && st.grounded &&
                st.enemies.any { !it.dead && it.kind == EnemyKind.MITE && inView(st, it.x, 120.0, 520.0) } &&
                st.picks.count { !it.taken && inView(st, it.x, 0.0, 600.0) } >= 3
        })
        shot("04-midrun-suns-mite", s)
    }

    @Test fun jumpAndDoubleJump() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s) { st -> st.meters > 90 && !st.grounded && st.airJumps == 1 && st.vy in -260.0..-120.0 && st.particles.isNotEmpty() })
        shot("05-jump", s)
        val d2 = RunSim.create(seed)
        stepUntil(d2) { it.meters > 120 && it.grounded }
        RunSim.step(d2, RunSim.TICK, Input(true, true))
        repeat(16) { RunSim.step(d2, RunSim.TICK, Input(jumpHeld = true)) }
        val dbl = Ev.DOUBLE in RunSim.step(d2, RunSim.TICK, Input(true, true))
        repeat(5) { RunSim.step(d2, RunSim.TICK, Input(jumpHeld = true)) }
        assertTrue(dbl)
        shot("06-double-jump", d2)
    }

    @Test fun shieldPickupAndHeld() {
        // shields are rare (5% of calm roofs past 420 m): find a daily seed where the bot,
        // allowed to go for shields, grabs one, and shoot the approach and the held shield
        Autopilot.greedy = true
        try {
            var done = false
            for (day in 1..28) {
                if (done) break
                val s = RunSim.create(RunSim.daySeed("2026-10-%02d".format(day)), goalMeters = 99_999)
                var shotPick = false
                var n = 0
                while (n++ < 60 * 200 && s.phase != Phase.DEAD && !done) {
                    if (!shotPick && s.picks.any { it.shield && !it.taken && inView(s, it.x, 160.0, 420.0) }) {
                        shot("07-shield-pickup", s)
                        shotPick = true
                    }
                    RunSim.step(s, RunSim.TICK, Autopilot.input(s))
                    if (s.shield > 0 && shotPick) {
                        repeat(24) { RunSim.step(s, RunSim.TICK, Autopilot.input(s)) }
                        shot("08-shield-held", s)
                        done = true
                    }
                    if (shotPick && s.picks.none { it.shield && !it.taken }) shotPick = false
                }
            }
            assertTrue(done)
        } finally {
            Autopilot.greedy = false
        }
    }

    @Test fun slideUnderDrone() {
        // drone-day drones hover low (jump them); regular drones past 520 m are slid under
        val s = RunSim.create(seed, goalMeters = 99_999)
        fun droneAhead(st: RunState) = st.enemies.firstOrNull { !it.dead && it.kind == EnemyKind.DRONE && it.x > st.x }
        // let the bot run until a drone floats over the roof ahead, then hold slide under it
        assertTrue(stepUntil(s) { st ->
            val d = droneAhead(st)
            st.grounded && st.meters > 530 && d != null && d.x - st.x in 90.0..240.0 &&
                st.plats.any { it.kind == PlatKind.ROOF && it.x <= st.x && it.x + it.w >= d.x + 40 && kotlin.math.abs(it.y - st.y) < 1 } &&
                st.enemies.none { !it.dead && it.kind == EnemyKind.MITE && it.x > st.x - 30 && it.x < d.x + 40 }
        })
        val hearts = s.hearts
        var under = false
        var holding = false
        repeat(90) {
            if (!under) {
                val d = droneAhead(s)
                val press = !holding && d != null && d.x - s.x < 60
                if (press) holding = true
                RunSim.step(s, RunSim.TICK, Input(slidePressed = press, slideHeld = holding))
                under = holding && s.slide > 0 && s.enemies.any { e -> !e.dead && e.kind == EnemyKind.DRONE && kotlin.math.abs(e.x - s.x) < 12 }
            }
        }
        assertTrue(under)
        assertTrue(s.hearts == hearts)
        shot("09-slide-under-drone", s)
    }

    @Test fun wireGrind() {
        val s = RunSim.create(seed, DayMod.WIRE)
        assertTrue(stepUntil(s) { st -> st.grind && st.grounded && st.runTime > 3 })
        repeat(4) { RunSim.step(s, RunSim.TICK, Input()) }
        shot("10-wire-grind", s)
    }

    @Test fun skyFlightBonus() {
        val s = RunSim.create(seed, offerBonus = true)
        assertTrue(stepUntil(s) { st -> st.picks.any { it.portal && inView(st, it.x, 150.0, 400.0) } })
        shot("11-fly-gate", s)
        assertTrue(stepUntil(s) { st -> st.bonus && st.bonusLeft < 5.5 })
        shot("12-sky-flight", s)
    }

    @Test fun heatCombo() {
        val s = RunSim.create(seed, goalMeters = 99_999)
        assertTrue(stepUntil(s) { st -> st.fever > 1.0 && st.grounded })
        shot("13-heat", s)
    }

    @Test fun dayPhasesStormNightSerpent() {
        val s = RunSim.create(seed, goalMeters = 99_999)
        assertTrue(stepUntil(s, max = 60 * 900) { it.distance > 9_000 && it.grounded })
        shot("14-village", s)
        assertTrue(stepUntil(s, max = 60 * 900) { it.distance > 16_300 && it.grounded && it.lightning > 0.3 })
        shot("15-storm-lightning", s)
        assertTrue(stepUntil(s, max = 60 * 900) { it.distance > 19_300 && it.grounded })
        shot("16-dusk-storm", s)
        assertTrue(stepUntil(s, max = 60 * 900) { it.distance > 23_000 && it.grounded })
        shot("17-night", s)
        assertTrue(stepUntil(s, max = 60 * 900) { st -> st.bossDone && st.enemies.count { it.boss && !it.dead && inView(st, it.x, 100.0, 800.0) } >= 3 })
        shot("18-serpent", s)
    }

    @Test fun hurtAndLastHeart() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s, bot = false) { it.hearts == 2 })
        RunSim.step(s, RunSim.TICK, Input())
        shot("19-hurt", s)
        assertTrue(stepUntil(s, bot = false) { it.hearts == 1 && it.invuln < 1.2 })
        shot("20-last-heart", s, at = 0.0)
    }

    @Test fun pauseMenu() {
        val s = RunSim.create(seed)
        stepUntil(s) { it.meters > 140 && it.grounded }
        shot("21-pause", s) { it.setPaused(true) }
    }

    @Test fun gameOver() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s, bot = false) { it.phase == Phase.DEAD })
        repeat(40) { RunSim.step(s, RunSim.TICK, Input()) }
        shot("22-game-over", s)
    }

    @Test fun clockInAtGoal() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s, max = 60 * 300) { it.clockOpen })
        repeat(10) { RunSim.step(s, RunSim.TICK, Input()) }
        shot("23-clock-in", s)
    }

    @Test fun solCaption() {
        val s = RunSim.create(seed)
        stepUntil(s) { it.meters > 60 && it.grounded }
        shot("24-sol-caption", s) { it.setCaption("Nice roofline! Keep the rhythm, the village is close.") }
        shot("25-mic-listening", s) { it.setListening(true); it.setCaption(ctx.getString(R.string.run_listening)) }
    }

    /** The Run tab lobby card image: a real frame, no HUD, at the card's aspect. */
    @Test fun lobbyPreview() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s) { st ->
            st.meters in 40..600 && !st.grounded && st.vy < -100 && st.invuln == 0.0 &&
                st.enemies.any { !it.dead && it.kind == EnemyKind.MITE && inView(st, it.x, 40.0, 420.0) } &&
                st.picks.count { !it.taken && inView(st, it.x, 0.0, 420.0) } >= 2
        })
        s.pops.clear() // no floating score text on the lobby card
        val w = 1200
        val h = 870
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        renderer().also { it.logicalH = 560.0 }.draw(Canvas(bmp), w, h, s, s.runTime + 1.3)
        File(outDir, "lobby-preview.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test @Config(qualifiers = "uk-w914dp-h411dp-land-xxhdpi") fun ukrainian() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s, bot = false) { it.phase == Phase.DEAD })
        repeat(40) { RunSim.step(s, RunSim.TICK, Input()) }
        shot("26-uk-game-over", s)
        val p = RunSim.create(seed)
        stepUntil(p) { it.meters > 140 && it.grounded }
        shot("27-uk-pause", p) { it.setPaused(true) }
        val v = RunSim.create(seed)
        assertTrue(stepUntil(v) { it.announceLife > 1.2 && it.distance > 5_000 })
        shot("28-uk-village-banner", v)
        val c = RunSim.create(seed)
        assertTrue(stepUntil(c, max = 60 * 300) { it.clockOpen })
        shot("29-uk-clock-in", c)
    }
}
