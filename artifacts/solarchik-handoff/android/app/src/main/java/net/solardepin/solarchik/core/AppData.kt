package net.solardepin.solarchik.core

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import androidx.work.WorkManager

/**
 * Everything this app keeps about the player lives on the phone, in these preference files.
 * Settings > Privacy & data > "Delete my data" wipes all of them (dApp Store Publisher Policy:
 * users must be able to delete their data). Nothing is held on a server under the player's name;
 * on-chain records (CLOCK IN memos, minted NFTs, fee transfers) are public and cannot be erased.
 */
object AppData {
    /** Every SharedPreferences file the app writes. Keep in sync when a new store is added. */
    val PREFS = listOf(
        "solarchik-game",
        "solarchik-lang",
        "solarchik-slice",
        "solarchik-agents",
        "solarchik-desk",
        "solarchik-notes",
        "solarchik-sol",
        "solarchik.desk",
        "solarchik.player",
        "solarchik.secretary",
        "seeker-wallet",
    )

    /** Background jobs that would otherwise keep ticking with old state. */
    val WORKS = listOf("solarchik-desk", "solarchik-notes")

    const val PRIVACY_URL = "https://github.com/Solar-DePIN-Hub/Solarchik/blob/native-full/PRIVACY.md"

    // commit(), not apply(): the activity is recreated right after, so the wipe must be on disk first.
    @SuppressLint("ApplySharedPref")
    fun wipe(ctx: Context) {
        val app = ctx.applicationContext
        runCatching { WORKS.forEach { WorkManager.getInstance(app).cancelUniqueWork(it) } }
        runCatching { (app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancelAll() }
        PREFS.forEach { name ->
            app.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit()
            app.deleteSharedPreferences(name)
        }
        // Sol's cached voice clips (texts Sol said to this player)
        runCatching { java.io.File(app.cacheDir, "sol-voice").deleteRecursively() }
    }
}
