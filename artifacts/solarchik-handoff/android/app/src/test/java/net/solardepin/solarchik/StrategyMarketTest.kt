package net.solardepin.solarchik

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import net.solardepin.solarchik.agents.StrategyApi
import net.solardepin.solarchik.agents.StrategyCard
import net.solardepin.solarchik.agents.StrategyRules
import net.solardepin.solarchik.agents.StrategyRules.Trade
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors strategy.test.ts vectors so the phone's Verify gives the same answer as the web and the server. */
class StrategyMarketTest {
    private val day = 86_400_000L
    private val changedSec = 1790812800L
    private val trades = listOf(
        Trade(changedSec * 1000 + 1000, changedSec * 1000 + 60_000, 10_000_000, 2_000_000),
        Trade(changedSec * 1000 + 2000, changedSec * 1000 + 3 * day, 15_000_000, -500_000),
        Trade(changedSec * 1000 - 5000, changedSec * 1000 + 70_000, 20_000_000, 9_000_000),
        Trade(changedSec * 1000 + 3000, changedSec * 1000 + 36 * 3_600_000, 12_000_000, 1_234_567),
    )

    @Test fun proofMessageIsTheServerFormat() {
        assertEquals("solarchik:market:v1\nwallet:W\nts:5\nbuy:A:10", StrategyRules.proofMessage("market", "W", 5, "buy:A:10"))
    }

    @Test fun verifyMatchesTheServerValues() {
        // Values the TS server writes for this vector (computePerf → perfAttrs → perfFromAttrs at pu = 1790985723).
        val onChain = StrategyRules.Perf(trades = 2, winRatePct = 100.0, realizedSol = 0.00324, apr7 = 4915.7, apr30 = 4915.7, aprSince = 4915.7, writtenSec = 1790985723)
        val r = StrategyRules.verify(trades, changedSec, onChain)
        assertTrue(r.mismatches.joinToString(), r.ok)
        assertEquals(1, r.newer)
        val forged = StrategyRules.verify(trades, changedSec, onChain.copy(aprSince = 99_999.0))
        assertFalse(forged.ok)
    }

    @Test fun perfOverLongerRunMatchesTs() {
        val p = StrategyRules.computePerf(trades, changedSec * 1000, changedSec * 1000 + 40 * day)
        assertEquals(3, p.trades)
        assertEquals(66.7, p.winRatePct!!, 1e-9)
        assertEquals(0.002735, p.realizedSol, 1e-12)
        assertNull(p.apr7)
        assertEquals(166.4, p.aprSince!!, 1e-9)
    }

    @Test fun roundingIsJsToFixed() {
        assertEquals(0.3, StrategyRules.fix(0.25, 1), 0.0)
        assertEquals(1.0, StrategyRules.fix(1.005, 2), 0.0) // 1.005 is 1.00499… in binary, as in JS
        assertEquals(-0.3, StrategyRules.fix(-0.25, 1), 0.0)
    }

    @Test fun saleLockAndRoyalty() {
        assertEquals(240, StrategyRules.SALE_LOCK_HOURS)
        assertNull(StrategyRules.lockParts(StrategyRules.lockLeftMs(100, 100_000)))
        assertEquals(9L to 23L, StrategyRules.lockParts(StrategyRules.lockLeftMs(240 * 3600L, 3_600_000L)))
        assertEquals(9_500_000L to 500_000L, StrategyRules.splitSale(10_000_000))
        assertEquals("https://explorer.solana.com/tx/S?cluster=devnet", StrategyRules.explorerTx("S"))
    }

    @Test fun parsesMarketItems() {
        val body = Json.parseToJsonElement(
            """{"ok":true,"items":[{"asset":"A1","name":"Bot","owner":"S","priceLamports":10000000,
            "chain":{"spec":{"lanes":["crypto"],"windows":[15],"risk":"calm","stakeSol":0.01,"askLo":0.1,"askHi":0.9,"edgeBps":0,"stopPct":50,"takePct":100,"rules":""},
            "version":2,"hash":"H","hashOk":true,"changedSec":10,"unlockSec":864010},
            "perf":{"trades":1,"winRatePct":100,"realizedSol":0.002,"apr7":null,"apr30":null,"aprSince":7300,"writtenSec":20},
            "listing":{"status":"active"},"records":[{"openedMs":10001,"closedMs":10002,"stakeLamports":10000000,"pnlLamports":2000000,"feeSigs":["F1"]}],
            "versions":[{"sig":"V2"}],"perfWrite":{"sig":"P1"},"sales":[]}]}""",
        ).jsonObject
        val items = StrategyCard.parseMarket(body)
        assertEquals(1, items.size)
        val c = items[0]
        assertEquals(10_000_000L, c.priceLamports)
        assertTrue(c.listed && c.hashOk && c.hasChain)
        assertEquals(listOf("F1"), c.feeSigs)
        assertEquals("P1", c.perfSig)
        assertEquals(7300.0, c.perf!!.aprSince!!, 0.0)
        assertTrue(c.summary.startsWith("crypto · 15 min · calm"))
        assertTrue(StrategyCard.parseMarket(Json.parseToJsonElement("""{"ok":false}""").jsonObject).isEmpty())
        assertEquals(0, StrategyApi.txs(Json.parseToJsonElement("""{"txs":[]}""").jsonObject).size)
    }
}
