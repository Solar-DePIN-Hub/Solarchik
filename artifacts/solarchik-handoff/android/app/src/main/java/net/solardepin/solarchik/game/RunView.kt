package net.solardepin.solarchik.game

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.content.res.ResourcesCompat
import net.solardepin.solarchik.R
import net.solardepin.solarchik.game.run.ChapterId
import net.solardepin.solarchik.game.run.DayMod
import net.solardepin.solarchik.game.run.DeathKind
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Input
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunAudio
import net.solardepin.solarchik.game.run.RunRenderer
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunSkin
import net.solardepin.solarchik.game.run.RunPreload
import net.solardepin.solarchik.game.run.RunState
import net.solardepin.solarchik.game.run.RunSounds
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.ceil
import kotlin.math.min

/** What a run is started with. Immutable; handed to the game thread through a volatile field. */
class RunSetup(
    val seed: Int,
    val mod: DayMod,
    val offerBonus: Boolean,
    val goalMeters: Int,
    val careBoost: Boolean = false,
    /** Equipped roof skin and robot (RunGarage ids). */
    val skin: String = "flag",
    val robot: String = "stock",
    /** First run on this phone: show the tutorial hints. */
    val tutorial: Boolean = false,
)

/** HUD snapshot (web snapshot()), built on the game thread and posted to the UI thread. */
data class RunHud(
    val hearts: Int,
    val shield: Int,
    val score: Int,
    val meters: Int,
    val combo: Int,
    val phase: Phase,
    val countdown: Double,
    val death: DeathKind,
    val suns: Int,
    val maxCombo: Int,
    val bonus: Boolean,
    val bonusLeft: Double,
    val grind: Boolean,
    val didBonus: Boolean,
    val chapter: ChapterId,
    val announce: String,
    val announceOn: Boolean,
    val clockOpen: Boolean,
    val stomps: Int = 0,
    val grinds: Int = 0,
    val unders: Int = 0,
    /** Tutorial hint line on (first run, first [RunSim.HINT_TIME] s, until a jump and a slide). */
    val hint: Boolean = false,
    /** Music for this moment ([RunSounds] track). */
    val music: Int = RunSounds.GOLDEN,
) {
    companion object {
        fun hintOn(s: RunState) = s.tutorial && s.phase == Phase.RUNNING && !s.bonus && !s.clockOpen &&
            s.runTime < RunSim.HINT_TIME && !(s.hasJumped && s.slid)

        fun of(s: RunState) = RunHud(
            s.hearts, s.shield, Math.round(s.score).toInt(), s.meters, s.combo, s.phase, s.countdown, s.death,
            s.suns, s.maxCombo, s.bonus, s.bonusLeft, s.grind, s.didBonus, s.chapter, s.announce,
            s.announceLife > 0, s.clockOpen, s.stomps, s.grinds, s.unders, hintOn(s), RunSounds.trackOf(s),
        )
    }
}

/** The sim's English in-world words (pops, chapter banners, cues) -> this locale's strings. */
fun runLabels(ctx: Context): Map<String, String> {
    val r = ctx.resources
    val m = HashMap<String, String>()
    fun put(k: String, id: Int) { m[k] = r.getString(id) }
    put("SHIELD", R.string.run_pop_shield); put("GRIND", R.string.run_pop_grind); put("NICE", R.string.run_pop_nice)
    put("GUST", R.string.run_pop_gust); put("OVERHEAT", R.string.run_pop_overheat); put("DRONE DOWN", R.string.run_pop_drone_down)
    put("SERPENT", R.string.run_pop_serpent); put("BACK TO ROOFS", R.string.run_pop_back); put("FLY GATE", R.string.run_pop_fly_gate)
    put("FLY!", R.string.run_pop_fly_go); put("STOMP", R.string.run_pop_stomp); put("SLIDE", R.string.run_pop_slide)
    put("CLOSE", R.string.run_pop_close); put("UNDER", R.string.run_pop_under); put("CLEAN", R.string.run_pop_clean)
    put("+SUN", R.string.run_pop_sun); put("HEAT", R.string.run_pop_heat); put("TAP", R.string.run_pop_tap); put("FLY", R.string.run_pop_fly)
    for (ch in RunSim.CHAPTERS) m[ch.banner] = r.getString(RunOverlay.bannerRes(ch.id))
    m[RunSim.BOSS_BANNER] = r.getString(R.string.run_boss_banner)
    return m
}

