package net.solardepin.solarchik.screen

import android.telecom.Call
import android.telecom.CallScreeningService
import android.util.Log
import org.json.JSONObject

class IncomingScreenService : CallScreeningService() {
    override fun onScreenCall(details: Call.Details) {
        if (details.callDirection != Call.Details.DIRECTION_INCOMING) {
            respondToCall(details, CallResponse.Builder().build())
            return
        }
        if (!PlayerIds.screeningOn(this)) {
            respondToCall(details, CallResponse.Builder().build())
            return
        }
        val number = details.handle?.schemeSpecificPart.orEmpty()
        val hit = ContactsGate.lookup(this, number)

        if (hit.known) {
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
}
