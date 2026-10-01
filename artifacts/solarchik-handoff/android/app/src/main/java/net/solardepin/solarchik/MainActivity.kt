package net.solardepin.solarchik

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import net.solardepin.solarchik.agents.AgentStore
import net.solardepin.solarchik.agents.MintError
import net.solardepin.solarchik.agents.Minter
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.game.RunActivity
import net.solardepin.solarchik.ui.AgentsScreen
import net.solardepin.solarchik.ui.RunScreen
import net.solardepin.solarchik.ui.Screen
import net.solardepin.solarchik.ui.SettingsScreen
import net.solardepin.solarchik.ui.SolScreen
import net.solardepin.solarchik.ui.Ui
import net.solardepin.solarchik.ui.Ui.dp
import net.solardepin.solarchik.ui.YardScreen
import net.solardepin.solarchik.wallet.SolanaWallet
import net.solardepin.solarchik.wallet.WalletError

/** Single activity: five native tabs over one MWA sender. No WebView anywhere. */
class MainActivity : ComponentActivity() {
    enum class Tab(val label: Int, val icon: Int) {
        YARD(R.string.nav_yard, R.drawable.ic_nav_yard),
        RUN(R.string.nav_run, R.drawable.ic_nav_run),
        AGENTS(R.string.nav_agents, R.drawable.ic_nav_agents),
        SOL(R.string.nav_sol, R.drawable.ic_nav_sol),
        SETTINGS(R.string.nav_settings, R.drawable.ic_nav_settings),
    }

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    lateinit var wallet: SolanaWallet
        private set
    lateinit var sender: ActivityResultSender
        private set
    lateinit var save: GameSave
        private set
    lateinit var store: AgentStore
        private set
    lateinit var minter: Minter
        private set

    private val screens = LinkedHashMap<Tab, Screen>()
    private lateinit var content: FrameLayout
    private lateinit var nav: LinearLayout
    private lateinit var toastView: TextView
    private val navItems = HashMap<Tab, Pair<ImageView, TextView>>()
    private val main = Handler(Looper.getMainLooper())
    var current: Tab = Tab.YARD
        private set
    var topInset = 0
        private set
    var bottomInset = 0
        private set

    private val runLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        renderAll()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sender = ActivityResultSender(this)
        wallet = SolanaWallet(this)
        save = GameSave(this)
        store = AgentStore(this)
        minter = Minter(wallet, store)
        Ui.init(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(buildRoot())
        val start = savedInstanceState?.getString("tab")?.let { name -> Tab.entries.firstOrNull { it.name == name } } ?: Tab.YARD
        select(start)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("tab", current.name)
    }

    override fun onResume() {
        super.onResume()
        screens[current]?.onShow()
    }

    override fun onPause() {
        screens[current]?.onHide()
        super.onPause()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        scope.cancel()
        super.onDestroy()
    }

