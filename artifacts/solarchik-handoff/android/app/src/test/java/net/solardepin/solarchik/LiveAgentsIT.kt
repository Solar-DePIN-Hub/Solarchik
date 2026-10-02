package net.solardepin.solarchik

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import net.solardepin.solarchik.agents.engine.Desk
import net.solardepin.solarchik.agents.engine.DeskEvent
import net.solardepin.solarchik.agents.engine.EventKind
import net.solardepin.solarchik.agents.engine.HttpMarketFeed
import net.solardepin.solarchik.agents.engine.Source
import net.solardepin.solarchik.agents.engine.Track
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.core.FeeReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.time.Instant

/**
 * Opt-in LIVE check of the five strategy agents: `-PliveAgents=1`.
 *
 * Uses the production [Desk] and [HttpMarketFeed] (Coinbase/Kraken, Backpack/Coinbase,
 * Open-Meteo, Polymarket Gamma) on the PAPER track only: no wallet, no RPC, no order is sent.
 * Market reads are real and taken minutes apart; the desk clock is stepped forward so each
 * strategy reaches its decision window (15/10/30/60 min) inside one test run. Every decision,
 * open and close comes from the real engine on those real quotes, nothing is scripted.
 * A transcript is printed and written to build/live-agents.txt.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LiveAgentsIT {
    private val min = 60_000L
    private val decisions = setOf(EventKind.SKIP, EventKind.OPEN, EventKind.FUNDS, EventKind.BLOCK)

    @Test fun everyStrategyReadsLiveMarketsAndDecidesOnPaper() = runBlocking<Unit> {
        assumeTrue(System.getProperty("solarchik.liveAgents") == "1")
        val waitMs = (System.getProperty("solarchik.liveWaitSec")?.toLongOrNull() ?: 40L) * 1000
        val ctx: Context = ApplicationProvider.getApplicationContext()
        listOf("solarchik-desk", "solarchik-agents", "solarchik-game").forEach {
            ctx.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit()
        }
        val out = StringBuilder()
        fun log(s: String) { println(s); out.appendLine(s) }

        // 1. Every source answers with a real, plausible number.
        val feed = HttpMarketFeed()
        for (src in Source.entries) {
            val q = feed.quote(src)
            assertNotNull("no live quote for $src", q)
            val ok = when (src) {
                Source.BTC -> q!!.px in 1_000.0..10_000_000.0
                Source.SOL -> q!!.px in 1.0..100_000.0
                Source.WEATHER -> q!!.px in 223.0..333.0 // Kelvin
                Source.EVENTS -> q!!.px in 0.0..1.0
            }
            assertTrue("implausible $src quote ${q!!.px}", ok)
            log("QUOTE ${Instant.now()} $src key=${q.key} label=\"${q.label.take(90)}\" px=${q.px}")
        }

        // 2. The production desk runs all five SKUs on paper.
        var now = System.currentTimeMillis()
        val t0 = now
        val desk = Desk(ctx, feed, { now }, FakeRpc())
        val names = Catalog.skus.associate { it.id to it.nameFor(AgentTier.FREE) }
        // 0.21.8: paper runs need owned agents
        for ((id, name) in names) net.solardepin.solarchik.agents.AgentStore(ctx).upsert(net.solardepin.solarchik.agents.OwnedAgent("Live$id", id, AgentTier.FREE, name, "owner", "devnet"))
        for ((id, name) in names) desk.start("paper:$id", id, AgentTier.FREE, name, Track.PAPER)
        val all = ArrayList<DeskEvent>()
        val closes = ArrayList<String>()
        suspend fun step(label: String, advanceMin: Long) {
            if (advanceMin > 0) { Thread.sleep(waitMs); now += advanceMin * min + waitMs }
            val r = desk.tick()
            log("TICK $label (desk clock +${(now - t0) / min} min, real ${Instant.now()})")
            r.events.forEach {
                log("  ${it.agent} ${it.kind} ${it.source} \"${it.label.take(70)}\" side=${it.side} conf=${"%.3f".format(it.confidence)} move=${"%.1f".format(it.moveBps)}bps stake=${it.stake} pnl=${it.pnl} ${it.block}")
            }
            r.closed.forEach { (c, row) ->
                closes += "${c.position.label.take(40)} pnl=${c.pnl} fee=${row.fee} reason=${row.reason}"
                assertEquals(FeeReason.PAPER, row.reason)
            }
            all += r.events
        }
        step("anchor", 0)
        step("+16", 16)   // BTC (15) and SOL (10) windows
        step("+16", 16)   // Events (30); BTC/SOL positions settle
        step("+30", 30)   // Weather (60); Events positions settle
        step("+31", 31)   // whatever opened last settles

        // 3. Each agent anchored on real data and then made a real decision.
        for ((_, name) in names) {
            val mine = all.filter { it.agent == name }
            assertTrue("$name never watched", mine.any { it.kind == EventKind.WATCH })
            assertTrue("$name never decided: ${mine.map { it.kind }}", mine.any { it.kind in decisions })
            assertTrue("$name saw no data", mine.none { it.kind == EventKind.NODATA })
            log("AGENT $name: ${mine.groupingBy { it.kind }.eachCount()}")
        }
        closes.forEach { log("CLOSE $it") }
        log("PAPER PnL ${desk.state().paperPnl} SOL (simulated on real prices, no order sent)")
        File(System.getProperty("solarchik.shots") ?: ".").parentFile?.resolve("live-agents.txt")?.writeText(out.toString())
    }
}
