package net.solardepin.solarchik.game

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import kotlin.math.max
import kotlin.random.Random

/* Built in code by RunActivity only, never inflated from XML. */
@SuppressLint("ViewConstructor")
class RunView(context: Context, private val onDone: (meters: Int, score: Int) -> Unit) :
    SurfaceView(context), SurfaceHolder.Callback, Runnable {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 42f
        isFakeBoldText = true
    }
    private val hud = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F5C542")
        textSize = 36f
        isFakeBoldText = true
    }

    private val hudLine = context.getString(net.solardepin.solarchik.R.string.run_hud)
    private val doneLine = context.getString(net.solardepin.solarchik.R.string.run_done, GameSave.GOAL_M)
    private val retryLine = context.getString(net.solardepin.solarchik.R.string.run_retry)
    private val tapLine = context.getString(net.solardepin.solarchik.R.string.run_tap)

    private var thread: Thread? = null
    // Shared with the UI thread: only these cross threads. All game state below is touched by
    // the game thread alone; taps and surface sizes are handed over through [input] / [surfaceH].
    @Volatile private var running = false
    @Volatile private var finished = false
    private val input = RunInput()
    @Volatile private var generation = 0
    @Volatile private var surfaceW = 0
    @Volatile private var surfaceH = 0

    private val runFrames = loadSheet("sprites/hero-run", 8)
    private val jumpFrames = loadSheet("sprites/hero-jump", 4)
    private val mite = load("sprites/foe-mite.png")
    private val drone = load("sprites/foe-drone.png")
    private val sky = load("yard-bg.jpg")

    private var ground = 0f
    private var px = 0f
    private var py = 0f
    private var vy = 0f
    private var onFloor = true
    private var meters = 0f
    private var score = 0
    private var frame = 0
    private var tick = 0
    private var lives = 3
    private var hurt = 0
    private var exitIn = 0
    private val foes = mutableListOf<Foe>()
    private val ghosts = mutableListOf<GhostPt>()
    private var replay: List<GhostPt> = emptyList()
    private var mod = "calm"
    private var foeSlot = 0
    private var spawnIn = 110

    init {
        holder.addCallback(this)
        isFocusable = true
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        val save = GameSave(context)
        mod = save.dayMod()
        replay = save.readGhost()?.takeIf { it.day != save.today() }?.samples ?: emptyList()
        if (running) return
        running = true
        finished = false
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

    // Jump fires on ACTION_DOWN for latency; performClick is the accessibility
    // path (TalkBack double-tap / switch access) and jumps too.
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) jump()
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        jump()
        return true
    }

    /** UI thread: only queue the tap; the game thread applies it on its next step. */
    private fun jump() {
        if (!finished) input.request()
    }

    override fun run() = loop(generation)

    private fun loop(my: Int) {
        var last = System.nanoTime()
        while (running && my == generation) {
            val now = System.nanoTime()
            val dt = ((now - last) / 16_666_666f).coerceIn(0.5f, 2.2f)
            last = now
            if (!finished) step(dt)
            val canvas = holder.lockCanvas()
            if (canvas == null) {
                // surface not ready / going away: do not spin a core
                try { Thread.sleep(16) } catch (_: InterruptedException) { break }
                continue
            }
            drawFrame(canvas)
            holder.unlockCanvasAndPost(canvas)
            if (finished) {
                exitIn--
                if (exitIn <= 0) {
                    running = false
                    val m = meters.toInt().coerceAtMost(GameSave.GOAL_M)
                    val sc = score
                    post { onDone(m, sc) }
                }
            }
        }
    }

    private fun step(dt: Float) {
        val w = surfaceW.takeIf { it > 0 } ?: width.takeIf { it > 0 } ?: return
        val h = surfaceH.takeIf { it > 0 } ?: height.takeIf { it > 0 } ?: return
        val g = h * 0.78f
        if (ground != g) {
            val wasOnFloor = py == 0f || py >= ground
            ground = g
            if (wasOnFloor) py = ground
        }
        px = w * 0.18f

        if (input.take() && onFloor) {
            vy = if (mod == "wind") -20.5f else -22f
            onFloor = false
        }

        tick++
        if (hurt > 0) hurt--
        meters += 0.85f * dt
        score = meters.toInt() + foes.count { it.hit } * 20

        vy += 1.15f * dt
        py += vy * dt
        if (py >= ground) {
            py = ground
            vy = 0f
            onFloor = true
        }

        if (--spawnIn <= 0) {
            foeSlot += 1
            val skip = mod == "gold" && foeSlot % 3 == 0
            if (!skip) {
                val air = when {
                    mod == "wire" && foeSlot % 4 == 0 -> true
                    mod == "drones" -> Random.nextFloat() < 0.55f
                    else -> Random.nextFloat() < 0.35f
                }
                foes += Foe(
                    x = w + 40f,
                    y = if (air) ground - 160f else ground,
                    air = air,
                )
            }
            spawnIn = if (mod == "drones") 100 + Random.nextInt(50) else 130 + Random.nextInt(80)
        }
        val speed = (6.2f + meters / 700f) * if (mod == "wind") 1.08f else 1f
        val it = foes.iterator()
        while (it.hasNext()) {
            val f = it.next()
            f.x -= speed * dt
            if (f.x < -120f) it.remove()
            else if (!f.hit && hurt <= 0 && hits(f)) {
                f.hit = true
                lives -= 1
                hurt = 48
                if (lives <= 0) {
                    endRun()
                    return
                }
            }
        }
        if (meters >= GameSave.GOAL_M) endRun()
        if (tick % 8 == 0 && ghosts.size < 80) {
            ghosts += GhostPt(meters, py, onFloor)
        }
        if (tick % 5 == 0) frame++
    }

    private fun hits(foe: Foe): Boolean {
        val hero = RectF(px - 36f, py - 92f, px + 36f, py + 8f)
        val box = if (foe.air) RectF(foe.x - 28f, foe.y - 36f, foe.x + 28f, foe.y + 20f)
        else RectF(foe.x - 30f, foe.y - 40f, foe.x + 30f, foe.y + 8f)
        return RectF.intersects(hero, box)
    }

    private fun endRun() {
        if (finished) return
        finished = true
        meters = meters.coerceAtMost(GameSave.GOAL_M.toFloat())
        exitIn = 54
        val doneMeters = meters.toInt()
        if (doneMeters >= 400) GameSave(context).writeGhost(doneMeters, ghosts)
    }

    private fun drawFrame(c: Canvas) {
        val w = c.width.toFloat()
        val h = c.height.toFloat()
        c.drawColor(Color.parseColor("#07131C"))
        sky?.let {
            val src = android.graphics.Rect(0, 0, it.width, it.height)
            c.drawBitmap(it, src, android.graphics.RectF(0f, 0f, w, h), paint)
        }
        paint.color = Color.parseColor("#12324A")
        c.drawRect(0f, ground + 8f, w, h, paint)
        paint.color = Color.parseColor("#F5C542")
        c.drawRect(0f, ground + 6f, w, ground + 12f, paint)

        for (foe in foes) {
            val bmp = if (foe.air) drone else mite
            drawSprite(c, bmp, foe.x, foe.y, if (foe.air) 88f else 80f)
        }

        val hero = if (onFloor) runFrames.getOrNull(frame % runFrames.size.coerceAtLeast(1)) else jumpFrames.getOrNull((frame / 2) % jumpFrames.size.coerceAtLeast(1))
        paintGhost(c)
        if (hurt == 0 || tick % 4 < 2) drawSprite(c, hero, px, py, 120f)
        if (lives == 1 && !finished) {
            val veil = Paint(paint)
            veil.color = Color.parseColor("#07131C")
            veil.alpha = 46
            c.drawRect(0f, 0f, w, h, veil)
        }

        c.drawText("${meters.toInt()} / ${GameSave.GOAL_M} m", 32f, 64f, hud)
        c.drawText(hudLine.format(score, lives), 32f, 110f, text)
        if (finished) c.drawText(if (meters >= GameSave.GOAL_M) doneLine else retryLine, 32f, 164f, hud)
        else c.drawText(tapLine, 32f, h - 36f, text)
    }

    private fun paintGhost(c: Canvas) {
        if (replay.size < 2) return
        var prev: GhostPt? = null
        for (g in replay) {
            if (g.x > meters) break
            prev = g
        }
        val g = prev ?: return
        if (g.x < meters - 80f || g.x > meters + 900f) return
        val bmp = if (g.grounded) runFrames.getOrNull(frame % runFrames.size.coerceAtLeast(1)) else jumpFrames.getOrNull((frame / 2) % jumpFrames.size.coerceAtLeast(1))
        val gx = width * 0.18f + (g.x - meters) * 0.35f
        val old = paint.alpha
        paint.alpha = 70
        drawSprite(c, bmp, gx, g.y, 120f)
        paint.alpha = old
    }

    private fun drawSprite(c: Canvas, bmp: Bitmap?, cx: Float, baseline: Float, size: Float) {
        if (bmp == null) {
            paint.color = Color.parseColor("#7AD1FF")
            c.drawCircle(cx, baseline - size / 2f, size / 3f, paint)
            return
        }
        val ratio = bmp.width.toFloat() / max(1, bmp.height)
        val dw = size * ratio
        val dest = RectF(cx - dw / 2f, baseline - size, cx + dw / 2f, baseline)
        c.drawBitmap(bmp, null, dest, paint)
    }

    private fun load(path: String): Bitmap? = try {
        context.assets.open(path).use { BitmapFactory.decodeStream(it) }
    } catch (_: Throwable) {
        null
    }

    private fun loadSheet(prefix: String, count: Int): List<Bitmap> {
        val out = ArrayList<Bitmap>(count)
        for (i in 1..count) load("$prefix-$i.png")?.let { out += it }
        return out
    }

    private class Foe(var x: Float, var y: Float, val air: Boolean, var hit: Boolean = false)
}

/**
 * Hand-over of taps from the UI thread to the game thread. A tap is remembered until the next
 * step consumes it (at most one jump per step), so no game state is written from the UI thread.
 */
class RunInput {
    private val pending = java.util.concurrent.atomic.AtomicBoolean(false)
    fun request() { pending.set(true) }
    fun take(): Boolean = pending.getAndSet(false)
}
