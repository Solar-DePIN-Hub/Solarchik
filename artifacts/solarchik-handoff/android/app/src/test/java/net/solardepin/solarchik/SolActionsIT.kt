package net.solardepin.solarchik

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import net.solardepin.solarchik.agents.ChainSigner
import net.solardepin.solarchik.agents.StrategyApi
import net.solardepin.solarchik.agents.StrategyCard
import net.solardepin.solarchik.agents.StrategyFlows
import net.solardepin.solarchik.agents.StrategyRules
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.sol.ActAgent
import net.solardepin.solarchik.sol.ActContext
import net.solardepin.solarchik.sol.ActListing
import net.solardepin.solarchik.sol.ActType
import net.solardepin.solarchik.sol.SolActClient
import net.solardepin.solarchik.sol.SolActions
import net.solardepin.solarchik.solana.Rpc
import net.solardepin.solarchik.wallet.Base58
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.sol4k.Keypair
import java.io.File

/**
 * Opt-in LIVE run on DEVNET (-Pdevnet=1 -Pchat=act): the real Sol action route (Gemini) reads the
 * request, the phone code validates it and builds the plan, the "tap" is this test calling execute,
 * and the same [StrategyFlows] as the app signs with a throwaway keypair instead of MWA.
 * Key file: SOLARCHIK_IT_KEYFILE (box only, never committed), so a rerun reuses the same buyer.
 */
class SolActionsIT {
    private val rpc = Rpc(SolarchikConfig.RPC_DEVNET)

    private fun loadKey(): Keypair {
        val path = System.getenv("SOLARCHIK_IT_KEYFILE") ?: return Keypair.generate()
        val f = File(path)
        if (f.exists()) return Keypair.fromSecretKey(Base58.decode(f.readText().trim()))
        val k = Keypair.generate()
        f.parentFile?.mkdirs()
        f.writeText(Base58.encode(k.secret))
        return k
    }

    /** Server-built txs: put our signature in our slot (legacy or v0), send, wait for confirmed. */
    private inner class KeySigner(val key: Keypair) : ChainSigner {
        val address = key.publicKey.toBase58()
        override suspend fun signText(message: String) = Result.success(address to Base58.encode(key.sign(message.encodeToByteArray())))
        override suspend fun signAndSend(txs: List<ByteArray>): Result<String> = runCatching {
            var last = ""
            for (raw in txs) {
                val signed = signSlot(raw, key)
                last = rpc.sendTransaction(signed)
                var seen: String? = null
                for (i in 0 until 40) {
                    seen = rpc.signatureStatus(last)
                    if (seen == "confirmed" || seen == "finalized") break
                    check(seen != "failed") { "failed on chain: $last" }
                    delay(1000)
                }
                check(seen == "confirmed" || seen == "finalized") { "not confirmed: $last" }
            }
            last
        }
    }

    private fun shortvec(b: ByteArray, at: Int): Pair<Int, Int> {
        var v = 0; var shift = 0; var i = at
        while (true) { val x = b[i++].toInt() and 0xFF; v = v or ((x and 0x7F) shl shift); if (x and 0x80 == 0) break; shift += 7 }
        return v to i
    }

    private fun signSlot(tx: ByteArray, key: Keypair): ByteArray {
        val (n, sigStart) = shortvec(tx, 0)
        val msgStart = sigStart + 64 * n
        val msg = tx.copyOfRange(msgStart, tx.size)
        var p = if (msg[0].toInt() and 0x80 != 0) 1 else 0
        val required = msg[p].toInt() and 0xFF
        p += 3
        val (keys, keysAt) = shortvec(msg, p)
        val me = key.publicKey.bytes()
        val idx = (0 until minOf(required, keys)).firstOrNull { i -> msg.copyOfRange(keysAt + 32 * i, keysAt + 32 * i + 32).contentEquals(me) }
            ?: error("our key is not a signer of this tx")
        val out = tx.copyOf()
        key.sign(msg).copyInto(out, sigStart + 64 * idx)
        return out
    }

    private suspend fun fund(signer: KeySigner, needLamports: Long) {
        if (rpc.balanceLamports(signer.address) >= needLamports) return
        val air = runCatching { rpc.requestAirdrop(signer.address, 500_000_000L) }
        println("AIRDROP ${air.getOrNull() ?: air.exceptionOrNull()?.message}")
        if (air.isFailure) {
            val ts = System.currentTimeMillis()
            val (addr, sig) = signer.signText(StrategyRules.proofMessage("faucet", signer.address, ts, "devnet")).getOrThrow()
            val r = StrategyApi.post("faucet-drip", buildJsonObject { put("proof", StrategyApi.proof(addr, ts, sig)) })
            println("FAUCET $r")
        }
        repeat(40) { if (rpc.balanceLamports(signer.address) >= needLamports) return; delay(1500) }
    }

