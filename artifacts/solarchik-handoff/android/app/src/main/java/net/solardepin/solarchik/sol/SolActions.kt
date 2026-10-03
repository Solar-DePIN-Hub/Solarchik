package net.solardepin.solarchik.sol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import net.solardepin.solarchik.core.SolarchikConfig

/**
 * Sol "does things" (0.21.7). A chat or voice request becomes ONE structured action; the app shows a
 * confirmation card and runs the real devnet flow only after the player's tap. Nothing in this file
 * executes anything: it is the action shape, the phone-side validation and the offline fallback parser.
 */
enum class ActType(val wire: String) {
    SET_STRATEGY("set_strategy"), BUY_STRATEGY("buy_strategy"), MINT_FREE("mint_free"),
    START_AGENT("start_agent"), STOP_AGENT("stop_agent"), AGENT_STATUS("agent_status");

    /** Status is read-only: answered at once. Everything else waits for the confirm tap. */
    val needsConfirm: Boolean get() = this != AGENT_STATUS

    companion object {
        fun of(wire: String?): ActType? = entries.firstOrNull { it.wire == wire }
    }
}

data class SolAction(
    val type: ActType,
    val agent: String = "",
    val listing: String = "",
    val risk: String = "",
    val windows: List<Int> = emptyList(),
)

/** One of my agents as Sol sees it. [id] is the Core asset, or the desk key (`paper:<sku>`). */
data class ActAgent(
    val id: String,
    val name: String,
    val running: Boolean = false,
    val strategyNft: Boolean = false,
    val spec: JsonObject? = null,
    val listed: Boolean = false,
    val unlockSec: Long = 0,
    val trades: Int? = null,
    val pnlSol: Double? = null,
    val skuId: String = "",
    val tier: String = "free",
    val track: String = "paper",
    val aprSince: Double? = null,
    /** 0.21.8: false for a catalog agent the player has not minted or bought yet (start offers mint/buy). */
    val owned: Boolean = true,
) {
    val risk: String get() = (spec?.get("risk") as? JsonPrimitive)?.content.orEmpty()
    val windows: List<Int> get() = SolActions.windowsOf(spec)
}

data class ActListing(val id: String, val name: String, val priceLamports: Long, val spec: JsonObject? = null) {
    val priceSol: Double get() = priceLamports / 1e9
}

data class ActContext(val agents: List<ActAgent>, val market: List<ActListing>, val canMintFree: Boolean) {
    fun agent(id: String) = agents.firstOrNull { it.id == id }
    fun listing(id: String) = market.firstOrNull { it.id == id }

    fun toJson(): JsonObject = buildJsonObject {
        putJsonArray("agents") {
            agents.take(12).forEach { a ->
                add(buildJsonObject {
                    put("id", a.id); put("name", a.name); put("running", a.running); put("strategyNft", a.strategyNft); put("owned", a.owned)
                    if (a.risk.isNotBlank()) put("risk", a.risk)
                    if (a.windows.isNotEmpty()) putJsonArray("windows") { a.windows.forEach { add(it) } }
                    a.trades?.let { put("trades", it) }
                    a.pnlSol?.let { put("pnlSol", it) }
                })
            }
        }
        putJsonArray("market") {
            market.take(20).forEach { m ->
                add(buildJsonObject {
                    put("id", m.id); put("name", m.name); put("priceSol", m.priceSol)
                    (m.spec?.get("risk") as? JsonPrimitive)?.let { put("risk", it) }
                    val w = SolActions.windowsOf(m.spec)
                    if (w.isNotEmpty()) putJsonArray("windows") { w.forEach { add(it) } }
                })
            }
        }
        put("canMintFree", canMintFree)
    }
}

data class SolActReply(val reply: String, val action: SolAction?, val model: String = "", val offline: Boolean = false)

/** What a confirmed action would change: shown on the card before anything is signed. */
data class ActionPlan(
    val action: SolAction,
    val agent: ActAgent? = null,
    val listing: ActListing? = null,
    /** Spec field → (before, after); only fields that change. */
    val changes: List<Triple<String, String, String>> = emptyList(),
    val nextSpec: JsonObject? = null,
    val priceLamports: Long? = null,
    /** A strategy change locks sale for 240 h. */
    val locksSale: Boolean = false,
    /** Why it cannot run (string key for the UI), or null when it can. */
    val blocked: String? = null,
    /** 0.21.8: START on an agent the player does not own yet: the card offers Mint free / Buy Pro, then starts. */
    val acquire: Boolean = false,
)

