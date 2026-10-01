package net.solardepin.solarchik.agents.engine

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Background ticks while strategies run (Android's floor is 15 minutes). The open app ticks every 30 s. */
class DeskWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val desk = Desk(applicationContext)
        runCatching { desk.tick() }.onSuccess { report -> DeskHooks.afterTick?.invoke(applicationContext, report) }
        if (!desk.state().anyRunning) cancel(applicationContext)
        return Result.success()
    }

    companion object {
        private const val NAME = "solarchik-desk"

        fun sync(ctx: Context, running: Boolean) = if (running) schedule(ctx) else cancel(ctx)

        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<DeskWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(NAME)
        }
    }
}

/** Set by the app so the worker can raise notifications without a dependency cycle. */
object DeskHooks {
    var afterTick: ((Context, TickReport) -> Unit)? = null
}
