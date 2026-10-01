package net.solardepin.solarchik

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.OwnedAgent
import net.solardepin.solarchik.agents.engine.DeskState
import net.solardepin.solarchik.agents.engine.DeskStore
import net.solardepin.solarchik.agents.engine.Track
import net.solardepin.solarchik.core.AgentTier
import net.solardepin.solarchik.core.FeeLedger
import net.solardepin.solarchik.sol.ChatTurn
import net.solardepin.solarchik.sol.SolChatStore
import net.solardepin.solarchik.sol.SolRules
import net.solardepin.solarchik.ui.SolScreen
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Milestone B screens. The desk, log and ledger come from a real-time paper session on live
 * market data (LiveSession, -Plive=path); the chat from real friend-worker replies (-Pchat=dir).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w411dp-h914dp-xxhdpi")
class ScreensBTest {
    private val outDir = File((System.getProperty("solarchik.shots") ?: "build/screens").let { if (it.endsWith("screens-A")) it.replace("screens-A", "screens-B") else it })
    private val live = File(System.getProperty("solarchik.live").orEmpty())
    private val chatDir = File(System.getProperty("solarchik.chat").orEmpty())
    private val json = Json { ignoreUnknownKeys = true }

    @Before fun off() { MainActivity.tickerEnabled = false }
    @After fun on() { MainActivity.tickerEnabled = true }

    private fun seed(lang: String) {
        assumeTrue("needs -Plive=<session.json>", live.isFile)
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        listOf("solarchik-game", "solarchik-agents", "solarchik-desk", "solarchik-sol", "seeker-wallet", "solarchik-notes").forEach {
            ctx.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit()
        }
        val today = LocalDate.now(ZoneOffset.UTC)
        val days = (6 downTo 1).map { today.minusDays(it.toLong()).toString() }
        ctx.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE).edit()
            .putInt("streak", 6).putString("signedDay", today.minusDays(1).toString()).putInt("seven", 6).putInt("thirty", 6)
            .putString("clockDays", days.joinToString(",", "[", "]") { "\"$it\"" }).putString("feeWindows", "[]")
            .putString("runDay", today.toString()).putInt("lastDistance", 1240).putInt("lastScore", 1510)
            .putInt("bestDistance", 1240).putInt("bestScore", 1720).putString("lastClockDay", today.toString())
            .commit()
        ctx.getSharedPreferences("seeker-wallet", Context.MODE_PRIVATE).edit().putString("address", ScreensTest.WALLET).commit()
        val store = AgentStore(ctx)
        store.upsert(OwnedAgent("Fz6LxeUg5qjesYX3BdmtTwyyzBtMxk644XiTqU5W3w9w", "sku-pred-alpha", AgentTier.FREE, "Bitcoin Windows #11", ScreensTest.WALLET, "devnet", "sig", System.currentTimeMillis() - 86_400_000L, OwnedAgent.STATUS_VERIFIED))

        // Real session: runs, log and every closed position, booked as the app books paper rows.
        val s = json.decodeFromString(LiveSession.Out.serializer(), live.readText())
        s.fees.reversed().forEach { r ->
            store.addFee(FeeLedger.planFee(r.id, r.agent, s.runs.firstOrNull { it.name == r.agent }?.tier, r.openedAt, r.closedAt, r.pnl, paper = true, covered = false))
        }
        DeskStore(ctx).write(DeskState(runs = s.runs, days = mapOf(Track.PAPER to s.day), log = s.log, paperPnl = s.paperPnl, lastTickAt = s.updatedAt))

        val chat = File(chatDir, "chat-$lang.json")
        if (chat.isFile) {
            val turns = json.decodeFromString(ListSerializer(ChatTurn.serializer()), chat.readText())
            val sol = SolChatStore(ctx)
            // Stored as the app stores them: worker replies pass through SolRules.tidy.
            turns.take(2).forEach { sol.add(if (it.role == "assistant") it.copy(text = SolRules.tidy(it.text)) else it) }
        }
    }

    private fun shot(a: MainActivity, name: String, scrollToText: String? = null, full: Boolean = true) {
        ShadowLooper.idleMainLooper()
        val root: View = a.window.decorView
        root.measure(View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(2400, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 1080, 2400)
        val scroll = findScroll(root)
        if (scroll != null) {
            val y = scrollToText?.let { t -> findText(scroll, t)?.let { offsetIn(scroll, it) - 40 } } ?: 0
            scroll.scrollTo(0, y.coerceAtLeast(0))
        }
        val bmp = Bitmap.createBitmap(1080, 2400, Bitmap.Config.ARGB_8888)
        root.draw(Canvas(bmp))
        outDir.mkdirs()
        File(outDir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        scroll?.scrollTo(0, 0)
        if (!full || scroll == null) return
        val inner = scroll.getChildAt(0)
        inner.measure(View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
        val fullBmp = Bitmap.createBitmap(1080, inner.measuredHeight.coerceAtMost(12000), Bitmap.Config.ARGB_8888)
        val c = Canvas(fullBmp)
        c.drawColor(0xFF07131C.toInt())
        inner.layout(0, 0, 1080, inner.measuredHeight)
        inner.draw(c)
        File(outDir, "$name-full.png").outputStream().use { fullBmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun offsetIn(parent: View, v: View): Int {
        var y = 0
        var cur: View? = v
        while (cur != null && cur !== parent) { y += cur.top; cur = cur.parent as? View }
        return y
    }

    private fun findText(v: View, text: String): View? {
        if (v is TextView && v.text.toString().equals(text, ignoreCase = true)) return v
        if (v is ViewGroup) for (i in 0 until v.childCount) findText(v.getChildAt(i), text)?.let { return it }
        return null
    }

    private fun findScroll(v: View): ScrollView? {
        if (v is ScrollView) return v
        if (v is ViewGroup) for (i in 0 until v.childCount) findScroll(v.getChildAt(i))?.let { return it }
        return null
    }

    private fun run(lang: String, suffix: String, ask: String, risk: String, notes: String, chatTitle: String) {
        seed(lang)
        val a = Robolectric.buildActivity(MainActivity::class.java).setup().visible().get()
        a.select(MainActivity.Tab.AGENTS)
        shot(a, "B01-desk-running$suffix")
        shot(a, "B02-risk-panel$suffix", scrollToText = risk, full = false)
        a.select(MainActivity.Tab.SOL)
        shot(a, "B03-sol-report$suffix")
        (a.screen(MainActivity.Tab.SOL) as SolScreen).send(ask)
        shot(a, "B04-sol-chat$suffix", scrollToText = chatTitle, full = false)
        a.select(MainActivity.Tab.SETTINGS)
        shot(a, "B05-settings-notifications$suffix", scrollToText = notes, full = false)
        a.select(MainActivity.Tab.YARD)
        shot(a, "B06-yard$suffix", full = false)
    }

    @Test fun english() = run("en", "", "What does a fee-free window do?", "Risk limits", "Reminders", "Talk to Sol")

    @Test @Config(qualifiers = "uk-w411dp-h914dp-xxhdpi")
    fun ukrainian() = run("uk", "-uk", "Що дає вікно без комісії?", "Ліміти ризику", "Нагадування", "Поговори з Sol")
}
