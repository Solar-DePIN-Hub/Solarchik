package net.solardepin.solarchik.game

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.core.content.res.ResourcesCompat
import net.solardepin.solarchik.R
import net.solardepin.solarchik.game.run.Input
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunRenderer
import net.solardepin.solarchik.game.run.RunSim
import net.solardepin.solarchik.game.run.RunSkin
import net.solardepin.solarchik.game.run.RunSprites
import net.solardepin.solarchik.game.run.RunState

/**
 * The lobby card and shop preview: a real frame of the run, drawn by the game's own renderer
 * with the equipped (or previewed) roof skin and robot. UI thread; one frame per change.
 */
object RunPreview {
    private var sprites: RunSprites? = null

    /** A fixed, good-looking moment: the robot mid-hop over the first roof, suns ahead. */
    fun scene(): RunState {
        val s = RunSim.create(SEED)
        s.phase = Phase.RUNNING
        s.countdown = 0.0
        s.enemies.clear()
        val idle = Input(false, false, false, false)
        repeat(40) { RunSim.step(s, RunSim.TICK, idle) }
        RunSim.step(s, RunSim.TICK, Input(true, true, false, false))
        repeat(16) { RunSim.step(s, RunSim.TICK, Input(false, true, false, false)) }
        s.pops.clear()
        s.particles.clear()
        s.shake = 0.0
        return s
    }

    fun render(ctx: Context, skin: String, robot: String, w: Int, h: Int): Bitmap {
        val spr = sprites ?: RunSprites(ctx.assets).also { sprites = it }
        val r = RunRenderer(
            spr,
            runCatching { ResourcesCompat.getFont(ctx, R.font.nunito_bold) }.getOrNull(),
            runCatching { ResourcesCompat.getFont(ctx, R.font.fredoka_semibold) }.getOrNull(),
        )
        r.skin = RunSkin.of(skin)
        r.robot = robot
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        r.draw(Canvas(bmp), w, h, scene(), 2.4)
        return bmp
    }

    private const val SEED = 20260621
}
