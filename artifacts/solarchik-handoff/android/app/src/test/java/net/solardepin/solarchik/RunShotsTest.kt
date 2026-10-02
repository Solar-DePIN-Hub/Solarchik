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
import net.solardepin.solarchik.game.RunPreview
import net.solardepin.solarchik.game.run.DayMod
import net.solardepin.solarchik.game.run.EnemyKind
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Input
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.PlatKind
import net.solardepin.solarchik.game.run.RunRenderer
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunSkin
import net.solardepin.solarchik.game.run.RunSprites
import net.solardepin.solarchik.game.run.RunState
import org.junit.Assert.assertEquals
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
        override fun signBadge() {}
        override fun share() {}
        override fun yardSign() {}
        override fun musicToggle() {}
        override fun mic() {}
        override fun slideDown() {}
        override fun slideUp() {}
    }).also {
        it.buddy.setImageBitmap(ctx.assets.open("sprites/pet/buddy-talk-3.png").use { s -> BitmapFactory.decodeStream(s) })
        it.setMuted(false)
        it.setMicAvailable(true)
        it.animations = false
    }

    private fun shot(
        name: String, s: RunState, at: Double = s.runTime + 1.3, hud: Boolean = true, scale: Int = 1,
        skin: String = "flag", robot: String = "stock", moment: Boolean = false, prep: (RunOverlay) -> Unit = {},
    ): Bitmap {
        // the hero blinks while invulnerable (16 Hz); show a frame where it is drawn
        val clock = if (Math.floor(at * 16).toInt() % 2 == 0) at + 1.0 / 16 else at
        val dm = ctx.resources.displayMetrics
        val w = dm.widthPixels / scale
        val h = dm.heightPixels / scale
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val r = renderer().also { it.skin = RunSkin.of(skin); it.robot = robot }
        // a live renderer has been drawing for a while (one-shot effects already played),
        // unless the shot is about that moment
        r.draw(c, w, h, s, clock - if (moment) 0.35 else 3.0) // a moment shot: 0.35 s into the effect
        r.draw(c, w, h, s, clock)
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
                st.picks.count { !it.taken && inView(st, it.x, 0.0, 600.0) } >= 2
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
        // on the wire, with no buffered jump about to fire, a few frames into the grind
        assertTrue(stepUntil(s) { st ->
            st.grind && st.grounded && st.jumpBuf == 0.0 && st.runTime > 3 &&
                st.plats.any { it.kind == PlatKind.WIRE && st.x - it.x in 26.0..(it.w - 20) }
        })
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

    @Test fun dayPhasesAndMaintenanceDrone() {
        val s = RunSim.create(seed, goalMeters = 99_999)
        assertTrue(stepUntil(s, max = 60 * 900) { it.distance > 5_600 && it.grounded })
        shot("14-dusk-district", s)
        assertTrue(stepUntil(s, max = 60 * 900) { it.bossStage == 2 && it.bossTele in 0.15..0.4 && it.grounded })
        shot("15-boss-telegraph", s, moment = true)
        assertTrue(stepUntil(s, max = 60 * 900) { it.bossStage == 2 && it.bossBeam in 0.08..0.2 && it.bossShots >= 1 })
        shot("16-boss-beam", s, moment = true)
        assertTrue(stepUntil(s, max = 60 * 900) { it.bossStage == 3 && it.bossT > 0.35 })
        shot("17-boss-overheat", s, moment = true)
        assertTrue(stepUntil(s, max = 60 * 900) { it.distance > 13_000 && it.grounded })
        shot("18-night-city", s)
        assertTrue(stepUntil(s, max = 60 * 900) { it.distance > 16_300 && it.grounded && it.lightning > 0.3 })
        shot("18b-storm-lightning", s)
    }

    @Test fun cityHazards() {
        val s = RunSim.create(seed, goalMeters = 99_999)
        assertTrue(stepUntil(s, max = 60 * 900) { st ->
            st.grounded && st.plats.any { it.crumble && it.crackT in 0.1..0.3 && st.x - it.x in 10.0..it.w }
        })
        shot("18c-cracking-canopy", s, moment = true)
        val w = RunSim.create(seed, goalMeters = 99_999)
        assertTrue(stepUntil(w, max = 60 * 900) { st ->
            st.plats.any { it.live && RunSim.wireLive(st, it) == 2 && inView(st, it.x, 120.0, 420.0) }
        })
        shot("18d-live-cable", w, moment = true)
        val g = RunSim.create(seed, goalMeters = 99_999)
        assertTrue(stepUntil(g, max = 60 * 900) { it.gustLeft in 0.6..1.0 && it.grounded })
        shot("18e-gust", g, moment = true)
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

    private val clockOpen = RunOverlay.ClockUi(open = true, wallet = true)
    private val clockSigned = RunOverlay.ClockUi(
        open = true, signed = true, wallet = true, dayLine = "CLOCK IN 1386m · streak 6", proofLine = "devnet 5Qm7…Hc2P · explorer",
    )

    @Test fun clockInAtGoalKeepsRunning() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s, max = 60 * 300) { it.clockOpen })
        val x = s.x
        repeat(20) { RunSim.step(s, RunSim.TICK, Autopilot.input(s)) }
        assertEquals(Phase.RUNNING, s.phase)
        assertTrue("the run keeps going", s.x > x)
        // frame it with the hero back on a roof (still inside the 2.8 s banner)
        var n = 0
        while (!(s.grounded && s.slide <= 0) && n++ < 150) RunSim.step(s, RunSim.TICK, Autopilot.input(s))
        // celebratory banner + shockwave, badge appears; no card, no freeze
        shot("23-clock-unlocked-banner", s, moment = true) { it.setClock(clockOpen); it.celebrateClock() }
        // a few seconds on: only the Sign badge stays in the HUD
        assertTrue(stepUntil(s) { it.meters > 1300 && it.grounded })
        shot("23b-clock-sign-badge", s) { it.setClock(clockOpen) }
        // tapping the badge pauses into the sign sheet
        shot("23c-clock-sign-sheet", s) { it.setClock(clockOpen); it.setPaused(true) }
        // signed in place: the web day card replaces the button, Resume continues the run
        shot("23d-clock-signed-day-card", s) { it.setClock(clockSigned); it.setPaused(true) }
    }

    @Test fun gameOverAfterTheGoalWithRewards() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s, max = 60 * 300) { it.clockOpen })
        assertTrue(stepUntil(s, max = 60 * 300) { it.meters > 1350 && it.grounded })
        s.hearts = 1; s.invuln = 0.0
        assertTrue(stepUntil(s, bot = false) { it.phase == Phase.DEAD })
        repeat(40) { RunSim.step(s, RunSim.TICK, Input()) }
        val rewards = listOf(
            ctx.getString(R.string.quest_suns) to 20,
            ctx.getString(R.string.quest_b_stomp) to 20,
            ctx.getString(R.string.milestones_title) + " · " + ctx.getString(R.string.ms_distance, 1200) to 60,
        )
        shot("23e-game-over-rewards-sign", s) { it.setClock(clockOpen); it.showRewards(s.suns, rewards, newBest = true) }
        shot("23f-game-over-signed", s) { it.setClock(clockSigned); it.showRewards(s.suns, rewards.take(1), newBest = false) }
    }

    @Test fun questToastMidRun() {
        val s = RunSim.create(seed)
        stepUntil(s) { it.meters > 420 && it.grounded }
        shot("23g-quest-toast", s) { it.questDone(ctx.getString(R.string.quest_done_toast, ctx.getString(R.string.quest_suns)) + "  +20") }
    }

    @Test fun robotsAndSkinsInTheRun() {
        // every bought robot runs on its own strip; roofs take the skin palette
        val combos = listOf("sunflower" to "gold", "midnight" to "night", "hetman" to "prism", "frostkit" to "frost", "emberkit" to "magma", "carbonkit" to "polar")
        for ((robot, skin) in combos) {
            val s = RunSim.create(seed)
            assertTrue(stepUntil(s) { it.meters > 220 && it.grounded })
            shot("30-gear-$robot-$skin", s, skin = skin, robot = robot)
        }
        val air = RunSim.create(seed)
        assertTrue(stepUntil(air) { it.meters > 260 && !it.grounded && it.vy < 0 })
        shot("30-gear-mosskit-cherry-jump", air, skin = "cherry", robot = "mosskit")
    }

    @Test fun solCaption() {
        val s = RunSim.create(seed)
        stepUntil(s) { it.meters > 60 && it.grounded }
        shot("24-sol-caption", s) { it.setCaption("Nice roofline! Keep the rhythm, the village is close.") }
        shot("25-mic-listening", s) { it.setListening(true); it.setCaption(ctx.getString(R.string.run_listening)) }
    }

    /** The Run tab lobby card: a live frame with the equipped gear (RunPreview). */
    @Test fun lobbyPreview() {
        for ((robot, skin) in listOf("stock" to "flag", "hetman" to "gold", "prismkit" to "violet")) {
            val bmp = RunPreview.render(ctx, skin, robot, 1080, 780)
            File(outDir, "lobby-preview-$robot-$skin.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    @Test @Config(qualifiers = "uk-w914dp-h411dp-land-xxhdpi") fun ukrainian() {
        val s = RunSim.create(seed)
        assertTrue(stepUntil(s, bot = false) { it.phase == Phase.DEAD })
        repeat(40) { RunSim.step(s, RunSim.TICK, Input()) }
        shot("26-uk-game-over", s) {
            it.showRewards(s.suns, listOf(ctx.getString(R.string.quest_combo) to 25, ctx.getString(R.string.quest_chest_name) to 50), newBest = true)
        }
        val p = RunSim.create(seed)
        stepUntil(p) { it.meters > 140 && it.grounded }
        shot("27-uk-pause", p) { it.setPaused(true) }
        val v = RunSim.create(seed)
        assertTrue(stepUntil(v) { it.announceLife > 1.2 && it.distance > 5_000 })
        shot("28-uk-village-banner", v)
        val c = RunSim.create(seed)
        assertTrue(stepUntil(c, max = 60 * 300) { it.clockOpen })
        repeat(20) { RunSim.step(c, RunSim.TICK, Autopilot.input(c)) }
        shot("29-uk-clock-unlocked", c, moment = true) { it.setClock(clockOpen); it.celebrateClock() }
        shot("29b-uk-sign-sheet", c) { it.setClock(clockOpen); it.setPaused(true) }
        shot("29c-uk-signed-day-card", c) { it.setClock(clockSigned.copy(dayLine = "CLOCK IN 1386m · streak 6")); it.setPaused(true) }
    }
}