    private fun buildRoot(): View {
        val root = FrameLayout(this).apply { setBackgroundColor(Ui.BG) }
        content = FrameLayout(this)
        root.addView(content, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = android.graphics.drawable.LayerDrawable(
                arrayOf(
                    android.graphics.drawable.ColorDrawable(Ui.withAlpha(Ui.SURFACE, 0xF5)),
                ),
            )
            elevation = dp(12).toFloat()
        }
        val line = View(this).apply { setBackgroundColor(Ui.STROKE) }
        for (tab in Tab.entries) nav.addView(navItem(tab), LinearLayout.LayoutParams(0, dp(68), 1f))
        val navWrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(line, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
            addView(nav, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            setBackgroundColor(Ui.withAlpha(Ui.SURFACE, 0xF5))
        }
        root.addView(navWrap, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))

        toastView = Ui.text(this, "", 14f, Ui.TEXT, 700).apply {
            background = Ui.rounded(Ui.SURFACE2, dp(16).toFloat(), Ui.withAlpha(Ui.GOLD, 0x66), dp(1))
            setPadding(dp(16), dp(12), dp(16), dp(12))
            elevation = dp(16).toFloat()
            visibility = View.GONE
        }
        root.addView(
            toastView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
                leftMargin = dp(16); rightMargin = dp(16); bottomMargin = dp(84)
            },
        )

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            topInset = bars.top
            bottomInset = bars.bottom
            navWrap.setPadding(0, 0, 0, bars.bottom)
            (toastView.layoutParams as FrameLayout.LayoutParams).bottomMargin = dp(84) + bars.bottom
            screens.values.forEach { it.applyInsets() }
            insets
        }
        return root
    }

    private fun navItem(tab: Tab): View {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            isClickable = true
            background = Ui.ripple(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT), dp(20).toFloat(), 0x22F5C542)
            setOnClickListener { select(tab) }
            contentDescription = getString(tab.label)
        }
        val icon = ImageView(this).apply {
            setImageResource(tab.icon)
            setPadding(dp(14), dp(4), dp(14), dp(4))
        }
        val label = Ui.text(this, getString(tab.label), 11f, Ui.MUTED, 800).apply {
            gravity = Gravity.CENTER
            maxLines = 1
        }
        col.addView(icon, LinearLayout.LayoutParams(dp(56), dp(30)))
        col.addView(label, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        navItems[tab] = icon to label
        return col
    }

    fun select(tab: Tab) {
        if (screens.containsKey(current) && current != tab) screens[current]?.onHide()
        current = tab
        val screen = screens.getOrPut(tab) { create(tab) }
        content.removeAllViews()
        content.addView(screen.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        screen.applyInsets()
        for ((t, pair) in navItems) {
            val on = t == tab
            pair.first.setColorFilter(if (on) Ui.GOLD else Ui.MUTED)
            pair.first.background = if (on) Ui.rounded(Ui.withAlpha(Ui.GOLD, 0x24), dp(15).toFloat()) else null
            pair.second.setTextColor(if (on) Ui.GOLD else Ui.MUTED)
        }
        screen.onShow()
    }

    private fun create(tab: Tab): Screen = when (tab) {
        Tab.YARD -> YardScreen(this)
        Tab.RUN -> RunScreen(this)
        Tab.AGENTS -> AgentsScreen(this)
        Tab.SOL -> SolScreen(this)
        Tab.SETTINGS -> SettingsScreen(this)
    }

    fun renderAll() {
        screens.values.forEach { it.render() }
    }

    fun startRun() {
        runLauncher.launch(Intent(this, RunActivity::class.java))
    }

    fun openUrl(url: String) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }

    fun explorerTx(sig: String, cluster: String): String =
        if (cluster == "devnet") "https://explorer.solana.com/tx/$sig?cluster=devnet" else "https://explorer.solana.com/tx/$sig"

    fun explorerAddress(addr: String, cluster: String): String =
        if (cluster == "devnet") "https://explorer.solana.com/address/$addr?cluster=devnet" else "https://explorer.solana.com/address/$addr"

    fun toast(message: CharSequence) {
        toastView.text = message
        toastView.visibility = View.VISIBLE
        toastView.alpha = 0f
        toastView.translationY = dp(12).toFloat()
        toastView.animate().alpha(1f).translationY(0f).setDuration(180).start()
        main.removeCallbacksAndMessages(TOAST)
        main.postAtTime({
            toastView.animate().alpha(0f).setDuration(220).withEndAction { toastView.visibility = View.GONE }.start()
        }, TOAST, android.os.SystemClock.uptimeMillis() + 3600)
    }

    fun errorText(t: Throwable?): String = when (t) {
        is WalletError -> when (t.kind) {
            WalletError.Kind.NO_WALLET -> getString(R.string.err_no_wallet)
            WalletError.Kind.DECLINED -> getString(R.string.err_declined)
            WalletError.Kind.NETWORK -> getString(R.string.err_network)
            WalletError.Kind.FAILED -> getString(R.string.err_failed, (t.message ?: "").take(120))
        }
        is MintError -> when (t.kind) {
            MintError.Kind.FREE_USED -> getString(R.string.mint_err_free)
            MintError.Kind.PRO_MAINNET_OFF -> getString(R.string.mint_err_pro_off)
            MintError.Kind.TOO_BIG -> getString(R.string.mint_err_big)
        }
        is java.io.IOException -> getString(R.string.err_network)
        else -> getString(R.string.err_failed, (t?.message ?: "").take(120))
    }

    companion object {
        private val TOAST = Any()
    }
}
