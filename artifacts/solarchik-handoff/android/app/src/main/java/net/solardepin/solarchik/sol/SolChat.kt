package net.solardepin.solarchik.sol

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.screen.PlayerIds
import net.solardepin.solarchik.solana.Rpc
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

@Serializable
data class ChatTurn(
    /** "user" or "assistant" (wire names of the friend worker). */
    val role: String,
    val text: String,
    val at: Long,
    /** The worker answered with its canned fallback, or the phone was offline. */
    val fallback: Boolean = false,
)

data class SolReply(val text: String, val fallback: Boolean, val offline: Boolean)

/**
 * Client for the AI friend worker (worker/solarchik-ai-friend.js): POST /v1/chat with
 * {message, language, playerId, conversationId, history<=4, scene} -> {reply, fallback}.
 * No keys on the phone; the worker holds them.
 */
class SolChat(
    private val url: String = SolarchikConfig.FRIEND_CHAT_URL,
    private val post: suspend (String, String) -> String? = ::httpPost,
) {
    suspend fun ask(message: String, language: String, playerId: String, conversationId: String, history: List<ChatTurn>, scene: String = "yard", context: String = ""): SolReply {
        val body = buildJsonObject {
            put("message", message.take(2000))
            put("language", language)
            put("playerId", playerId)
            put("conversationId", conversationId)
            put("scene", scene)
            put("name", "Sol")
            if (context.isNotBlank()) put("context", context.take(400))
            put("history", buildJsonArray {
                history.filter { !it.fallback }.takeLast(4).forEach { t ->
                    add(buildJsonObject { put("role", t.role); put("content", t.text.take(400)) })
                }
            })
        }.toString()
        val text = runCatching { post(url, body) }.getOrNull() ?: return SolReply(offlineLine(language), fallback = true, offline = true)
        return runCatching {
            val o = json.parseToJsonElement(text).jsonObject
            val reply = o["reply"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val fb = o["fallback"]?.jsonPrimitive?.booleanOrNull == true
            if (reply.isBlank()) SolReply(offlineLine(language), true, true) else SolReply(reply, fb, false)
        }.getOrElse { SolReply(offlineLine(language), true, true) }
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        fun offlineLine(language: String): String =
            if (language == "uk") "Я зараз не дістаю до сонячної вежі. Спробуй ще раз за хвилину." else "I can't reach the sun tower right now. Try again in a minute."

        private suspend fun httpPost(url: String, body: String): String? = withContext(Dispatchers.IO) {
            val req = Request.Builder().url(url)
                .header("Origin", "https://appassets.androidplatform.net")
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()
            Rpc.client.newCall(req).execute().use { res -> if (res.isSuccessful) res.body?.string() else null }
        }

        private val NUM = Regex("\\d+(?:\\.\\d+)?")

        fun nums(text: String): List<String> = NUM.findAll(text).map { it.value }.toList()

        /** Web DailyReport onlyKnownNumbers: every number in the reply must appear in the note. */
        fun onlyKnownNumbers(reply: String, source: String): Boolean {
            val allow = nums(source).toSet()
            return nums(reply).all { it in allow }
        }
    }
}

/** Chat history on the phone (last 40 turns) and a conversation id per UTC day. */
class SolChatStore(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("solarchik-sol", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun turns(): List<ChatTurn> = prefs.getString("turns", null)?.let {
        runCatching { json.decodeFromString(ListSerializer(ChatTurn.serializer()), it) }.getOrNull()
    } ?: emptyList()

    fun add(turn: ChatTurn) {
        val all = (turns() + turn).takeLast(40)
        prefs.edit().putString("turns", json.encodeToString(ListSerializer(ChatTurn.serializer()), all)).apply()
    }

    fun clear() = prefs.edit().remove("turns").apply()

    fun playerId(): String = PlayerIds.get(app)

    fun conversationId(day: String): String {
        val key = "conv.$day"
        prefs.getString(key, null)?.let { return it }
        val id = "sol-" + UUID.randomUUID().toString().take(12)
        prefs.edit().putString(key, id).apply()
        return id
    }

    var voiceOn: Boolean
        get() = prefs.getBoolean("voice", true)
        set(v) = prefs.edit().putBoolean("voice", v).apply()
}
