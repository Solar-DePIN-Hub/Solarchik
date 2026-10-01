package net.solardepin.solarchik.screen

import android.content.Context
import android.net.Uri
import android.provider.ContactsContract
import android.telephony.PhoneNumberUtils

object ContactsGate {
    data class Hit(val known: Boolean, val name: String, val number: String)

    fun canRead(ctx: Context): Boolean =
        ctx.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) == android.content.pm.PackageManager.PERMISSION_GRANTED

    fun lookup(ctx: Context, rawNumber: String?): Hit {
        val number = rawNumber.orEmpty().trim()
        if (number.isBlank()) return Hit(false, "", "")
        val cr = ctx.applicationContext.contentResolver
        return try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(number),
            )
            cr.query(
                uri,
                arrayOf(
                    ContactsContract.PhoneLookup.DISPLAY_NAME,
                    ContactsContract.PhoneLookup.NUMBER,
                ),
                null,
                null,
                null,
            )?.use { c ->
                if (c.moveToFirst()) {
                    val name = c.getString(0).orEmpty()
                    val stored = c.getString(1).orEmpty()
                    Hit(true, name, stored.ifBlank { number })
                } else {
                    Hit(false, "", number)
                }
            } ?: Hit(false, "", number)
        } catch (_: Throwable) {
            Hit(false, "", number)
        }
    }

    fun names(ctx: Context): List<String> {
        val out = LinkedHashSet<String>()
        return try {
            ctx.applicationContext.contentResolver.query(
                ContactsContract.Contacts.CONTENT_URI,
                arrayOf(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY),
                null,
                null,
                "${ContactsContract.Contacts.DISPLAY_NAME_PRIMARY} ASC",
            )?.use { c ->
                val idx = c.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY)
                if (idx < 0) return emptyList()
                while (c.moveToNext() && out.size < 200) {
                    val name = c.getString(idx).orEmpty().trim()
                    if (name.length >= 2) out += name.take(40)
                }
            }
            out.toList()
        } catch (_: Throwable) {
            emptyList()
        }
    }

    fun same(a: String, b: String): Boolean {
        if (a.isBlank() || b.isBlank()) return false
        return PhoneNumberUtils.compare(a, b)
    }
}
