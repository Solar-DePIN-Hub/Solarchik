package net.solardepin.solarchik.wallet

import android.os.Build

/** Seeker reports itself in the Android build fields. Seed Vault is the wallet behind MWA there. */
object SeekerDevice {
    fun isSeeker(): Boolean {
        val text = listOf(Build.MANUFACTURER, Build.BRAND, Build.MODEL, Build.DEVICE, Build.PRODUCT)
            .joinToString(" ")
            .lowercase()
        return text.contains("seeker") || text.contains("solanamobile") || text.contains("solana mobile")
    }
}
