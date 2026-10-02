package net.solardepin.solarchik

import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.runBlocking
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.Minter
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.wallet.LocalFunding
import net.solardepin.solarchik.wallet.LocalKey
import net.solardepin.solarchik.wallet.SolanaWallet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * Opt-in, DEVNET ONLY (-Pdevnet=1): the app's own built-in-wallet code path end to end against the real
 * devnet and the real Solarchik faucet: no wallet app -> offer accepted -> key created -> funded ->
 * free Weather Station mint -> Pro buy (0.1 SOL to the treasury). Prints the signatures.
 */
@RunWith(RobolectricTestRunner::class)
class LocalWalletDevnetIT {
    @Test fun builtInWalletMintsFreeAndBuysProOnDevnet() = runBlocking {
        assumeTrue(System.getProperty("solarchik.devnet") == "1")
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        LocalKey.box = TestBox()
        LocalKey.delete(ctx)
        SolanaWallet.walletAppCheck = { false }
        val w = SolanaWallet(ctx)
        w.forget()
        w.offerBuiltIn = {
            w.useBuiltIn()
            val f = LocalFunding.fund(w, SolanaWallet.LOCAL_MIN_LAMPORTS)
            println("DEVNET-LOCAL funded ${f.getOrNull()} via ${LocalFunding.last?.via} err=${f.exceptionOrNull()?.message}")
            true
        }
        val sender = ActivityResultSender(Robolectric.buildActivity(ComponentActivity::class.java).create().get())
        val minter = Minter(w, AgentStore(ctx))
        val sku = Catalog.skus.first { it.id == "sku-pred-weather" }
        val treasuryBefore = w.rpc.balanceLamports(SolarchikConfig.TREASURY)
        val free = minter.mint(sender, sku, AgentTier.FREE)
        println("DEVNET-LOCAL wallet ${w.address} isLocal=${w.isLocal}")
        println("DEVNET-LOCAL free sig ${free.getOrNull()?.sig} asset ${free.getOrNull()?.asset} err=${free.exceptionOrNull()}")
        val freeRec = minter.verify(free.getOrThrow())
        println("DEVNET-LOCAL free status ${freeRec.status}")
        val pro = minter.mint(sender, sku, AgentTier.PRO)
        println("DEVNET-LOCAL pro sig ${pro.getOrNull()?.sig} asset ${pro.getOrNull()?.asset} err=${pro.exceptionOrNull()}")
        val proRec = minter.verify(pro.getOrThrow())
        println("DEVNET-LOCAL pro status ${proRec.status}")
        val treasuryAfter = w.rpc.balanceLamports(SolarchikConfig.TREASURY)
        println("DEVNET-LOCAL treasury delta ${treasuryAfter - treasuryBefore}")
        assertTrue(w.isLocal)
        assertEquals("verified", freeRec.status)
        assertEquals("verified", proRec.status)
    }
}
