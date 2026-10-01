package net.solardepin.solarchik

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.OwnedAgent
import net.solardepin.solarchik.agents.engine.Desk
import net.solardepin.solarchik.agents.engine.AgentEngine
import net.solardepin.solarchik.agents.engine.DeskError
import net.solardepin.solarchik.agents.engine.DeskStore
import net.solardepin.solarchik.agents.engine.PendingPay
import net.solardepin.solarchik.solana.SigInfo
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
    private val rpc = FakeRpc()
    private fun desk() = Desk(ctx, feed, { now }, rpc)
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

    // ---- 0.20.2 audit fixes ----

    private val freeAsset = "AssetFree111111111111111111111111111111111"

    private fun ownFree() = AgentStore(ctx).upsert(OwnedAgent(freeAsset, "sku-pred-alpha", "free", "Bitcoin Windows #11", owner, "devnet"))

    @Test fun devnetBalanceRefreshesEveryFiveMinutesWhileTheAppTicks() = runBlocking {
        ownFree()
        val d = desk()
        d.start(freeAsset, "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.DEVNET)
        rpc.lamports = 1_500_000_000L
        d.tick()
        assertEquals(1.5, d.state().devnetBalance, 1e-12)
        assertEquals(1, rpc.calls.count { it == "getBalance" })
        // the open app ticks every 30 s: lastTickAt moves, the balance read must not depend on it
        rpc.lamports = 2_000_000_000L
        repeat(9) { now += 30_000; d.tick() }
        assertEquals(1, rpc.calls.count { it == "getBalance" })
        now += Desk.BALANCE_EVERY_MS
        d.tick()
        assertEquals(2, rpc.calls.count { it == "getBalance" })
        assertEquals(2.0, d.state().devnetBalance, 1e-12)
    }

    @Test fun balanceReadFailureKeepsTheLastBalance() = runBlocking {
        ownFree()
        val d = desk()
        d.start(freeAsset, "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.DEVNET)
        d.store.write(d.state().copy(devnetBalance = 0.7))
        rpc.failAll = true
        d.tick()
        assertEquals(0.7, d.state().devnetBalance, 1e-12)
    }

    @Test fun positionFromUnknownSourceDoesNotBreakTicks() = runBlocking {
        val d = desk()
        d.start("paper:sku-pred-alpha", "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.PAPER)
        d.tick(); now += 15 * min; btc *= 1.0045
        val opened = d.tick().opened.single()
        // pretend an older/newer build stored a source this build does not know
        val st = d.state()
        d.store.write(st.copy(runs = st.runs.map { r -> r.copy(open = r.open?.copy(source = "SOMETHING_NEW")) }))
        now = opened.closeAt + 60_000
        val r1 = d.tick() // used to throw IllegalArgumentException from Source.valueOf
        assertTrue(r1.closed.isEmpty())
        now = opened.closeAt + AgentEngine.NO_DATA_GRACE_MS + 1
        val (c, _) = d.tick().closed.single()
        assertEquals(0.0, c.pnl, 0.0)
    }

    private fun owedRow(d: Desk) = runBlocking {
        ownFree()
        d.start(freeAsset, "sku-pred-alpha", "free", "Bitcoin Windows #11", Track.DEVNET)
        cycle(d, 1.0)
        d.owedRows().single()
    }

    private val paidSig = "5".repeat(88)

    @Test fun reconcileMarksRowsChargedWhenTheMemoRefIsOnChain() = runBlocking {
        val d = desk()
        val row = owedRow(d)
        val ref = Desk.payRef(listOf(row.id))
        d.store.write(d.state().copy(pendingPay = PendingPay(listOf(row.id), ref, owner, 1000, now)))
        rpc.sigs = listOf(
            SigInfo("otherSig", true, "[20] solarchik fees n=1 lamports=5 ref=0000000000"),
            SigInfo(paidSig, true, "[48] solarchik fees n=1 lamports=1000 ref=$ref"),
        )
        val tx = d.reconcile()
        assertEquals(paidSig, tx!!.signature)
        assertTrue(d.owedRows().isEmpty())
        assertEquals(null, d.state().pendingPay)
        assertEquals(paidSig, AgentStore(ctx).fees().single { it.id == row.id }.sig)
    }

    @Test fun failedMemoTxDoesNotCountAsPaid() = runBlocking {
        val d = desk()
        val row = owedRow(d)
        val ref = Desk.payRef(listOf(row.id))
        d.store.write(d.state().copy(pendingPay = PendingPay(listOf(row.id), ref, owner, 1000, now)))
        rpc.sigs = listOf(SigInfo("failedSig", false, "solarchik fees ref=$ref"))
        assertEquals(null, d.reconcile())
        assertEquals(1, d.owedRows().size)
        assertTrue(d.state().pendingPay != null) // still young: keep blocking a second payment
        now += Desk.PENDING_EXPIRES_MS + 1
        d.reconcile()
        assertEquals(null, d.state().pendingPay)
        assertEquals(1, d.owedRows().size)
    }

    @Test fun offlineReconcileKeepsThePendingPayment() = runBlocking {
        val d = desk()
        val row = owedRow(d)
        d.store.write(d.state().copy(pendingPay = PendingPay(listOf(row.id), "abc", owner, 1000, now)))
        rpc.sigs = null
        now += Desk.PENDING_EXPIRES_MS + 1
        d.reconcile()
        assertTrue(d.state().pendingPay != null)
        now += Desk.PENDING_GIVE_UP_MS
        d.reconcile()
        assertEquals(null, d.state().pendingPay)
    }

    @Test fun payRefIsStableAndOrderIndependent() {
        val a = Desk.payRef(listOf("f-1", "f-2", "f-3"))
        assertEquals(a, Desk.payRef(listOf("f-3", "f-1", "f-2")))
        assertEquals(10, a.length)
        assertTrue(a.all { it in "0123456789abcdef" })
        assertTrue(a != Desk.payRef(listOf("f-1", "f-2")))
        val prev = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale("ar", "EG")) // Arabic-Indic digits must not leak in
            assertEquals(a, Desk.payRef(listOf("f-1", "f-2", "f-3")))
        } finally { java.util.Locale.setDefault(prev) }
    }

    @Test fun feeTxMemoCarriesTheRef() {
        val payer = Keypair.generate()
        val text = String(Desk.feeTx(payer.publicKey, ByteArray(32) { 1 }, 77, 2, "a1b2c3d4e5").serialize(), Charsets.ISO_8859_1)
        assertTrue(text.contains("solarchik fees n=2 lamports=77 ref=a1b2c3d4e5"))
    }

    @Test fun unreadableDeskBlobIsKeptAside() {
        val prefs = ctx.getSharedPreferences("solarchik-desk", Context.MODE_PRIVATE)
        prefs.edit().putString("desk.v1", "{not json").commit()
        val d = desk()
        assertTrue(d.state().runs.isEmpty())
        assertEquals("{not json", prefs.getString(DeskStore.KEY_BAD, null))
    }
}
