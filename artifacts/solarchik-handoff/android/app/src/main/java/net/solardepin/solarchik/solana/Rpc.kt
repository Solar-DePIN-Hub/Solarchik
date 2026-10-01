package net.solardepin.solarchik.solana

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import net.solardepin.solarchik.wallet.Base58
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.Base64
import java.util.concurrent.TimeUnit

class RpcException(message: String, val code: Int = 0) : Exception(message)

/** Minimal JSON-RPC client for the few calls the app needs. */
class Rpc(val url: String) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun call(method: String, params: JsonArray): JsonElement = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", 1)
            put("method", method)
            put("params", params)
        }.toString()
        val req = Request.Builder().url(url)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (res.code == 429) throw RpcException("rate limited", 429)
            if (!res.isSuccessful) throw RpcException("HTTP ${res.code}", res.code)
            val obj = json.parseToJsonElement(text).jsonObject
            obj["error"]?.takeIf { it !is JsonNull }?.let {
                val e = it.jsonObject
                throw RpcException(e["message"]?.jsonPrimitive?.contentOrNull ?: "rpc error", e["code"]?.jsonPrimitive?.longOrNull?.toInt() ?: 0)
            }
            obj["result"] ?: JsonNull
        }
    }

    suspend fun latestBlockhash(): ByteArray {
        val r = call("getLatestBlockhash", buildJsonArray { add(buildJsonObject { put("commitment", "confirmed") }) })
        return Base58.decode(r.jsonObject["value"]!!.jsonObject["blockhash"]!!.jsonPrimitive.content)
    }

    suspend fun balanceLamports(address: String): Long {
        val r = call("getBalance", buildJsonArray { add(JsonPrimitive(address)); add(buildJsonObject { put("commitment", "confirmed") }) })
        return r.jsonObject["value"]!!.jsonPrimitive.longOrNull ?: 0L
    }

    suspend fun requestAirdrop(address: String, lamports: Long): String {
        val r = call("requestAirdrop", buildJsonArray { add(JsonPrimitive(address)); add(JsonPrimitive(lamports)) })
        return r.jsonPrimitive.content
    }

    /** Sends an already fully signed transaction (tests and devnet tools only; the app sends through MWA). */
    suspend fun sendTransaction(signed: ByteArray): String {
        val r = call(
            "sendTransaction",
            buildJsonArray {
                add(JsonPrimitive(Base64.getEncoder().encodeToString(signed)))
                add(buildJsonObject { put("encoding", "base64"); put("preflightCommitment", "confirmed") })
            },
        )
        return r.jsonPrimitive.content
    }

    data class AccountInfo(val owner: String, val lamports: Long, val data: ByteArray)

    suspend fun accountInfo(address: String): AccountInfo? {
        val r = call(
            "getAccountInfo",
            buildJsonArray {
                add(JsonPrimitive(address))
                add(buildJsonObject { put("encoding", "base64"); put("commitment", "confirmed") })
            },
        )
        val v = r.jsonObject["value"]
        if (v == null || v is JsonNull) return null
        val o = v.jsonObject
        val data = o["data"]?.jsonArray?.firstOrNull()?.jsonPrimitive?.content.orEmpty()
        return AccountInfo(
            owner = o["owner"]?.jsonPrimitive?.content.orEmpty(),
            lamports = o["lamports"]?.jsonPrimitive?.longOrNull ?: 0L,
            data = runCatching { Base64.getDecoder().decode(data) }.getOrDefault(ByteArray(0)),
        )
    }

    /** "confirmed" / "finalized" / "processed", "failed", or null when unknown yet. */
    suspend fun signatureStatus(sig: String): String? {
        val r = call(
            "getSignatureStatuses",
            buildJsonArray { add(buildJsonArray { add(JsonPrimitive(sig)) }); add(buildJsonObject { put("searchTransactionHistory", true) }) },
        )
        val row = r.jsonObject["value"]?.jsonArray?.firstOrNull()
        if (row == null || row is JsonNull) return null
        val o = row.jsonObject
        if (o["err"] != null && o["err"] !is JsonNull) return "failed"
        return o["confirmationStatus"]?.jsonPrimitive?.contentOrNull
    }

    /** DAS getAssetsByOwner. Most public RPCs do not have it; callers fall back to local records. */
    suspend fun dasAssetsByOwner(owner: String): List<Pair<String, String>> {
        val r = call(
            "getAssetsByOwner",
            JsonArray(listOf(buildJsonObject { put("ownerAddress", owner); put("page", 1); put("limit", 100) })),
        )
        val items = (r as? JsonObject)?.get("items")?.jsonArray ?: return emptyList()
        return items.mapNotNull {
            val o = it.jsonObject
            val id = o["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val name = o["content"]?.jsonObject?.get("metadata")?.jsonObject?.get("name")?.jsonPrimitive?.contentOrNull.orEmpty()
            id to name
        }
    }

    companion object {
        val client: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}
