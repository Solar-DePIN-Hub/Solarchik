package net.solardepin.solarchik.agents

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Strategy NFTs on Android (devnet only): the same server routes as the web
 * (/api/native/strategy-* and /api/native/market-*). The MWA wallet signs a
 * proof message and the server-built transactions; the server validates and
 * co-signs. Pure helpers here mirror strategy-spec.ts so a judge can verify
 * the on-chain APR on the phone too.
 */
object StrategyRules {
    const val SALE_LOCK_HOURS = 240
    const val ROYALTY_BPS = 500
    private const val DAY_MS = 86_400_000L

    /** Same text the server verifies (wallet-proof.ts proofMessage). */
    fun proofMessage(action: String, wallet: String, ts: Long, extra: String): String =
        "solarchik:$action:v1\nwallet:$wallet\nts:$ts\n$extra"

    fun explorerTx(sig: String) = "https://explorer.solana.com/tx/$sig?cluster=devnet"
    fun explorerAddress(addr: String) = "https://explorer.solana.com/address/$addr?cluster=devnet"
    fun coreExplorer(asset: String) = "https://core.metaplex.com/explorer/$asset?env=devnet"

    fun lockLeftMs(unlockSec: Long, nowMs: Long): Long = max(0L, unlockSec * 1000 - nowMs)

    /** "2д 3год" style; "" when open. */
    fun lockParts(leftMs: Long): Pair<Long, Long>? {
        if (leftMs <= 0) return null
        val totalMin = (leftMs + 59_999) / 60_000
        val h = totalMin / 60
        return (h / 24) to (h % 24)
    }

    /** Seller gets price − 5%, the treasury the royalty (integer lamports). */
    fun splitSale(priceLamports: Long): Pair<Long, Long> {
        val royalty = priceLamports * ROYALTY_BPS / 10_000
        return (priceLamports - royalty) to royalty
    }

    data class Trade(val openedMs: Long, val closedMs: Long, val stakeLamports: Long, val pnlLamports: Long)

    data class Perf(
        val trades: Int,
        val winRatePct: Double?,
        val realizedSol: Double,
        val apr7: Double?,
        val apr30: Double?,
        val aprSince: Double?,
        val writtenSec: Long = 0,
    )

    /** Same rounding as JS Number(v.toFixed(d)): exact binary value, halves away from zero. */
    fun fix(v: Double, d: Int): Double = java.math.BigDecimal(v).setScale(d, java.math.RoundingMode.HALF_UP).toDouble()

    fun aprOver(trades: List<Trade>, fromMs: Long, nowMs: Long): Double? {
        val rows = trades.filter { it.closedMs in fromMs..nowMs }
        if (rows.isEmpty()) return null
        val capital = rows.maxOf { it.stakeLamports }
        if (capital <= 0) return null
        val pnl = rows.sumOf { it.pnlLamports }.toDouble()
        val days = max(nowMs - fromMs, DAY_MS).toDouble() / DAY_MS
        val apr = pnl / capital * (365.0 / days) * 100.0
        return max(-99_999.0, min(99_999.0, fix(apr, 1)))
    }

    fun computePerf(all: List<Trade>, changedMs: Long, nowMs: Long): Perf {
        val t = all.filter { it.openedMs >= changedMs && it.closedMs <= nowMs }
        val wins = t.count { it.pnlLamports > 0 }
        val cum = t.sumOf { it.pnlLamports }
        return Perf(
            trades = t.size,
            winRatePct = if (t.isEmpty()) null else fix(wins * 100.0 / t.size, 1),
            realizedSol = fix(cum / 1e9, 6),
            apr7 = aprOver(t, max(nowMs - 7 * DAY_MS, changedMs), nowMs),
            apr30 = aprOver(t, max(nowMs - 30 * DAY_MS, changedMs), nowMs),
            aprSince = aprOver(t, changedMs, nowMs),
        )
    }

    data class Check(val ok: Boolean, val recomputed: Perf, val mismatches: List<String>, val newer: Int)

    /** Recompute the on-chain results at their write time (pu) from the listed records. */
    fun verify(trades: List<Trade>, changedSec: Long, onChain: Perf): Check {
        val asOf = onChain.writtenSec * 1000
        val r = computePerf(trades, changedSec * 1000, asOf)
        val bad = mutableListOf<String>()
        fun eq(a: Double?, b: Double?) = if (a == null || b == null) a == b else abs(a - b) < 1e-9
        if (r.trades != onChain.trades) bad += "trades ${r.trades} ≠ ${onChain.trades}"
        if (!eq(r.winRatePct, onChain.winRatePct)) bad += "win% ${r.winRatePct} ≠ ${onChain.winRatePct}"
        if (!eq(fix(r.realizedSol, 5), onChain.realizedSol)) bad += "pnl ${fix(r.realizedSol, 5)} ≠ ${onChain.realizedSol}"
        if (!eq(r.apr7, onChain.apr7)) bad += "apr7 ${r.apr7} ≠ ${onChain.apr7}"
        if (!eq(r.apr30, onChain.apr30)) bad += "apr30 ${r.apr30} ≠ ${onChain.apr30}"
        if (!eq(r.aprSince, onChain.aprSince)) bad += "apr ${r.aprSince} ≠ ${onChain.aprSince}"
        val newer = trades.count { it.openedMs >= changedSec * 1000 && it.closedMs > asOf }
        return Check(bad.isEmpty(), r, bad, newer)
    }
}

