package net.solardepin.solarchik.game.run

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory

/**
 * The web runner sprites (public/sprites on the web build), loaded from app assets. Big
 * sources (the 800 px foes) are subsampled on decode: they are drawn about 60 px tall.
 */
class RunSprites(private val assets: AssetManager) {
    val run: List<Bitmap> = (1..8).mapNotNull { load("sprites/hero-run-$it.png") }
    val jump: List<Bitmap> = (1..4).mapNotNull { load("sprites/hero-jump-$it.png") }
    val mite: Bitmap? = load("sprites/foe-mite.png", maxH = 220)
    val drone: Bitmap? = load("sprites/foe-drone.png", maxH = 240)
    val cottage: Bitmap? = load("sprites/farm/cottage.png", maxH = 200)
    val greenhouse: Bitmap? = load("sprites/farm/greenhouse.png", maxH = 200)
    val buddy: Bitmap? = load("sprites/pet/buddy-talk-3.png", maxH = 160)

    /** Painted world art (layers, rooftops, coins, clouds, sun). */
    val art = RunArt(assets)

    private val robots = HashMap<String, List<Bitmap>>()

    /** web SPR.robotRun(id): the bought robot's 4-frame run strip (empty if missing). */
    fun robotRun(id: String): List<Bitmap> = robots.getOrPut(id) {
        if (!ROBOT_ID.matches(id)) emptyList() else (1..4).mapNotNull { load("sprites/robots/$id-run-$it.png") }
    }

    /** web heroFrame(grounded, vy, runPhase, squash) */
    fun heroFrame(grounded: Boolean, vy: Double, runPhase: Double, squash: Double): Bitmap? {
        if (!grounded && jump.size == 4) {
            if (squash > 0.4 && vy >= 0) return jump[0]
            if (vy < -220) return jump[1]
            if (vy < 80) return jump[2]
            return jump[3]
        }
        if (run.isEmpty()) return null
        val n = run.size
        val i = ((Math.floor(runPhase).toInt() % n) + n) % n
        return run[i]
    }

    private companion object {
        val ROBOT_ID = Regex("^[a-z]+$")
    }

    private fun load(path: String, maxH: Int = 0): Bitmap? = try {
        val opts = BitmapFactory.Options()
        if (maxH > 0) {
            opts.inJustDecodeBounds = true
            assets.open(path).use { BitmapFactory.decodeStream(it, null, opts) }
            var sample = 1
            while (opts.outHeight / (sample * 2) >= maxH) sample *= 2
            opts.inJustDecodeBounds = false
            opts.inSampleSize = sample
        }
        assets.open(path).use { BitmapFactory.decodeStream(it, null, opts) }
    } catch (_: Throwable) {
        null
    }
}
