package net.solardepin.solarchik.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.agents.engine.DeskStore
import net.solardepin.solarchik.core.StreakRules
import net.solardepin.solarchik.game.GameSave
import java.util.concurrent.TimeUnit

/** Local reminders. No server, no push: WorkManager checks once an hour and posts what is due. */
object Notes {
    const val CHANNEL = "solarchik"
    private const val SENT = "notes.sent"
    private const val WORK = "solarchik-notes"

    fun allowed(ctx: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    fun needsRuntimePermission(): Boolean = Build.VERSION.SDK_INT >= 33

    fun createChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, ctx.getString(R.string.note_channel), NotificationManager.IMPORTANCE_DEFAULT))
    }

    fun schedule(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<NoteWorker>(1, TimeUnit.HOURS, 15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    /** Was there anything worth a report today: a run, a signed day, or a closed position. */
    fun activityToday(ctx: Context, save: GameSave): Boolean {
        val today = save.today()
        if (save.todayDistance() > 0 || save.signedToday()) return true
        return DeskStore(ctx).read().log.any { StreakRules.dayKey(it.at) == today }
    }

    /** Posts every due note once. Returns what was posted (for tests and logs). */
    fun check(ctx: Context, save: GameSave = GameSave(ctx)): List<DueNote> {
        val prefs = ctx.getSharedPreferences("solarchik-notes", Context.MODE_PRIVATE)
        val sent = prefs.getStringSet(SENT, emptySet()).orEmpty()
        val due = NotePlanner.due(save.streakState(), save.now(), sent, { save.noteOn(it.toggle) }, activityToday(ctx, save))
        if (due.isEmpty() || !allowed(ctx)) return emptyList()
        due.forEach { post(ctx, it.kind) }
        prefs.edit().putStringSet(SENT, (sent + due.map { it.key }).toList().takeLast(60).toSet()).apply()
        return due
    }

    private fun post(ctx: Context, kind: NoteKind) {
        val (title, body, tab) = when (kind) {
            NoteKind.STREAK -> Triple(R.string.note_streak_title, R.string.note_streak_body, MainActivity.Tab.RUN)
            NoteKind.REWARD -> Triple(R.string.note_reward_title, R.string.note_reward_body, MainActivity.Tab.YARD)
            NoteKind.WINDOW -> Triple(R.string.note_window_title, R.string.note_window_body, MainActivity.Tab.YARD)
            NoteKind.REPORT -> Triple(R.string.note_report_title, R.string.note_report_body, MainActivity.Tab.SOL)
        }
        val open = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_TAB, tab.name)
        }
        val pi = PendingIntent.getActivity(ctx, kind.ordinal, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_flame)
            .setContentTitle(ctx.getString(title))
            .setContentText(ctx.getString(body))
            .setStyle(NotificationCompat.BigTextStyle().bigText(ctx.getString(body)))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setColor(0xFFF5C542.toInt())
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(100 + kind.ordinal, n) }
    }
}

class NoteWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        runCatching { Notes.check(applicationContext) }
        return Result.success()
    }
}
