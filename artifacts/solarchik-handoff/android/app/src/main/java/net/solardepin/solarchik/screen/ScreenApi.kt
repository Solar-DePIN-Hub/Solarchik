package net.solardepin.solarchik.screen

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object ScreenApi {
    const val BASE = "https://solarchik-screen.davidbell1603.workers.dev"

    data class Balance(val usd: Double)
    data class Screened(
        val reply: String,
        val summary: JSONObject,
        val chargedUsd: Double,
        val usd: Double,
        val needTopup: Boolean,
    )

    fun balance(userId: String): Balance {
        val (code, body) = request("GET", "$BASE/balance?userId=${enc(userId)}", null)
        val json = parse(body)
        if (code == 402) return Balance(0.0)
        return Balance(json.optDouble("usd", json.optDouble("balance", 0.0)))
    }

    fun topup(userId: String): Balance {
        val payload = JSONObject().put("userId", userId).toString()
        val (_, body) = request("POST", "$BASE/topup", payload)
        val json = parse(body)
        return Balance(json.optDouble("usd", json.optDouble("balance", 0.0)))
    }

    fun screen(userId: String, text: String): Screened {
        val payload = JSONObject().put("userId", userId).put("text", text).toString()
        val (code, body) = request("POST", "$BASE/screen", payload)
        val json = parse(body)
        val need = code == 402 || json.optString("error") == "NEED_TOPUP"
        val summary = json.optJSONObject("summary") ?: JSONObject()
        if (summary.length() == 0 && json.optString("summary").isNotBlank()) {
            summary.put("notes", json.optString("summary"))
        }
        return Screened(
            reply = json.optString("reply"),
            summary = summary,
            chargedUsd = json.optDouble("chargedUsd", 0.0),
            usd = json.optDouble("usd", 0.0),
            needTopup = need,
        )
    }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

    private fun parse(body: String): JSONObject {
        return runCatching { JSONObject(body.ifBlank { "{}" }) }.getOrElse { JSONObject() }
    }

    private fun open(method: String, url: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 12000
        c.readTimeout = 20000
        c.setRequestProperty("Accept", "application/json")
        return c
    }

    private fun request(method: String, url: String, body: String?): Pair<Int, String> {
        val c = open(method, url)
        return try {
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.readText().orEmpty()
            code to text
        } catch (e: Throwable) {
            0 to JSONObject().put("error", e.message ?: "offline").toString()
        } finally {
            c.disconnect()
        }
    }
}
