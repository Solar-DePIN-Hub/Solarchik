package net.solardepin.solarchik.game

import android.content.Context
import java.time.LocalDate
import java.time.ZoneOffset

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

    companion object {
        const val GOAL_M = 1200
    }
}
