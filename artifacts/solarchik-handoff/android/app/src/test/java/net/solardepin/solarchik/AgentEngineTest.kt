package net.solardepin.solarchik

import net.solardepin.solarchik.agents.engine.AgentEngine
import net.solardepin.solarchik.agents.engine.AgentRun
import net.solardepin.solarchik.agents.engine.Block
import net.solardepin.solarchik.agents.engine.DayBook
import net.solardepin.solarchik.agents.engine.EventKind
import net.solardepin.solarchik.agents.engine.GammaPick
import net.solardepin.solarchik.agents.engine.Quote
import net.solardepin.solarchik.agents.engine.RiskCaps
import net.solardepin.solarchik.agents.engine.Source
import net.solardepin.solarchik.agents.engine.Strategies
import net.solardepin.solarchik.agents.engine.Track
import net.solardepin.solarchik.agents.engine.UserCaps
import net.solardepin.solarchik.core.SolarchikConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentEngineTest {
    private val t0 = 1_790_000_000_000L
    private val min = 60_000L
    private var n = 0
    private val id = { "id${++n}" }
    private val btcRun = AgentRun("paper:sku-pred-alpha", "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.PAPER, running = true)
    private fun btc(px: Double) = mapOf(Source.BTC to Quote(Source.BTC, "BTC-USD", "Bitcoin · Coinbase", px))

    /** Anchor at 100000, then a move of [bps] after one 15-minute window. */
    private fun decide(bps: Double, day: DayBook = DayBook(), caps: UserCaps = UserCaps(), free: Double = 1.0) =
        AgentEngine.tick(btcRun, t0, btc(100_000.0), null, day, caps, free, id).let { a ->
            AgentEngine.tick(a.run, t0 + 15 * min, btc(100_000.0 * (1 + bps / 10_000)), null, a.day, caps, free, id)
        }

    @Test fun firstTickOnlyAnchors() {
        val out = AgentEngine.tick(btcRun, t0, btc(100_000.0), null, DayBook(), UserCaps(), 1.0, id)
        assertEquals(EventKind.WATCH, out.events.single().kind)
        assertNull(out.opened)
        assertEquals(100_000.0, out.run.anchors["BTC"]!!.px, 0.0)
        // before the window passes nothing is decided
        val early = AgentEngine.tick(out.run, t0 + 14 * min, btc(101_000.0), null, out.day, UserCaps(), 1.0, id)
        assertTrue(early.events.isEmpty())
    }

    @Test fun entersOnlyAtSixtyFivePercent() {
        val weak = decide(10.0) // 10 bps < 15 bps edge -> 60%
        assertEquals(EventKind.SKIP, weak.events.single().kind)
        assertEquals(0.6, weak.events.single().confidence, 1e-9)
        val edge = decide(15.0) // exactly the edge -> 65%
        assertEquals(EventKind.OPEN, edge.events.single().kind)
        assertEquals(0.65, edge.opened!!.confidence, 1e-9)
        assertEquals("up", edge.opened!!.side)
        assertEquals(Strategies.MIN_CONFIDENCE, Strategies.edgeConfidence(15.0, 15.0), 1e-9)
        assertEquals(0.95, Strategies.edgeConfidence(400.0, 15.0), 1e-9)
    }

    @Test fun sizeFollowsWebDynamicSizeAndHardCap() {
        val out = decide(-45.0) // 3 edges -> 95%, down
        val p = out.opened!!
        assertEquals("down", p.side)
        assertEquals(RiskCaps.dynamicSize(SolarchikConfig.HARD_MAX_TRADE_SOL, 0.95, 1.0), p.stake, 0.0)
        assertTrue(p.stake <= SolarchikConfig.HARD_MAX_TRADE_SOL)
        assertEquals(p.stake, out.day.spent, 1e-12)
        assertEquals(t0 + 30 * min, p.closeAt)
    }

    @Test fun settlesAfterWindowWithSignedPnl() {
        val open = decide(-45.0)
        val p = open.opened!!
        // still open before closeAt
        val wait = AgentEngine.tick(open.run, p.closeAt - 1, btc(1.0), null, open.day, UserCaps(), 1.0, id)
        assertNull(wait.closed)
        // price kept falling 1%: a "down" position earns 1% of stake
        val exit = p.entryPx * 0.99
        val closed = AgentEngine.tick(open.run, p.closeAt, emptyMap(), Quote(Source.BTC, "BTC-USD", "x", exit), open.day, UserCaps(), 1.0, id)
        val c = closed.closed!!
        assertEquals(AgentEngine.roundLamports(p.stake * 0.01), c.pnl, 1e-12)
        assertEquals(1, closed.run.wins)
        assertEquals(0, closed.day.lossStreak)
        assertNull(closed.run.open)
        assertEquals(EventKind.CLOSE, closed.events.single().kind)
    }

    @Test fun lossesInARowStopNewEntries() {
        val day = DayBook(day = net.solardepin.solarchik.core.StreakRules.dayKey(t0), lossStreak = 2)
        val out = decide(45.0, day)
        assertEquals(EventKind.BLOCK, out.events.single().kind)
        assertEquals(Block.LOSSES.name, out.events.single().block)
        assertNull(out.opened)
    }

    @Test fun userCapsOnlyTighten() {
        val loose = RiskCaps.clamp(UserCaps(maxTradeSol = 5.0, dayCapSol = 9.0, maxLosses = 10, dayLossSol = 4.0))
        assertEquals(UserCaps(), loose)
        val tight = UserCaps(maxTradeSol = 0.005)
        val out = decide(45.0, caps = tight)
        assertTrue(out.opened!!.stake <= 0.005 + 1e-12)
        val paused = decide(45.0, caps = UserCaps(paused = true))
        assertEquals(Block.PAUSED.name, paused.events.single().block)
    }

    @Test fun dayCapAndDayLossBlock() {
        val today = net.solardepin.solarchik.core.StreakRules.dayKey(t0)
        val full = decide(45.0, DayBook(today, spent = 0.295))
        assertEquals(Block.DAY_CAP.name, full.events.single().block)
        val lost = decide(45.0, DayBook(today, loss = 0.3))
        assertEquals(Block.DAY_LOSS.name, lost.events.single().block)
        // a new UTC day clears the counters
        val yesterday = decide(45.0, DayBook("2000-01-01", spent = 0.3, lossStreak = 2, loss = 0.3))
        assertNotNull(yesterday.opened)
    }

    @Test fun smallPurseSkipsForFunds() {
        val out = decide(45.0, free = 0.005)
        assertEquals(EventKind.FUNDS, out.events.single().kind)
    }

    @Test fun eventsFollowTheFavorite() {
        val run = AgentRun("paper:sku-pred-events", "sku-pred-events", "free", "Events Scout #04", Track.PAPER, running = true)
        fun ev(yes: Double) = mapOf(Source.EVENTS to Quote(Source.EVENTS, "m1", "Will it rain?", yes))
        val a = AgentEngine.tick(run, t0, ev(0.3), null, DayBook(), UserCaps(), 1.0, id)
        val b = AgentEngine.tick(a.run, t0 + 30 * min, ev(0.3), null, a.day, UserCaps(), 1.0, id)
        val p = b.opened!!
        assertEquals("no", p.side)
        assertEquals(0.7, p.entryPx, 1e-9)
        assertEquals(0.7, p.confidence, 1e-9)
        // NO price rose from 0.70 to 0.77 (YES fell to 0.23): +10% of stake
        val c = AgentEngine.tick(b.run, p.closeAt, emptyMap(), Quote(Source.EVENTS, "m1", "Will it rain?", 0.23), b.day, UserCaps(), 1.0, id)
        assertEquals(AgentEngine.roundLamports(p.stake * 0.1), c.closed!!.pnl, 1e-9)
        // a decided market (97%) is not entered
        val d = AgentEngine.tick(a.run, t0 + 30 * min, ev(0.97), null, a.day, UserCaps(), 1.0, id)
        assertEquals(EventKind.SKIP, d.events.single().kind)
    }

    @Test fun comboTakesStrongestForecast() {
        val run = AgentRun("paper:sku-combo-prime", "sku-combo-prime", "pro", "Combo Prime Pro", Track.PAPER, running = true)
        val q0 = mapOf(
            Source.BTC to Quote(Source.BTC, "BTC-USD", "btc", 100_000.0),
            Source.EVENTS to Quote(Source.EVENTS, "m1", "ev", 0.7),
            Source.WEATHER to Quote(Source.WEATHER, "kyiv-t2m", "kyiv", 283.15),
        )
        val a = AgentEngine.tick(run, t0, q0, null, DayBook(), UserCaps(), 1.0, id)
        // after 30 min BTC moved 3 edges (95%) and events still 70%: BTC wins; weather window (60m) not yet due
        val q1 = q0 + (Source.BTC to Quote(Source.BTC, "BTC-USD", "btc", 100_450.0))
        val b = AgentEngine.tick(a.run, t0 + 30 * min, q1, null, a.day, UserCaps(), 1.0, id)
        assertEquals("BTC", b.opened!!.source)
        assertEquals(0.95, b.opened!!.confidence, 1e-9)
    }

    @Test fun vanishedMarketClosesFlatAfterGrace() {
        val open = decide(45.0)
        val p = open.opened!!
        val waiting = AgentEngine.tick(open.run, p.closeAt + 60 * min, emptyMap(), null, open.day, UserCaps(), 1.0, id)
        assertNull(waiting.closed)
        val flat = AgentEngine.tick(open.run, p.closeAt + AgentEngine.NO_DATA_GRACE_MS, emptyMap(), null, open.day, UserCaps(), 1.0, id)
        assertEquals(0.0, flat.closed!!.pnl, 0.0)
    }

    @Test fun gammaPickSkipsBitcoinSportsAndDecided() {
        val now = t0
        val far = now + 5 * 24 * 3600_000L
        val ms = listOf(
            GammaPick.Market("1", "Will Bitcoin hit 100k?", 0.8, 9e6, far, true),
            GammaPick.Market("2", "Lakers vs. Celtics", 0.7, 8e6, far, true),
            GammaPick.Market("3", "Will the Fed cut rates?", 0.97, 7e6, far, true),
            GammaPick.Market("4", "Will X happen?", 0.25, 1e6, far, true),
            GammaPick.Market("5", "Will Y happen?", 0.66, 5e6, far, true),
        )
        assertEquals("4", GammaPick.pick(ms, now)!!.id)
    }
}
