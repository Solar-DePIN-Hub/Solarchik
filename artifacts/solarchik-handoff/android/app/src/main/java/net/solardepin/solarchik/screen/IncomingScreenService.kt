package net.solardepin.solarchik.screen

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService
import android.util.Log
import org.json.JSONObject

class IncomingScreenService : CallScreeningService() {
    override fun onScreenCall(details: Call.Details) {
        // Call.Details.getCallDirection() exists only on API 29+; before that the
        // service is only bound for incoming calls.
        val incoming = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            details.callDirection == Call.Details.DIRECTION_INCOMING
        val number = details.handle?.schemeSpecificPart.orEmpty()
        val readable = ContactsGate.canRead(this)
        val screeningOn = incoming && PlayerIds.screeningOn(this)
        val hit = if (screeningOn && readable) ContactsGate.lookup(this, number) else ContactsGate.Hit(false, "", number)
        if (!shouldReject(incoming, screeningOn, readable, hit.known)) {
            respondToCall(details, CallResponse.Builder().build())
            return
        }

        respondToCall(
            details,
            CallResponse.Builder()
                .setDisallowCall(true)
                .setRejectCall(true)
                .setSkipCallLog(false)
                .setSkipNotification(true)
                .build(),
        )

        Thread {
            runCatching { screenUnknown(hit.number.ifBlank { number }) }
                .onFailure { Log.w("SolarchikScreen", "screen failed", it) }
        }.start()
    }

    private fun screenUnknown(number: String) {
        val userId = PlayerIds.get(this)
        val label = number.ifBlank { "unknown number" }
        val text = "Incoming call from $label. Not in the player's phone book. Screen this caller for Solarchik."
        val out = ScreenApi.screen(userId, text)
        val summary = out.summary
        if (summary.optString("callback").isBlank()) summary.put("callback", label)
        if (summary.optString("caller_name").isBlank()) summary.put("caller_name", label)
        val row = JSONObject()
            .put("id", "sec-${System.currentTimeMillis().toString(36)}")
            .put("at", System.currentTimeMillis())
            .put("user", label)
            .put("reply", if (out.needTopup) "Need credit to screen this caller." else out.reply)
            .put("summary", summary)
            .put("chargedUsd", out.chargedUsd)
            .put("usd", out.usd)
            .put("archived", false)
            .put("read", false)
            .put("needTopup", out.needTopup)
        DeskStore.addMessage(this, row)
        IncomingBus.emit(row)
    }

    companion object {
        /**
         * Reject only an incoming call, with screening on, that we could check
         * against the phone book and did not find. Without READ_CONTACTS every
         * caller would look unknown, so we let the call through.
         */
        fun shouldReject(incoming: Boolean, screeningOn: Boolean, contactsReadable: Boolean, known: Boolean): Boolean =
            incoming && screeningOn && contactsReadable && !known
    }
}
