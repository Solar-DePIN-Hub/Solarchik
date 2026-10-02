package net.solardepin.solarchik

import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.Minter
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.solana.LegacyTx
import net.solardepin.solarchik.solana.Rpc
import net.solardepin.solarchik.wallet.Base58
import net.solardepin.solarchik.wallet.LocalKey
import net.solardepin.solarchik.wallet.SolanaWallet
import net.solardepin.solarchik.wallet.WalletError
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.sol4k.Keypair
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Robolectric has no AndroidKeyStore: same AES-GCM sealing with an in-memory key. */
class TestBox : LocalKey.Box {
    private val key: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    override fun seal(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        return c.iv + c.doFinal(plain)
    }
    override fun open(sealed: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12))) }
        return c.doFinal(sealed.copyOfRange(12, sealed.size))
    }
}

/** Scripted devnet node: balance, blockhash, send (records the bytes), confirmed status. */
class ChainStub(var lamports: Long = 1_000_000_000L) : Rpc("http://stub.invalid") {
    val sent = ArrayList<ByteArray>()
    val calls = ArrayList<String>()
    var sendError: String? = null
    override suspend fun call(method: String, params: JsonArray): JsonElement {
        calls += method
        return when (method) {
            "getBalance" -> buildJsonObject { put("context", buildJsonObject { put("slot", 1) }); put("value", lamports) }
            "getLatestBlockhash" -> buildJsonObject { put("value", buildJsonObject { put("blockhash", Base58.encode(ByteArray(32) { 7 })); put("lastValidBlockHeight", 9) }) }
            "sendTransaction" -> {
                sendError?.let { throw net.solardepin.solarchik.solana.RpcException(it) }
                val raw = Base64.getDecoder().decode(params[0].jsonPrimitive.content)
                sent += raw
                JsonPrimitive("SIG${sent.size}")
            }
            "getSignatureStatuses" -> buildJsonObject {
                put("value", buildJsonArray { add(buildJsonObject { put("confirmationStatus", "confirmed"); put("err", JsonNull) }) })
            }
            "getAccountInfo" -> buildJsonObject { put("context", buildJsonObject { put("slot", 1) }); put("value", JsonNull) }
            else -> JsonNull
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class LocalWalletTest {
    private val ctx get() = ApplicationProvider.getApplicationContext<android.app.Application>()
    private val realCheck = SolanaWallet.walletAppCheck

    @Before fun setUp() {
        LocalKey.box = TestBox()
        LocalKey.delete(ctx)
    }

    @After fun tearDown() {
        SolanaWallet.walletAppCheck = realCheck
        LocalKey.delete(ctx)
    }

    private fun sender(): ActivityResultSender =
        ActivityResultSender(Robolectric.buildActivity(ComponentActivity::class.java).create().get())

    @Test fun keyIsSealedAndRoundTrips() {
        val addr = LocalKey.create(ctx)
        assertTrue(LocalKey.exists(ctx))
        assertEquals("a second create keeps the same key", addr, LocalKey.create(ctx))
        val kp = LocalKey.keypair(ctx)!!
        assertEquals(addr, kp.publicKey.toBase58())
        // the secret is never stored in the clear
        val stored = ctx.getSharedPreferences("solarchik-local-wallet", 0).all.values.joinToString()
        assertFalse(stored.contains(Base58.encode(kp.secret)))
        assertFalse(stored.contains(Base64.getEncoder().encodeToString(kp.secret)))
        LocalKey.delete(ctx)
        assertFalse(LocalKey.exists(ctx))
        assertNull(LocalKey.keypair(ctx))
    }

    @Test fun signSlotFillsOnlyTheWalletSlot() {
        val kp = Keypair.generate()
        val asset = Keypair.generate()
        val sku = Catalog.skus.first { it.id == "sku-pred-weather" }
        val tx = Minter.buildMintTx(kp.publicKey, ByteArray(32) { 3 }, sku, AgentTier.PRO, asset)
        val raw = tx.serialize()
        val signed = LocalKey.signSlot(raw, kp)
        assertEquals(raw.size, signed.size)
        val msg = tx.message
        val sig0 = signed.copyOfRange(1, 65)
        val sig1 = signed.copyOfRange(65, 129)
        assertTrue("payer slot signed by the local key", kp.publicKey.verify(sig0, msg))
        assertTrue("asset co-signature untouched", asset.publicKey.verify(sig1, msg))
        val stranger = Keypair.generate()
        assertTrue(runCatching { LocalKey.signSlot(raw, stranger) }.exceptionOrNull() is WalletError)
    }

    @Test fun noWalletAppOffersBuiltInAndMintsWithIt() = runBlocking {
        SolanaWallet.walletAppCheck = { false }
        val w = SolanaWallet(ctx)
        w.forget()
        val chain = ChainStub()
        w.rpcOverride = chain
        var offered = 0
        w.offerBuiltIn = { offered++; w.useBuiltIn(); true }
        assertFalse(w.hasWalletApp())
        val store = AgentStore(ctx)
        val minter = Minter(w, store)
        val sku = Catalog.skus.first { it.id == "sku-pred-weather" }
        val s = sender()
        val free = minter.mint(s, sku, AgentTier.FREE).getOrThrow()
        assertEquals(1, offered)
        assertTrue(w.isLocal)
        assertFalse("built-in wallet is never mainnet", w.mainnet)
        assertEquals(LocalKey.address(ctx), w.address)
        assertEquals("SIG1", free.sig)
        assertEquals(w.address, free.owner)
        assertEquals("devnet", free.cluster)
        val pro = minter.mint(s, sku, AgentTier.PRO).getOrThrow()
        assertEquals("offer shown once", 1, offered)
        assertEquals("SIG2", pro.sig)
        // the Pro tx pays the treasury and is fully signed by the local key (slot 0)
        val raw = chain.sent[1]
        val kp = LocalKey.keypair(ctx)!!
        val n = raw[0].toInt()
        val msg = raw.copyOfRange(1 + 64 * n, raw.size)
        assertTrue(kp.publicKey.verify(raw.copyOfRange(1, 65), msg))
        assertTrue(Base58.decode(SolarchikConfig.TREASURY).let { t -> msg.toList().windowed(32).any { it.toByteArray().contentEquals(t) } })
    }

    @Test fun emptyBuiltInWalletExplainsItself() = runBlocking {
        SolanaWallet.walletAppCheck = { false }
        val w = SolanaWallet(ctx)
        w.useBuiltIn()
        val chain = ChainStub(lamports = 200_000_000L).apply { sendError = "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit." }
        w.rpcOverride = chain
        val r = w.signAndSend(sender()) { payer, hash -> LegacyTx.compile(payer, hash, listOf(net.solardepin.solarchik.solana.SystemIx.transfer(payer, payer, 1))) }
        val e = r.exceptionOrNull()
        assertNotNull(e)
        assertEquals(SolanaWallet.NO_DEVNET_SOL, e!!.message)
        assertTrue(WalletError.text(ctx, e).contains("devnet SOL"))
    }

    @Test fun signTextUsesTheLocalKey() = runBlocking {
        SolanaWallet.walletAppCheck = { false }
        val w = SolanaWallet(ctx)
        w.useBuiltIn()
        val p = w.signText(sender(), "hello").getOrThrow()
        assertEquals(w.address, p.address)
        assertTrue(LocalKey.keypair(ctx)!!.publicKey.verify(Base58.decode(p.signature), "hello".encodeToByteArray()))
    }
}
