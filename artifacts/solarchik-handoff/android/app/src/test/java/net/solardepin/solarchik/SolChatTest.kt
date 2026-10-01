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
    @Test fun sendsWorkerContractWithAtMostFourHistoryTurns() = runBlocking {
        var sent = ""
        val chat = SolChat("https://x/v1/chat") { _, body -> sent = body; """{"ok":true,"reply":"Sun is up.","fallback":false}""" }
        val hist = (1..7).map { ChatTurn(if (it % 2 == 0) "assistant" else "user", "m$it", it.toLong()) } + ChatTurn("assistant", "canned", 9, fallback = true)
        val r = chat.ask("hi", "uk", "p1", "c1", hist)
        assertEquals("Sun is up.", r.text)
        assertFalse(r.fallback)
        val o = Json.parseToJsonElement(sent).jsonObject
        assertEquals("hi", o["message"]!!.jsonPrimitive.content)
        assertEquals("uk", o["language"]!!.jsonPrimitive.content)
        assertEquals("p1", o["playerId"]!!.jsonPrimitive.content)
        assertEquals("c1", o["conversationId"]!!.jsonPrimitive.content)
        assertEquals("yard", o["scene"]!!.jsonPrimitive.content)
        val h = o["history"]!!.jsonArray.map { it.jsonObject["content"]!!.jsonPrimitive.content }
        assertEquals(listOf("m4", "m5", "m6", "m7"), h) // fallback turns are never sent back as context
    }

    @Test fun fallbackAndOfflineAreFlagged() = runBlocking {
        val fb = SolChat("u") { _, _ -> """{"ok":true,"reply":"I'm here.","provider":"fallback","fallback":true}""" }.ask("hi", "en", "p", "c", emptyList())
        assertTrue(fb.fallback)
        assertFalse(fb.offline)
        val off = SolChat("u") { _, _ -> null }.ask("привіт", "uk", "p", "c", emptyList())
        assertTrue(off.offline)
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
