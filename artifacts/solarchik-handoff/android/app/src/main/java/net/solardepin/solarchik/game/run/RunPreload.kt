package net.solardepin.solarchik.game.run

import android.content.Context
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Process-wide run assets (0.21.7 first-launch lag fix). Decoding the 2560 px skyline layers,
 * facades, atlas and baking the hero frames used to happen inside the first draw() on the game
 * thread while the countdown already ticked: the owner's video shows a black surface during "2".
 * Now the Yard starts [start] on a background thread, RunView waits for [warm] before it creates
 * the sim, and the same prepared [RunSprites] is reused by every run in this process.
 */
object RunPreload {
    private val lock = Any()
    @Volatile private var sprites: RunSprites? = null
    @Volatile var warmedFor: String = ""
        private set

    /** Device pixels per logical unit for a landscape run on this display. */
    fun pxPerUnit(ctx: Context): Double {
        val dm = ctx.resources.displayMetrics
        val h = min(dm.widthPixels, dm.heightPixels).coerceAtLeast(1)
        return h / RunRenderer.LOGICAL_H
    }

    fun start(ctx: Context, robot: String, skin: String) {
        val app = ctx.applicationContext
        val k = pxPerUnit(ctx)
        Thread({
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
            runCatching { warm(app, robot, skin, k) }
        }, "run-preload").start()
    }

    /** Blocking: everything the first frames need, prepared for [k] px/unit. Cheap when already done. */
    fun warm(ctx: Context, robot: String, skin: String, k: Double): RunSprites = synchronized(lock) {
        val spr = sprites ?: RunSprites(ctx.applicationContext.assets).also { sprites = it }
        spr.art.prepare(k.toFloat(), RunSkin.of(skin))
        spr.prepareHero((RunRenderer.HERO_H * k).roundToInt())
        if (robot != "stock") { spr.robotRun(robot); spr.robotSlide(robot) }
        warmedFor = "$robot|$skin|${(k * 20).roundToInt()}"
        spr
    }

    /** The shared sprites (created empty if nothing was warmed yet; the renderer prepares lazily). */
    fun sprites(ctx: Context): RunSprites = synchronized(lock) {
        sprites ?: RunSprites(ctx.applicationContext.assets).also { sprites = it }
    }

    /** Low memory with no run on screen: drop the cache; the next run warms again. */
    fun trim() = synchronized(lock) { sprites = null; warmedFor = "" }
}
