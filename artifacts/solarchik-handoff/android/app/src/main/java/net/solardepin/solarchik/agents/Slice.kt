package net.solardepin.solarchik.agents

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject

/**
 * Slice (0.21.7, restored): the web desk's "Акції / Slice" tab never made it into the native rewrite.
 * Tokenized stocks (xStocks / PreStocks mints on Solana mainnet) with LIVE prices from Jupiter's public
 * price API, and a PAPER portfolio on the phone: virtual dollars, no wallet, no transaction.
 */
object SliceStocks {
    data class Stock(val name: String, val ticker: String, val mint: String)

    /** Same 10 mints as the web (src/lib/agents/slice-stocks.ts). */
    val all = listOf(
        Stock("Apple", "AAPLx", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"),
        Stock("NVIDIA", "NVDAx", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
        Stock("Microsoft", "MSFTx", "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX"),
        Stock("Alphabet", "GOOGLx", "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN"),
        Stock("Amazon", "AMZNx", "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg"),
        Stock("Meta", "METAx", "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu"),
        Stock("Tesla", "TSLAx", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"),
        Stock("S&P 500", "SPYx", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"),
        Stock("Nasdaq 100", "QQQx", "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ"),
        Stock("OpenAI", "OpenAI", "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF"),
    )
    const val SITE = "https://slice-solana.netlify.app/"
    const val PRICE_API = "https://lite-api.jup.ag/price/v3?ids="
}

data class SlicePrice(val usd: Double, val change24h: Double?)

object SlicePrices {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(body: String): Map<String, SlicePrice> {
        val o = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return emptyMap()
        return o.mapNotNull { (mint, v) ->
            val row = v as? JsonObject ?: return@mapNotNull null
            val usd = (row["usdPrice"] as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
            if (!usd.isFinite() || usd <= 0) return@mapNotNull null
            mint to SlicePrice(usd, (row["priceChange24h"] as? JsonPrimitive)?.doubleOrNull)
        }.toMap()
    }

    suspend fun fetch(get: suspend (String) -> String? = ::httpGet): Map<String, SlicePrice> {
        val body = runCatching { get(SliceStocks.PRICE_API + SliceStocks.all.joinToString(",") { it.mint }) }.getOrNull() ?: return emptyMap()
        return parse(body)
    }

    private suspend fun httpGet(url: String): String? = withContext(Dispatchers.IO) {
        val req = okhttp3.Request.Builder().url(url).get().build()
        net.solardepin.solarchik.solana.Rpc.client.newCall(req).execute().use { if (it.isSuccessful) it.body?.string() else null }
    }
}

@Serializable
data class SliceLot(val qty: Double, val costUsd: Double)

@Serializable
data class SliceBook(val cash: Double = START_USD, val lots: Map<String, SliceLot> = emptyMap()) {
    fun value(prices: Map<String, SlicePrice>): Double = cash + lots.entries.sumOf { (m, l) -> l.qty * (prices[m]?.usd ?: (l.costUsd / l.qty)) }
    fun pnl(prices: Map<String, SlicePrice>): Double = value(prices) - START_USD

    /** Paper buy of [usd] dollars at [price]; refused (null) beyond the virtual cash. */
    fun buy(mint: String, usd: Double, price: Double): SliceBook? {
        if (usd <= 0 || price <= 0 || usd > cash + 1e-9) return null
        val cur = lots[mint] ?: SliceLot(0.0, 0.0)
        return copy(cash = cash - usd, lots = lots + (mint to SliceLot(cur.qty + usd / price, cur.costUsd + usd)))
    }

    /** Paper sell of the whole lot at [price]. */
    fun sellAll(mint: String, price: Double): SliceBook? {
        val l = lots[mint] ?: return null
        if (price <= 0) return null
        return copy(cash = cash + l.qty * price, lots = lots - mint)
    }

    companion object {
        const val START_USD = 1000.0
        const val TICKET_USD = 50.0
    }
}

/** Paper portfolio on the phone (prefs "solarchik-slice", wiped by Delete my data). */
class SliceStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun book(): SliceBook = prefs.getString("book", null)?.let { runCatching { json.decodeFromString(SliceBook.serializer(), it) }.getOrNull() } ?: SliceBook()
    fun save(b: SliceBook) = prefs.edit().putString("book", json.encodeToString(SliceBook.serializer(), b)).apply()
    fun reset() = prefs.edit().remove("book").apply()

    companion object {
        const val PREFS = "solarchik-slice"
    }
}
