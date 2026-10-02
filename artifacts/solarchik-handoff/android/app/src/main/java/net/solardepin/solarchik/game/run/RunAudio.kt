package net.solardepin.solarchik.game.run

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.sin

/**
 * Run sounds, ported from the web audio.ts: every effect there is a few WebAudio oscillator
 * "beeps" (type, frequency glide, exponential envelope). Here the same beeps are rendered once
 * into small PCM clips and played through a SoundPool; the theme loops in a MediaPlayer at the
 * web volume (0.2). As on the web, the speaker button mutes the music only, never the effects.
 */
object RunSynth {
    const val RATE = 22050

    enum class Wave { SINE, SQUARE, TRIANGLE, SAW }

    class Beep(val freq: Double, val dur: Double, val wave: Wave, val vol: Double, val slide: Double = 0.0, val delay: Double = 0.0)

    private fun b(freq: Double, dur: Double, wave: Wave, vol: Double, slide: Double = 0.0, delay: Double = 0.0) = Beep(freq, dur, wave, vol, slide, delay)

    /** web play(kind) recipes, beep for beep. */
    val RECIPES: Map<String, List<Beep>> = mapOf(
        "start" to listOf(b(392.0, 0.1, Wave.TRIANGLE, 0.12), b(494.0, 0.1, Wave.TRIANGLE, 0.12, 0.0, 0.08), b(587.0, 0.16, Wave.SINE, 0.14, 0.0, 0.16), b(784.0, 0.22, Wave.SINE, 0.12, 40.0, 0.28)),
        "jump" to listOf(b(520.0, 0.09, Wave.SQUARE, 0.16, 180.0)),
        "double" to listOf(b(640.0, 0.1, Wave.SQUARE, 0.17, 240.0), b(960.0, 0.08, Wave.TRIANGLE, 0.09, 80.0)),
        "land" to listOf(b(140.0, 0.08, Wave.SINE, 0.16, -40.0), b(90.0, 0.05, Wave.TRIANGLE, 0.07, -20.0)),
        "collect" to listOf(b(900.0, 0.07, Wave.TRIANGLE, 0.15, 200.0)),
        "collect2" to listOf(b(884.0, 0.07, Wave.TRIANGLE, 0.15, 200.0)),
        "collect3" to listOf(b(916.0, 0.07, Wave.TRIANGLE, 0.15, 200.0)),
        "gold" to listOf(b(740.0, 0.06, Wave.TRIANGLE, 0.14, 120.0), b(1180.0, 0.1, Wave.SINE, 0.14, 80.0)),
        "combo" to listOf(b(523.0, 0.08, Wave.SQUARE, 0.12), b(659.0, 0.1, Wave.SQUARE, 0.12, 0.0, 0.06), b(784.0, 0.16, Wave.SQUARE, 0.14, 0.0, 0.12), b(1046.0, 0.18, Wave.TRIANGLE, 0.1, 0.0, 0.2)),
        "hurt" to listOf(b(180.0, 0.2, Wave.SAW, 0.2, -90.0), b(90.0, 0.16, Wave.SQUARE, 0.12, -40.0)),
        "dead" to listOf(b(160.0, 0.3, Wave.SAW, 0.22, -80.0), b(70.0, 0.28, Wave.TRIANGLE, 0.12, -30.0)),
        "tick" to listOf(b(440.0, 0.06, Wave.SQUARE, 0.12)),
        "near" to listOf(b(1100.0, 0.06, Wave.SINE, 0.16, -520.0), b(640.0, 0.08, Wave.TRIANGLE, 0.1, -260.0)),
        "stomp" to listOf(b(180.0, 0.1, Wave.SQUARE, 0.22, -50.0), b(520.0, 0.08, Wave.TRIANGLE, 0.12, 180.0), b(90.0, 0.07, Wave.SAW, 0.1, -20.0)),
        "shield" to listOf(b(640.0, 0.1, Wave.SINE, 0.14, 220.0), b(980.0, 0.12, Wave.TRIANGLE, 0.11)),
        "slide" to listOf(b(220.0, 0.12, Wave.SAW, 0.13, -90.0), b(140.0, 0.08, Wave.TRIANGLE, 0.09, -40.0)),
        "grind" to listOf(b(420.0, 0.16, Wave.SQUARE, 0.12, 260.0), b(880.0, 0.12, Wave.TRIANGLE, 0.09, 80.0)),
        "bonus" to listOf(b(523.0, 0.09, Wave.TRIANGLE, 0.13), b(659.0, 0.1, Wave.TRIANGLE, 0.13, 0.0, 0.07), b(784.0, 0.12, Wave.SINE, 0.15, 0.0, 0.14), b(1046.0, 0.2, Wave.SINE, 0.12, 0.0, 0.22)),
        "thunder" to listOf(b(70.0, 0.28, Wave.SAW, 0.2, -20.0), b(42.0, 0.34, Wave.TRIANGLE, 0.15, -10.0)),
        "boss" to listOf(b(110.0, 0.22, Wave.SAW, 0.18, -30.0), b(330.0, 0.18, Wave.SQUARE, 0.1, 40.0), b(880.0, 0.12, Wave.TRIANGLE, 0.09)),
        "chapter" to listOf(b(392.0, 0.08, Wave.TRIANGLE, 0.12), b(523.0, 0.1, Wave.TRIANGLE, 0.13, 0.0, 0.07), b(784.0, 0.16, Wave.SINE, 0.14, 0.0, 0.14)),
        "gust" to listOf(b(160.0, 0.5, Wave.SAW, 0.06, 90.0), b(240.0, 0.4, Wave.TRIANGLE, 0.05, -60.0, 0.1)),
        "crack" to listOf(b(300.0, 0.05, Wave.SQUARE, 0.12, -180.0), b(120.0, 0.12, Wave.SAW, 0.1, -50.0, 0.04)),
        "zap" to listOf(b(1400.0, 0.06, Wave.SQUARE, 0.12, -900.0), b(700.0, 0.12, Wave.SAW, 0.12, -400.0, 0.03)),
        "charge" to listOf(b(220.0, 0.6, Wave.SAW, 0.07, 520.0)),
        "beam" to listOf(b(880.0, 0.22, Wave.SQUARE, 0.12, -300.0), b(110.0, 0.2, Wave.SAW, 0.12, -30.0)),
        "downed" to listOf(b(196.0, 0.12, Wave.SQUARE, 0.18, -60.0), b(523.0, 0.1, Wave.TRIANGLE, 0.13, 0.0, 0.1), b(784.0, 0.12, Wave.SINE, 0.14, 0.0, 0.18), b(1046.0, 0.22, Wave.SINE, 0.12, 0.0, 0.26)),
        "clock" to listOf(b(523.0, 0.08, Wave.TRIANGLE, 0.15), b(784.0, 0.12, Wave.SINE, 0.16, 60.0, 0.08), b(1046.0, 0.2, Wave.SINE, 0.14, 0.0, 0.16)),
    )

