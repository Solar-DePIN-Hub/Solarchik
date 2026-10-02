package net.solardepin.solarchik.screen

import android.content.Context
import android.net.Uri
import android.os.Build
import net.solardepin.solarchik.wallet.Base58
import java.security.SecureRandom

/**
 * Call secretary settings and decisions.
 *
 * No READ_CONTACTS: Android only hands calls from numbers that are NOT in the user's contacts to a
 * CallScreeningService without that permission (CallScreeningService.onScreenCall docs), so
 * contacts always ring normally and the app never reads the phone book.
 */
object Secretary {
    enum class Mode { SILENCE, DECLINE }
    enum class Action { ALLOW, SILENCE, DECLINE }

    /** Android 10 (API 29) added ROLE_CALL_SCREENING and CallResponse.setSilenceCall. */
    const val MIN_SDK = Build.VERSION_CODES.Q

    const val PAY_WALLET = "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic"
    const val USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    const val TOPUP_USD = 5
    const val NOTE_USD = 0.20

    private const val PREF = "solarchik.secretary"

    fun supported(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= MIN_SDK

    /** Only incoming calls, only with the secretary on, only where the platform supports silencing. */
    fun decide(incoming: Boolean, enabled: Boolean, mode: Mode, sdk: Int = Build.VERSION.SDK_INT): Action = when {
        !incoming || !enabled || !supported(sdk) -> Action.ALLOW
        mode == Mode.DECLINE -> Action.DECLINE
        else -> Action.SILENCE
    }

    fun mode(ctx: Context): Mode = runCatching { Mode.valueOf(prefs(ctx).getString("mode", null) ?: "") }.getOrDefault(Mode.SILENCE)
    fun setMode(ctx: Context, m: Mode) = prefs(ctx).edit().putString("mode", m.name).apply()

    /** Paid AI note per screened call ($0.20 from credit). Off until the player turns it on. */
    fun aiNotes(ctx: Context): Boolean = prefs(ctx).getBoolean("aiNotes", false)
    fun setAiNotes(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("aiNotes", on).apply()

    fun lastUsd(ctx: Context): Double? = prefs(ctx).getString("usd", null)?.toDoubleOrNull()
    fun setLastUsd(ctx: Context, usd: Double) = prefs(ctx).edit().putString("usd", usd.toString())
        .putBoolean("needTopup", usd < NOTE_USD && needTopup(ctx)).apply()

    fun needTopup(ctx: Context): Boolean = prefs(ctx).getBoolean("needTopup", false)
    fun setNeedTopup(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("needTopup", on).apply()

    fun pendingRef(ctx: Context): String? = prefs(ctx).getString("pendingRef", null)?.takeIf { it.isNotBlank() }
    fun setPendingRef(ctx: Context, ref: String?) = prefs(ctx).edit().putString("pendingRef", ref).apply()

    /** A fresh Solana Pay reference: 32 random bytes as a base58 public key. */
    fun newReference(rnd: SecureRandom = SecureRandom()): String = Base58.encode(ByteArray(32).also { rnd.nextBytes(it) })

    /** The worker matches the memo against userId.slice(0, 32). */
    fun memo(userId: String): String = userId.take(32)

    /** Solana Pay transfer request: [TOPUP_USD] USDC to the secretary treasury, tagged with reference and memo. */
    fun payUri(userId: String, reference: String, amount: Int = TOPUP_USD): String =
        "solana:$PAY_WALLET?amount=$amount&spl-token=$USDC_MINT&reference=$reference" +
            "&label=" + Uri.encode("Solarchik") + "&message=" + Uri.encode("Call secretary credit") +
            "&memo=" + Uri.encode(memo(userId))

    // ---- Carrier call forwarding (GSM MMI codes, dialed by the user from the system dialer) ----

    /** GSM conditional call forwarding. The carrier forwards; the app only pre-fills the dialer (ACTION_DIAL). */
    enum class Forward(val code: String) { NO_ANSWER("61"), BUSY("67"), UNREACHABLE("62") }

    /** Cancels all conditional forwarding (no answer + busy + unreachable) in one code. */
    const val FORWARD_ALL_OFF = "##004#"

    /**
     * No verified secretary phone number exists yet (the screen worker has no carrier/SIP number configured),
     * so the target is empty until the player or owner types one in.
     */
    fun forwardNumber(ctx: Context): String = prefs(ctx).getString("fwdNumber", null).orEmpty()

    /** Saves a valid number (returns it) or leaves the old one and returns null. Blank clears it. */
    fun setForwardNumber(ctx: Context, raw: String): String? {
        if (raw.isBlank()) {
            prefs(ctx).edit().remove("fwdNumber").apply()
            return ""
        }
        val clean = cleanNumber(raw) ?: return null
        prefs(ctx).edit().putString("fwdNumber", clean).apply()
        return clean
    }

    /**
     * International format only, so forwarding works from any country: "+" (or "00") then 8..15 digits (E.164).
     * Spaces, dashes, dots and brackets are dropped. Anything else (letters, *, #, a second +) is rejected,
     * so a typed number can never change the MMI code itself.
     */
    fun cleanNumber(raw: String): String? {
        var t = raw.trim().filterNot { it == ' ' || it == '-' || it == '.' || it == '(' || it == ')' || it == '\u00A0' }
        if (t.startsWith("00")) t = "+" + t.drop(2)
        if (!t.startsWith("+")) return null
        val digits = t.drop(1)
        if (digits.length !in 8..15 || !digits.all { it in '0'..'9' } || digits.startsWith("0")) return null
        return "+$digits"
    }

    fun forwardOnCode(kind: Forward, number: String): String? = cleanNumber(number)?.let { "**${kind.code}*$it#" }
    fun forwardOffCode(kind: Forward): String = "##${kind.code}#"

    /** tel: URI for ACTION_DIAL; "#" must be escaped or the dialer drops everything after it. */
    fun dialUri(code: String): Uri = Uri.parse("tel:" + Uri.encode(code))

    /** True when the player picked Solarchik as the call screening app (API 29+ only). */
    fun holdsRole(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val rm = ctx.getSystemService(android.app.role.RoleManager::class.java) ?: return false
        return runCatching { rm.isRoleHeld(android.app.role.RoleManager.ROLE_CALL_SCREENING) }.getOrDefault(false)
    }

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)
}
