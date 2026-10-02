package net.solardepin.solarchik

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.solardepin.solarchik.sol.ChatTurn
import net.solardepin.solarchik.sol.SolChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SolChatTest {
    @Test fun sendsWorkerContractWithRecentRealTurnsOnly() = runBlocking {
        var sent = ""
        val chat = SolChat("https://x/v1/chat") { _, body -> sent = body; """{"ok":true,"reply":"Сонце вже встало.","fallback":false}""" }
        val hist = (1..9).map { ChatTurn(if (it % 2 == 0) "assistant" else "user", "m$it", it.toLong()) } + ChatTurn("assistant", "canned", 10, fallback = true)
        val r = chat.ask("hi", "uk", "p1", "c1", hist)
        assertEquals("Сонце вже встало.", r.text)
        assertFalse(r.fallback)
        val o = Json.parseToJsonElement(sent).jsonObject
        assertEquals("hi", o["message"]!!.jsonPrimitive.content)
        assertEquals("uk", o["language"]!!.jsonPrimitive.content)
        assertEquals("p1", o["playerId"]!!.jsonPrimitive.content)
        assertEquals("c1", o["conversationId"]!!.jsonPrimitive.content)
        assertEquals("yard", o["scene"]!!.jsonPrimitive.content)
        val h = o["history"]!!.jsonArray.map { it.jsonObject["content"]!!.jsonPrimitive.content }
        assertEquals(listOf("m4", "m5", "m6", "m7", "m8", "m9"), h) // fallback turns are never sent back as context
    }

    @Test fun marketFirstThenFriendWhenTheReplyIsInTheWrongLanguage() = runBlocking {
        val calls = mutableListOf<String>()
        val chat = SolChat(listOf("https://m/api/native/sol-chat", "https://f/v1/chat")) { url, _ ->
            calls += url
            if (url.contains("sol-chat")) """{"ok":true,"reply":"Let us soar! Один заряд лишився.","model":"x"}"""
            else """{"reply":"Тримайся, ще один стрибок!","fallback":false}"""
        }
        val r = chat.ask("Подія: останнє серце", "uk", "p", "c", emptyList(), scene = "run")
        assertEquals(listOf("https://m/api/native/sol-chat", "https://f/v1/chat"), calls)
        assertEquals("Тримайся, ще один стрибок!", r.text)
        assertFalse(r.fallback)
        // The market body has no companion name (the server reads "name" as the player's name).
        var marketBody = ""
        SolChat(listOf("https://m/api/native/sol-chat")) { _, b -> marketBody = b; """{"ok":true,"reply":"Hi there!"}""" }.ask("hi", "en", "p", "c", emptyList())
        assertFalse(Json.parseToJsonElement(marketBody).jsonObject.containsKey("name"))
    }

    @Test fun languageGuard() {
        assertTrue(SolChat.fitsLanguage("Привіт! Pro-агент коштує 0.1 SOL.", "uk"))
        assertFalse(SolChat.fitsLanguage("Let us soar!", "uk"))
        assertFalse(SolChat.fitsLanguage("Привіт, відст kupi!", "uk"))
        assertFalse(SolChat.fitsLanguage("Привет, как дела? Это ты?", "uk"))
        assertTrue(SolChat.fitsLanguage("Keep going, friend!", "en"))
        assertFalse(SolChat.fitsLanguage("Привіт!", "en"))
    }

    @Test fun fallbackAndOfflineAreFlagged() = runBlocking {
        val fb = SolChat("u") { _, _ -> """{"ok":true,"reply":"I'm here.","provider":"fallback","fallback":true}""" }.ask("hi", "en", "p", "c", emptyList())
        assertTrue(fb.fallback)
        assertFalse(fb.offline)
        assertEquals(SolChat.offlineLine("en"), fb.text) // canned server text is never shown as Sol's own words
        val off = SolChat("u") { _, _ -> null }.ask("привіт", "uk", "p", "c", emptyList())
        assertTrue(off.offline)
        assertTrue(off.fallback)
        assertEquals(SolChat.offlineLine("uk"), off.text)
        val broken = SolChat("u") { _, _ -> throw java.io.IOException("no net") }.ask("hi", "en", "p", "c", emptyList())
        assertTrue(broken.offline)
    }

    @Test fun numberGuardMatchesWebDailyReport() {
        val note = "Closed positions: 3, in profit: 2. P&L 0.00041 SOL. Streak: 5 days."
        assertTrue(SolChat.onlyKnownNumbers("Five-day streak, 2 of 3 in profit, 0.00041 SOL.", note))
        assertFalse(SolChat.onlyKnownNumbers("You made 0.5 SOL across 3 positions!", note))
        assertTrue(SolChat.onlyKnownNumbers("Nice work today.", note))
    }
}

class SolRulesTest {
    @Test fun tidyKeepsWholeSentences() {
        val s = net.solardepin.solarchik.sol.SolRules
        assertEquals("Run early. It is cool.", s.tidy("Run early. It is cool. And then when the"))
        assertEquals("Hi!", s.tidy("Hi!"))
        assertEquals("Привіт! Краще бігти зранку, коли ще…", s.tidy("Привіт! Краще бігти зранку, коли ще"))
    }
}