/** End of a run (the last heart lost). CLOCK IN at the goal does not end the run. */
class RunResult(val hud: RunHud)

/**
 * The roof run surface. The game thread owns the [RunState] and the renderer; the UI thread only
 * queues input ([input]), flips [paused] and asks for restarts. Results and HUD snapshots travel
 * back as immutable objects through [post].
 */
@SuppressLint("ViewConstructor")
class RunView(context: Context, private val listener: Listener? = null) :
    SurfaceView(context), SurfaceHolder.Callback {

    interface Listener {
        fun onHud(hud: RunHud)
        fun onEvents(events: List<Ev>, hud: RunHud)
        fun onResult(result: RunResult)
    }

    private var thread: Thread? = null
    @Volatile private var running = false
    @Volatile private var generation = 0
    @Volatile private var surfaceW = 0
    @Volatile private var surfaceH = 0
    /** UI -> game: taps and holds. */
    private val input = RunInput()
    /** UI -> game: pause (web pausedRef). The world keeps drawing, the sim does not step. */
    @Volatile var paused = false
    /** game -> UI: the run ended (overlay up); taps are ignored like on the web. */
    @Volatile var ended = false
        private set
    @Volatile private var setup: RunSetup? = null
    private val restartReq = AtomicBoolean(true)
    var audio: RunAudio? = null
    /** UI -> game: the HUD suns chip centre (fractions of the view), where collected suns fly. */
    @Volatile var sunTargetX = 0.28
    @Volatile var sunTargetY = 0.083

    // ---- game thread only ----
    private var state: RunState? = null
    /** Process-wide prepared sprites (RunPreload): the Yard warms them before the run opens. */
    private val sprites by lazy { RunPreload.sprites(context) }
    /** UI -> game: robot/skin to warm before the first run (set before the surface exists). */
    @Volatile private var primeRobot = "stock"
    @Volatile private var primeSkin = "flag"
    /** game: assets decoded, scaled and drawn once (GPU upload) behind the loading cover. */
    @Volatile var warmed = false
        private set
    /** UI thread callback once [warmed]; the activity starts the countdown only then. */
    var onReady: (() -> Unit)? = null
    /** Death beat: slow-motion then a frozen world behind the result card. */
    private var deadAtNs = 0L
    private val renderer by lazy {
        val uk = context.resources.configuration.locales[0].language == "uk"
        // Fredoka has no Cyrillic: Ukrainian in-world text uses the rounded Nunito ExtraBold
        RunRenderer(sprites, font(R.font.nunito_bold), font(if (uk) R.font.nunito_extrabold else R.font.fredoka_semibold)).also {
            it.reducedMotion = reducedMotion()
            it.labels = runLabels(context)
        }
    }
    private var reported = false
    private var hudKey = ""
    private var hudAcc = 0.0

    // ---- UI thread only (touch tracking, web ptrRef) ----
    private var ptrId = -1
    private var ptrY = 0f
    private var ptrSliding = false
    private val slideDy = 36f * resources.displayMetrics.density

    init {
        holder.addCallback(this)
        isFocusable = true
        contentDescription = context.getString(R.string.run_a11y_view)
    }

    private fun font(id: Int): Typeface? = runCatching { ResourcesCompat.getFont(context, id) }.getOrNull()

    private fun reducedMotion(): Boolean = runCatching {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }.getOrDefault(false)

    /** UI thread: which robot/skin the first run uses, so the warm-up prepares exactly those frames. */
    fun prime(robot: String, skin: String) {
        primeRobot = robot
        primeSkin = skin
    }

    /** UI thread: start (or restart) a run with [s]. Applied by the game thread on its next frame. */
    fun start(s: RunSetup) {
        setup = s
        ended = false
        paused = false
        restartReq.set(true)
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        if (running) return
        running = true
        // A loop that outlived the 400 ms join of the last surfaceDestroyed sees a newer
        // generation and exits, so two game threads never run at once.
        val my = ++generation
        thread = Thread({ loop(my) }, "solarchik-run").also { it.start() }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        surfaceW = width
        surfaceH = height
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        running = false
        thread?.join(400)
        thread = null
    }

    // ---- input (UI thread): only queue, never touch the state ----

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (ended || paused) return true
                ptrId = event.getPointerId(0)
                ptrY = event.y
                ptrSliding = false
                jumpDown()
            }
            MotionEvent.ACTION_MOVE -> {
                val i = event.findPointerIndex(ptrId)
                if (i >= 0 && !ptrSliding && event.getY(i) - ptrY > slideDy) {
                    ptrSliding = true
                    input.requestSlide()
                    input.slideHeld = true
                    input.jumpHeld = false
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                input.jumpHeld = false
                input.slideHeld = false
                ptrId = -1
                ptrSliding = false
            }
        }
        return true
    }

    /** Accessibility path (TalkBack double-tap / switch access): a jump. */
    override fun performClick(): Boolean {
        super.performClick()
        if (!ended && !paused) {
            input.request()
            input.jumpHeld = false
        }
        return true
    }

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.addAction(AccessibilityNodeInfo.AccessibilityAction(R.id.run_action_slide, context.getString(R.string.run_slide)))
    }

    override fun performAccessibilityAction(action: Int, arguments: Bundle?): Boolean {
        if (action == R.id.run_action_slide) {
            slideTap()
            return true
        }
        return super.performAccessibilityAction(action, arguments)
    }

    fun jumpDown() {
        if (ended || paused) return
        input.request()
        input.jumpHeld = true
    }

    fun jumpUp() { input.jumpHeld = false }

    fun slideDown() {
        if (ended || paused) return
        input.requestSlide()
        input.slideHeld = true
    }

    fun slideUp() { input.slideHeld = false }

    private fun slideTap() {
        if (ended || paused) return
        input.requestSlide()
    }

    fun releaseAll() {
        input.jumpHeld = false
        input.slideHeld = false
    }

    // ---- game thread ----

    private fun newRun(): RunState? {
        val s = setup ?: return null
        reported = false
        hudKey = ""
        input.take(); input.takeSlide()
        renderer.skin = RunSkin.of(s.skin)
        renderer.robot = s.robot
        renderer.reset()
        return RunSim.create(s.seed, s.mod, s.offerBonus, s.careBoost, s.goalMeters).also { it.tutorial = s.tutorial }
    }

    /**
     * Game thread, before the first run: decode/scale everything (instant when the Yard preloaded),
     * then draw a throw-away world a few times so every bitmap is uploaded to the GPU and the draw
     * code is JIT-warm. The loading cover hides these frames; the sim does not exist yet.
     */
    private fun warmUp(): Boolean {
        val w = surfaceW
        val h = surfaceH
        if (w <= 0 || h <= 0) return false
        val k = h / renderer.logicalH
        RunPreload.warm(context, primeRobot, primeSkin, k)
        renderer.skin = RunSkin.of(primeSkin)
        renderer.robot = primeRobot
        val dummy = RunSim.create(1, DayMod.of(""), false, false, 1200)
        for (i in 0 until 3) {
            val canvas = runCatching { holder.lockHardwareCanvas() }.getOrNull() ?: runCatching { holder.lockCanvas() }.getOrNull() ?: return false
            try {
                renderer.draw(canvas, canvas.width, canvas.height, dummy, i * 0.016)
                RunSim.step(dummy, RunSim.TICK, Input(false, false, false, false))
                // every hero / robot frame once, tiny, in a corner (covered by the loading layer)
                val all = sprites.run + sprites.jump + listOfNotNull(sprites.slide) + sprites.robotRun(primeRobot)
                for ((j, f) in all.withIndex()) {
                    canvas.drawBitmap(f.bmp, null, android.graphics.RectF(j * 3f, 0f, j * 3f + 2f, 2f), null)
                    canvas.drawBitmap(f.rim, null, android.graphics.RectF(j * 3f, 3f, j * 3f + 2f, 5f), null)
                }
            } finally {
                holder.unlockCanvasAndPost(canvas)
            }
        }
        renderer.reset()
        return true
    }

    private fun loop(my: Int) {
        var last = System.nanoTime()
        var acc = 0.0
        while (running && my == generation) {
            if (!warmed) {
                if (runCatching { warmUp() }.getOrDefault(true)) {
                    warmed = true
                    post { onReady?.invoke() }
                } else {
                    try { Thread.sleep(16) } catch (_: InterruptedException) { break }
                    continue
                }
                last = System.nanoTime()
            }
            if (RunStartGate.shouldCreate(warmed, setup != null, restartReq.get(), state != null)) {
                restartReq.set(false)
                state = newRun()
                deadAtNs = 0L
                acc = 0.0
                state?.let { post { listener?.onHud(RunHud.of(it)) } }
            }
            val s = state
            val now = System.nanoTime()
            var dt = min((now - last) / 1e9, 0.05)
            last = now
            var drawClock = now / 1e9
            if (s != null && s.phase == Phase.DEAD) {
                // death beat: the fall plays in slow motion for DEATH_BEAT, then the world holds still
                if (deadAtNs == 0L) deadAtNs = now
                val since = (now - deadAtNs) / 1e9
                val beat = RunOverlay.DEATH_BEAT_MS / 1000.0
                dt = if (since < beat) dt * 0.35 else 0.0
                drawClock = deadAtNs / 1e9 + min(since, beat) * 0.35
            }
            if (s != null && !paused && dt > 0) {
                acc += dt
                var steps = 0
                while (acc >= RunSim.TICK && steps < 3) {
                    prevX = s.x; prevY = s.y; prevPhase = s.runPhase
                    val inp = Input(input.take(), input.jumpHeld, input.takeSlide(), input.slideHeld)
                    val events = RunSim.step(s, RunSim.TICK, inp)
                    afterStep(s, events)
                    acc -= RunSim.TICK
                    steps += 1
                }
                if (steps >= 3) acc = 0.0
                hudAcc += dt
                if (hudAcc > 0.12) {
                    hudAcc = 0.0
                    val cd = if (s.phase == Phase.COUNTDOWN) (if (s.countdown > 0.28) ceil(s.countdown).toInt() else 0) else -1
                    val key = "${s.phase}|${s.hearts}|${s.shield}|${Math.round(s.score)}|${s.combo}|${(s.distance / 8).toInt()}|${s.bonus}|${s.clockOpen}|$cd|${s.announceLife > 0}|${s.grind}|${s.bonusLeft.toInt()}|${RunHud.hintOn(s)}|${RunSounds.trackOf(s)}"
                    if (key != hudKey) {
                        hudKey = key
                        val hud = RunHud.of(s)
                        post { listener?.onHud(hud) }
                    }
                }
            } else {
                acc = 0.0
            }
            val w = surfaceW
            val h = surfaceH
            val canvas: Canvas? = if (w > 0 && h > 0) {
                runCatching { holder.lockHardwareCanvas() }.getOrNull() ?: runCatching { holder.lockCanvas() }.getOrNull()
            } else null
            if (canvas == null) {
                try { Thread.sleep(16) } catch (_: InterruptedException) { break }
                continue
            }
            try {
                if (s != null) {
                    renderer.sunTargetX = sunTargetX
                    renderer.sunTargetY = sunTargetY
                    // 0.21.9 ("two robots"): the sim steps at a fixed 60 Hz but the screen does not. Frames got
                    // 0, 1 or 2 steps, so the robot and the scrolling city stood still for a frame and then jumped,
                    // which the eye reads as a doubled, ghosting robot (worse on 90/120 Hz tablets). The hero
                    // and camera are drawn between the last two steps, by the leftover fraction of a tick.
                    val a = if (paused || s.phase != Phase.RUNNING) 1.0 else Interp.alpha(acc, RunSim.TICK)
                    val cx = s.x; val cy = s.y; val cp = s.runPhase
                    if (a < 1.0 && Interp.continuous(prevX, cx, prevY, cy)) {
                        s.x = Interp.lerp(prevX, cx, a); s.y = Interp.lerp(prevY, cy, a); s.runPhase = Interp.lerp(prevPhase, cp, a)
                    }
                    try {
                        renderer.draw(canvas, canvas.width, canvas.height, s, drawClock)
                    } finally {
                        s.x = cx; s.y = cy; s.runPhase = cp
                    }
                }
            } finally {
                holder.unlockCanvasAndPost(canvas)
            }
            val spent = (System.nanoTime() - now) / 1_000_000L
            if (spent < 8) try { Thread.sleep(8 - spent) } catch (_: InterruptedException) { break }
        }
    }

    // last sim step's start: the hero / camera are drawn between this and the current state
    private var prevX = 0.0
    private var prevY = 0.0
    private var prevPhase = 0.0

    private fun afterStep(s: RunState, events: List<Ev>) {
        if (events.isNotEmpty()) {
            val a = audio
            a?.onEvents(events)
            val hud = RunHud.of(s)
            val copy = ArrayList(events)
            post { listener?.onEvents(copy, hud) }
        }
        if (s.phase == Phase.DEAD && !reported) {
            reported = true
            ended = true
            input.take(); input.takeSlide()
            val hud = RunHud.of(s)
            hudKey = ""
            post {
                listener?.onHud(hud)
                listener?.onResult(RunResult(hud))
            }
        }
    }
}

