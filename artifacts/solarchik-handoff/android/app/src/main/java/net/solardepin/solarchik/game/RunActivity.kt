package net.solardepin.solarchik.game

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import net.solardepin.solarchik.game.run.DayMod
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.GhostSample
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunAudio
import net.solardepin.solarchik.game.run.RunSim

/**
 * Full-screen immersive roof run (landscape, like the web runner). Hosts the RunView surface and
 * the RunOverlay HUD; records the result (best distance / score, today's CLOCK IN unlock at
 * GameSave.GOAL_M, the ghost) as soon as the run ends, exactly when the web commits it.
 */
class RunActivity : ComponentActivity(), RunView.Listener, RunOverlay.Actions {
    private lateinit var save: GameSave
    private lateinit var game: RunView
    private lateinit var overlay: RunOverlay
    private lateinit var audio: RunAudio
    private lateinit var radio: RunRadio
    private val scope = MainScope()
    private var hud: RunHud? = null
    private var paused = false
    private var ended = false

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) radio.startListen() else overlay.setCaption(getString(net.solardepin.solarchik.R.string.run_mic_denied))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        save = GameSave(this)
        audio = RunAudio(this).also { it.prepare() }
        game = RunView(this, this).also { it.audio = audio }
        overlay = RunOverlay(this, this)
        radio = RunRadio(this, scope, lang(), audio, onCaption = { overlay.setCaption(it) }, onListening = { overlay.setListening(it) })
        overlay.buddy.setImageBitmap(runCatching { assets.open("sprites/pet/buddy-talk-3.png").use { android.graphics.BitmapFactory.decodeStream(it) } }.getOrNull())
        overlay.setMuted(audio.musicMuted)
        overlay.setMicAvailable(android.speech.SpeechRecognizer.isRecognitionAvailable(this))

        val root = FrameLayout(this)
        root.addView(game, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val c = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            overlay.setSafeInsets(c.left, c.top, c.right, c.bottom)
            insets
        }
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (ended) yard() else pauseToggle()
            }
        })
        startRun()
    }

    private fun lang() = if (resources.configuration.locales[0].language == "uk") "uk" else "en"

    private fun setup(): RunSetup {
        val today = save.today()
        val ghost = save.readGhost()?.takeIf { it.day != today }?.samples?.map { GhostSample(it.x.toDouble(), it.y.toDouble(), it.grounded) }.orEmpty()
        return RunSetup(
            seed = RunSim.daySeed(today),
            mod = DayMod.of(save.dayMod()),
            offerBonus = save.offerBonus(),
            goalMeters = GameSave.GOAL_M,
            ghost = ghost,
        )
    }

    private fun startRun() {
        ended = false
        paused = false
        hud = null
        overlay.setPaused(false)
        overlay.setCaption("")
        game.start(setup())
        audio.play("start")
        audio.startMusic()
        radio.live = true
        radio.paused = false
        radio.begin()
    }

    // ---- RunView.Listener (UI thread) ----

    override fun onHud(hud: RunHud) {
        this.hud = hud
        overlay.bind(hud, save.signedToday())
        radio.onHud(hud)
    }

    override fun onEvents(events: List<Ev>, hud: RunHud) {
        radio.push(events, hud)
        // web buzz(): jump 18 ms, hurt 40 ms, clock 55 ms
        when {
            Ev.CLOCK in events || Ev.HURT in events -> game.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            Ev.JUMP in events -> game.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        }
    }

    override fun onResult(result: RunResult) {
        if (ended) return
        ended = true
        val h = result.hud
        val meters = h.meters.coerceIn(0, GameSave.GOAL_M)
        save.recordRun(meters, h.score)
        if (meters >= 400) save.writeGhost(meters, result.ghost)
        setResult(RESULT_OK)
        radio.live = false
        if (h.phase == Phase.DEAD) audio.stopMusic()
        overlay.bind(h, save.signedToday())
    }

    // ---- RunOverlay.Actions ----

    override fun pauseToggle() = setPaused(!paused)

    private fun setPaused(p: Boolean) {
        if (ended && p) return
        paused = p
        game.paused = p
        game.releaseAll()
        overlay.setPaused(p)
        radio.paused = p
        if (p) audio.pauseMusic() else audio.startMusic()
    }

    override fun resume() = setPaused(false)

    override fun yard() {
        audio.stopMusic()
        finish()
    }

    override fun again() {
        radio.stopListen()
        startRun()
    }

    override fun sign() {
        // Same as the web onClock: sign the day now. The Yard owns the wallet flow.
        setResult(RESULT_OK, Intent().putExtra(EXTRA_SIGN, true))
        audio.stopMusic()
        finish()
    }

    override fun musicToggle() {
        val next = !audio.musicMuted
        audio.musicMuted = next
        overlay.setMuted(next)
        if (!next && !paused && !ended) audio.startMusic()
    }

    override fun mic() {
        if (radio.listening) {
            radio.stopListen()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) radio.startListen()
        else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    override fun slideDown() = game.slideDown()
    override fun slideUp() = game.slideUp()

    // ---- keyboard (web: Space/Up/W/K jump, Down/S/J slide, Esc/P pause) ----

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_ESCAPE, KeyEvent.KEYCODE_P -> { if (event.repeatCount == 0 && !ended) pauseToggle(); return true }
            KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_K, KeyEvent.KEYCODE_NUMPAD_0 -> {
                if (event.repeatCount == 0) game.jumpDown()
                return true
            }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_S, KeyEvent.KEYCODE_J -> {
                if (event.repeatCount == 0) game.slideDown()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_K, KeyEvent.KEYCODE_NUMPAD_0 -> { game.jumpUp(); return true }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_S, KeyEvent.KEYCODE_J -> { game.slideUp(); return true }
        }
        return super.onKeyUp(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        // web: the tab going hidden pauses the run
        if (!ended && hud != null) setPaused(true)
        audio.pauseMusic()
    }

    override fun onResume() {
        super.onResume()
        if (!paused && !ended) audio.startMusic()
    }

    override fun onDestroy() {
        radio.shutdown()
        audio.release()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_SIGN = "solarchik.run.sign"
    }
}
