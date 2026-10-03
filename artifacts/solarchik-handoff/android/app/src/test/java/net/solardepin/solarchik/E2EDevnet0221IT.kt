package net.solardepin.solarchik

import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.Minter
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.game.ClockIn
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.sol.SolState
import net.solardepin.solarchik.wallet.LocalFunding
import net.solardepin.solarchik.wallet.LocalKey
import net.solardepin.solarchik.wallet.SolanaWallet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * 0.22.1 opt-in E2E on DEVNET (-Pdevnet=1), the app's own code paths: built-in wallet created and funded
 * -> a 1300 m run -> CLOCK IN signed as a real memo tx (checked on chain) -> the run/Sol state flips to
 * "signed" -> free mint -> Pro buy. Prints every signature.
 */
@RunWith(RobolectricTestRunner::class)
class E2EDevnet0221IT {
    @Test fun walletClockInMintAndProOnDevnet() = runBlocking {
        assumeTrue(System.getProperty("solarchik.devnet") == "1")
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        ctx.getSharedPreferences("solarchik-game", android.content.Context.MODE_PRIVATE).edit().clear().commit()
        LocalKey.box = TestBox()
        LocalKey.delete(ctx)
        SolanaWallet.walletAppCheck = { false }
        val w = SolanaWallet(ctx)
        w.forget()
        w.offerBuiltIn = {
            w.useBuiltIn()
            val f = LocalFunding.fund(w, SolanaWallet.LOCAL_MIN_LAMPORTS)
            println("E2E funded ${f.getOrNull()} via ${LocalFunding.last?.via} err=${f.exceptionOrNull()?.message}")
            true
        }
        val sender = ActivityResultSender(Robolectric.buildActivity(ComponentActivity::class.java).create().get())

        // CLOCK IN: run 1300 m, then sign today's day
        val save = GameSave(ctx)
        save.recordRun(1300, 1500)
        assertTrue(ClockIn.ready(save))
        assertFalse(SolState.of(save).signedToday)
        // the first wallet use creates + funds the built-in wallet (no wallet app here)
        val minter = Minter(w, AgentStore(ctx))
        val sku = Catalog.skus.first { it.id == "sku-pred-weather" }
        val free = minter.mint(sender, sku, AgentTier.FREE)
        println("E2E wallet ${w.address} isLocal=${w.isLocal}")
        println("E2E free sig ${free.getOrNull()?.sig} asset ${free.getOrNull()?.asset} err=${free.exceptionOrNull()}")
        val freeRec = minter.verify(free.getOrThrow())
        println("E2E free status ${freeRec.status}")

        val signed = ClockIn.sign(w, sender, save)
        println("E2E clock result ok=${signed.isSuccess} err=${signed.exceptionOrNull()} kind=${save.clockKind} sig=${save.clockSig}")
        assertTrue(signed.exceptionOrNull()?.toString(), signed.isSuccess)
        assertEquals("tx", save.clockKind)
        var status: String? = null
        for (i in 0 until 30) { status = w.rpc.signatureStatus(save.clockSig); if (status == "finalized") break; delay(2000) }
        println("E2E clock status $status https://explorer.solana.com/tx/${save.clockSig}?cluster=devnet")
        assertTrue("clock tx status $status", status == "confirmed" || status == "finalized")
        assertTrue(save.signedToday())
        assertFalse("no second offer", ClockIn.ready(save))
        val st = SolState.of(save)
        assertTrue(st.signedToday && st.streak >= 1)
        println("E2E sol state: ${st.line()}")

        val pro = minter.mint(sender, sku, AgentTier.PRO)
        println("E2E pro sig ${pro.getOrNull()?.sig} asset ${pro.getOrNull()?.asset} err=${pro.exceptionOrNull()}")
        val proRec = minter.verify(pro.getOrThrow())
        println("E2E pro status ${proRec.status}")
        assertTrue(w.isLocal)
        assertEquals("verified", freeRec.status)
        assertEquals("verified", proRec.status)
    }
}