object SolActions {
    /**
     * 0.22.0: what Sol is told about "my agents". One NFT used to show up twice ("Weather Station" from the chain
     * card and "Метеостанція" from the paper desk of the same strategy). Now: devnet NFTs once per asset id; a
     * paper entry of a strategy I already hold as a devnet NFT is dropped (kept only while its practice run is
     * running, then marked with [practiceTag]); every name goes through [localize] (current app language).
     */
    fun mergeAgents(devnet: List<ActAgent>, paper: List<ActAgent>, practiceTag: String, localize: (String) -> String): List<ActAgent> {
        val nft = devnet.distinctBy { it.id }.map { it.copy(name = localize(it.name)) }
        val held = nft.mapNotNull { net.solardepin.solarchik.core.Catalog.baseOf(it.skuId)?.id ?: it.skuId.removeSuffix("-pro").ifBlank { null } }.toSet()
        // a practice (paper) run of a strategy also held as an NFT stays startable, but never under the same name
        val rest = paper.distinctBy { it.id }.map { p ->
            val base = net.solardepin.solarchik.core.Catalog.baseOf(p.skuId)?.id ?: p.skuId
            if (base !in held) p.copy(name = localize(p.name)) else p.copy(name = localize(p.name) + " · " + practiceTag)
        }
        return nft + rest
    }

    val RISKS = listOf("calm", "balanced", "risky")
    val WINDOWS = listOf(5, 15, 60, 240)

    fun windowsOf(spec: JsonObject?): List<Int> =
        (spec?.get("windows") as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() }

    /* ---------------- server reply → validated action ---------------- */

    private fun JsonObject.s(k: String): String = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content.orEmpty()

