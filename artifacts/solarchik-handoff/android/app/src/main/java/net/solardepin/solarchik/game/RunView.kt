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
import net.solardepin.solarchik.game.run.GhostSample
import net.solardepin.solarchik.game.run.Input
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunAudio
import net.solardepin.solarchik.game.run.RunRenderer
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunSprites
import net.solardepin.solarchik.game.run.RunState
import net.solardepin.solarchik.game.run.RunSynth
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.ceil
import kotlin.math.min

/** What a run is started with. Immutable; handed to the game thread through a volatile field. */
class RunSetup(
    val seed: Int,
    val mod: DayMod,
    val offerBonus: Boolean,
    val goalMeters: Int,
    val ghost: List<GhostSample>,
    val careBoost: Boolean = false,
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
) {
    companion object {
        fun of(s: RunState) = RunHud(
            s.hearts, s.shield, Math.round(s.score).toInt(), s.meters, s.combo, s.phase, s.countdown, s.death,
            s.suns, s.maxCombo, s.bonus, s.bonusLeft, s.grind, s.didBonus, s.chapter, s.announce,
            s.announceLife > 0, s.clockOpen,
        )
    }
}

/** End of a run (death or the CLOCK IN goal). [ghost] is a copy, safe on any thread. */
class RunResult(val hud: RunHud, val ghost: List<GhostPt>)

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

    // ---- game thread only ----
    private var state: RunState? = null
    private val sprites by lazy { RunSprites(context.assets) }
    private val renderer by lazy {
        RunRenderer(sprites, font(R.font.nunito_bold), font(R.font.fredoka_semibold)).also {
            it.reducedMotion = reducedMotion()
        }
    }
    private var reported = false
    private var goalReported = false
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
        renderer.ghost = s.ghost
        reported = false
        goalReported = false
        hudKey = ""
        input.take(); input.takeSlide()
        return RunSim.create(s.seed, s.mod, s.offerBonus, s.careBoost, s.goalMeters)
    }

    private fun loop(my: Int) {
        var last = System.nanoTime()
        var acc = 0.0
        while (running && my == generation) {
            if (restartReq.getAndSet(false) || state == null) {
                state = newRun()
                acc = 0.0
                state?.let { post { listener?.onHud(RunHud.of(it)) } }
            }
            val s = state
            val now = System.nanoTime()
            val dt = min((now - last) / 1e9, 0.05)
            last = now
            if (s != null && !paused) {
                acc += dt
                var steps = 0
                while (acc >= RunSim.TICK && steps < 3) {
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
                    val key = "${s.phase}|${s.hearts}|${s.shield}|${Math.round(s.score)}|${s.combo}|${(s.distance / 8).toInt()}|${s.bonus}|${s.clockOpen}|$cd|${s.announceLife > 0}|${s.grind}|${s.bonusLeft.toInt()}"
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
                if (s != null) renderer.draw(canvas, canvas.width, canvas.height, s, now / 1e9)
            } finally {
                holder.unlockCanvasAndPost(canvas)
            }
            val spent = (System.nanoTime() - now) / 1_000_000L
            if (spent < 8) try { Thread.sleep(8 - spent) } catch (_: InterruptedException) { break }
        }
    }

    private fun afterStep(s: RunState, events: List<Ev>) {
        if (events.isNotEmpty()) {
            val a = audio
            if (a != null) for (ev in events) a.play(RunSynth.soundOf(ev))
            val hud = RunHud.of(s)
            val copy = ArrayList(events)
            post { listener?.onEvents(copy, hud) }
        }
        val goal = s.clockOpen && !goalReported
        val dead = s.phase == Phase.DEAD && !reported
        if (goal || dead) {
            goalReported = goalReported || goal
            reported = true
            ended = true
            input.take(); input.takeSlide()
            val hud = RunHud.of(s)
            hudKey = ""
            val ghost = s.ghost.map { GhostPt(it.x.toFloat(), it.y.toFloat(), it.grounded) }
            post {
                listener?.onHud(hud)
                listener?.onResult(RunResult(hud, ghost))
            }
        }
    }
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
