package net.solardepin.solarchik.game

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import net.solardepin.solarchik.core.FeeProgress
import net.solardepin.solarchik.core.FeeWindow
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.core.StreakRules
import net.solardepin.solarchik.core.StreakState
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneOffset

data class GhostPt(val x: Float, val y: Float, val grounded: Boolean)

class GhostTape(val day: String, val meters: Int, val samples: List<GhostPt>)

/** One signed day, kept for the yard history (native extra; web keeps only clockDays). */
@Serializable
data class ClockEntry(
    val day: String,
    val sig: String,
    val kind: String,
    val cluster: String,
    val meters: Int,
    val at: Long,
)

/**
 * Local save. Storage keys for the streak and fee windows match the Grok export
 * (streak, signedDay, seven, thirty, clockDays, feeWindows) so both builds read the same prefs.
 */
class GameSave(context: Context, private val clock: () -> Long = { System.currentTimeMillis() }) {
    private val prefs = context.applicationContext.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE)

    var lastDistance: Int
        get() = prefs.getInt("lastDistance", 0)
        set(value) { prefs.edit().putInt("lastDistance", value).apply() }

    var bestDistance: Int
        get() = prefs.getInt("bestDistance", 0)
        set(value) { prefs.edit().putInt("bestDistance", value).apply() }

    var lastScore: Int
        get() = prefs.getInt("lastScore", 0)
        set(value) { prefs.edit().putInt("lastScore", value).apply() }

    var bestScore: Int
        get() = prefs.getInt("bestScore", 0)
        set(value) { prefs.edit().putInt("bestScore", value).apply() }

    /** Live streak (0 once a UTC day was missed). Only [stampClock] raises it. */
    val streak: Int
        get() = liveStreak().streak

    var lastClockDay: String
        get() = prefs.getString("lastClockDay", "").orEmpty()
        set(value) { prefs.edit().putString("lastClockDay", value).apply() }

    var signedDay: String
        get() = prefs.getString("signedDay", "").orEmpty()
        set(value) { prefs.edit().putString("signedDay", value).apply() }

    var clockSig: String
        get() = prefs.getString("clockSig", "").orEmpty()
        set(value) { prefs.edit().putString("clockSig", value).apply() }

    var clockKind: String
        get() = prefs.getString("clockKind", "").orEmpty()
        set(value) { prefs.edit().putString("clockKind", value).apply() }

    var clockCluster: String
        get() = prefs.getString("clockCluster", "").orEmpty()
        set(value) { prefs.edit().putString("clockCluster", value).apply() }

    var clockAddress: String
        get() = prefs.getString("clockAddress", "").orEmpty()
        set(value) { prefs.edit().putString("clockAddress", value).apply() }

    fun now(): Long = clock()
    fun today(): String = StreakRules.dayKey(clock())

    fun dayMod(): String = Companion.dayModOf(today())

    fun clockedToday(): Boolean = lastClockDay == today() && lastDistance >= GOAL_M

    /** Best distance run today (0 after a new UTC day until the next run). */
    fun todayDistance(): Int = if (prefs.getString("runDay", "") == today()) lastDistance else 0
    fun todayScore(): Int = if (prefs.getString("runDay", "") == today()) lastScore else 0
    fun signedToday(): Boolean = signedDay == today()

    fun recordRun(meters: Int, score: Int) {
        val today = today()
        runs += 1
        if (prefs.getString("runDay", "") != today) {
            lastDistance = 0
            lastScore = 0
            prefs.edit().putString("runDay", today).apply()
        }
        if (meters >= lastDistance) {
            lastDistance = meters
            lastScore = score
        }
        if (meters > bestDistance) bestDistance = meters
        if (score > bestScore) bestScore = score
        // The run only unlocks today's CLOCK IN. The streak moves on the signed CLOCK IN.
        if (meters < GOAL_M || lastClockDay == today) return
        lastClockDay = today
    }

    // ---- Streak + fee-free windows (rules in core/StreakRules.kt, same as web save.ts) ----

    fun streakState(): StreakState {
        val streakNow = prefs.getInt("streak", 0)
        val signed = signedDay
        val daysRaw = prefs.getString("clockDays", null)
        val days = daysRaw?.let { runCatching { json.decodeFromString(ListSerializer(String.serializer()), it) }.getOrNull() }
            ?.filter { DAY.matches(it) }?.distinct()?.take(SolarchikConfig.CLOCK_DAYS_KEEP)
            ?: StreakRules.seedDays(signed, streakNow)
        return StreakState(
            streak = streakNow,
            signedDay = signed,
            seven = if (prefs.contains("seven")) prefs.getInt("seven", 0) else streakNow % SolarchikConfig.STREAK_SHORT_DAYS,
            thirty = if (prefs.contains("thirty")) prefs.getInt("thirty", 0) else streakNow,
            clockDays = days,
            feeWindows = readWindows(),
        )
    }

    /** Normalized for today: a broken streak reads as 0. */
    fun liveStreak(): StreakState {
        val raw = streakState()
        val norm = StreakRules.normalize(raw, today())
        if (norm != raw) writeStreak(norm)
        return norm
    }

    private fun writeStreak(s: StreakState) {
        prefs.edit()
            .putInt("streak", s.streak)
            .putString("signedDay", s.signedDay)
            .putInt("seven", s.seven)
            .putInt("thirty", s.thirty)
            .putString("clockDays", json.encodeToString(ListSerializer(String.serializer()), s.clockDays))
            .putString("feeWindows", json.encodeToString(ListSerializer(FeeWindow.serializer()), s.feeWindows))
            .apply()
    }

    private fun readWindows(): List<FeeWindow> {
        val raw = prefs.getString("feeWindows", null) ?: return emptyList()
        return runCatching { net.solardepin.solarchik.core.FeeWindows.read(json.parseToJsonElement(raw)) }.getOrDefault(emptyList())
    }

    /** Streak the memo will carry if today gets signed now. */
    fun nextStreak(): Int {
        val s = liveStreak()
        if (s.signedDay == today()) return s.streak
        return if (s.signedDay == StreakRules.prevDay(today())) s.streak + 1 else 1
    }

    /**
     * Returns the windows granted by this stamp (empty when none). [day] is the UTC day the run and
     * the signature belong to: a wallet prompt opened before midnight and signed after it still
     * stamps the day that was run, not the new one.
     */
    fun stampClock(address: String, signature: String, cluster: String, kind: String, day: String = today(), meters: Int = lastDistance): List<FeeWindow> {
        val before = StreakRules.normalize(streakState(), day)
        val after = StreakRules.stamp(before, day, now())
        writeStreak(after)
        clockAddress = address
        clockSig = signature
        clockCluster = cluster
        clockKind = kind
        addLog(ClockEntry(day, signature.take(100), kind, cluster, meters, now()))
        return after.feeWindows.filter { w -> before.feeWindows.none { it.id == w.id } }
    }

    fun activateWindow(): Boolean {
        val before = liveStreak()
        val after = StreakRules.activate(before, now())
        writeStreak(after)
        return after.feeWindows.any { it.status == FeeWindow.ACTIVE } && before.feeWindows != after.feeWindows
    }

    fun feeProgress(): FeeProgress = StreakRules.progress(liveStreak(), now())

    fun feeWindowCovers(openedAt: Long): Boolean = StreakRules.covers(liveStreak(), openedAt)

    fun clockLog(): List<ClockEntry> {
        val raw = prefs.getString("clockLog", null) ?: return emptyList()
        return runCatching { json.decodeFromString(ListSerializer(ClockEntry.serializer()), raw) }.getOrDefault(emptyList())
    }

    private fun addLog(entry: ClockEntry) {
        val all = clockLog().filter { it.day != entry.day } + entry
        prefs.edit().putString("clockLog", json.encodeToString(ListSerializer(ClockEntry.serializer()), all.takeLast(400))).apply()
    }

    // ---- Notification switches (keys shared with the Grok export DayAlerts) ----
    fun noteOn(key: String): Boolean = prefs.getBoolean(key, true)
    fun setNote(key: String, on: Boolean) { prefs.edit().putBoolean(key, on).apply() }

    /**
     * Ghost of the best run of a day: world-unit samples (x, y, grounded) every
     * RunSim.GHOST_DT seconds of running time ("v": 2). Tapes of the old minigame (screen
     * pixels, no "v") do not fit the new world and read as no ghost.
     */
    fun readGhost(): GhostTape? {
        val raw = prefs.getString("ghost", null) ?: return null
        return try {
            val obj = JSONObject(raw)
            if (obj.optInt("v") != GHOST_V) return null
            val day = obj.optString("day")
            if (day.isBlank()) return null
            val arr = obj.optJSONArray("samples") ?: return null
            val samples = ArrayList<GhostPt>(arr.length())
            for (i in 0 until arr.length()) {
                val row = arr.optJSONObject(i) ?: continue
                samples += GhostPt(
                    row.optDouble("x").toFloat(),
                    row.optDouble("y").toFloat(),
                    row.optBoolean("grounded"),
                )
                if (samples.size >= GHOST_CAP) break
            }
            if (samples.size < 2) null else GhostTape(day, obj.optInt("meters"), samples)
        } catch (_: Throwable) {
            null
        }
    }

    fun writeGhost(meters: Int, samples: List<GhostPt>) {
        if (meters < 400 || samples.size < 2) return
        val today = today()
        val prev = readGhost()
        if (prev != null && prev.day == today && meters < prev.meters) return
        val arr = JSONArray()
        for (s in samples.take(GHOST_CAP)) {
            arr.put(JSONObject().put("x", Math.round(s.x * 10) / 10.0).put("y", Math.round(s.y * 10) / 10.0).put("grounded", s.grounded))
        }
        val obj = JSONObject().put("v", GHOST_V).put("day", today).put("meters", meters).put("samples", arr)
        prefs.edit().putString("ghost", obj.toString()).apply()
    }

    /** Finished runs (death or the goal), for the web's every-15th-run fly gate. */
    var runs: Int
        get() = prefs.getInt("runs", 0)
        set(value) { prefs.edit().putInt("runs", value).apply() }

    /** web: offerBonus = (runs + 1) % 15 === 0 */
    fun offerBonus(): Boolean = (runs + 1) % 15 == 0

    companion object {
        const val GOAL_M = SolarchikConfig.RUN_GOAL_M
        const val GHOST_V = 2
        const val GHOST_CAP = 480
        private val DAY = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        fun dayModOf(day: String): String {
            val mods = arrayOf("calm", "wind", "gold", "drones", "wire")
            val h = dayHash(day)
            return mods[(h % mods.size).toInt()]
        }

        private fun dayHash(key: String): Long {
            var h = 2166136261L
            for (ch in key) {
                h = h xor ch.code.toLong()
                h = (h * 16777619L) and 0xFFFFFFFFL
            }
            return h
        }
    }
}