    /** Same rules as the server (sol-actions.ts normalizeAction), applied again on the phone: never trust the wire. */
    fun normalize(o: JsonObject?, ctx: ActContext): SolAction? {
        if (o == null) return null
        val type = ActType.of(o.s("type").ifBlank { o.s("action") }) ?: return null
        val agent = o.s("agent").let { id -> ctx.agent(id) }
        val listing = o.s("listing").let { id -> ctx.listing(id) }
        val risk = o.s("risk").takeIf { it in RISKS }.orEmpty()
        val windows = (o["windows"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() }
            .filter { it in WINDOWS }.distinct().sorted()
        return when (type) {
            ActType.BUY_STRATEGY -> listing?.let { SolAction(type, listing = it.id) }
            ActType.MINT_FREE -> SolAction(type)
            ActType.START_AGENT, ActType.STOP_AGENT, ActType.AGENT_STATUS ->
                (agent ?: ctx.agents.singleOrNull())?.let { SolAction(type, agent = it.id) }
            ActType.SET_STRATEGY -> {
                val a = agent ?: ctx.agents.filter { it.strategyNft }.singleOrNull() ?: return null
                if (risk.isBlank() && windows.isEmpty() && listing == null) return null
                SolAction(type, agent = a.id, listing = listing?.id.orEmpty(), risk = risk, windows = windows)
            }
        }
    }

    /* ---------------- offline / quick intent parser (EN + UK) ---------------- */

    private val BUY = Regex("\\b(buy|purchase|get me)\\b|купи|купити|придбай|придбати", RegexOption.IGNORE_CASE)
    private val MINT = Regex("\\bmint\\b|змінт|мінт", RegexOption.IGNORE_CASE)
    private val STOP = Regex("\\b(pause|stop|halt|turn off)\\b|зупини|зупинити|пауз|призупини|вимкни|стоп", RegexOption.IGNORE_CASE)
    private val START = Regex("\\b(start|resume|launch|turn on|run my)\\b|запусти|запустити|увімкни|старт|віднови", RegexOption.IGNORE_CASE)
    private val STATUS = Regex("how('s| is| are)\\b.*\\b(agent|doing|going)|\\bstatus\\b|\\bdoing\\b|як там|як справи|як працює|стан агента|результат", RegexOption.IGNORE_CASE)
    private val CHANGE = Regex("\\b(change|set|switch|make|move|use)\\b|змін|постав|встанов|переключ|зроби|заміни|використ", RegexOption.IGNORE_CASE)
    private val STRATEGY = Regex("strateg|стратег|risk|ризик|\\d+\\s*(m|min|h|хв|год)\\b|hourly|щогодин", RegexOption.IGNORE_CASE)
    private val CALM = Regex("\\b(low|safe|calm|careful|conservative)\\b|низьк|безпечн|спокійн|обережн", RegexOption.IGNORE_CASE)
    private val BALANCED = Regex("\\b(medium|balanced|normal|moderate)\\b|середн|збалансован|помірн", RegexOption.IGNORE_CASE)
    private val RISKY = Regex("\\b(high|aggressive|risky|bold)\\b|висок|агресивн|ризикован|сміли", RegexOption.IGNORE_CASE)
    private val MINUTES = Regex("(\\d{1,3})\\s*(m|min|mins|minutes?|хв|хвилин[аиу]?)\\b", RegexOption.IGNORE_CASE)
    private val HOURS = Regex("(\\d{1,2})\\s*(h|hr|hours?|год|годин[аиу]?)\\b", RegexOption.IGNORE_CASE)
    private val HOURLY = Regex("hourly|щогодин|1\\s*год", RegexOption.IGNORE_CASE)

    /** True when the message reads like a request to DO something (sent to the action route, not plain chat). */
    fun looksLikeCommand(msg: String): Boolean {
        val m = msg.trim()
        if (m.length > 200) return false
        return BUY.containsMatchIn(m) || MINT.containsMatchIn(m) || STOP.containsMatchIn(m) || START.containsMatchIn(m) ||
            STATUS.containsMatchIn(m) || (CHANGE.containsMatchIn(m) && STRATEGY.containsMatchIn(m))
    }

    fun riskOf(msg: String): String = when {
        CALM.containsMatchIn(msg) -> "calm"
        RISKY.containsMatchIn(msg) -> "risky"
        BALANCED.containsMatchIn(msg) -> "balanced"
        else -> ""
    }

    fun windowsIn(msg: String): List<Int> {
        val out = mutableListOf<Int>()
        MINUTES.findAll(msg).forEach { it.groupValues[1].toIntOrNull()?.let(out::add) }
        HOURS.findAll(msg).forEach { it.groupValues[1].toIntOrNull()?.let { h -> out += h * 60 } }
        if (HOURLY.containsMatchIn(msg)) out += 60
        return out.filter { it in WINDOWS }.distinct().sorted()
    }

    private fun tokens(s: String) = s.lowercase().split(Regex("[^\\p{L}\\p{N}]+")).filter { it.length >= 3 }

    /** Best name match by shared words (≥1), ties → none. */
    fun <T> byName(msg: String, items: List<T>, name: (T) -> String): T? {
        val said = tokens(msg).toSet()
        val scored = items.map { it to tokens(name(it)).count { w -> w in said } }.filter { it.second > 0 }.sortedByDescending { it.second }
        if (scored.isEmpty()) return null
        if (scored.size > 1 && scored[0].second == scored[1].second) return null
        return scored[0].first
    }

    /** Offline fallback: the same actions from keywords and names, when the action route is unreachable. */
    fun parseLocal(msg: String, ctx: ActContext): SolAction? {
        val listing = byName(msg, ctx.market) { it.name }
        val agent = byName(msg, ctx.agents) { it.name }
        return when {
            BUY.containsMatchIn(msg) -> listing?.let { SolAction(ActType.BUY_STRATEGY, listing = it.id) }
            MINT.containsMatchIn(msg) -> SolAction(ActType.MINT_FREE)
            STOP.containsMatchIn(msg) -> (agent ?: ctx.agents.filter { it.running }.singleOrNull())?.let { SolAction(ActType.STOP_AGENT, agent = it.id) }
            START.containsMatchIn(msg) -> (agent ?: ctx.agents.singleOrNull())?.let { SolAction(ActType.START_AGENT, agent = it.id) }
            CHANGE.containsMatchIn(msg) && STRATEGY.containsMatchIn(msg) || (CHANGE.containsMatchIn(msg) && listing != null) -> {
                val a = (agent?.takeIf { it.strategyNft }) ?: ctx.agents.filter { it.strategyNft }.singleOrNull() ?: return null
                val risk = riskOf(msg)
                val w = windowsIn(msg)
                val tpl = listing?.takeIf { it.name != a.name }
                if (risk.isBlank() && w.isEmpty() && tpl == null) null
                else SolAction(ActType.SET_STRATEGY, agent = a.id, listing = tpl?.id.orEmpty(), risk = risk, windows = w)
            }
            STATUS.containsMatchIn(msg) -> (agent ?: ctx.agents.singleOrNull() ?: ctx.agents.firstOrNull { it.running })?.let { SolAction(ActType.AGENT_STATUS, agent = it.id) }
            else -> null
        }
    }

    /* ---------------- plan: what exactly would change ---------------- */

    /** current spec ← template's spec (lanes kept to what the NFT can do) ← explicit risk / windows. */
    fun nextSpec(current: JsonObject, template: JsonObject?, risk: String, windows: List<Int>): JsonObject {
        val m = current.toMutableMap()
        template?.forEach { (k, v) -> if (k != "lanes") m[k] = v }
        if (risk.isNotBlank()) m["risk"] = JsonPrimitive(risk)
        if (windows.isNotEmpty()) m["windows"] = buildJsonArray { windows.forEach { add(it) } }
        return JsonObject(m)
    }

    private fun show(v: kotlinx.serialization.json.JsonElement?): String = when (v) {
        null, is JsonNull -> "—"
        is JsonArray -> v.joinToString("/") { (it as? JsonPrimitive)?.content.orEmpty() }
        is JsonPrimitive -> v.content
        else -> v.toString()
    }

    fun plan(action: SolAction, ctx: ActContext, nowMs: Long = System.currentTimeMillis()): ActionPlan {
        val agent = ctx.agent(action.agent)
        val listing = ctx.listing(action.listing)
        return when (action.type) {
            ActType.BUY_STRATEGY -> ActionPlan(action, listing = listing, priceLamports = listing?.priceLamports, blocked = if (listing == null) "gone" else null)
            ActType.MINT_FREE -> ActionPlan(action, priceLamports = 0, blocked = if (!ctx.canMintFree) "free_used" else null)
            ActType.START_AGENT -> ActionPlan(action, agent, blocked = if (agent?.running == true) "already_running" else null, acquire = agent != null && !agent.owned && agent.running != true)
            ActType.STOP_AGENT -> ActionPlan(action, agent, blocked = if (agent?.running == false) "already_stopped" else null)
            ActType.AGENT_STATUS -> ActionPlan(action, agent)
            ActType.SET_STRATEGY -> {
                val cur = agent?.spec
                if (agent == null || !agent.strategyNft || cur == null) return ActionPlan(action, agent, blocked = "no_strategy_nft")
                if (agent.listed) return ActionPlan(action, agent, blocked = "listed")
                val next = nextSpec(cur, listing?.spec, action.risk, action.windows)
                val keys = listOf("risk", "windows", "stakeSol", "askLo", "askHi", "edgeBps", "stopPct", "takePct", "rules")
                val changes = keys.mapNotNull { k ->
                    val a = show(cur[k]); val b = show(next[k])
                    if (a == b) null else Triple(k, a, b)
                }
                ActionPlan(action, agent, listing, changes, next, priceLamports = 0, locksSale = true, blocked = if (changes.isEmpty()) "same" else null)
            }
        }
    }
}

/** Client for the server action route (Gemini structured output); [post] is the test seam. */
class SolActClient(
    private val url: String = SolarchikConfig.SOL_ACT_URL,
    private val post: suspend (String, String) -> String? = { u, b -> SolChat.httpPost(u, b) },
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun ask(message: String, language: String, ctx: ActContext, history: List<ChatTurn>): SolActReply {
        val body = buildJsonObject {
            put("message", message.take(600))
            put("language", if (language == "uk") "uk" else "en")
            put("context", ctx.toJson())
            putJsonArray("history") {
                history.filter { !it.fallback && !it.local }.takeLast(6).forEach { t -> add(buildJsonObject { put("role", t.role); put("content", t.text) }) }
            }
        }.toString()
        val raw = runCatching { post(url, body) }.getOrNull()
        val o = raw?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() }
        if (o == null || (o["ok"] as? JsonPrimitive)?.content != "true") {
            return SolActReply("", SolActions.parseLocal(message, ctx), offline = true)
        }
        val reply = (o["reply"] as? JsonPrimitive)?.content.orEmpty()
        val action = SolActions.normalize(o["action"] as? JsonObject, ctx)
        return SolActReply(reply, action, (o["model"] as? JsonPrimitive)?.content.orEmpty())
    }
}
