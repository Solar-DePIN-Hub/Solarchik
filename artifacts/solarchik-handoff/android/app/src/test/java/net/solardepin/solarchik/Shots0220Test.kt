package net.solardepin.solarchik

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import androidx.test.core.app.ApplicationProvider
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.game.RunActivity
import net.solardepin.solarchik.game.RunHud
import net.solardepin.solarchik.game.RunResult
import net.solardepin.solarchik.game.run.ChapterId
import net.solardepin.solarchik.game.run.DeathKind
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.ui.AgentsScreen
import net.solardepin.solarchik.ui.roof.RooftopScreen
import net.solardepin.solarchik.wallet.LocalKey
import net.solardepin.solarchik.wallet.SolanaWallet
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.io.File

/** 0.22.0 review screenshots (Robolectric native graphics, 1080x2400) into build/screens/0.22.0. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "uk-w411dp-h914dp-xxhdpi")
class Shots0220Test {
    private val app = ApplicationProvider.getApplicationContext<Context>()
    private val realCheck = SolanaWallet.walletAppCheck
    private val dir = File(System.getProperty("solarchik.shots") ?: "build/screens", "0.22.0")

    @Before fun setUp() {
        MainActivity.tickerEnabled = false
        SolanaWallet.walletAppCheck = { false }
        LocalKey.box = TestBox()
        RooftopScreen.forceMute = true
        listOf("solarchik-roof", "solarchik-game", "solarchik-agents", "solarchik.calls").forEach {
            app.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit()
        }
    }

    @After fun tearDown() {
        MainActivity.tickerEnabled = true
        SolanaWallet.walletAppCheck = realCheck
        RooftopScreen.forceMute = false
    }

    private fun idle() = repeat(10) { ShadowLooper.idleMainLooper(); Thread.sleep(5) }

    private fun find(v: View, tag: String): View? {
        if (v.tag == tag) return v
        if (v is ViewGroup) for (i in 0 until v.childCount) find(v.getChildAt(i), tag)?.let { return it }
        return null
    }

    private fun shot(a: Activity, name: String) {
        idle()
        val root = a.window.decorView
        root.measure(View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(2400, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 1080, 2400)
        val bmp = Bitmap.createBitmap(1080, 2400, Bitmap.Config.ARGB_8888)
        root.draw(Canvas(bmp))
        dir.mkdirs()
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun open(): MainActivity = Robolectric.buildActivity(MainActivity::class.java).setup().visible().get().also { idle() }

    private fun click(a: Activity, tag: String) { requireNotNull(find(a.window.decorView, tag)) { tag }.performClick(); idle() }

    @Test fun rooftopTourMenuAndClock() {
        val a = open()
        shot(a, "01-roof-tour-offer-uk")
        click(a, "tour-offer-later")
        shot(a, "02-roof-uk")
        click(a, "roof-help")
        click(a, "tour-next"); click(a, "tour-next")
        shot(a, "03-roof-tour-clock-step-uk")
        click(a, "tour-skip")
        click(a, "roof-menu")
        shot(a, "04-roof-menu-uk")
        click(a, "roof-row-judges")
        shot(a, "05a-roof-judges-first-uk")
        var guard = 0
        while (find(a.window.decorView, "tour-link") == null && guard++ < 8) {
            val next = find(a.window.decorView, "tour-next") ?: break
            next.performClick(); idle()
        }
        shot(a, "05-roof-judges-step-uk")
        find(a.window.decorView, "tour-skip")?.performClick(); idle()
        // CLOCK IN glowing (run done, not signed) vs signed
        val save = GameSave(app)
        save.recordRun(1340, 1500)
        val b = open()
        shot(b, "06-roof-clock-ready-uk")
        save.stampClock("Addr111", "sig-test-not-a-real-tx", "devnet", "memo")
        val c = open()
        shot(c, "07-roof-clock-signed-uk")
    }

    @Test @Config(qualifiers = "en-w411dp-h914dp-xxhdpi")
    fun rooftopEnglish() {
        val a = open()
        click(a, "tour-offer-later")
        shot(a, "08-roof-en")
    }

    @Test fun sliceAndCalls() {
        val a = open()
        a.select(MainActivity.Tab.AGENTS, animate = false)
        (a.screen(MainActivity.Tab.AGENTS) as AgentsScreen).openSection(3)
        shot(a, "09-slice-uk")
        val calls = Robolectric.buildActivity(net.solardepin.solarchik.ui.CallsActivity::class.java).setup().visible().get()
        assertNotNull(find(calls.window.decorView, "calls-sec-settings"))
        shot(calls, "10-calls-uk")
    }

    private fun hud(phase: Phase, m: Int) = RunHud(
        hearts = if (phase == Phase.DEAD) 0 else 3, shield = 0, score = m, meters = m, combo = 0, phase = phase, countdown = 0.0,
        death = DeathKind.HIT, suns = 12, maxCombo = 3, bonus = false, bonusLeft = 0.0, grind = false, didBonus = false,
        chapter = ChapterId.STORM, announce = "", announceOn = false, clockOpen = true,
    )

    @Test fun runAlreadySigned() {
        val save = GameSave(app)
        save.recordRun(1340, 1500)
        save.stampClock("Addr111", "sig-test-not-a-real-tx", "devnet", "memo")
        val a = Robolectric.buildActivity(RunActivity::class.java).setup().visible().get()
        a.onHud(hud(Phase.RUNNING, 1199))
        a.onEvents(listOf(Ev.CLOCK), hud(Phase.RUNNING, 1200))
        ShadowLooper.idleMainLooper()
        shot(a, "11-run-1200m-already-signed-uk")
        a.onResult(RunResult(hud(Phase.DEAD, 1610)))
        ShadowLooper.idleMainLooper(3, java.util.concurrent.TimeUnit.SECONDS)
        shot(a, "12-run-end-already-signed-uk")
    }
}
