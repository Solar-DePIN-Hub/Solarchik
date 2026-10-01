package net.solardepin.solarchik.agents.engine

import android.annotation.SuppressLint
import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Whole desk in one JSON blob, so a tick reads and writes atomically under [Desk.lock]. */
@Serializable
data class DeskState(
    val runs: List<AgentRun> = emptyList(),
    val days: Map<String, DayBook> = emptyMap(),
    val log: List<DeskEvent> = emptyList(),
    val caps: UserCaps = UserCaps(),
    /** Paper purse = start + realized paper PnL. */
    val paperPnl: Double = 0.0,
    /** Last devnet balance the desk saw for the connected wallet. */
    val devnetBalance: Double = 0.0,
    val lastTickAt: Long = 0,
    /** When [devnetBalance] was read (the open app ticks every 30 s, so this is separate from [lastTickAt]). */
    val balanceAt: Long = 0,
    /** A fee payment handed to the wallet whose outcome is not known yet (app killed, timeout). */
    val pendingPay: PendingPay? = null,
) {
    fun day(track: String): DayBook = days[track] ?: DayBook()
    fun run(key: String): AgentRun? = runs.firstOrNull { it.key == key }
    val anyRunning: Boolean get() = runs.any { it.running || it.open != null }
}

/** Rows being paid in one devnet tx; [ref] is written into the memo so the payment can be found later. */
@Serializable
data class PendingPay(val ids: List<String>, val ref: String, val owner: String, val lamports: Long, val at: Long)

class DeskStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("solarchik-desk", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun read(): DeskState = prefs.getString(KEY, null)?.let { raw ->
        runCatching { json.decodeFromString(DeskState.serializer(), raw) }
            .onFailure {
                // Keep the unreadable blob instead of letting the next write erase the ledger.
                if (prefs.getString(KEY_BAD, null) == null) prefs.edit().putString(KEY_BAD, raw).apply()
            }
            .getOrNull()
    }?.let { it.copy(caps = RiskCaps.clamp(it.caps)) } ?: DeskState()

    /** Synchronous on purpose: a tick's state must be on disk before the next one reads it. Desk calls this off the main thread. */
    @SuppressLint("ApplySharedPref")
    fun write(s: DeskState) {
        prefs.edit().putString(KEY, json.encodeToString(DeskState.serializer(), s.copy(log = s.log.take(LOG_KEEP)))).commit()
    }

    companion object {
        private const val KEY = "desk.v1"
        const val KEY_BAD = "desk.v1.unreadable"
        const val LOG_KEEP = 80
    }
}
