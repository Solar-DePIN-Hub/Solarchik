package net.solardepin.solarchik

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import net.solardepin.solarchik.agents.Minter
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.solana.CoreIx
import net.solardepin.solarchik.solana.Rpc
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.sol4k.Keypair
import org.sol4k.PublicKey
import java.util.Base64

/**
 * Opt-in live check on DEVNET ONLY: -Pdevnet=1. A throwaway payer is generated in memory,
 * funded by the devnet faucet, then mints FREE and PRO exactly as the app builds them
 * (the payer signs slot 0 here instead of MWA). Never touches mainnet.
 */
class DevnetMintIT {
    /**
     * Faucet-free check: the devnet Core program executes every SKU/tier exactly as built,
     * via simulateTransaction (sigVerify off) with a funded public devnet account as fee payer.
     * Nothing is sent.
     */
    @Test fun coreProgramAcceptsEveryMintInSimulation() = runBlocking {
        assumeTrue(System.getProperty("solarchik.devnet") == "1")
        val rpc = Rpc(SolarchikConfig.RPC_DEVNET)
        val payer = PublicKey(SolarchikConfig.TREASURY) // has devnet SOL; only simulated
        for (sku in Catalog.skus) for (tier in listOf(AgentTier.FREE, AgentTier.PRO)) {
            val asset = Keypair.generate()
            val tx = Minter.buildMintTx(payer, rpc.latestBlockhash(), sku, tier, asset)
            val r = rpc.call(
                "simulateTransaction",
                buildJsonArray {
                    add(JsonPrimitive(Base64.getEncoder().encodeToString(tx.serialize())))
                    add(buildJsonObject { put("encoding", "base64"); put("sigVerify", false); put("replaceRecentBlockhash", true); put("commitment", "confirmed") })
                },
            ).jsonObject["value"]!!.jsonObject
            val err = r["err"]
            val logs = r["logs"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
            println("SIM ${sku.skuId(tier)} err=$err units=${r["unitsConsumed"]} size=${tx.serialize().size}")
            assertTrue("${sku.skuId(tier)}: $err\n${logs.joinToString("\n")}", err == null || err is JsonNull)
            assertTrue(logs.any { it.contains("${SolarchikConfig.MPL_CORE_PROGRAM} success") })
            delay(400)
        }
    }

    @Test fun mintsFreeAndProOnDevnet() = runBlocking {
        assumeTrue(System.getProperty("solarchik.devnet") == "1")
        val rpc = Rpc(SolarchikConfig.RPC_DEVNET)
        val payer = Keypair.generate()
        val addr = payer.publicKey.toBase58()
        println("DEVNET payer $addr")
        val dropped = runCatching { rpc.requestAirdrop(addr, SolarchikConfig.lamports(0.25)) }
        assumeTrue("devnet faucet refused: ${dropped.exceptionOrNull()?.message}", dropped.isSuccess)
        var bal = 0L
        repeat(30) {
            bal = rpc.balanceLamports(addr)
            if (bal > 0) return@repeat
            delay(2000)
        }
        assumeTrue("faucet gave nothing (rate limit)", bal > 0)
        val treasuryBefore = rpc.balanceLamports(SolarchikConfig.TREASURY)
        for (tier in listOf(AgentTier.FREE, AgentTier.PRO)) {
            val sku = Catalog.skus.first { it.id == "sku-combo-prime" }
            val asset = Keypair.generate()
            val tx = Minter.buildMintTx(payer.publicKey, rpc.latestBlockhash(), sku, tier, asset)
            tx.partialSign(payer)
            val sig = rpc.sendTransaction(tx.serialize())
            println("DEVNET $tier mint sig $sig asset ${asset.publicKey.toBase58()}")
            var info: Rpc.AccountInfo? = null
            repeat(30) {
                info = rpc.accountInfo(asset.publicKey.toBase58())
                if (info != null) return@repeat
                delay(1500)
            }
            val got = info!!
            assertEquals(SolarchikConfig.MPL_CORE_PROGRAM, got.owner)
            assertEquals(payer.publicKey, CoreIx.ownerOf(got.data))
            assertEquals(sku.nameFor(tier), CoreIx.nameOf(got.data))
        }
        val treasuryAfter = rpc.balanceLamports(SolarchikConfig.TREASURY)
        assertEquals(SolarchikConfig.lamports(SolarchikConfig.PRO_PRICE_SOL), treasuryAfter - treasuryBefore)
    }
}
