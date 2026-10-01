package net.solardepin.solarchik.agents.engine

import kotlinx.serialization.Serializable
import net.solardepin.solarchik.core.StreakRules

/** One market read. For EVENTS [px] is the YES price and [key] the Gamma market id. */
data class Quote(val source: Source, val key: String, val label: String, val px: Double)

@Serializable
data class Anchor(val px: Double, val key: String, val at: Long)

/** An open forecast position. Simulated on real market data; settles after [closeAt]. */
@Serializable
data class Position(
    val id: String,
    val source: String,
    val key: String,
    val label: String,
    /** up | down (edge markets) or yes | no (events, the favorite side). */
    val side: String,
    val stake: Double,
    /** Price of the chosen side at entry. For events this is the favorite's probability. */
    val entryPx: Double,
    val openedAt: Long,
    val closeAt: Long,
    val confidence: Double,
)

object Track {
    const val PAPER = "paper"
    const val DEVNET = "devnet"
}

/** Runtime for one strategy on this phone. [key] is the Core asset, or `paper:<sku>` for a trial. */
@Serializable
data class AgentRun(
    val key: String,
    val skuId: String,
    val tier: String,
    val name: String,
    val track: String = Track.PAPER,
    val running: Boolean = false,
    val anchors: Map<String, Anchor> = emptyMap(),
    val open: Position? = null,
    val wins: Int = 0,
    val losses: Int = 0,
    val pnl: Double = 0.0,
    val jobs: Int = 0,
    val startedAt: Long = 0,
    val lastAt: Long = 0,
    val last: DeskEvent? = null,
)

/** Day counters per track, reset at 00:00 UTC (web solarchik.limits.v1 dayKey/daySpent/lossStreak). */
@Serializable
data class DayBook(val day: String = "", val spent: Double = 0.0, val lossStreak: Int = 0, val loss: Double = 0.0) {
    fun rolled(today: String): DayBook = if (day == today) this else DayBook(today)
}

object EventKind {
    const val WATCH = "watch"
    const val SKIP = "skip"
    const val FUNDS = "funds"
    const val BLOCK = "block"
    const val OPEN = "open"
    const val CLOSE = "close"
    const val NODATA = "nodata"
}

/** Structured log line; the UI words it in the player's language. */
@Serializable
data class DeskEvent(
    val at: Long,
    val agent: String,
    val kind: String,
    val source: String = "",
    val label: String = "",
    val side: String = "",
    val stake: Double = 0.0,
    val pnl: Double = 0.0,
    val confidence: Double = 0.0,
    val moveBps: Double = 0.0,
    val block: String = "",
    val limit: Double = 0.0,
    val track: String = "",
)

data class Closed(val position: Position, val exitPx: Double, val pnl: Double, val closedAt: Long)

data class TickOut(val run: AgentRun, val day: DayBook, val events: List<DeskEvent>, val closed: Closed?, val opened: Position?)

/**
 * Pure decision loop, one call per strategy per tick. Ticks may be irregular (WorkManager
 * runs every ~15 min, the open app every 30 s): everything is decided from timestamps.
 */
object AgentEngine {
    /** An anchor older than this many windows is stale and is re-taken instead of traded on. */
    private const val STALE_WINDOWS = 3
    /** A position whose market vanished is closed flat after this long past its close time. */
    const val NO_DATA_GRACE_MS = 6 * 3600_000L

    fun roundLamports(sol: Double): Double = Math.round(sol * 1e9) / 1e9

    fun sidePx(side: String, px: Double): Double = if (side == "no") 1.0 - px else px

    fun pnlOf(p: Position, exitYesOrPx: Double): Double {
        val exit = sidePx(p.side, exitYesOrPx)
        if (!(p.entryPx > 0)) return 0.0
        val move = (exit - p.entryPx) / p.entryPx
        val signed = if (p.side == "down") -move else move
        return roundLamports(p.stake * signed)
    }

