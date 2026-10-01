package net.solardepin.solarchik

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.OwnedAgent
import net.solardepin.solarchik.agents.engine.Desk
import net.solardepin.solarchik.agents.engine.DeskError
import net.solardepin.solarchik.agents.engine.MarketFeed
import net.solardepin.solarchik.agents.engine.Quote
import net.solardepin.solarchik.agents.engine.Source
import net.solardepin.solarchik.agents.engine.Track
import net.solardepin.solarchik.core.FeeReason
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.solana.LegacyTx
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.sol4k.Keypair

/** Desk end to end with a scripted market: every close goes through planFee with the window rule. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DeskTest {
    private lateinit var ctx: Context
    private var now = 1_790_000_000_000L
    private var btc = 100_000.0
    private val min = 60_000L
    private val feed = object : MarketFeed {
        override suspend fun quote(source: Source, key: String?): Quote? =
            if (source == Source.BTC) Quote(Source.BTC, "BTC-USD", "Bitcoin · test", btc) else null
    }
    private fun desk() = Desk(ctx, feed, { now })
    private val owner = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"

    @Before fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        listOf("solarchik-desk", "solarchik-agents", "solarchik-game").forEach {
            ctx.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit()
        }
    }

    /** One full position: anchor, +3 edges (enter up), then +[exitPct]% at close. */
    private fun cycle(d: Desk, exitPct: Double) = runBlocking {
        d.tick(); now += 15 * min; btc *= 1.0045
        val opened = d.tick().opened.single()
        now = opened.closeAt; btc *= 1 + exitPct / 100
        d.tick().closed.single()
    }

    @Test fun paperRowsAreRecordedNotOwed() = runBlocking {
        val d = desk()
        d.start("paper:sku-pred-alpha", "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.PAPER)
        val (c, row) = cycle(d, 1.0)
        assertTrue(c.pnl > 0)
        assertEquals(FeeReason.PAPER, row.reason)
        assertEquals(c.pnl * 0.05, row.fee, 2e-9)
        assertTrue(d.owedRows().isEmpty())
        assertEquals(c.pnl, d.state().paperPnl, 1e-12)
    }

    @Test fun devnetFreeProfitIsOwedProIsNot() = runBlocking {
        val store = AgentStore(ctx)
        store.upsert(OwnedAgent("AssetFree111111111111111111111111111111111", "sku-pred-alpha", "free", "Bitcoin Windows #11", owner, "devnet"))
        store.upsert(OwnedAgent("AssetPro1111111111111111111111111111111111", "sku-pred-alpha-pro", "pro", "Bitcoin Windows #11 Pro", owner, "devnet"))
        val d = desk()
        // not owned -> refused
        assertTrue(d.start("nope", "sku-pred-alpha", "free", "x", Track.DEVNET).exceptionOrNull() is DeskError)
        d.start("AssetFree111111111111111111111111111111111", "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.DEVNET)
        // devnet sizing uses the cached devnet balance; give it one
        d.store.write(d.state().copy(devnetBalance = 1.0, lastTickAt = now))
        val (c, row) = cycle(d, 1.0)
        assertEquals(FeeReason.UNSENT, row.reason)
        assertEquals(SolarchikConfig.lamports(c.pnl * 0.05) / 1e9, row.fee, 1e-9)
        assertEquals(1, d.owedRows().size)
        d.stop("AssetFree111111111111111111111111111111111")
        d.start("AssetPro1111111111111111111111111111111111", "sku-pred-alpha-pro", "pro", "Bitcoin Windows #11 Pro", Track.DEVNET)
        val (_, proRow) = cycle(d, 1.0)
        assertEquals(FeeReason.PRO, proRow.reason)
        assertEquals(0.0, proRow.fee, 0.0)
    }

    @Test fun positionOpenedInsideWindowIsWaivedEvenAfterItEnds() = runBlocking {
        val store = AgentStore(ctx)
        store.upsert(OwnedAgent("AssetFree111111111111111111111111111111111", "sku-pred-alpha", "free", "Bitcoin Windows #11", owner, "devnet"))
        val windowStart = now + 10 * min
        val ends = windowStart + 20 * min // window ends before the position closes
        ctx.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE).edit()
            .putString("feeWindows", """[{"id":"h48-1-2026-09-21","kind":"h48","milestone":7,"status":"active","grantedAt":$now,"startedAt":$windowStart,"endsAt":$ends}]""")
            .commit()
        val d = desk()
        d.start("AssetFree111111111111111111111111111111111", "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.DEVNET)
        d.store.write(d.state().copy(devnetBalance = 1.0, lastTickAt = now))
        val (c, row) = cycle(d, 1.0) // opens at +15m (inside), closes at +30m (after the window ended)
        assertTrue(c.position.openedAt in windowStart until ends)
        assertTrue(c.closedAt >= ends)
        assertTrue(GameSave(ctx) { now }.feeWindowCovers(c.position.openedAt))
        assertEquals(FeeReason.WINDOW, row.reason)
        assertTrue(d.owedRows().isEmpty())
    }

    @Test fun lossesFeedTheLossBrake() = runBlocking {
        val d = desk()
        d.start("paper:sku-pred-alpha", "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.PAPER)
        val (c1, r1) = cycle(d, -1.0)
        assertTrue(c1.pnl < 0)
        assertEquals(FeeReason.PAPER, r1.reason)
        cycle(d, -1.0)
        assertEquals(2, d.state().day(Track.PAPER).lossStreak)
        // next strong signal is blocked by the hard 2-loss brake
        d.tick(); now += 15 * min; btc *= 1.0045
        val r = d.tick()
        assertTrue(r.opened.isEmpty())
        assertEquals("LOSSES", r.events.single().block)
    }

    @Test fun feeTxPaysTreasuryWithMemo() {
        val payer = Keypair.generate()
        val tx = Desk.feeTx(payer.publicKey, ByteArray(32) { 1 }, 12_345, 3)
        val bytes = tx.serialize()
        assertTrue(bytes.size <= LegacyTx.MAX_SIZE)
        val text = String(bytes, Charsets.ISO_8859_1)
        assertTrue(text.contains("solarchik fees n=3 lamports=12345"))
    }
}
