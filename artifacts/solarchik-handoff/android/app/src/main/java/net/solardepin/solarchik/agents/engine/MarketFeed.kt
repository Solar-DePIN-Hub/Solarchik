package net.solardepin.solarchik.agents.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.solardepin.solarchik.solana.Rpc
import okhttp3.Request
import java.time.Instant

/** Reads live public market data. Every source has a fallback; a failed read is null, never invented. */
interface MarketFeed {
    suspend fun quote(source: Source, key: String? = null): Quote?
}

class HttpMarketFeed : MarketFeed {
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun quote(source: Source, key: String?): Quote? = withContext(Dispatchers.IO) {
        runCatching {
            when (source) {
                Source.BTC -> coinbase("BTC-USD")?.let { Quote(source, "BTC-USD", "Bitcoin · Coinbase", it) }
                    ?: kraken("XBTUSD")?.let { Quote(source, "BTC-USD", "Bitcoin · Kraken", it) }
                Source.SOL -> backpack("SOL_USDC")?.let { Quote(source, "SOL-USDC", "SOL/USDC · Backpack", it) }
                    ?: coinbase("SOL-USD")?.let { Quote(source, "SOL-USDC", "SOL/USD · Coinbase", it) }
                Source.WEATHER -> kyiv()?.let { Quote(source, "kyiv-t2m", "Kyiv °C · Open-Meteo", it + 273.15) }
                Source.EVENTS -> if (key != null) eventById(key) else topEvent()
            }
        }.getOrNull()
    }

    private fun get(url: String): JsonElement? {
        val req = Request.Builder().url(url).header("User-Agent", "Solarchik-Android").build()
        Rpc.client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return null
            return json.parseToJsonElement(res.body?.string().orEmpty())
        }
    }

    private fun num(e: JsonElement?): Double? = e?.jsonPrimitive?.let { it.doubleOrNull ?: it.contentOrNull?.toDoubleOrNull() }

    private fun coinbase(pair: String): Double? =
        num(get("https://api.coinbase.com/v2/prices/$pair/spot")?.jsonObject?.get("data")?.jsonObject?.get("amount"))?.takeIf { it > 0 }

    private fun kraken(pair: String): Double? {
        val result = get("https://api.kraken.com/0/public/Ticker?pair=$pair")?.jsonObject?.get("result")?.jsonObject ?: return null
        val first = result.values.firstOrNull()?.jsonObject ?: return null
        return num(first["c"]?.jsonArray?.firstOrNull())?.takeIf { it > 0 }
    }

    private fun backpack(symbol: String): Double? =
        num(get("https://api.backpack.exchange/api/v1/ticker?symbol=$symbol")?.jsonObject?.get("lastPrice"))?.takeIf { it > 0 }

    private fun kyiv(): Double? =
        num(get("https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current=temperature_2m")
            ?.jsonObject?.get("current")?.jsonObject?.get("temperature_2m"))

    private fun topEvent(): Quote? {
        val arr = get("https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=60&order=volume24hr&ascending=false") as? JsonArray
            ?: return null
        return GammaPick.pick(arr.mapNotNull { GammaPick.parse(it as? JsonObject ?: return@mapNotNull null) }, System.currentTimeMillis())
            ?.let { Quote(Source.EVENTS, it.id, it.question, it.yes) }
    }

    private fun eventById(id: String): Quote? {
        val m = GammaPick.parse(get("https://gamma-api.polymarket.com/markets/$id") as? JsonObject ?: return null) ?: return null
        return Quote(Source.EVENTS, m.id, m.question, m.yes)
    }
}

/** Gamma market parsing and the events pick (web pickEvent: not Bitcoin, favorite 62–94%, loudest first). */
object GammaPick {
    data class Market(val id: String, val question: String, val yes: Double, val volume: Double, val endMs: Long?, val open: Boolean)

    private val json = Json { ignoreUnknownKeys = true }
    private val btc = Regex("\\b(bitcoin|btc)\\b", RegexOption.IGNORE_CASE)
    private val sports = Regex("\\b(vs\\.?|nfl|nba|nhl|mlb|fc|uefa|premier league|match|game \\d)\\b", RegexOption.IGNORE_CASE)

    fun parse(o: JsonObject): Market? {
        val id = o["id"]?.jsonPrimitive?.contentOrNull ?: return null
        val q = o["question"]?.jsonPrimitive?.contentOrNull ?: return null
        val prices = o["outcomePrices"]?.jsonPrimitive?.contentOrNull?.let {
            runCatching { json.parseToJsonElement(it).jsonArray.map { p -> p.jsonPrimitive.contentOrNull?.toDoubleOrNull() ?: Double.NaN } }.getOrNull()
        } ?: return null
        val yes = prices.firstOrNull()?.takeIf { it.isFinite() } ?: return null
        val vol = o["volume"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: 0.0
        val end = o["endDate"]?.jsonPrimitive?.contentOrNull?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        val open = o["active"]?.jsonPrimitive?.booleanOrNull != false && o["closed"]?.jsonPrimitive?.booleanOrNull != true
        return Market(id, q, yes, vol, end, open)
    }

    fun pick(markets: List<Market>, now: Long): Market? = markets
        .filter { it.open && !btc.containsMatchIn(it.question) && !sports.containsMatchIn(it.question) }
        .filter { it.endMs == null || it.endMs > now + 2 * 3600_000L }
        .filter { val fav = maxOf(it.yes, 1 - it.yes); fav >= 0.62 && fav <= Strategies.FAVORITE_MAX }
        .sortedWith(compareByDescending<Market> { maxOf(it.yes, 1 - it.yes) }.thenByDescending { it.volume })
        .firstOrNull()
}