    /** Mix [beeps] into 16-bit mono PCM, with the web gain chain (sfx bus 0.85). */
    fun render(beeps: List<Beep>, rate: Int = RATE): ShortArray {
        val end = beeps.maxOf { it.delay + it.dur + 0.02 }
        val n = (end * rate).toInt() + 1
        val mix = DoubleArray(n)
        for (bp in beeps) {
            val start = (bp.delay * rate).toInt()
            val len = ((bp.dur + 0.02) * rate).toInt()
            val f1 = max(40.0, bp.freq + bp.slide)
            var phase = 0.0
            for (i in 0 until len) {
                val t = i.toDouble() / rate
                // exponentialRampToValueAtTime on frequency
                val f = if (bp.slide != 0.0) bp.freq * exp(ln(f1 / bp.freq) * (t / bp.dur).coerceAtMost(1.0)) else bp.freq
                phase += f / rate
                val p = phase - Math.floor(phase)
                val v = when (bp.wave) {
                    Wave.SINE -> sin(2 * PI * p)
                    Wave.SQUARE -> if (p < 0.5) 1.0 else -1.0
                    Wave.TRIANGLE -> 1 - 4 * abs(p - 0.5)
                    Wave.SAW -> 2 * p - 1
                }
                // gain 0.0001 -> vol in 12 ms, then -> 0.0001 at dur (both exponential)
                val g = when {
                    t < 0.012 -> 0.0001 * exp(ln(bp.vol / 0.0001) * t / 0.012)
                    t < bp.dur -> bp.vol * exp(ln(0.0001 / bp.vol) * (t - 0.012) / (bp.dur - 0.012))
                    else -> 0.0
                }
                val j = start + i
                if (j < n) mix[j] += v * g * 0.85
            }
        }
        return ShortArray(n) { (mix[it].coerceIn(-1.0, 1.0) * 32767).toInt().toShort() }
    }

