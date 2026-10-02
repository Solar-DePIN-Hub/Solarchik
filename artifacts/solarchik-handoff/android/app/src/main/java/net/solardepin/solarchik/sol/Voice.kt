package net.solardepin.solarchik.sol

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.media.AudioAttributes
import android.media.MediaPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.solana.Rpc
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Sol's voice. Online: neural Gemini TTS from solarchik-market /api/native/sol-voice (warm voice,
 * WAV, cached per text+language+voice so repeated lines are instant). The phone's system TTS is only
 * the offline fallback. [speak] returns at once; audio starts when the clip is ready.
 */
class SolVoice(context: Context) {
    private val app = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    private var player: MediaPlayer? = null
    private var system: SystemVoice? = null
    var missingLanguage: String? = null
        private set
    /** Model that voiced the last line ("system" offline). For logs/tests only. */
    var lastSource: String = ""
        private set

    /** Returns false only when we already know this phone can't voice [lang] offline. */
    fun speak(text: String, lang: String): Boolean {
        stop()
        val line = text.trim()
        if (line.isEmpty()) return true
        job = scope.launch {
            val file = NeuralVoice.clip(app, line, lang)
            if (file != null) play(file) else {
                lastSource = "system"
                val sys = system ?: SystemVoice(app).also { system = it }
                if (!sys.speak(line, lang)) missingLanguage = lang
            }
        }
        return missingLanguage != lang
    }

    /** Warm the cache for a line that is likely to be spoken soon. */
    fun prefetch(text: String, lang: String) {
        scope.launch { NeuralVoice.clip(app, text.trim(), lang) }
    }

    private fun play(file: java.io.File) {
        runCatching {
            val mp = MediaPlayer()
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            mp.setDataSource(file.absolutePath)
            mp.setOnCompletionListener { it.release(); if (player === it) player = null }
            mp.setOnPreparedListener { it.start() }
            mp.prepareAsync()
            player = mp
            lastSource = "neural"
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        player?.let { runCatching { it.stop() }; runCatching { it.release() } }
        player = null
        system?.stop()
    }

    fun shutdown() {
        stop()
        system?.shutdown()
        scope.cancel()
    }

    companion object {
        fun localeOf(lang: String): Locale = if (lang == "uk") Locale("uk", "UA") else Locale.US
    }
}

/** Neural clips from the server, cached in cacheDir/sol-voice (newest 80 kept). */
object NeuralVoice {
    const val VOICE = "Sulafat"
    private const val KEEP = 80
    private val client by lazy { Rpc.client.newBuilder().callTimeout(25, TimeUnit.SECONDS).build() }
    /** Test seam: replaces the HTTP call. */
    @Volatile var fetcher: (suspend (String, String) -> ByteArray?)? = null

    fun key(text: String, lang: String, voice: String = VOICE): String {
        val d = MessageDigest.getInstance("SHA-1").digest("$lang|$voice|$text".toByteArray())
        return d.joinToString("") { "%02x".format(it) }
    }

    private fun dir(ctx: Context) = java.io.File(ctx.cacheDir, "sol-voice").apply { mkdirs() }

    fun cached(ctx: Context, text: String, lang: String): java.io.File? =
        java.io.File(dir(ctx), key(text, lang) + ".wav").takeIf { it.length() > 1000 }

    suspend fun clip(ctx: Context, text: String, lang: String): java.io.File? = withContext(Dispatchers.IO) {
        if (text.isEmpty()) return@withContext null
        cached(ctx, text, lang)?.let { it.setLastModified(System.currentTimeMillis()); return@withContext it }
        val l = if (lang == "uk") "uk" else "en"
        val bytes = try {
            val f = fetcher
            if (f != null) f(text.take(400), l) else download(text.take(400), l)
        } catch (c: kotlinx.coroutines.CancellationException) {
            throw c
        } catch (_: Throwable) {
            null
        }
        if (bytes == null || bytes.size < 1000 || String(bytes, 0, 4, Charsets.US_ASCII) != "RIFF") return@withContext null
        val d = dir(ctx)
        val out = java.io.File(d, key(text, lang) + ".wav")
        val tmp = java.io.File(d, out.name + ".part")
        tmp.writeBytes(bytes)
        tmp.renameTo(out)
        d.listFiles { f -> f.name.endsWith(".wav") }?.sortedByDescending { it.lastModified() }?.drop(KEEP)?.forEach { it.delete() }
        out
    }

    private fun download(text: String, lang: String): ByteArray? {
        val body = buildJsonObject { put("text", text); put("language", lang); put("voice", VOICE) }.toString()
        val req = Request.Builder().url(SolarchikConfig.SOL_VOICE_URL)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return client.newCall(req).execute().use { res ->
            val type = res.header("content-type").orEmpty()
            if (res.isSuccessful && type.startsWith("audio/")) res.body?.bytes() else null
        }
    }
}

/** The phone's own TTS (offline fallback). */
private class SystemVoice(context: Context) {
    private var ready = false
    private var pending: Pair<String, String>? = null
    private val tts: TextToSpeech = TextToSpeech(context) { status ->
        ready = status == TextToSpeech.SUCCESS
        pending?.let { (t, l) -> pending = null; speak(t, l) }
    }

    fun speak(text: String, lang: String): Boolean {
        if (!ready) { pending = text to lang; return true }
        val r = tts.setLanguage(SolVoice.localeOf(lang))
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) return false
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sol-" + text.hashCode())
        return true
    }

    fun stop() = runCatching { tts.stop() }
    fun shutdown() = runCatching { tts.shutdown() }
}

/** One-shot speech recognition. Callbacks arrive on the main thread. */
class SolEars(private val context: Context) {
    private var rec: SpeechRecognizer? = null

    fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    fun listen(lang: String, onPartial: (String) -> Unit, onDone: (String?) -> Unit) {
        stop()
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        rec = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) { onDone(null); stop() }
            override fun onResults(results: Bundle?) {
                onDone(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull())
                stop()
            }
            override fun onPartialResults(partial: Bundle?) {
                partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val tag = SolVoice.localeOf(lang).toLanguageTag()
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, tag)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        })
    }

    fun stop() {
        rec?.let { runCatching { it.cancel(); it.destroy() } }
        rec = null
    }
}
