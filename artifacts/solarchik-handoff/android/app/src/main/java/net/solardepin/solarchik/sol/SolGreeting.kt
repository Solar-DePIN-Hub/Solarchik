package net.solardepin.solarchik.sol

import android.content.Context
import android.os.Build

/**
 * Yard bubble: one live Sol greeting per day and language (AI, from a localized cue with the
 * player's streak). The rotating tip is shown only until it arrives or when Sol is unreachable.
 */
object SolGreeting {
    private const val PREFS = "solarchik-sol"
    private var inFlight = ""
    /** Robolectric renders the yard in tests: no live calls there. */
    var enabled: Boolean = Build.FINGERPRINT != "robolectric"

    /** 0.22.0: keyed by the player state too, so a greeting written before today's signature is never shown after it. */
    fun cached(ctx: Context, day: String, lang: String, stateKey: String = ""): String? =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("greet.$lang.$day.$stateKey", null)

    suspend fun fetch(ctx: Context, day: String, lang: String, cue: String, state: SolState? = null, chat: SolChat = SolChat()): String? {
        if (!enabled) return null
        val key = "$lang.$day.${state?.key.orEmpty()}"
        if (inFlight == key) return null
        cached(ctx, day, lang, state?.key.orEmpty())?.let { return it }
        inFlight = key
        try {
            val store = SolChatStore(ctx)
            val r = chat.ask(cue, lang, store.playerId(), store.conversationId(day), emptyList(), "yard", state?.line().orEmpty())
            if (r.fallback || r.text.isBlank()) return null
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val edit = prefs.edit()
            prefs.all.keys.filter { it.startsWith("greet.") }.forEach { edit.remove(it) }
            edit.putString("greet.$key", r.text).apply()
            return r.text
        } finally {
            inFlight = ""
        }
    }
}
