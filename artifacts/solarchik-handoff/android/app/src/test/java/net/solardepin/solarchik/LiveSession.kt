package net.solardepin.solarchik

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import net.solardepin.solarchik.agents.engine.AgentEngine
import net.solardepin.solarchik.agents.engine.AgentRun
import net.solardepin.solarchik.agents.engine.DayBook
import net.solardepin.solarchik.agents.engine.DeskEvent
import net.solardepin.solarchik.agents.engine.HttpMarketFeed
import net.solardepin.solarchik.agents.engine.Quote
import net.solardepin.solarchik.agents.engine.Source
import net.solardepin.solarchik.agents.engine.Strategies
import net.solardepin.solarchik.agents.engine.Track
import net.solardepin.solarchik.agents.engine.UserCaps
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.Catalog
import net.solardepin.solarchik.core.FeeLedger
import net.solardepin.solarchik.core.FeeRow
import java.io.File
import java.util.UUID

/**
 * Real-time paper session on live public market data, using the production engine.
 * Not a unit test: run with `java -cp … net.solardepin.solarchik.LiveSession <minutes> <out.json>`.
 * Its output seeds the milestone B screenshots, so every row on them is a real decision.
 */
object LiveSession {
    @Serializable
    data class Out(
        val startedAt: Long,
        val updatedAt: Long,
        val runs: List<AgentRun>,
        val day: DayBook,
        val log: List<DeskEvent>,
        val fees: List<FeeRow>,
        val paperPnl: Double,
    )

    @JvmStatic
    fun main(args: Array<String>) = runBlocking {
        val minutes = args.getOrNull(0)?.toLongOrNull() ?: 60
        val out = File(args.getOrNull(1) ?: "live-session.json")
        val json = Json { prettyPrint = true; encodeDefaults = true }
        val feed = HttpMarketFeed()
        val start = System.currentTimeMillis()
        // Free tier everywhere except Combo (Pro) so the ledger shows both fee paths.
        var runs = Catalog.skus.map { sku ->
            val tier = if (sku.id == "sku-combo-prime") AgentTier.PRO else AgentTier.FREE
            AgentRun("paper:${sku.id}", sku.id, tier, sku.nameFor(tier), Track.PAPER, running = true, startedAt = start)
        }
        // Each strategy gets its own day book in the recording so one loss brake does not end the whole sample.
        val days = HashMap<String, DayBook>()
        val log = ArrayList<DeskEvent>()
        val fees = ArrayList<FeeRow>()
        var paperPnl = 0.0
        val caps = UserCaps()
        while (System.currentTimeMillis() - start < minutes * 60_000L) {
            val now = System.currentTimeMillis()
            val cache = HashMap<String, Quote?>()
            suspend fun q(s: Source, k: String? = null) = cache.getOrPut("$s|$k") { feed.quote(s, k) }
            runs = runs.map { run ->
                val open = run.open
                val settle = if (open != null && now >= open.closeAt) {
                    val src = Source.valueOf(open.source); q(src, if (src == Source.EVENTS) open.key else null)
                } else null
                val quotes = if (open == null) Strategies.sources(run.skuId).mapNotNull { s -> q(s)?.let { s to it } }.toMap() else emptyMap()
                val locked = runs.sumOf { it.open?.stake ?: 0.0 }
                val res = AgentEngine.tick(run, now, quotes, settle, days[run.key] ?: DayBook(), caps, Strategies.PAPER_PURSE + paperPnl - locked) {
                    "p-" + UUID.randomUUID().toString().take(13)
                }
                days[run.key] = res.day
                log.addAll(0, res.events.reversed())
                res.closed?.let { c ->
                    // Paper rows are booked as devnet-style rows here so the screenshots show every fee reason.
                    fees.add(0, FeeLedger.planFee(c.position.id, run.name, run.tier, c.position.openedAt, c.closedAt, c.pnl, paper = false, covered = false))
                    paperPnl = AgentEngine.roundLamports(paperPnl + c.pnl)
                }
                res.events.forEach { println("${java.time.Instant.ofEpochMilli(it.at)} ${it.agent} ${it.kind} ${it.label} ${it.side} conf=${"%.2f".format(it.confidence)} stake=${it.stake} pnl=${it.pnl} move=${"%.1f".format(it.moveBps)} ${it.block}") }
                res.run
            }
            out.writeText(json.encodeToString(Out.serializer(), Out(start, now, runs, DayBook(days.values.firstOrNull()?.day ?: "", days.values.sumOf { it.spent }, 0, days.values.sumOf { it.loss }), log.take(80), fees, paperPnl)))
            Thread.sleep(60_000)
        }
    }
}