    fun wav(pcm: ShortArray, rate: Int = RATE): ByteArray {
        val data = pcm.size * 2
        val buf = ByteBuffer.allocate(44 + data).order(ByteOrder.LITTLE_ENDIAN)
        buf.put("RIFF".toByteArray()).putInt(36 + data).put("WAVE".toByteArray())
        buf.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(rate).putInt(rate * 2).putShort(2).putShort(16)
        buf.put("data".toByteArray()).putInt(data)
        for (s in pcm) buf.putShort(s)
        return buf.array()
    }

    /** Events the web rate-limits to one per 55 ms. */
    val BUSY = setOf("near", "collect", "land", "grind")

    fun soundOf(ev: Ev): String = ev.name.lowercase()
}

class RunAudio(private val context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE)
    private val pool: SoundPool = SoundPool.Builder().setMaxStreams(8).setAudioAttributes(
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
    ).build()
    private val ids = java.util.concurrent.ConcurrentHashMap<String, Int>()
    @Volatile private var lastBusy = 0L
    private var collectTurn = 0
    private var music: MediaPlayer? = null
    private var wantMusic = false

    /** Music muted (web key "solarchik-mute"). Effects always play, as on the web. */
    var musicMuted: Boolean
        get() = prefs.getBoolean("runMusicMuted", false)
        set(v) { prefs.edit().putBoolean("runMusicMuted", v).apply(); applyMusic() }

    /** Renders and loads the clips off the UI thread. */
    fun prepare() {
        Thread({
            val dir = File(context.cacheDir, "run-sfx-v1").apply { mkdirs() }
            for ((name, beeps) in RunSynth.RECIPES) {
                runCatching {
                    val f = File(dir, "$name.wav")
                    if (!f.isFile || f.length() < 64) FileOutputStream(f).use { it.write(RunSynth.wav(RunSynth.render(beeps))) }
                    ids[name] = pool.load(f.path, 1)
                }
            }
        }, "run-sfx").start()
    }

    /** Thread-safe (SoundPool is): called from the game thread with each step's events. */
    fun play(kind: String) {
        if (kind in RunSynth.BUSY) {
            val now = System.nanoTime()
            if (now - lastBusy < 55_000_000L) return
            lastBusy = now
        }
        val name = if (kind == "collect") arrayOf("collect", "collect2", "collect3")[(collectTurn++ and 0x7fffffff) % 3] else kind
        val id = ids[name] ?: return
        pool.play(id, 1f, 1f, 1, 0, 1f)
    }

    // ---- music: UI thread only ----

    fun startMusic() { wantMusic = true; applyMusic() }
    fun pauseMusic() { wantMusic = false; runCatching { music?.takeIf { it.isPlaying }?.pause() } }
    fun stopMusic() {
        wantMusic = false
        runCatching { music?.takeIf { it.isPlaying }?.pause(); music?.seekTo(0) }
    }

    private fun applyMusic() {
        if (!wantMusic || musicMuted) {
            runCatching { music?.takeIf { it.isPlaying }?.pause() }
            return
        }
        val mp = music ?: runCatching {
            context.assets.openFd("audio/theme.ogg").use { fd ->
                MediaPlayer().apply {
                    setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                    isLooping = true
                    setVolume(0.2f, 0.2f)
                    prepare()
                }
            }
        }.getOrNull()?.also { music = it } ?: return
        runCatching { if (!mp.isPlaying) mp.start() }
    }

    /** Lower the theme while the buddy talks (web duckMusic: 0.2 -> 0.07). */
    fun duck(on: Boolean) { runCatching { music?.setVolume(if (on) 0.07f else 0.2f, if (on) 0.07f else 0.2f) } }

    fun release() {
        runCatching { music?.release() }
        music = null
        runCatching { pool.release() }
    }
}
