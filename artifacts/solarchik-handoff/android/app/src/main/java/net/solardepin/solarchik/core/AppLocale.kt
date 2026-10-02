package net.solardepin.solarchik.core

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.LocaleList
import java.util.Locale

/**
 * App language: follows the phone (Ukrainian phone → Ukrainian, any other locale → English) until
 * the player picks English or Ukrainian in Settings; that choice is stored and applied to the UI,
 * Sol's chat/voice language and the agents' texts (everything reads [lang] / the wrapped context).
 */
object AppLocale {
    const val FOLLOW = ""
    const val EN = "en"
    const val UK = "uk"
    private const val PREFS = "solarchik-lang"
    private const val KEY = "lang"

    fun choice(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, FOLLOW).takeIf { it == EN || it == UK } ?: FOLLOW

    fun set(ctx: Context, choice: String) {
        val v = if (choice == EN || choice == UK) choice else FOLLOW
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, v).commit()
    }

    /** "uk" only for an explicit Ukrainian pick or a Ukrainian phone; ru/de/pl/… fall back to English. */
    fun resolve(choice: String, device: Locale): String = when (choice) {
        UK -> UK
        EN -> EN
        else -> if (device.language == "uk") UK else EN
    }

    fun deviceLocale(): Locale = Resources.getSystem().configuration.locales.let { if (it.isEmpty) Locale.getDefault() else it[0] }

    fun lang(ctx: Context): String = resolve(choice(ctx), deviceLocale())

    fun localeOf(lang: String): Locale = if (lang == UK) Locale("uk", "UA") else Locale.US

    /** Use from attachBaseContext: resources, formatting and Locale.getDefault() follow the app language. */
    fun wrap(base: Context): Context {
        val loc = localeOf(lang(base))
        Locale.setDefault(loc)
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocales(LocaleList(loc))
        return base.createConfigurationContext(cfg)
    }
}
