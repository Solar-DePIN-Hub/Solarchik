package net.solardepin.solarchik

import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.core.FeeLedger
import net.solardepin.solarchik.core.FeeReason
import net.solardepin.solarchik.core.SolarchikConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FeeLedgerTest {
    private fun plan(tier: String?, pnl: Double, paper: Boolean = false, covered: Boolean = false) =
        FeeLedger.planFee("p1", "Combo Prime", tier, 1000, 2000, pnl, paper, covered)

    @Test fun configMatchesWeb() {
        assertEquals(0.1, SolarchikConfig.PRO_PRICE_SOL, 0.0)
        assertEquals(0.05, SolarchikConfig.FREE_FEE_RATE, 0.0)
        assertEquals(500, SolarchikConfig.ROYALTY_BPS)
        assertEquals("8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic", SolarchikConfig.TREASURY)
    }

    @Test fun feeCutIsFivePercentInWholeLamports() {
        assertEquals(0.05, FeeLedger.feeCut(1.0), 1e-12)
        assertEquals(0.00061725, FeeLedger.feeCut(0.012345), 1e-12)
        assertEquals(0.0, FeeLedger.feeCut(0.000000001), 0.0) // 0.05 lamport rounds to 0 -> no fee
        assertEquals(1e-9, FeeLedger.feeCut(0.00000002), 1e-15) // 1 lamport
        assertEquals(0.0, FeeLedger.feeCut(0.0), 0.0)
        assertEquals(0.0, FeeLedger.feeCut(-1.0), 0.0)
    }

    @Test fun freeProfitOwesFee() {
        val r = plan(AgentTier.FREE, 0.2)
        assertEquals(FeeReason.UNSENT, r.reason)
        assertEquals(0.01, r.fee, 1e-12)
        assertFalse(r.charged)
        assertTrue(r.owes)
    }

    @Test fun proNeverPays() {
        val r = plan(AgentTier.PRO, 0.2)
        assertEquals(FeeReason.PRO, r.reason)
        assertEquals(0.0, r.fee, 0.0)
    }

    @Test fun missingTierIsTreatedAsPro() {
        assertEquals(FeeReason.PRO, plan(null, 0.2).reason)
    }

    @Test fun lossNeverPays() {
        assertEquals(FeeReason.LOSS, plan(AgentTier.FREE, -0.2).reason)
        assertEquals(FeeReason.LOSS, plan(AgentTier.FREE, 0.0).reason)
        assertEquals(0.0, plan(AgentTier.FREE, -0.2).fee, 0.0)
    }

    @Test fun windowWaivesAndKeepsAmount() {
        val r = plan(AgentTier.FREE, 0.2, covered = true)
        assertEquals(FeeReason.WINDOW, r.reason)
        assertEquals(0.01, r.fee, 1e-12)
        assertTrue(r.waived)
        assertFalse(r.owes)
    }

    @Test fun paperStoresWouldBeFee() {
        assertEquals(FeeReason.PAPER, plan(AgentTier.FREE, 0.2, paper = true).reason)
        assertEquals(0.01, plan(AgentTier.FREE, 0.2, paper = true).fee, 1e-12)
        assertEquals(0.0, plan(AgentTier.FREE, 0.2, paper = true, covered = true).fee, 0.0)
        assertEquals(FeeReason.PAPER, plan(AgentTier.FREE, -0.1, paper = true).reason)
    }

    @Test fun markChargedNeedsSignature() {
        val r = plan(AgentTier.FREE, 0.2)
        assertEquals(FeeReason.UNSENT, FeeLedger.markCharged(r, "short").reason)
        val c = FeeLedger.markCharged(r, "5".repeat(64))
        assertEquals(FeeReason.CHARGED, c.reason)
        assertTrue(c.charged)
    }

    @Test fun summaryAddsUp() {
        val rows = listOf(
            plan(AgentTier.FREE, 0.2),
            plan(AgentTier.FREE, 0.4, covered = true),
            plan(AgentTier.PRO, 1.0),
            plan(AgentTier.FREE, -0.1),
            FeeLedger.markCharged(plan(AgentTier.FREE, 0.1), "5".repeat(64)),
        )
        val s = FeeLedger.summarize(rows)
        assertEquals(5, s.positions)
        assertEquals(4, s.wins)
        assertEquals(1.6, s.pnl, 1e-9)
        assertEquals(0.01, s.feesOwed, 1e-12)
        assertEquals(0.005, s.feesCharged, 1e-12)
        assertEquals(0.02, s.feesWaived, 1e-12)
    }

    @Test fun sanitizeDropsBadRows() {
        val ok = plan(AgentTier.FREE, 0.2)
        val rows = listOf(ok, ok.copy(id = ""), ok.copy(id = "x", reason = "weird"), ok.copy(id = "y", charged = true))
        val clean = FeeLedger.sanitize(rows)
        assertEquals(listOf("p1", "y"), clean.map { it.id })
        assertFalse(clean[1].charged)
    }

    @Test fun catalogTiersMatchWeb() {
        assertEquals(5, Catalog.skus.size)
        assertEquals(AgentTier.PRO to 0.1, Catalog.offerFor("sku-combo-prime-pro"))
        assertEquals(AgentTier.FREE to 0.0, Catalog.offerFor("sku-combo-prime"))
        assertEquals(AgentTier.FREE to 0.0, Catalog.offerFor("unknown"))
        val alpha = Catalog.skus.first()
        assertEquals("Bitcoin Windows #11 Pro", alpha.nameFor(AgentTier.PRO))
        assertEquals("sku-pred-alpha-pro", alpha.skuId(AgentTier.PRO))
        assertEquals(listOf(1, 1, 1, 3, 2), Catalog.skus.map { it.agentClass.id })
        assertEquals(0.0, Catalog.feeRateFor(AgentTier.PRO), 0.0)
        assertEquals(0.05, Catalog.feeRateFor(AgentTier.FREE), 0.0)
        Catalog.skus.forEach { assertTrue(it.nameFor(AgentTier.PRO).length <= 32) }
    }
}
