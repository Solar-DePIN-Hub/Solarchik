package net.solardepin.solarchik

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import net.solardepin.solarchik.solana.Rpc
import net.solardepin.solarchik.solana.RpcException
import net.solardepin.solarchik.solana.SigInfo

/** Offline Rpc for unit tests: scripted balance and memo signatures, counts calls. */
class FakeRpc(var lamports: Long = 1_000_000_000L) : Rpc("http://fake.invalid") {
    val calls = ArrayList<String>()
    var sigs: List<SigInfo>? = emptyList()
    var failAll = false

    override suspend fun call(method: String, params: JsonArray): JsonElement {
        calls += method
        if (failAll) throw RpcException("offline")
        return when (method) {
            "getBalance" -> buildJsonObject { put("context", buildJsonObject { put("slot", 1) }); put("value", lamports) }
            else -> JsonNull
        }
    }

    override suspend fun memoSignatures(address: String, limit: Int): List<SigInfo> {
        calls += "memoSignatures"
        if (failAll) throw RpcException("offline")
        return sigs ?: throw RpcException("offline")
    }

    @Suppress("unused")
    private val keep = JsonPrimitive(0)
}