    private suspend fun market(me: String) = StrategyCard.parseMarket(StrategyApi.post("market-list", JsonObject(emptyMap())))
        .filter { it.priceLamports != null && it.owner != me }.map { ActListing(it.asset, it.name, it.priceLamports!!, it.spec) }

    private suspend fun mine(asset: String): ActAgent {
        val c = StrategyCard.parse(StrategyApi.post("strategy-info", buildJsonObject { put("asset", asset) }))
        return ActAgent(asset, c.name, strategyNft = c.hasChain && c.spec != null, spec = c.spec, listed = c.listed, unlockSec = c.unlockSec)
    }

    @Test fun chatBuysThenChangesStrategyOnDevnet() = runBlocking {
        assumeTrue(System.getProperty("solarchik.devnet") == "1" && System.getProperty("solarchik.chat") == "act")
        val signer = KeySigner(loadKey())
        println("BUYER ${signer.address}")
        val client = SolActClient()
        val flows = StrategyFlows(signer)
        val target = System.getenv("SOLARCHIK_IT_BUY") ?: "Calm Hourly BTC"
        var owned = System.getenv("SOLARCHIK_IT_OWNED").orEmpty()

        if (owned.isBlank()) {
            val list = market(signer.address)
            val wanted = list.firstOrNull { it.name == target }
            assumeTrue("listing '$target' is not on the market", wanted != null)
            fund(signer, wanted!!.priceLamports + 30_000_000L)
            val ctx1 = ActContext(emptyList(), list, canMintFree = false)
            val ask1 = "buy the $target NFT"
            val r1 = client.ask(ask1, "en", ctx1, emptyList())
            println("CHAT1 '$ask1' -> action=${r1.action} model=${r1.model} offline=${r1.offline} reply='${r1.reply}'")
            assertEquals(ActType.BUY_STRATEGY, r1.action?.type)
            val plan1 = SolActions.plan(r1.action!!, ctx1)
            println("CARD1 buy ${plan1.listing?.name} price=${plan1.priceLamports!! / 1e9} SOL locksSale=${plan1.locksSale}")
            // ---- the player's tap ----
            val o1 = flows.buy(signer.address, plan1.listing!!.id, plan1.priceLamports!!)
            println("BUY ok=${o1.ok} sig=${o1.sig} reason=${o1.reason} err=${o1.error?.message} ${StrategyRules.explorerTx(o1.sig)}")
            assertTrue(o1.reason + o1.error?.message, o1.ok)
            owned = plan1.listing!!.id
        }

        var agent = mine(owned)
        repeat(10) { if (agent.strategyNft) return@repeat; delay(2000); agent = mine(owned) }
        assertTrue("bought NFT carries a strategy", agent.strategyNft)
        val ctx2 = ActContext(listOf(agent), market(signer.address), canMintFree = false)
        val ask2 = System.getenv("SOLARCHIK_IT_ASK") ?: "зміни мого BTC агента на ризиковий 5 хвилин"
        val r2 = client.ask(ask2, if (ask2.any { it in 'а'..'я' || it in "іїєґ" }) "uk" else "en", ctx2, emptyList())
        println("CHAT2 '$ask2' -> action=${r2.action} model=${r2.model} offline=${r2.offline} reply='${r2.reply}'")
        assertEquals(ActType.SET_STRATEGY, r2.action?.type)
        val plan2 = SolActions.plan(r2.action!!, ctx2)
        println("CARD2 changes=${plan2.changes} locksSale=${plan2.locksSale} blocked=${plan2.blocked}")
        assertNotNull(plan2.nextSpec)
        // ---- the player's tap ----
        val o2 = flows.changeStrategy(signer.address, owned, plan2.nextSpec!!)
        println("STRATEGY ok=${o2.ok} v=${o2.version} unlockSec=${o2.unlockSec} sig=${o2.sig} reason=${o2.reason} err=${o2.error?.message} ${StrategyRules.explorerTx(o2.sig)}")
        assertTrue(o2.reason + o2.error?.message, o2.ok)
        println("ASSET ${StrategyRules.explorerAddress(owned)}")
    }
}
