package net.solardepin.solarchik.screen

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object DeskStore {
    private const val PREF = "solarchik.desk"
    private const val KEY = "reports"

    fun addMessage(ctx: Context, row: JSONObject) {
        val all = list(ctx)
        all.put(row)
        while (all.length() > 40) all.remove(0)
        prefs(ctx).edit().putString(KEY, all.toString()).apply()
    }

    fun list(ctx: Context): JSONArray {
        val raw = prefs(ctx).getString(KEY, "[]").orEmpty()
        return runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
    }

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)
}
