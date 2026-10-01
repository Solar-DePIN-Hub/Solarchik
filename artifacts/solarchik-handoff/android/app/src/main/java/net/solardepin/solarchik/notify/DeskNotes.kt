package net.solardepin.solarchik.notify

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import net.solardepin.solarchik.R
import net.solardepin.solarchik.agents.engine.TickReport
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.ui.Fmt

/** One close waiting to be announced. */
@Serializable
data class PendingClose(val id: String, val pnl: Double, val at: Long)

/** What [DeskNotes.plan] decided: post this batch now (or not), and what stays queued. */
data class DeskPlan(val post: List<PendingClose>, val queue: List<PendingClose>)

/**
 * Close notifications from background desk ticks (the open app shows closes itself).
 * - respects the Settings toggle ("noteDesk"); off = queue dropped, nothing posted
 * - one summary note per [MIN_GAP_MS] at most; closes in between are queued and summed later
 * - every position id is announced once (ids already sent are ignored)
 */
object DeskNotes {
    const val MIN_GAP_MS = 30 * 60_000L
    const val QUEUE_MAX = 50
    private const val PREFS = "solarchik-notes"
    private const val QUEUE = "desk.queue"
    private const val SENT = "desk.sent"
    private const val LAST = "desk.lastAt"
    private const val SENT_KEEP = 200
    private val json = Json { ignoreUnknownKeys = true }

    /** Pure rule. */
    fun plan(queue: List<PendingClose>, incoming: List<PendingClose>, sent: Set<String>, lastAt: Long, now: Long, enabled: Boolean, allowed: Boolean): DeskPlan {
        if (!enabled) return DeskPlan(emptyList(), emptyList())
        val known = sent + queue.map { it.id }
        val merged = (queue + incoming.filter { it.id !in known }.distinctBy { it.id }).takeLast(QUEUE_MAX)
        if (merged.isEmpty() || !allowed) return DeskPlan(emptyList(), merged)
        if (lastAt in 1..now && now - lastAt < MIN_GAP_MS) return DeskPlan(emptyList(), merged)
        return DeskPlan(merged, emptyList())
    }

    fun text(ctx: Context, batch: List<PendingClose>): String =
        ctx.getString(R.string.note_desk_body, batch.size, Fmt.signedSol(batch.sumOf { it.pnl }, 6))

    /** Called after a background tick. */
    fun onTick(ctx: Context, report: TickReport, now: Long = System.currentTimeMillis()) {
        val incoming = report.closed.map { (c, _) -> PendingClose(c.position.id, c.pnl, c.closedAt) }
        run(ctx, incoming, now)
    }

    /** Hourly worker: post anything queued by the rate limit. */
    fun flush(ctx: Context, now: Long = System.currentTimeMillis()) = run(ctx, emptyList(), now)

    @Synchronized
    private fun run(ctx: Context, incoming: List<PendingClose>, now: Long) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val save = GameSave(ctx)
        val queue = prefs.getString(QUEUE, null)?.let { runCatching { json.decodeFromString(ListSerializer(PendingClose.serializer()), it) }.getOrNull() }.orEmpty()
        val sent = sentIds(ctx)
        val p = plan(queue, incoming, sent.toSet(), prefs.getLong(LAST, 0), now, save.noteOn(NoteKind.DESK.toggle), Notes.allowed(ctx))
        val posted = p.post.isNotEmpty() && Notes.post(ctx, NoteKind.DESK, text(ctx, p.post))
        val edit = prefs.edit()
        if (posted) {
            val keep = (sent + p.post.map { it.id }).distinct().takeLast(SENT_KEEP)
            edit.putString(SENT, org.json.JSONArray(keep).toString()).putLong(LAST, now).remove(QUEUE)
        } else {
            val q = if (p.post.isNotEmpty()) p.post else p.queue // post failed: keep for later
            edit.putString(QUEUE, json.encodeToString(ListSerializer(PendingClose.serializer()), q))
        }
        edit.apply()
    }

    fun sentIds(ctx: Context): List<String> {
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SENT, null) ?: return emptyList()
        return runCatching { org.json.JSONArray(raw).let { a -> (0 until a.length()).map { a.getString(it) } } }.getOrDefault(emptyList())
    }

    fun queued(ctx: Context): List<PendingClose> =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(QUEUE, null)
            ?.let { runCatching { json.decodeFromString(ListSerializer(PendingClose.serializer()), it) }.getOrNull() }.orEmpty()
}
