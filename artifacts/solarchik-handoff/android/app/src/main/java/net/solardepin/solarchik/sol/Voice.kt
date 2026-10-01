package net.solardepin.solarchik.sol

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Text to speech in the app language (uk-UA or en-US). Silent and honest when the voice is missing. */
class SolVoice(context: Context) {
    private var ready = false
    private var pending: Pair<String, String>? = null
    var missingLanguage: String? = null
        private set
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        pending?.let { (t, l) -> pending = null; speak(t, l) }
    }

    /** Returns false when this phone has no voice for [lang]. */
    fun speak(text: String, lang: String): Boolean {
        if (!ready) { pending = text to lang; return true }
        val loc = localeOf(lang)
        val r = tts.setLanguage(loc)
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            missingLanguage = lang
            return false
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sol-" + text.hashCode())
        return true
    }

    fun stop() = runCatching { tts.stop() }

    fun shutdown() = runCatching { tts.shutdown() }

    companion object {
        fun localeOf(lang: String): Locale = if (lang == "uk") Locale("uk", "UA") else Locale.US
    }
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
