package net.solardepin.solarchik

import net.solardepin.solarchik.agents.Minter
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.solana.CoreIx
import net.solardepin.solarchik.solana.LegacyTx
import net.solardepin.solarchik.solana.SystemIx
import net.solardepin.solarchik.wallet.Base58
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sol4k.Keypair
import org.sol4k.PublicKey

/**
 * Byte-for-byte checks against @metaplex-foundation/mpl-core createV1 and @solana/web3.js
 * (see the scripts in tools/mpl-core-ref, which generated the hex below for the same inputs).
 */
class CoreIxTest {
    private val payer = PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")
    private val asset = PublicKey("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T")
    private val treasury = PublicKey("8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic")
    private val blockhash = Base58.decode("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N")

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    private fun royalties() = CoreIx.Plugin.Royalties(500, listOf(CoreIx.Creator(treasury, 100)))

    @Test fun createV1DataMatchesMplCorePro() {
        val data = CoreIx.createV1Data(
            "Bitcoin Windows #11 Pro", "urn:solarchik:agent",
            listOf(royalties(), CoreIx.Plugin.Attributes(listOf("sku" to "sku-pred-alpha-pro", "tier" to "pro", "class" to "1"))),
        )
        assertEquals(REF1_DATA, hex(data))
    }

    @Test fun createV1AccountsMatchMplCore() {
        val ix = CoreIx.createV1(asset, payer, "x", "u", emptyList())
        assertEquals("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", ix.program.toBase58())
        val got = ix.accounts.map { Triple(it.key.toBase58(), it.signer, it.writable) }
        assertEquals(REF1_KEYS, got)
    }

    @Test fun createV1DataMatchesMplCoreFree() {
        val data = CoreIx.createV1Data(
            "Events Scout #04", "urn:solarchik:agent",
            listOf(royalties(), CoreIx.Plugin.Attributes(listOf("sku" to "sku-pred-events", "tier" to "free", "class" to "1"))),
        )
        assertEquals(REF2_FREE, hex(data))
    }

    @Test fun legacyMessageMatchesWeb3js() {
        val create = CoreIx.createV1(
            asset, payer, "Events Scout #04", "urn:solarchik:agent",
            listOf(royalties(), CoreIx.Plugin.Attributes(listOf("sku" to "sku-pred-events", "tier" to "free", "class" to "1"))),
        )
        val tx = LegacyTx.compile(payer, blockhash, listOf(SystemIx.transfer(payer, treasury, 100_000_000L), create))
        assertEquals(REF2_MSG, hex(tx.message))
    }

    @Test fun productionProMintMatchesReference() {
        val sku = Catalog.skus.first { it.id == "sku-combo-prime" }
        val plugins = CoreIx.agentPlugins(sku.skuId(AgentTier.PRO), AgentTier.PRO, sku.agentClass.id, sku.agentClass.role, 0, sku.lanes)
        assertEquals(REF3_DATA, hex(CoreIx.createV1Data(sku.nameFor(AgentTier.PRO), "urn:solarchik:agent", plugins)))
        // Minter builds the same message with a real keypair; swap in the fixed asset key to compare.
        val tx = LegacyTx.compile(
            payer, blockhash,
            listOf(SystemIx.transfer(payer, treasury, 100_000_000L), CoreIx.createV1(asset, payer, sku.nameFor(AgentTier.PRO), "urn:solarchik:agent", plugins)),
        )
        assertEquals(REF3_MSG, hex(tx.message))
    }

    @Test fun everySkuFitsInOnePacketAndAssetPartiallySigns() {
        for (sku in Catalog.skus) for (tier in listOf(AgentTier.FREE, AgentTier.PRO)) {
            val kp = Keypair.generate()
            val tx = Minter.buildMintTx(payer, blockhash, sku, tier, kp)
            val bytes = tx.serialize()
            assertTrue("${sku.id} $tier size ${bytes.size}", bytes.size <= LegacyTx.MAX_SIZE)
            assertEquals(2, tx.signerCount)
            assertEquals(payer, tx.keys[0].key)
            // slot 0 (wallet) is empty, slot 1 (asset) is a valid signature of the message
            assertArrayEquals(ByteArray(64), tx.signature(0))
            assertEquals(1, tx.signerIndex(kp.publicKey))
            assertTrue(kp.publicKey.verify(tx.signature(1), tx.message))
            val hasTransfer = tx.keys.any { it.key == treasury }
            assertEquals(tier == AgentTier.PRO, hasTransfer)
        }
    }

    @Test fun systemTransferLayout() {
        val ix = SystemIx.transfer(payer, treasury, 100_000_000L)
        assertEquals("0200000000e1f50500000000", hex(ix.data))
    }

