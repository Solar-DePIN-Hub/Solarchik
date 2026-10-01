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
        val arr = get("https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volume24hr&ascending=false") as? JsonArray
            ?: return null
        return GammaPick.pick(arr.mapNotNull { GammaPick.parse(it as? JsonObject ?: return@mapNotNull null) }, System.currentTimeMillis())
            ?.let { Quote(Source.EVENTS, it.id, it.question, it.yes) }
    }

    private fun eventById(id: String): Quote? {
        val m = GammaPick.parse(get("https://gamma-api.polymarket.com/markets/$id") as? JsonObject ?: return null) ?: return null
        return Quote(Source.EVENTS, m.id, m.question, m.yes)
    }
}

/**
 * Gamma market parsing and the events pick. Base rule as web pickEvent (not Bitcoin, not sports,
 * favourite between the entry floor and 94%). A position lasts 30 minutes, so the pick prefers
 * markets that resolve within days and trade actively: long-dated favourites barely move in half
 * an hour and would settle flat every time.
 */
object GammaPick {
    data class Market(
        val id: String,
        val question: String,
        val yes: Double,
        val volume: Double,
        val endMs: Long?,
        val open: Boolean,
        /** 24 h traded volume (USD). */
        val volume24h: Double = 0.0,
        /** Gamma oneDayPriceChange / oneHourPriceChange of the YES price (absolute values). */
        val dayMove: Double = 0.0,
        val hourMove: Double = 0.0,
    )

    /** Resolves within this many days: tier 1. */
    const val SOON_DAYS = 7L
    /** Fallback horizon before any end date is accepted. */
    const val LATER_DAYS = 30L
    /** Enough trading for the price to move inside one window. */
    const val MIN_VOLUME_24H = 20_000.0
    /** "Moving": at least one point in a day or half a point in an hour. */
    const val MIN_DAY_MOVE = 0.01
    const val MIN_HOUR_MOVE = 0.005
    /** Must outlast the 30-minute window with room to settle. */
    const val MIN_LEFT_MS = 2 * 3600_000L

    private val json = Json { ignoreUnknownKeys = true }
    private val btc = Regex("\\b(bitcoin|btc)\\b", RegexOption.IGNORE_CASE)
    private val sports = Regex(
        "\\b(vs\\.?|nfl|nba|nhl|mlb|fc|uefa|premier league|match|game \\d|map handicap|spread:|o/u|bo3|bo5|counter-strike|valorant|lol:|dota|win on \\d{4}-\\d{2}-\\d{2}|end in a draw)(?![a-z0-9])",
        RegexOption.IGNORE_CASE,
    )

    private fun dbl(o: JsonObject, key: String): Double? = o[key]?.let { runCatching { it.jsonPrimitive.contentOrNull?.toDoubleOrNull() }.getOrNull() }

    fun parse(o: JsonObject): Market? {
        val id = o["id"]?.jsonPrimitive?.contentOrNull ?: return null
        val q = o["question"]?.jsonPrimitive?.contentOrNull ?: return null
        val prices = o["outcomePrices"]?.jsonPrimitive?.contentOrNull?.let {
            runCatching { json.parseToJsonElement(it).jsonArray.map { p -> p.jsonPrimitive.contentOrNull?.toDoubleOrNull() ?: Double.NaN } }.getOrNull()
        } ?: return null
        val yes = prices.firstOrNull()?.takeIf { it.isFinite() && it in 0.0..1.0 } ?: return null
        val vol = dbl(o, "volume") ?: 0.0
        val end = o["endDate"]?.jsonPrimitive?.contentOrNull?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        val open = o["active"]?.jsonPrimitive?.booleanOrNull != false && o["closed"]?.jsonPrimitive?.booleanOrNull != true
        return Market(
            id, q, yes, vol, end, open,
            volume24h = dbl(o, "volume24hr") ?: 0.0,
            dayMove = kotlin.math.abs(dbl(o, "oneDayPriceChange") ?: 0.0),
            hourMove = kotlin.math.abs(dbl(o, "oneHourPriceChange") ?: 0.0),
        )
    }

    private fun fav(m: Market) = maxOf(m.yes, 1 - m.yes)

    fun moving(m: Market) = m.dayMove >= MIN_DAY_MOVE || m.hourMove >= MIN_HOUR_MOVE

    /**
     * Tiers, first non-empty wins:
     * 1. resolves within 7 days, 24 h volume >= 20k and moving; 2. same without the move;
     * 3. within 30 days with that volume; 4. the plain base rule.
     * Inside a tier: most 24 h volume first, then the stronger favourite.
     */
    fun pick(markets: List<Market>, now: Long): Market? {
        val base = markets
            .filter { it.open && !btc.containsMatchIn(it.question) && !sports.containsMatchIn(it.question) }
            .filter { it.endMs == null || it.endMs > now + MIN_LEFT_MS }
            .filter { val f = fav(it); f + 1e-9 >= Strategies.MIN_CONFIDENCE && f <= Strategies.FAVORITE_MAX }
        fun within(m: Market, days: Long) = m.endMs != null && m.endMs <= now + days * 86_400_000L
        val liquid = base.filter { it.volume24h >= MIN_VOLUME_24H }
        val tiers = listOf(
            liquid.filter { within(it, SOON_DAYS) && moving(it) },
            liquid.filter { within(it, SOON_DAYS) },
            liquid.filter { within(it, LATER_DAYS) },
        )
        val byActivity = compareByDescending<Market> { it.volume24h }.thenByDescending { fav(it) }
        tiers.firstOrNull { it.isNotEmpty() }?.let { return it.sortedWith(byActivity).first() }
        return base.sortedWith(compareByDescending<Market> { fav(it) }.thenByDescending { it.volume }).firstOrNull()
    }
}
