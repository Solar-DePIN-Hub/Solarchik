package net.solardepin.solarchik

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.ChainSigner
import net.solardepin.solarchik.agents.OwnedAgent
import net.solardepin.solarchik.agents.StrategyFlows
import net.solardepin.solarchik.sol.ActAgent
import net.solardepin.solarchik.sol.ActContext
import net.solardepin.solarchik.sol.ActListing
import net.solardepin.solarchik.sol.ActType
import net.solardepin.solarchik.sol.SolActClient
import net.solardepin.solarchik.sol.SolAction
import net.solardepin.solarchik.sol.SolActions
import net.solardepin.solarchik.sol.SolBrain
import net.solardepin.solarchik.ui.SolActionDesk
import net.solardepin.solarchik.ui.SolScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.io.File

/**
 * 0.21.7 #17: Sol turns a chat/voice request into ONE action, shows a confirmation card and runs the
 * devnet flow ONLY after the tap. Server and wallet are faked here; the live run is SolActionsIT.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w411dp-h914dp-xxhdpi")
class SolActionsTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun spec(risk: String, windows: String) = json.parseToJsonElement(
        """{"lanes":["crypto"],"windows":$windows,"risk":"$risk","stakeSol":0.005,"askLo":0.35,"askHi":0.65,"edgeBps":60,"stopPct":25,"takePct":40,"rules":""}""",
    ).jsonObject

    private val calm = spec("calm", "[60,240]")
    private val momentum = spec("risky", "[5,15]")
    private val ctxA = ActContext(
        agents = listOf(
            ActAgent("CalmAsset111", "Calm Hourly BTC", running = true, strategyNft = true, spec = calm, trades = 3, pnlSol = 0.0012),
            ActAgent("paper:sku-pred-alpha", "Bitcoin Windows", running = false, skuId = "sku-pred-alpha"),
        ),
        market = listOf(ActListing("AV8Eg", "Momentum Rider 5m", 120_000_000, momentum), ActListing("2ijiD", "Mean Revert Scout", 80_000_000, spec("balanced", "[15,60]"))),
        canMintFree = true,
    )

    @Test fun phoneRevalidatesServerActions() {
        val o = { s: String -> json.parseToJsonElement(s).jsonObject }
        assertEquals(SolAction(ActType.BUY_STRATEGY, listing = "AV8Eg"), SolActions.normalize(o("""{"type":"buy_strategy","listing":"AV8Eg"}"""), ctxA))
        assertNull("invented listing", SolActions.normalize(o("""{"type":"buy_strategy","listing":"Nope"}"""), ctxA))
        assertNull("unknown type", SolActions.normalize(o("""{"type":"transfer_all"}"""), ctxA))
        assertEquals(
            SolAction(ActType.SET_STRATEGY, agent = "CalmAsset111", risk = "calm", windows = listOf(5)),
            SolActions.normalize(o("""{"type":"set_strategy","risk":"calm","windows":[5,7,5]}"""), ctxA),
        )
        assertNull("nothing to change", SolActions.normalize(o("""{"type":"set_strategy","agent":"CalmAsset111"}"""), ctxA))
    }

    @Test fun offlineParserReadsEnglishAndUkrainian() {
        assertEquals(SolAction(ActType.SET_STRATEGY, agent = "CalmAsset111", risk = "calm", windows = listOf(5)), SolActions.parseLocal("change my BTC agent to low risk 5m", ctxA))
        assertEquals(SolAction(ActType.SET_STRATEGY, agent = "CalmAsset111", risk = "calm", windows = listOf(5)), SolActions.parseLocal("зміни мого агента на низький ризик 5 хвилин", ctxA))
        assertEquals(SolAction(ActType.SET_STRATEGY, agent = "CalmAsset111", listing = "AV8Eg"), SolActions.parseLocal("set strategy Momentum Rider", ctxA))
        assertEquals(SolAction(ActType.BUY_STRATEGY, listing = "2ijiD"), SolActions.parseLocal("купи Mean Revert Scout", ctxA))
        assertEquals(SolAction(ActType.MINT_FREE), SolActions.parseLocal("mint a free agent", ctxA))
        assertEquals(SolAction(ActType.STOP_AGENT, agent = "CalmAsset111"), SolActions.parseLocal("pause my agent", ctxA))
        assertEquals(SolAction(ActType.START_AGENT, agent = "paper:sku-pred-alpha"), SolActions.parseLocal("запусти Bitcoin Windows", ctxA))
        assertEquals(SolAction(ActType.AGENT_STATUS, agent = "CalmAsset111"), SolActions.parseLocal("how is my BTC agent doing?", ctxA))
        assertTrue(SolActions.looksLikeCommand("buy the Calm Hourly BTC NFT"))
        assertFalse(SolActions.looksLikeCommand("what is a fee-free window?"))
        assertFalse(SolActions.looksLikeCommand("розкажи про сонячні панелі"))
    }

    @Test fun planShowsTheDiffPriceAndLock() {
        val p = SolActions.plan(SolAction(ActType.SET_STRATEGY, agent = "CalmAsset111", risk = "risky", windows = listOf(5)), ctxA)
        assertNull(p.blocked)
        assertTrue(p.locksSale)
        assertEquals(listOf(Triple("risk", "calm", "risky"), Triple("windows", "60/240", "5")), p.changes)
        assertEquals("[\"crypto\"]", p.nextSpec!!["lanes"].toString())
        val same = SolActions.plan(SolAction(ActType.SET_STRATEGY, agent = "CalmAsset111", risk = "calm"), ctxA)
        assertEquals("same", same.blocked)
        val buy = SolActions.plan(SolAction(ActType.BUY_STRATEGY, listing = "AV8Eg"), ctxA)
        assertEquals(120_000_000L, buy.priceLamports)
        assertFalse(buy.locksSale)
        assertEquals("already_running", SolActions.plan(SolAction(ActType.START_AGENT, agent = "CalmAsset111"), ctxA).blocked)
    }

    @Test fun clientFallsBackToThePhoneParserWhenTheRouteIsDown() = runBlocking {
        val down = SolActClient(post = { _, _ -> null })
        val r = down.ask("buy Mean Revert Scout", "en", ctxA, emptyList())
        assertTrue(r.offline)
        assertEquals(SolAction(ActType.BUY_STRATEGY, listing = "2ijiD"), r.action)
        var sent = ""
        val up = SolActClient(post = { _, b -> sent = b; """{"ok":true,"reply":"Ready.","action":{"type":"buy_strategy","listing":"AV8Eg"},"model":"m"}""" })
        val r2 = up.ask("buy momentum", "uk", ctxA, emptyList())
        assertEquals(SolAction(ActType.BUY_STRATEGY, listing = "AV8Eg"), r2.action)
        assertTrue(sent.contains("\"language\":\"uk\"") && sent.contains("Momentum Rider 5m") && sent.contains("\"priceSol\":0.12"))
    }

    @Test fun flowsSignProofThenServerTxsThenConfirm() = runBlocking {
        val calls = mutableListOf<String>()
        val api: suspend (String, JsonObject) -> JsonObject = { route, _ ->
            calls += route
            when (route) {
                "market-prepare-buy" -> buildJsonObject { put("ok", true); put("txs", kotlinx.serialization.json.buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("AAEC")) }) }
                else -> buildJsonObject { put("ok", true) }
            }
        }
        val signer = object : ChainSigner {
            override suspend fun signText(message: String) = Result.success("W" to "sig").also { calls += "sign:" + message.lineSequence().first() + ":" + message.lines().last() }
            override suspend fun signAndSend(txs: List<ByteArray>) = Result.success("TXSIG").also { calls += "send:${txs.size}" }
        }
        val o = StrategyFlows(signer, api, confirmDelayMs = 0).buy("W", "AV8Eg", 120_000_000)
        assertTrue(o.ok)
        assertEquals("TXSIG", o.sig)
        assertEquals(listOf("sign:solarchik:market:v1:buy:AV8Eg:120000000", "market-prepare-buy", "send:1", "market-confirm-buy"), calls)
    }

    /* ---------------- the screen: card first, chain only after the tap ---------------- */

    private val routes = mutableListOf<String>()

    private fun fakeApi(): suspend (String, JsonObject) -> JsonObject = { route, body ->
        routes += route
        when (route) {
            "market-list" -> json.parseToJsonElement(
                """{"ok":true,"items":[{"asset":"sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH","name":"Calm Hourly BTC","owner":"u2irHRaCwjogBYjdRQK7NmmzkGtLZzUqGfsSWAqsrQq","priceLamports":50000000,
                   "chain":{"spec":$calm,"version":1,"hash":"h","hashOk":true,"changedSec":1,"unlockSec":1}}]}""",
            ).jsonObject
            "strategy-info" -> if ((body["asset"] as kotlinx.serialization.json.JsonPrimitive).content == MINE)
                json.parseToJsonElement("""{"ok":true,"asset":"$MINE","name":"Momentum Rider 5m","owner":"${ScreensTest.WALLET}","chain":{"spec":$momentum,"version":2,"hash":"h2","hashOk":true,"changedSec":1,"unlockSec":1}}""").jsonObject
            else buildJsonObject { put("ok", false); put("reason", "NFT is not from the server collection") }
            else -> buildJsonObject { put("ok", false); put("reason", "must not be called in this test: $route") }
        }
    }

    private fun open(): Pair<MainActivity, SolScreen> {
        val app = ApplicationProvider.getApplicationContext<Context>()
        app.getSharedPreferences("seeker-wallet", Context.MODE_PRIVATE).edit().clear().putString("address", ScreensTest.WALLET).commit()
        app.getSharedPreferences("solarchik-agents", Context.MODE_PRIVATE).edit().clear().commit()
        app.getSharedPreferences("solarchik-sol", Context.MODE_PRIVATE).edit().remove("turns").commit()
        AgentStore(app).upsert(OwnedAgent(MINE, "strategy-nft", "pro", "Momentum Rider 5m", ScreensTest.WALLET, "devnet", "sig", System.currentTimeMillis(), OwnedAgent.STATUS_VERIFIED))
        MainActivity.tickerEnabled = false
        val a = Robolectric.buildActivity(MainActivity::class.java).setup().visible().get()
        a.select(MainActivity.Tab.SOL)
        val s = a.screen(MainActivity.Tab.SOL) as SolScreen
        s.actions = SolActionDesk(a, fakeApi())
        return a to s
    }

    private fun find(v: View, tag: String): View? {
        if (v.tag == tag) return v
        if (v is ViewGroup) for (i in 0 until v.childCount) find(v.getChildAt(i), tag)?.let { return it }
        return null
    }

    private fun texts(v: View, out: MutableList<String> = mutableListOf()): List<String> {
        if (v is TextView) out += v.text.toString()
        if (v is ViewGroup) for (i in 0 until v.childCount) texts(v.getChildAt(i), out)
        return out
    }

    private fun settle() {
        repeat(20) { ShadowLooper.idleMainLooper(); Thread.sleep(15) }
    }

    @Test fun buyShowsCardAndNothingRunsUntilTheTap() {
        val (a, s) = open()
        s.brain = SolBrain(market = SolActClient(post = { _, _ -> """{"ok":true,"reply":"","action":{"type":"buy_strategy","listing":"sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH"}}""" }), stream = SolBrain.NO_WORKER)
        s.send("buy the Calm Hourly BTC NFT")
        settle()
        val card = requireNotNull(find(a.window.decorView, "sol-act-card")) { "no confirmation card" }
        val all = texts(card)
        assertTrue(all.toString(), all.any { it.contains("Calm Hourly BTC") })
        assertTrue(all.toString(), all.any { it.contains("0.05 SOL") })
        assertNull("buy has no lock note", find(card, "sol-act-lock"))
        assertFalse("nothing prepared before the tap: $routes", routes.any { it.startsWith("market-prepare") || it.contains("confirm") })
        shot(a, "sol-act-buy-en")
        find(card, "sol-act-cancel")!!.performClick()
        settle()
        assertNull(s.pending)
        assertFalse(routes.any { it.startsWith("market-prepare") })
    }

    @Test fun strategyCardShowsDiffAndThe240hLock() {
        val (a, s) = open()
        s.brain = SolBrain(market = SolActClient(post = { _, _ -> """{"ok":true,"reply":"","action":{"type":"set_strategy","agent":"$MINE","risk":"calm","windows":[60]}}""" }), stream = SolBrain.NO_WORKER)
        s.send("change my BTC agent to low risk 1h")
        settle()
        val card = requireNotNull(find(a.window.decorView, "sol-act-card"))
        val all = texts(card).joinToString("\n")
        assertTrue(all, all.contains("Risky → Calm"))
        assertTrue(all, all.contains("5/15 → 60"))
        assertTrue(all, all.contains("240 h"))
        assertNotNull(find(card, "sol-act-lock"))
        assertFalse(routes.any { it.startsWith("strategy-prepare") || it == "strategy-validate" })
        shot(a, "sol-act-strategy-en")
    }

    @Test @Config(qualifiers = "uk-w411dp-h914dp-xxhdpi")
    fun ukrainianCard() {
        val (a, s) = open()
        s.brain = SolBrain(market = SolActClient(post = { _, _ -> null }), stream = SolBrain.NO_WORKER) // route down: the phone parser still understands
        s.send("постав моєму агенту низький ризик 1 год")
        settle()
        val card = requireNotNull(find(a.window.decorView, "sol-act-card"))
        val all = texts(card).joinToString("\n")
        assertTrue(all, all.contains("Змінити стратегію «Momentum Rider 5m»"))
        assertTrue(all, all.contains("240 год"))
        assertTrue(all, all.contains("Підтвердити"))
        shot(a, "sol-act-strategy-uk")
    }

    @Test fun statusIsAnsweredAtOnceWithoutACard() {
        val (a, s) = open()
        s.brain = SolBrain(market = SolActClient(post = { _, _ -> """{"ok":true,"reply":"","action":{"type":"agent_status","agent":"$MINE"}}""" }), stream = SolBrain.NO_WORKER)
        s.send("how is my agent doing?")
        settle()
        assertNull(find(a.window.decorView, "sol-act-card"))
        val all = texts(a.window.decorView).joinToString("\n")
        assertTrue(all, all.contains("Momentum Rider 5m is paused"))
    }

    /* ---------------- 0.21.8: one brain, streamed; ownership ---------------- */

    private fun worker(vararg lines: String): suspend (String, String, (String) -> Unit) -> Boolean = { _, _, on -> lines.forEach(on); true }

    @Test fun brainStreamsTheWorkerThenFallsBackInOrder() = runBlocking {
        var body = ""
        val deltas = mutableListOf<String>()
        val up = SolBrain(market = SolActClient(post = { _, _ -> error("market must not be asked") }), stream = { _, b, on ->
            body = b
            on("""{"d":"Sure. "}"""); on("garbage"); on("""{"d":"I'll start it."}""")
            on("""{"done":true,"ok":true,"reply":"Sure. I'll start it.","action":{"type":"start_agent","agent":"paper:sku-pred-alpha"},"model":"gpt-4.1-mini","ttftMs":500}""")
            true
        })
        val r = up.ask("start bitcoin windows", "uk", "yard", ctxA, emptyList(), "note") { deltas += it }
        assertEquals(SolBrain.Source.WORKER, r.source)
        assertEquals(listOf("Sure. ", "Sure. I'll start it."), deltas)
        assertEquals(SolAction(ActType.START_AGENT, agent = "paper:sku-pred-alpha"), r.action)
        assertEquals("gpt-4.1-mini", r.model)
        assertNotNull(r.ttftMs)
        assertTrue(body, body.contains("\"stream\":true") && body.contains("\"language\":\"uk\"") && body.contains("\"owned\"") && body.contains("\"context\":\"note\""))
        // worker invents an agent -> the phone drops the action but keeps the words
        val bad = SolBrain(stream = worker("""{"done":true,"ok":true,"reply":"Done!","action":{"type":"start_agent","agent":"ghost"}}"""), market = SolActClient(post = { _, _ -> null }))
        val rb = bad.ask("start ghost", "en", "yard", ctxA, emptyList())
        assertNull(rb.action); assertEquals(SolBrain.Source.WORKER, rb.source)
        // worker down -> market
        val m = SolBrain(stream = SolBrain.NO_WORKER, market = SolActClient(post = { _, _ -> """{"ok":true,"reply":"Ready.","action":{"type":"buy_strategy","listing":"AV8Eg"},"model":"g"}""" }))
        val rm = m.ask("buy momentum", "en", "yard", ctxA, emptyList())
        assertEquals(SolBrain.Source.MARKET, rm.source); assertEquals("AV8Eg", rm.action?.listing)
        // worker says ok:false (503) and market down -> phone parser, labelled offline
        val off = SolBrain(stream = worker("""{"done":true,"ok":false}"""), market = SolActClient(post = { _, _ -> null }))
        val ro = off.ask("pause my agent", "en", "yard", ctxA, emptyList())
        assertTrue(ro.offline); assertEquals(SolAction(ActType.STOP_AGENT, agent = "CalmAsset111"), ro.action)
        val chit = off.ask("tell me a joke", "en", "yard", ctxA, emptyList())
        assertTrue(chit.offline); assertNull(chit.action)
    }

    @Test fun smallTalkGoesToTheWorkerNotTheFriend() {
        val (a, s) = open()
        s.brain = SolBrain(stream = worker("""{"d":"Your agents work while you sleep — "}""", """{"d":"start one on the Agents tab."}""",
            """{"done":true,"ok":true,"reply":"Your agents work while you sleep — start one on the Agents tab.","action":null,"model":"gpt-4.1-mini"}"""),
            market = SolActClient(post = { _, _ -> error("market must not be asked") }))
        s.send("what can my agents do?")
        settle()
        val all = texts(a.window.decorView).joinToString("\n")
        assertTrue(all, all.contains("Your agents work while you sleep"))
        assertFalse(all, all.contains("only watch"))
        assertEquals(SolBrain.Source.WORKER, s.lastReply?.source)
    }

    @Test fun startingAnUnownedAgentOffersMintOrProFirst() {
        val (a, s) = open()
        s.brain = SolBrain(stream = worker("""{"done":true,"ok":true,"reply":"","action":{"type":"start_agent","agent":"paper:sku-pred-alpha"}}"""), market = SolActClient(post = { _, _ -> null }))
        s.send("start Bitcoin Windows")
        settle()
        val card = requireNotNull(find(a.window.decorView, "sol-act-card")) { "no card" }
        assertTrue(requireNotNull(s.pending).acquire)
        assertNotNull("mint free option", find(card, "offer-mint-free"))
        assertNotNull("buy pro option", find(card, "offer-buy-pro"))
        assertNull("no plain confirm for an unowned agent", find(card, "sol-act-confirm"))
        val all = texts(a.window.decorView).joinToString("\n")
        assertTrue(all, all.contains("don't own"))
        assertTrue("nothing started before the tap", a.desk.state().run("paper:sku-pred-alpha")?.running != true)
        shot(a, "sol-act-acquire-en")
    }

    @Test fun startingAnOwnedPaperAgentIsAPlainConfirm() {
        val (a, s) = open()
        AgentStore(a).upsert(OwnedAgent("AlphaFree1", "sku-pred-alpha", "free", "Bitcoin Windows #11", ScreensTest.WALLET, "devnet", "sig", System.currentTimeMillis(), OwnedAgent.STATUS_VERIFIED))
        s.actions.invalidate()
        s.brain = SolBrain(stream = worker("""{"done":true,"ok":true,"reply":"Starting it — tap Confirm.","action":{"type":"start_agent","agent":"paper:sku-pred-alpha"}}"""), market = SolActClient(post = { _, _ -> null }))
        s.send("start Bitcoin Windows")
        settle()
        val card = requireNotNull(find(a.window.decorView, "sol-act-card"))
        assertFalse(requireNotNull(s.pending).acquire)
        find(card, "sol-act-confirm")!!.performClick()
        settle()
        assertTrue(a.desk.state().run("paper:sku-pred-alpha")?.running == true)
    }

    private fun shot(a: MainActivity, name: String) {
        val dir = File(System.getProperty("solarchik.shots") ?: "build/screens")
        val content = a.window.decorView.findViewById<ViewGroup>(android.R.id.content)
        val scroll = generateSequence(listOf<View>(content)) { l -> l.flatMap { v -> if (v is ViewGroup) (0 until v.childCount).map(v::getChildAt) else emptyList() }.takeIf { it.isNotEmpty() } }
            .flatten().firstOrNull { it is android.widget.ScrollView } as? android.widget.ScrollView ?: return
        val inner = scroll.getChildAt(0)
        inner.measure(View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
        inner.layout(0, 0, 1080, inner.measuredHeight)
        val card = find(inner, "sol-act-card")
        val top = card?.let { var y = 0; var v: View? = it; while (v != null && v !== inner) { y += v.top; v = v.parent as? View }; (y - 900).coerceAtLeast(0) } ?: 0
        val h = (inner.measuredHeight - top).coerceAtMost(2400)
        val bmp = Bitmap.createBitmap(1080, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(0xFF07131C.toInt())
        c.translate(0f, -top.toFloat())
        inner.draw(c)
        dir.mkdirs()
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    companion object {
        const val MINE = "AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX"
    }
}