    fun tick(
        run0: AgentRun,
        now: Long,
        quotes: Map<Source, Quote>,
        settle: Quote?,
        day0: DayBook,
        caps: UserCaps,
        free: Double,
        newId: () -> String,
    ): TickOut {
        var day = day0.rolled(StreakRules.dayKey(now))
        var run = run0
        val events = ArrayList<DeskEvent>()
        fun ev(kind: String, block: (DeskEvent) -> DeskEvent = { it }) =
            block(DeskEvent(at = now, agent = run.name, kind = kind, track = run.track)).also { events += it }

        // 1. An open position settles when its window has passed.
        run.open?.let { p ->
            if (now < p.closeAt) return TickOut(run, day, emptyList(), null, null)
            val exitPx = settle?.takeIf { it.key == p.key }?.px
            if (exitPx == null && now < p.closeAt + NO_DATA_GRACE_MS) {
                return TickOut(run, day, emptyList(), null, null)
            }
            val pnl = if (exitPx == null) 0.0 else pnlOf(p, exitPx)
            val win = pnl > 0
            val e = ev(EventKind.CLOSE) {
                it.copy(source = p.source, label = p.label, side = p.side, stake = p.stake, pnl = pnl, confidence = p.confidence)
            }
            day = day.copy(
                lossStreak = if (pnl < 0) day.lossStreak + 1 else if (win) 0 else day.lossStreak,
                loss = if (pnl < 0) roundLamports(day.loss - pnl) else day.loss,
            )
            run = run.copy(
                open = null,
                wins = run.wins + if (win) 1 else 0,
                losses = run.losses + if (pnl < 0) 1 else 0,
                pnl = roundLamports(run.pnl + pnl),
                lastAt = now,
                last = e,
                // the exit price is the next anchor, so the next decision starts from here
                anchors = if (exitPx != null) run.anchors + (p.source to Anchor(exitPx, p.key, now)) else run.anchors,
            )
            return TickOut(run, day, events, Closed(p, exitPx ?: p.entryPx, pnl, now), null)
        }
        if (!run.running) return TickOut(run, day, emptyList(), null, null)

        // 2. Anchor or evaluate every market this strategy reads.
        data class Cand(val q: Quote, val side: String, val conf: Double, val move: Double, val entry: Double)
        val cands = ArrayList<Cand>()
        val anchors = run.anchors.toMutableMap()
        var watched = false
        var sawData = false
        for (src in Strategies.sources(run.skuId)) {
            val q = quotes[src] ?: continue
            sawData = true
            val windowMs = src.windowMin * 60_000L
            val a = anchors[src.name]
            val fresh = a != null && a.px > 0 && now - a.at < STALE_WINDOWS * windowMs &&
                (src.mode == Source.Mode.FAVORITE || a.key == q.key)
            if (!fresh) {
                anchors[src.name] = Anchor(q.px, q.key, now)
                watched = true
                continue
            }
            if (now - a!!.at < windowMs) continue
            when (src.mode) {
                Source.Mode.EDGE -> {
                    val move = (q.px - a.px) / a.px * 10_000
                    val conf = Strategies.edgeConfidence(move, src.edgeBps)
                    cands += Cand(q, if (move >= 0) "up" else "down", conf, move, q.px)
                }
                Source.Mode.FAVORITE -> {
                    val side = if (q.px >= 0.5) "yes" else "no"
                    val fav = sidePx(side, q.px)
                    val conf = if (fav > Strategies.FAVORITE_MAX) 0.0 else fav
                    cands += Cand(q, side, conf, 0.0, fav)
                }
            }
            anchors[src.name] = Anchor(q.px, q.key, now)
        }
        run = run.copy(anchors = anchors)
        if (cands.isEmpty()) {
            if (!sawData) {
                val e = ev(EventKind.NODATA)
                run = run.copy(lastAt = now, last = e)
            } else if (watched) {
                val first = Strategies.sources(run.skuId).firstNotNullOfOrNull { quotes[it] }
                val e = ev(EventKind.WATCH) { it.copy(source = first?.source?.name ?: "", label = first?.label ?: "") }
                run = run.copy(lastAt = now, last = e)
            }
            return TickOut(run, day, events, null, null)
        }

        // 3. Strongest forecast wins; enter only at >= 65% confidence, sized and capped.
        val best = cands.maxBy { it.conf }
        fun base(e: DeskEvent) = e.copy(source = best.q.source.name, label = best.q.label, side = best.side, confidence = best.conf, moveBps = best.move)
        if (best.conf + 1e-9 < Strategies.MIN_CONFIDENCE) {
            val e = ev(EventKind.SKIP, ::base)
            run = run.copy(lastAt = now, last = e)
            return TickOut(run, day, events, null, null)
        }
        val clamped = RiskCaps.clamp(caps)
        val stake = RiskCaps.dynamicSize(clamped.maxTradeSol, best.conf, free)
        if (stake < Strategies.MIN_STAKE) {
            val e = ev(EventKind.FUNDS) { base(it).copy(stake = stake) }
            run = run.copy(lastAt = now, last = e)
            return TickOut(run, day, events, null, null)
        }
        RiskCaps.block(clamped, stake, day.lossStreak, day.spent, day.loss)?.let { b ->
            val e = ev(EventKind.BLOCK) { base(it).copy(stake = stake, block = b.block.name, limit = b.limit) }
            run = run.copy(lastAt = now, last = e)
            return TickOut(run, day, events, null, null)
        }
        val src = best.q.source
        val p = Position(
            id = newId(),
            source = src.name,
            key = best.q.key,
            label = best.q.label.take(120),
            side = best.side,
            stake = stake,
            entryPx = best.entry,
            openedAt = now,
            closeAt = now + src.windowMin * 60_000L,
            confidence = best.conf,
        )
        val e = ev(EventKind.OPEN) { base(it).copy(stake = stake) }
        day = day.copy(spent = Math.round((day.spent + stake) * 1e6) / 1e6)
        run = run.copy(open = p, jobs = run.jobs + 1, lastAt = now, last = e)
        return TickOut(run, day, events, null, p)
    }
}
