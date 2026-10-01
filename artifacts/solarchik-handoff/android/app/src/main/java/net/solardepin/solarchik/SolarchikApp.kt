package net.solardepin.solarchik

import android.app.Application
import net.solardepin.solarchik.notify.Notes

class SolarchikApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notes.createChannel(this)
        runCatching { Notes.schedule(this) }
    }
}
