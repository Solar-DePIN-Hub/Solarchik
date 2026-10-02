package net.solardepin.solarchik

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import net.solardepin.solarchik.sol.OpenAiVoice
import net.solardepin.solarchik.sol.SolVoice
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 0.21.8 #3: Sol's streamed voice — sentence cutting for streaming, the OpenAI TTS request and its cache. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceTest {
    private val app = ApplicationProvider.getApplicationContext<Context>()

    @After fun reset() { OpenAiVoice.fetcher = null }

    @Test fun sentencesForStreaming() {
        assertEquals(listOf("Hi. I am Sol, your friend!", "Ready to go?"), SolVoice.sentences("Hi.  I am Sol, your friend! Ready to go?"))
        assertEquals(listOf("Привіт! Твої агенти працюють.", "Я стежу за ринком…"), SolVoice.sentences("Привіт! Твої агенти працюють. Я стежу за ринком…"))
        assertEquals(emptyList<String>(), SolVoice.sentences("   "))
        // only a terminator followed by a space ends a streamed sentence ("3." may become "3.5")
        assertEquals("One sentence done. ".length, SolVoice.lastSentenceEnd("One sentence done. Two"))
        assertEquals(0, SolVoice.lastSentenceEnd("Price is 3."))
        assertEquals(0, SolVoice.lastSentenceEnd("no end yet"))
        assertEquals("Він сказав «так». ".length, SolVoice.lastSentenceEnd("Він сказав «так». Далі"))
    }

    @Test fun openAiRequestAndVoicePref() {
        val u = OpenAiVoice.url("Привіт, світ!", "uk", "marin")
        assertTrue(u, u.contains("/sol/tts?") && u.contains("fmt=pcm") && u.contains("lang=uk") && u.contains("voice=marin") && u.contains("text=%D0%9F"))
        assertTrue(OpenAiVoice.url("hi", "de", "cedar").contains("lang=en"))
        assertEquals(OpenAiVoice.DEFAULT, OpenAiVoice.voice(app))
        OpenAiVoice.setVoice(app, "nope")
        assertEquals("marin", OpenAiVoice.voice(app))
        OpenAiVoice.setVoice(app, "coral")
        assertEquals("coral", OpenAiVoice.voice(app))
        OpenAiVoice.setVoice(app, "marin")
        assertTrue(OpenAiVoice.key("a", "en", "marin") != OpenAiVoice.key("a", "en", "cedar"))
    }

    @Test fun fetchedLinesAreCachedOnce() {
        var calls = 0
        OpenAiVoice.fetcher = { text, lang, voice -> calls++; assertEquals("uk", lang); assertEquals("marin", voice); ByteArray(4800) { (it % 7).toByte() } }
        val line = "Обережно, дріт попереду! ${System.nanoTime()}"
        assertNull(OpenAiVoice.cached(app, line, "uk", "marin"))
        assertNotNull(OpenAiVoice.fetchToCache(app, line, "uk", "marin"))
        val f = OpenAiVoice.cached(app, line, "uk", "marin")
        assertNotNull(f)
        assertEquals(4800L, f!!.length())
        OpenAiVoice.fetchToCache(app, line, "uk", "marin")
        assertEquals(1, calls)
        // a tiny/empty answer (worker 503) is never cached
        OpenAiVoice.fetcher = { _, _, _ -> ByteArray(10) }
        assertNull(OpenAiVoice.fetchToCache(app, "short $line", "uk", "marin"))
    }
}
