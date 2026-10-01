package net.solardepin.solarchik

import android.app.Application
import net.solardepin.solarchik.agents.engine.DeskHooks
import net.solardepin.solarchik.notify.DeskNotes
import net.solardepin.solarchik.notify.Notes

class SolarchikApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notes.createChannel(this)
        runCatching { Notes.schedule(this) }
        // Background desk ticks (DeskWorker) announce closes; the open app shows them on screen.
        DeskHooks.afterTick = { ctx, report -> runCatching { DeskNotes.onTick(ctx, report) } }
    }
}
