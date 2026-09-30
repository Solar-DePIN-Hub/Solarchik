package net.solardepin.solarchik.screen

import android.content.Context
import java.util.UUID

object PlayerIds {
    private const val PREF = "solarchik.player"
    private const val KEY = "userId"
    private const val SCREEN = "screeningOn"

    fun get(ctx: Context): String {
        val p = prefs(ctx)
        val had = p.getString(KEY, null).orEmpty()
        if (had.isNotBlank()) return had
        val id = UUID.randomUUID().toString()
        p.edit().putString(KEY, id).apply()
        return id
    }

    fun bind(ctx: Context, id: String) {
        val clean = id.trim()
        if (clean.length < 8 || clean.length > 80 || clean.any { it.isWhitespace() }) return
        prefs(ctx).edit().putString(KEY, clean).apply()
    }

    fun screeningOn(ctx: Context): Boolean = prefs(ctx).getBoolean(SCREEN, false)

    fun setScreening(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(SCREEN, on).apply()
    }

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)
}
