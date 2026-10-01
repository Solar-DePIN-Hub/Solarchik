package net.solardepin.solarchik.agents.engine

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
) {
    fun day(track: String): DayBook = days[track] ?: DayBook()
    fun run(key: String): AgentRun? = runs.firstOrNull { it.key == key }
    val anyRunning: Boolean get() = runs.any { it.running || it.open != null }
}

class DeskStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("solarchik-desk", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun read(): DeskState = prefs.getString(KEY, null)?.let {
        runCatching { json.decodeFromString(DeskState.serializer(), it) }.getOrNull()
    }?.let { it.copy(caps = RiskCaps.clamp(it.caps)) } ?: DeskState()

    fun write(s: DeskState) {
        prefs.edit().putString(KEY, json.encodeToString(DeskState.serializer(), s.copy(log = s.log.take(LOG_KEEP)))).commit()
    }

    companion object {
        private const val KEY = "desk.v1"
        const val LOG_KEEP = 80
    }
}
