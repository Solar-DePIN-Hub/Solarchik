package net.solardepin.solarchik.sol

import android.content.Context
import net.solardepin.solarchik.core.SolarchikConfig
import okhttp3.Request

/**
 * 0.21.9: one Sol turn timed stage by stage, so the voice gap can be measured instead of guessed.
 * t0 is the end of the player's speech (voice) or the send tap (text). Stages, ms after t0:
 * stt = recognizer final text, request = context ready and the request leaves, token = first streamed
 * word, audio = first sound. Logged as `SolLatency` and kept for Settings › Voice.
 */
object SolLatency {
    data class Turn(
        val voice: Boolean,
        val t0: Long,
        var stt: Long = -1,
        var request: Long = -1,
        var token: Long = -1,
        var audio: Long = -1,
        var contextMs: Long = -1,
        /** Recognizer's own onEndOfSpeech, ms after t0 (its silence window). */
        var eos: Long = -1,
    ) {
        fun line(): String = "voice=$voice eos=$eos stt=$stt request=$request ctx=$contextMs token=$token audio=$audio"
    }

    @Volatile var current: Turn? = null
        private set
    @Volatile var last: Turn? = null
        private set
    /** Test seam. */
    @Volatile var clock: () -> Long = { android.os.SystemClock.elapsedRealtime() }

    /** End of speech (recognizer onEndOfSpeech, or the early-final timer). Starts a voice turn. */
    fun speechEnded(at: Long? = null) { current = Turn(voice = true, t0 = at ?: clock()) }

    fun endOfSpeech() { current?.let { if (it.voice && it.eos < 0) it.eos = clock() - it.t0 } }

    fun sttFinal() { current?.let { if (it.voice && it.stt < 0) it.stt = clock() - it.t0 } }

    /** A text send starts its own turn; a voice send continues the turn its speech started. */
    fun sent(voice: Boolean) {
        val c = current
        if (!voice || c == null || !c.voice || clock() - c.t0 > 15_000) current = Turn(voice = false, t0 = clock())
    }

    fun request(contextMs: Long) { current?.let { if (it.request < 0) { it.request = clock() - it.t0; it.contextMs = contextMs } } }

    fun firstToken() { current?.let { if (it.token < 0) it.token = clock() - it.t0 } }

    /** First sound of the reply: closes the turn. */
    fun firstAudio(ctx: Context?) {
        val c = current ?: return
        if (c.audio >= 0) return
        c.audio = clock() - c.t0
        finish(ctx)
    }

    /** Reply finished without voice (voice off / offline). */
    fun done(ctx: Context?) { if (current != null && current?.audio == -1L) finish(ctx) }

    private fun finish(ctx: Context?) {
        val c = current ?: return
        last = c
        current = null
        runCatching { android.util.Log.i("SolLatency", c.line()) }
        ctx?.applicationContext?.getSharedPreferences("solarchik-voice", Context.MODE_PRIVATE)?.edit()
            ?.putString("lat", "${if (c.voice) 1 else 0},${c.stt},${c.request},${c.token},${c.audio},${c.contextMs},${c.eos}")?.apply()
    }

    fun stored(ctx: Context): Turn? {
        val p = ctx.applicationContext.getSharedPreferences("solarchik-voice", Context.MODE_PRIVATE).getString("lat", null) ?: return null
        val v = p.split(',').mapNotNull { it.toLongOrNull() }
        if (v.size < 6) return null
        return Turn(v[0] == 1L, 0, v[1], v[2], v[3], v[4], v[5], v.getOrElse(6) { -1 })
    }

    /** "0.4 s" style, "—" when the stage did not happen. */
    fun sec(ms: Long): String = if (ms < 0) "—" else String.format(java.util.Locale.ROOT, "%.1f s", ms / 1000.0)

    @Volatile private var warmedAt = 0L

    /**
     * Opens the TLS connection to the worker ahead of the request (mic started / Sol tab opened), so the
     * request does not pay DNS + TLS after the player stops talking. At most once a minute.
     */
    fun prewarmWorker() {
        val now = System.currentTimeMillis()
        if (now - warmedAt < 60_000) return
        warmedAt = now
        Thread {
            runCatching {
                val base = SolarchikConfig.SOL_BRAIN_URL.substringBefore("/sol/")
                net.solardepin.solarchik.solana.Rpc.client.newCall(Request.Builder().url("$base/health").build()).execute().close()
            }
        }.apply { isDaemon = true; name = "sol-prewarm" }.start()
    }
}
