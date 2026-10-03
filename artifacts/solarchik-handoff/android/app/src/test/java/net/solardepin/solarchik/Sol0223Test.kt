package net.solardepin.solarchik

import kotlinx.coroutines.runBlocking
import net.solardepin.solarchik.sol.ActContext
import net.solardepin.solarchik.sol.SolActClient
import net.solardepin.solarchik.sol.SolBrain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** 0.22.3: the first in-game question always gets Sol's answer; a run never falls back to the agent desk. */
class Sol0223Test {
    private val ctx = ActContext(emptyList(), emptyList(), false)

    @Test fun firstCallFailureIsRetriedOnce() = runBlocking {
        var calls = 0
        val brain = SolBrain(market = SolActClient(post = { _, _ -> error("market must not be asked") }), stream = { _, _, onLine ->
            calls++
            if (calls == 1) false else { onLine("""{"d":"Тримай комбо!"}"""); onLine("""{"done":true,"ok":true,"reply":"Тримай комбо!","model":"m"}"""); true }
        })
        val r = brain.ask("Як побити рекорд?", "uk", "run", ctx, emptyList())
        assertEquals(2, calls)
        assertEquals(SolBrain.Source.WORKER, r.source)
        assertEquals("Тримай комбо!", r.reply)
    }

    @Test fun runNeverAsksTheAgentDesk() = runBlocking {
        var market = 0
        val brain = SolBrain(market = SolActClient(post = { _, _ -> market++; """{"ok":true,"reply":"Налаштування агента…"}""" }), stream = SolBrain.NO_WORKER)
        val r = brain.ask("Що тут робити?", "uk", "run", ctx, emptyList())
        assertEquals(0, market)
        assertEquals(SolBrain.Source.OFFLINE, r.source)
        assertFalse(r.reply.contains("агент"))
    }
}