/** Render interpolation between two fixed sim steps (0.21.9 double-robot fix). */
object Interp {
    /** Fraction of a tick left in the accumulator, 0..1. */
    fun alpha(acc: Double, tick: Double): Double = (acc / tick).coerceIn(0.0, 1.0)
    fun lerp(a: Double, b: Double, t: Double): Double = a + (b - a) * t
    /** A restart / respawn / bonus warp is drawn as is, never smeared across the screen. */
    fun continuous(px: Double, x: Double, py: Double, y: Double): Boolean = kotlin.math.abs(x - px) < 60 && kotlin.math.abs(y - py) < 120
}

/** When the game thread may create a run: never before the assets are warm (0.21.7 lag fix). */
object RunStartGate {
    fun shouldCreate(warmed: Boolean, hasSetup: Boolean, restartRequested: Boolean, hasState: Boolean): Boolean =
        warmed && hasSetup && (restartRequested || !hasState)
}

/**
 * Hand-over of input from the UI thread to the game thread. A press is remembered until the next
 * step consumes it (at most one per step); holds are plain volatile flags. No game state is
 * written from the UI thread.
 */
class RunInput {
    private val pending = AtomicBoolean(false)
    private val slide = AtomicBoolean(false)
    @Volatile var jumpHeld = false
    @Volatile var slideHeld = false
    fun request() { pending.set(true) }
    fun take(): Boolean = pending.getAndSet(false)
    fun requestSlide() { slide.set(true) }
    fun takeSlide(): Boolean = slide.getAndSet(false)
}
