package net.solardepin.solarchik.game

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneOffset

data class GhostPt(val x: Float, val y: Float, val grounded: Boolean)

class GhostTape(val day: String, val meters: Int, val samples: List<GhostPt>)

class GameSave(context: Context) {
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

    var streak: Int
        get() = prefs.getInt("streak", 0)
        set(value) { prefs.edit().putInt("streak", value).apply() }

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

    fun today(): String = LocalDate.now(ZoneOffset.UTC).toString()

    fun dayMod(): String = Companion.dayModOf(today())

    fun clockedToday(): Boolean = lastClockDay == today() && lastDistance >= GOAL_M
    fun signedToday(): Boolean = signedDay == today()

    fun recordRun(meters: Int, score: Int) {
        val today = today()
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
        if (meters < GOAL_M || lastClockDay == today) return
        val yesterday = LocalDate.now(ZoneOffset.UTC).minusDays(1).toString()
        streak = if (lastClockDay == yesterday) streak + 1 else 1
        lastClockDay = today
    }

    fun stampClock(address: String, signature: String, cluster: String, kind: String) {
        signedDay = today()
        clockAddress = address
        clockSig = signature
        clockCluster = cluster
        clockKind = kind
    }

    fun readGhost(): GhostTape? {
        val raw = prefs.getString("ghost", null) ?: return null
        return try {
            val obj = JSONObject(raw)
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
                if (samples.size >= 80) break
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
        val take = if (samples.size <= 80) samples else {
            val out = ArrayList<GhostPt>(80)
            val step = (samples.size - 1).toFloat() / 79f
            for (i in 0 until 80) out += samples[(i * step).toInt().coerceIn(0, samples.lastIndex)]
            out
        }
        for (s in take) {
            arr.put(JSONObject().put("x", s.x.toDouble()).put("y", s.y.toDouble()).put("grounded", s.grounded))
        }
        val obj = JSONObject().put("day", today).put("meters", meters).put("samples", arr)
        prefs.edit().putString("ghost", obj.toString()).apply()
    }

    companion object {
        const val GOAL_M = 1200

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
