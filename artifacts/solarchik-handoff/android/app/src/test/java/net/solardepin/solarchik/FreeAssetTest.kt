package net.solardepin.solarchik

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.runBlocking
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.FreeAsset
import net.solardepin.solarchik.agents.MintError
import net.solardepin.solarchik.agents.Minter
import net.solardepin.solarchik.agents.OwnedAgent
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.wallet.SentTx
import net.solardepin.solarchik.wallet.SolanaWallet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.sol4k.Keypair

/** One Free agent per wallet on every cluster: the asset address is derived from the wallet's own signature. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FreeAssetTest {
    private lateinit var ctx: Context
    private val payer = Keypair.generate()
    private val addr get() = payer.publicKey.toBase58()
    private val sku = Catalog.skus.first()

    @Before fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        listOf("solarchik-agents", "seeker-wallet", "solarchik-game").forEach {
            ctx.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit()
        }
        ctx.getSharedPreferences("seeker-wallet", Context.MODE_PRIVATE).edit().putString("auth", "tok").putString("address", addr).commit()
    }

    private fun sender(): ActivityResultSender = Robolectric.buildActivity(MainActivity::class.java).setup().get().sender

    private fun sign(kp: Keypair, wallet: String) = kp.sign(FreeAsset.message(wallet).encodeToByteArray())

    @Test fun sameWalletSameAddressOtherWalletOtherAddress() {
        val a = FreeAsset.keypair(addr, sign(payer, addr))!!
        val b = FreeAsset.keypair(addr, sign(payer, addr))!!
        assertEquals(a.publicKey, b.publicKey)
        assertEquals(64, a.secret.size)
        val msg = "x".encodeToByteArray()
        assertTrue("derived keypair signs for its own address", a.publicKey.verify(a.sign(msg), msg))
        val other = Keypair.generate()
        val c = FreeAsset.keypair(other.publicKey.toBase58(), sign(other, other.publicKey.toBase58()))!!
        assertNotEquals(a.publicKey, c.publicKey)
    }

    @Test fun someoneElsesSignatureIsRefused() {
        val other = Keypair.generate()
        assertNull(FreeAsset.keypair(addr, sign(other, addr)))
        assertNull(FreeAsset.keypair(addr, ByteArray(10)))
    }

    private fun minter(store: AgentStore, existing: String?, payerKey: Keypair = payer, sends: MutableList<String> = mutableListOf()) = Minter(
        SolanaWallet(ctx), store,
        send = { _, build ->
            runCatching { build(payerKey.publicKey, ByteArray(32) { 3 }) }
                .fold(onSuccess = { sends += "sent"; Result.success(SentTx(payerKey.publicKey.toBase58(), "9".repeat(88), "mainnet")) }, onFailure = { Result.failure(it) })
        },
        cluster = { "mainnet" },
        freeSeed = { _, wallet -> Result.success(sign(payer, wallet)) },
        coreOwner = { existing },
    )

    @Test fun freeMintUsesTheDerivedAddress() = runBlocking {
        val store = AgentStore(ctx)
        val res = minter(store, existing = null).mintFree(sender(), sku)
        assertTrue(res.exceptionOrNull()?.toString(), res.isSuccess)
        val expected = FreeAsset.keypair(addr, sign(payer, addr))!!.publicKey.toBase58()
        assertEquals(expected, res.getOrThrow().asset)
        assertEquals(AgentTier.FREE, res.getOrThrow().tier)
    }

    @Test fun secondFreeMintAfterReinstallIsRefusedAndTheOldAgentAdopted() = runBlocking {
        val store = AgentStore(ctx) // empty: a fresh install knows nothing locally
        val sends = mutableListOf<String>()
        val res = minter(store, existing = addr, sends = sends).mintFree(sender(), sku)
        assertEquals(MintError.Kind.FREE_USED, (res.exceptionOrNull() as? MintError)?.kind)
        assertTrue("nothing sent", sends.isEmpty())
        val adopted = store.agents().single()
        assertEquals(OwnedAgent.STATUS_VERIFIED, adopted.status)
        assertTrue(store.freeClaimed(addr, "mainnet"))
    }

    @Test fun addressTakenByAnotherOwnerIsStillRefused() = runBlocking {
        val store = AgentStore(ctx)
        val res = minter(store, existing = Keypair.generate().publicKey.toBase58()).mintFree(sender(), sku)
        assertEquals(MintError.Kind.FREE_USED, (res.exceptionOrNull() as? MintError)?.kind)
        assertTrue(store.agents().isEmpty())
    }

    @Test fun switchedWalletAccountCannotMintAnotherWalletsFreeAddress() = runBlocking {
        val store = AgentStore(ctx)
        val res = minter(store, existing = null, payerKey = Keypair.generate()).mintFree(sender(), sku)
        assertEquals(MintError.Kind.WALLET_CHANGED, (res.exceptionOrNull() as? MintError)?.kind)
        assertTrue(store.agents().isEmpty())
    }

    // ---- Combo is paid only ----

    private val combo get() = Catalog.skus.single { it.id == "sku-combo-prime" }

    @Test fun comboIsSoldOnlyAsPro() {
        assertTrue(combo.paidOnly)
        assertEquals(AgentTier.PRO, combo.tierFor(AgentTier.FREE))
        assertEquals("sku-combo-prime-pro", combo.skuId(combo.tierFor(AgentTier.FREE)))
        assertTrue(combo.priceSol(AgentTier.PRO) > 0.0)
        assertEquals(setOf("sku-combo-prime"), Catalog.paidOnlyFreeIds)
        // Every other base keeps its Free variant.
        Catalog.skus.filter { it.id != combo.id }.forEach { assertEquals(AgentTier.FREE, it.tierFor(AgentTier.FREE)) }
    }

    @Test fun freeComboMintIsRefusedOnEveryPathAndNothingIsSent() = runBlocking {
        val store = AgentStore(ctx)
        val sends = mutableListOf<String>()
        val m = minter(store, existing = null, sends = sends)
        assertEquals(MintError.Kind.PAID_ONLY, m.canMint(combo, AgentTier.FREE))
        assertNotEquals(MintError.Kind.PAID_ONLY, m.canMint(combo, AgentTier.PRO))
        val viaMint = m.mint(sender(), combo, AgentTier.FREE)
        assertEquals(MintError.Kind.PAID_ONLY, (viaMint.exceptionOrNull() as? MintError)?.kind)
        val viaFree = m.mintFree(sender(), combo)
        assertEquals(MintError.Kind.PAID_ONLY, (viaFree.exceptionOrNull() as? MintError)?.kind)
        val viaWith = m.mintWith(sender(), combo, AgentTier.FREE, Keypair.generate())
        assertEquals(MintError.Kind.PAID_ONLY, (viaWith.exceptionOrNull() as? MintError)?.kind)
        assertTrue("nothing sent", sends.isEmpty())
        assertTrue("nothing recorded", store.agents().isEmpty())
        assertTrue("a refused Combo does not use up the free slot", !store.freeClaimed(addr, "mainnet"))
    }

    @Test fun freeNonComboStillMints() = runBlocking {
        val store = AgentStore(ctx)
        val res = minter(store, existing = null).mintFree(sender(), Catalog.skus.first { !it.paidOnly })
        assertTrue(res.exceptionOrNull()?.toString(), res.isSuccess)
    }
}
