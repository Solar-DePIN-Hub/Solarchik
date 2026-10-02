package net.solardepin.solarchik.game.run

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.Handler
import android.os.Looper
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Pure tables for the run sound (unit-tested): which clip an event plays, its gain, the coin
 * streak pitch ladder and the music track for a moment of the run.
 *
 * Every clip and track is original, synthesised by tools/run-audio (numpy), CC0 — see
 * assets/licenses/AUDIO-CREDITS.txt.
 */
object RunSounds {
    const val GOLDEN = 0
    const val NIGHT = 1
    const val STORM = 2
    const val BOSS = 3
    val TRACKS = arrayOf("golden", "night", "storm", "boss")

    /** Every clip in assets/audio/sfx (name -> mix gain, before the player's SFX volume). */
    val GAIN: Map<String, Float> = mapOf(
        "jump" to 0.55f, "double" to 0.6f, "land" to 0.5f, "slide" to 0.75f, "coin" to 0.55f, "gold" to 0.7f,
        "hurt" to 0.9f, "dead" to 1f, "shield" to 0.8f, "stomp" to 0.8f, "near" to 0.7f, "combo" to 0.7f,
        "tick" to 0.7f, "start" to 0.75f, "grind" to 0.8f, "bonus" to 0.8f, "thunder" to 0.75f, "boss" to 0.85f,
        "chapter" to 0.8f, "clock" to 1f, "milestone" to 0.8f, "gust" to 0.9f, "crack" to 0.85f, "shatter" to 0.9f,
        "zap" to 1f, "charge" to 0.8f, "beam" to 0.85f, "overheat" to 0.85f, "downed" to 1f,
    )

    /** Clip for a sim event (every event has one). */
    fun of(ev: Ev): String = when (ev) {
        Ev.COLLECT -> "coin"
        Ev.HURT -> "hurt"
        else -> ev.name.lowercase()
    }

    /** Clips rate-limited to one per 55 ms (web audio.ts). */
    val BUSY = setOf("near", "land", "grind")

    /** Coins less than [STREAK_GAP] s apart climb a major scale, one step per coin, up an octave. */
    const val STREAK_GAP = 0.5
    private val SCALE = intArrayOf(0, 2, 4, 5, 7, 9, 11, 12)
    fun coinRate(streak: Int): Float = 2.0.pow(SCALE[min(streak, SCALE.size - 1).coerceAtLeast(0)] / 12.0).toFloat()

    /** Music for this moment: the boss theme while the big drone is up, the storm, the night, else golden hour. */
    fun trackOf(s: RunState): Int = when {
        s.bossStage in 1..3 -> BOSS
        s.classic -> when {
            s.distance / 10 >= 1600 -> STORM
            RunSim.moodAt(s.distance) >= 1.3 -> NIGHT
            else -> GOLDEN
        }
        RunSim.cityStormAt(s.distance) > 0.5 -> STORM
        RunSim.cityMoodAt(s.distance) >= 1.3 -> NIGHT
        else -> GOLDEN
    }
}

/**
 * Run audio: effects through a low-latency SoundPool, four looping chapter tracks in MediaPlayers
 * that crossfade (1.6 s) when the run moves between golden hour, night, storm and the boss.
 *
 * The speaker button mutes the music only (as on the web); the music and effects volumes live in
 * Settings (effects at 0 = silent).
 */