    @Test fun parsesCoreAssetOwnerAndName() {
        // key=1 | owner | updateAuthority Address(1)+32 | name | uri
        val name = "Combo Prime Pro".encodeToByteArray()
        val data = byteArrayOf(1) + payer.bytes() + byteArrayOf(1) + treasury.bytes() +
            byteArrayOf(name.size.toByte(), 0, 0, 0) + name + byteArrayOf(0, 0, 0, 0)
        assertEquals(payer, CoreIx.ownerOf(data))
        assertEquals("Combo Prime Pro", CoreIx.nameOf(data))
        assertEquals(Catalog.skus.first { it.id == "sku-combo-prime" } to AgentTier.PRO, Catalog.fromName("Combo Prime Pro"))
    }

    companion object {
        const val REF1_DATA = "000017000000426974636f696e2057696e646f7773202331312050726f1300000075726e3a736f6c61726368696b3a616765" +
            "6e74010200000000f401010000006c5fbdfd6f0d5b5338cc6f6da76c0edeaab045ea2137f7da56d96a1c4055ce7d64000006" +
            "0300000003000000736b7512000000736b752d707265642d616c7068612d70726f04000000746965720300000070726f0500" +
            "0000636c617373010000003100"
        val REF1_KEYS = listOf(
            Triple("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", true, true),
            Triple("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", false, false),
            Triple("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", false, false),
            Triple("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", true, true),
            Triple("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", false, false),
            Triple("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", false, false),
            Triple("11111111111111111111111111111111", false, false),
            Triple("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", false, false),
        )
        const val REF2_FREE = "0000100000004576656e74732053636f7574202330341300000075726e3a736f6c61726368696b3a6167656e740102000000" +
            "00f401010000006c5fbdfd6f0d5b5338cc6f6da76c0edeaab045ea2137f7da56d96a1c4055ce7d6400000603000000030000" +
            "00736b750f000000736b752d707265642d6576656e74730400000074696572040000006672656505000000636c6173730100" +
            "00003100"
        const val REF2_MSG = "020002057e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f2321cfa5add185e8893a5fd88013e" +
            "c4d7e122ded46354cadff50d956395e75b606c5fbdfd6f0d5b5338cc6f6da76c0edeaab045ea2137f7da56d96a1c4055ce7d" +
            "0000000000000000000000000000000000000000000000000000000000000000af54ab10bd97a542a09ef7b39889dd0cd394" +
            "a4cce9dfa6cdc97ebe2d235ba748cc490e928cd2e3873bb343fc95da33179ca60f4dbf46c2c36e91299d55d4e6b902030200" +
            "020c0200000000e1f50500000000040801040400040403049a010000100000004576656e74732053636f7574202330341300" +
            "000075726e3a736f6c61726368696b3a6167656e74010200000000f401010000006c5fbdfd6f0d5b5338cc6f6da76c0edeaa" +
            "b045ea2137f7da56d96a1c4055ce7d640000060300000003000000736b750f000000736b752d707265642d6576656e747304" +
            "00000074696572040000006672656505000000636c617373010000003100"
        const val REF3_DATA = "00000f000000436f6d626f205072696d652050726f1300000075726e3a736f6c61726368696b3a6167656e74010200000000" +
            "f401010000006c5fbdfd6f0d5b5338cc6f6da76c0edeaab045ea2137f7da56d96a1c4055ce7d640000060700000003000000" +
            "736b7513000000736b752d636f6d626f2d7072696d652d70726f04000000746965720300000070726f05000000636c617373" +
            "010000003304000000726f6c6505000000636f6d626f030000006665650100000030020000006c6e03000000636577050000" +
            "00747261636b040000006c69766500"
        const val REF3_MSG = "020002057e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f2321cfa5add185e8893a5fd88013e" +
            "c4d7e122ded46354cadff50d956395e75b606c5fbdfd6f0d5b5338cc6f6da76c0edeaab045ea2137f7da56d96a1c4055ce7d" +
            "0000000000000000000000000000000000000000000000000000000000000000af54ab10bd97a542a09ef7b39889dd0cd394" +
            "a4cce9dfa6cdc97ebe2d235ba748cc490e928cd2e3873bb343fc95da33179ca60f4dbf46c2c36e91299d55d4e6b902030200" +
            "020c0200000000e1f5050000000004080104040004040304d70100000f000000436f6d626f205072696d652050726f130000" +
            "0075726e3a736f6c61726368696b3a6167656e74010200000000f401010000006c5fbdfd6f0d5b5338cc6f6da76c0edeaab0" +
            "45ea2137f7da56d96a1c4055ce7d640000060700000003000000736b7513000000736b752d636f6d626f2d7072696d652d70" +
            "726f04000000746965720300000070726f05000000636c617373010000003304000000726f6c6505000000636f6d626f0300" +
            "00006665650100000030020000006c6e0300000063657705000000747261636b040000006c69766500"
    }
}
