package net.solardepin.solarchik

import net.solardepin.solarchik.game.RunRadio
import net.solardepin.solarchik.game.run.BanterKind
import net.solardepin.solarchik.game.run.ScriptLine
import net.solardepin.solarchik.sol.ActType
import net.solardepin.solarchik.sol.SolAction
import net.solardepin.solarchik.sol.SolHandoff
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.21.8 #4: what the run radio may say, and when (the late "wire ahead" bug). */
class RunRadioPolicyTest {
    private val P = RunRadio.Policy

    @Test fun timeCriticalHintsAreLocal() {
        for (k in listOf(BanterKind.HURT, BanterKind.COMBO, BanterKind.BONUS, BanterKind.CHAPTER, BanterKind.BOSS, BanterKind.SHIELD)) assertFalse(k.name, P.aiForBanter(k))
        assertTrue(P.aiForBanter(BanterKind.GO))
        assertTrue(P.aiForBanter(BanterKind.DEAD))
        assertTrue(P.aiForScript(ScriptLine.CLOCK_READY))
        assertFalse(P.aiForScript(ScriptLine.LAST_HEART))
        assertFalse(P.aiForScript(ScriptLine.FIRST_ROOF))
    }

    @Test fun staleHintsAreDropped() {
        assertFalse(P.stale(1_000, 1_500, P.HINT_MAX_AGE_MS, over = false, aboutEnd = false))
        assertTrue("older than 0.8 s", P.stale(1_000, 1_900, P.HINT_MAX_AGE_MS, over = false, aboutEnd = false))
        assertTrue("after DEAD", P.stale(1_000, 1_100, P.HINT_MAX_AGE_MS, over = true, aboutEnd = false))
        assertFalse("the DEAD line itself", P.stale(1_000, 1_100, P.HINT_MAX_AGE_MS, over = true, aboutEnd = true))
        assertEquals(12_000L, P.LISTEN_MS)
    }

    @Test fun wrongLanguageCaptionsFallBackToLocal() {
        assertEquals("Тримайся, ще трохи!", P.caption(" Тримайся, ще трохи! ", "uk"))
        assertNull(P.caption("Keep going, almost there!", "uk"))
        assertNull(P.caption("", "en"))
        assertNull(P.caption(null, "en"))
        assertEquals("Nice jump!", P.caption("Nice jump!", "en"))
    }

    @Test fun midRunActionsWaitForTheSolTab() {
        SolHandoff.take()
        SolHandoff.put("start my weather agent", SolAction(ActType.START_AGENT, agent = "paper:sku-pred-weather"))
        val p = SolHandoff.take()
        assertEquals("paper:sku-pred-weather", p?.action?.agent)
        assertNull("taken once", SolHandoff.take())
        SolHandoff.put("x", SolAction(ActType.MINT_FREE))
        assertNull("expired", SolHandoff.take(now = System.currentTimeMillis() + 31 * 60_000L))
    }
}