/** One Strategy NFT as the server reports it (strategy-info / market-list item). */
data class StrategyCard(
    val asset: String,
    val name: String,
    val owner: String,
    val priceLamports: Long?,
    val summary: String,
    val version: Int,
    val hash: String,
    val hashOk: Boolean,
    val changedSec: Long,
    val unlockSec: Long,
    val hasChain: Boolean,
    val perf: StrategyRules.Perf?,
    val trades: List<StrategyRules.Trade>,
    val feeSigs: List<String>,
    val perfSig: String?,
    val versionSigs: List<String>,
    val saleSigs: List<String>,
    val listed: Boolean,
    val spec: JsonObject?,
) {
    companion object {
        private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
        private fun JsonElement?.str(): String = (this as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
        private fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
        private fun JsonElement?.long(): Long = (this as? JsonPrimitive)?.longOrNull ?: (this.num()?.toLong() ?: 0L)

        fun summaryOf(spec: JsonObject?): String {
            if (spec == null) return ""
            val lanes = (spec["lanes"] as? JsonArray)?.joinToString("+") { it.str() }.orEmpty()
            val windows = (spec["windows"] as? JsonArray)?.joinToString("/") { (it as? JsonPrimitive)?.content ?: "" }.orEmpty()
            val rules = spec["rules"].str()
            return "$lanes · $windows min · ${spec["risk"].str()} · ≤ ${spec["stakeSol"].num()} SOL · " +
                "${spec["askLo"].num()}–${spec["askHi"].num()} · stop ${spec["stopPct"].long()}% · take ${spec["takePct"].long()}%" +
                if (rules.isNotBlank()) " · $rules" else ""
        }

        fun parse(o: JsonObject): StrategyCard {
            val chain = o["chain"].obj()
            val perf = o["perf"].obj()?.let {
                StrategyRules.Perf(
                    trades = it["trades"].long().toInt(),
                    winRatePct = it["winRatePct"].num(),
                    realizedSol = it["realizedSol"].num() ?: 0.0,
                    apr7 = it["apr7"].num(),
                    apr30 = it["apr30"].num(),
                    aprSince = it["aprSince"].num(),
                    writtenSec = it["writtenSec"].long(),
                )
            }
            val records = (o["records"] as? JsonArray).orEmpty().mapNotNull { it.obj() }
            val listing = o["listing"].obj()
            val st = listing?.get("status").str()
            return StrategyCard(
                asset = o["asset"].str(),
                name = o["name"].str(),
                owner = o["owner"].str(),
                priceLamports = o["priceLamports"]?.let { it.long() },
                summary = summaryOf(chain?.get("spec").obj()),
                version = chain?.get("version").long().toInt(),
                hash = chain?.get("hash").str(),
                hashOk = (chain?.get("hashOk") as? JsonPrimitive)?.booleanOrNull == true,
                changedSec = chain?.get("changedSec").long(),
                unlockSec = chain?.get("unlockSec").long(),
                hasChain = chain != null,
                perf = perf,
                trades = records.map {
                    StrategyRules.Trade(it["openedMs"].long(), it["closedMs"].long(), it["stakeLamports"].long(), it["pnlLamports"].long())
                },
                feeSigs = records.flatMap { r -> (r["feeSigs"] as? JsonArray).orEmpty().map { it.str() } },
                perfSig = o["perfWrite"].obj()?.get("sig").str().ifBlank { null },
                versionSigs = (o["versions"] as? JsonArray).orEmpty().mapNotNull { it.obj()?.get("sig").str().ifBlank { null } },
                saleSigs = (o["sales"] as? JsonArray).orEmpty().mapNotNull { it.obj()?.get("sig").str().ifBlank { null } },
                listed = st == "active" || st == "pending",
                spec = chain?.get("spec").obj(),
            )
        }

        fun parseMarket(body: JsonObject): List<StrategyCard> =
            if ((body["ok"] as? JsonPrimitive)?.booleanOrNull != true) emptyList()
            else (body["items"] as? JsonArray).orEmpty().mapNotNull { it.obj()?.let(::parse) }
    }
}

/** HTTP client for the strategy/market routes of the web server. */
object StrategyApi {
    const val BASE = "https://solarchik-super-app.vercel.app"
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun post(route: String, body: JsonObject): JsonObject = withContext(Dispatchers.IO) {
        val c = URL("$BASE/api/native/$route").openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 15_000
            c.readTimeout = 45_000
            c.doOutput = true
            c.setRequestProperty("content-type", "application/json")
            c.outputStream.use { it.write(body.toString().encodeToByteArray()) }
            val stream = if (c.responseCode in 200..299) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            runCatching { json.parseToJsonElement(text).jsonObject }.getOrElse {
                buildJsonObject { put("ok", false); put("reason", "server ${c.responseCode}") }
            }
        } finally {
            c.disconnect()
        }
    }

    fun proof(wallet: String, ts: Long, sig: String): JsonObject = buildJsonObject {
        put("wallet", wallet)
        put("ts", ts)
        put("sig", sig)
    }

    fun reason(o: JsonObject): String = (o["reason"] as? JsonPrimitive)?.content ?: (o["error"] as? JsonPrimitive)?.content ?: "error"
    fun ok(o: JsonObject): Boolean = (o["ok"] as? JsonPrimitive)?.booleanOrNull == true

    fun txs(o: JsonObject): List<ByteArray> =
        (o["txs"] as? JsonArray).orEmpty().map { java.util.Base64.getDecoder().decode((it as JsonPrimitive).content) }
}