class RunAudio(private val context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE)
    private val pool: SoundPool = SoundPool.Builder().setMaxStreams(10).setAudioAttributes(
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
    ).build()
    private val ids = java.util.concurrent.ConcurrentHashMap<String, Int>()
    @Volatile private var lastBusy = 0L
    @Volatile private var lastCoin = 0L
    @Volatile private var streak = 0
    @Volatile private var sfxVol = 0.9f

    private val main = Handler(Looper.getMainLooper())
    private val players = arrayOfNulls<MediaPlayer>(RunSounds.TRACKS.size)
    private val vols = FloatArray(RunSounds.TRACKS.size)
    private var track = RunSounds.GOLDEN
    private var wantMusic = false
    private var ducked = false
    private var musicVol = 0.7f

    /** Music muted (web key "solarchik-mute"). */
    var musicMuted: Boolean
        get() = prefs.getBoolean("runMusicMuted", false)
        set(v) { prefs.edit().putBoolean("runMusicMuted", v).apply(); applyMusic() }

    /** Loads the clips off the UI thread. */
    fun prepare() {
        readVolumes()
        Thread({
            for (name in RunSounds.GAIN.keys) {
                runCatching { context.assets.openFd("audio/sfx/$name.ogg").use { ids[name] = pool.load(it, 1) } }
            }
        }, "run-sfx").start()
    }

    private fun readVolumes() {
        sfxVol = prefs.getInt("runSfxVol", 90).coerceIn(0, 100) / 100f
        musicVol = prefs.getInt("runMusicVol", 70).coerceIn(0, 100) / 100f
    }

    /** Game thread: the step's events, one clip each. */
    fun onEvents(events: List<Ev>) { for (ev in events) play(RunSounds.of(ev)) }

    /** Thread-safe (SoundPool is). */
    fun play(name: String) {
        if (sfxVol <= 0f) return
        val now = System.nanoTime()
        if (name in RunSounds.BUSY) {
            if (now - lastBusy < 55_000_000L) return
            lastBusy = now
        }
        var rate = 1f
        if (name == "coin") {
            streak = if (now - lastCoin < (RunSounds.STREAK_GAP * 1e9).toLong()) streak + 1 else 0
            lastCoin = now
            rate = RunSounds.coinRate(streak)
        }
        val id = ids[name] ?: return
        val v = (RunSounds.GAIN[name] ?: 0.8f) * sfxVol
        pool.play(id, v, v, 1, 0, rate)
    }

    // ---- music: UI thread only ----

    /** Crossfade to [t] (a [RunSounds] track). */
    fun setTrack(t: Int) {
        if (t == track || t !in RunSounds.TRACKS.indices) return
        track = t
        applyMusic()
    }

    fun startMusic() { readVolumes(); wantMusic = true; applyMusic() }
    fun pauseMusic() {
        wantMusic = false
        main.removeCallbacks(fader)
        for (p in players) runCatching { p?.takeIf { it.isPlaying }?.pause() }
    }

    /** End of a run: silence, and the next run starts on golden hour from the top. */
    fun stopMusic() {
        pauseMusic()
        for (i in players.indices) {
            runCatching { players[i]?.seekTo(0) }
            vols[i] = 0f
            runCatching { players[i]?.setVolume(0f, 0f) }
        }
        track = RunSounds.GOLDEN
    }

    private fun player(i: Int): MediaPlayer? = players[i] ?: runCatching {
        context.assets.openFd("audio/music/${RunSounds.TRACKS[i]}.ogg").use { fd ->
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                isLooping = true
                setVolume(0f, 0f)
                prepare()
            }
        }
    }.getOrNull()?.also { players[i] = it }

    private fun target(i: Int): Float = if (i == track && wantMusic && !musicMuted) musicVol * (if (ducked) 0.35f else 1f) else 0f

    private fun applyMusic() {
        main.removeCallbacks(fader)
        if (!wantMusic || musicMuted) {
            for (p in players) runCatching { p?.takeIf { it.isPlaying }?.pause() }
            return
        }
        // a track joining from silence starts at its top; the first track of a run comes straight in
        val first = vols.all { it <= 0f }
        val p = player(track) ?: return
        if (first) { vols[track] = target(track); runCatching { p.setVolume(vols[track], vols[track]) } }
        else if (vols[track] <= 0f) runCatching { p.seekTo(0) }
        runCatching { if (!p.isPlaying) p.start() }
        for (i in players.indices) if (i != track && vols[i] > 0f) runCatching { players[i]?.takeIf { !it.isPlaying }?.start() }
        main.post(fader)
    }

    private val fader = object : Runnable {
        override fun run() {
            var moving = false
            val step = max(0.01f, musicVol) * FADE_STEP_MS / FADE_MS
            for (i in players.indices) {
                val p = players[i] ?: continue
                val want = target(i)
                val v = vols[i]
                val nv = if (v < want) min(want, v + step) else max(want, v - step)
                if (nv != v) {
                    vols[i] = nv
                    runCatching { p.setVolume(nv, nv) }
                }
                if (nv != want) moving = true
                if (nv <= 0f && want <= 0f) runCatching { if (p.isPlaying) p.pause() }
            }
            if (moving) main.postDelayed(this, FADE_STEP_MS.toLong())
        }
    }

    /** Lower the music while the buddy talks. */
    fun duck(on: Boolean) {
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { duck(on) }; return }
        ducked = on
        if (wantMusic) { main.removeCallbacks(fader); main.post(fader) }
    }

    fun release() {
        main.removeCallbacks(fader)
        for (i in players.indices) { runCatching { players[i]?.release() }; players[i] = null }
        runCatching { pool.release() }
    }

    private companion object {
        const val FADE_MS = 1600f
        const val FADE_STEP_MS = 40
    }
}
