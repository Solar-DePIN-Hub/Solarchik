package net.solardepin.solarchik.screen

import org.json.JSONObject

object IncomingBus {
    @Volatile
    var listener: ((JSONObject) -> Unit)? = null

    fun emit(row: JSONObject) {
        listener?.invoke(row)
    }
}
