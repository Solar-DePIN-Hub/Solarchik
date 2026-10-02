package net.solardepin.solarchik.screen

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Screened calls, kept on the phone only (newest last, at most [MAX]). */
object CallReports {
    private const val PREF = "solarchik.desk"
    private const val KEY = "reports"
    const val MAX = 40

    data class Report(
        val id: String,
        val at: Long,
        val number: String,
        val action: String,
        val status: String,
        val note: String = "",
        val callerName: String = "",
        val reason: String = "",
        val chargedUsd: Double = 0.0,
    ) {
        fun json(): JSONObject = JSONObject()
            .put("id", id).put("at", at).put("number", number).put("action", action).put("status", status)
            .put("note", note).put("callerName", callerName).put("reason", reason).put("chargedUsd", chargedUsd)

        companion object {
            fun from(o: JSONObject): Report? {
                val id = o.optString("id").ifBlank { return null }
                return Report(
                    id = id,
                    at = o.optLong("at"),
                    number = o.optString("number", o.optString("user")),
                    action = o.optString("action", "declined"),
                    status = o.optString("status", if (o.optBoolean("needTopup")) STATUS_NEED_TOPUP else STATUS_DONE),
                    note = o.optString("note", o.optJSONObject("summary")?.optString("notes").orEmpty()),
                    callerName = o.optString("callerName", o.optJSONObject("summary")?.optString("caller_name").orEmpty()),
                    reason = o.optString("reason", o.optJSONObject("summary")?.optString("intent").orEmpty()),
                    chargedUsd = o.optDouble("chargedUsd", 0.0).takeIf { it.isFinite() } ?: 0.0,
                )
            }
        }
    }

    const val STATUS_LOGGED = "logged"
    const val STATUS_PENDING = "pending"
    const val STATUS_DONE = "done"
    const val STATUS_NEED_TOPUP = "needTopup"
    const val STATUS_FAILED = "failed"

    @Synchronized
    fun add(ctx: Context, r: Report) {
        val all = raw(ctx)
        all.put(r.json())
        while (all.length() > MAX) all.remove(0)
        save(ctx, all)
    }

    @Synchronized
    fun update(ctx: Context, id: String, change: (Report) -> Report) {
        val all = raw(ctx)
        for (i in 0 until all.length()) {
            val r = all.optJSONObject(i)?.let { Report.from(it) } ?: continue
            if (r.id == id) {
                all.put(i, change(r).json())
                save(ctx, all)
                return
            }
        }
    }

    /** Newest first. Junk rows are skipped. */
    fun list(ctx: Context): List<Report> {
        val all = raw(ctx)
        return (0 until all.length()).mapNotNull { all.optJSONObject(it)?.let(Report::from) }.reversed()
    }

    fun clear(ctx: Context) = prefs(ctx).edit().remove(KEY).apply()

    private fun raw(ctx: Context): JSONArray =
        runCatching { JSONArray(prefs(ctx).getString(KEY, "[]").orEmpty()) }.getOrElse { JSONArray() }

    private fun save(ctx: Context, a: JSONArray) = prefs(ctx).edit().putString(KEY, a.toString()).apply()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)
}
