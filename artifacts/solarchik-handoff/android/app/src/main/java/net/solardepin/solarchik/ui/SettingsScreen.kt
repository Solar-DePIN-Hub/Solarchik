package net.solardepin.solarchik.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.View
import android.widget.CompoundButton
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.solardepin.solarchik.BuildConfig
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.core.SolarchikConfig
import net.solardepin.solarchik.ui.Ui.dp

class SettingsScreen(host: MainActivity) : Screen(host) {
    private lateinit var walletBox: LinearLayout
    private lateinit var networkBody: TextView
    private var devnetSwitch: Switch? = null
    private var balance: Double? = null
    private var airdropping = false
    private lateinit var notesState: LinearLayout

    override fun build(): View = page {
        addView(Ui.display(ctx, ctx.getString(R.string.settings_title), 26f))

        walletBox = Ui.card(ctx, accent = Ui.GOLD)
        addView(walletBox)

        addView(section(R.string.settings_network, R.drawable.ic_nav_sol, Ui.CYAN).apply {
            networkBody = Ui.muted(ctx)
            addView(Ui.top(networkBody, 10))
            if (host.wallet.isSeeker) {
                val sw = switchRow(ctx.getString(R.string.settings_force_devnet), host.wallet.forceDevnet) { _, on ->
                    host.wallet.forceDevnet = on
                    balance = null
                    host.renderAll()
                }
                addView(Ui.top(sw, 10))
            }
        })

        addView(section(R.string.settings_fees, R.drawable.ic_gift, Ui.GOLD).apply {
            addView(Ui.top(Ui.body(ctx, ctx.getString(
                R.string.settings_fees_body,
                Fmt.sol(SolarchikConfig.PRO_PRICE_SOL),
                Fmt.sol(SolarchikConfig.FREE_FEE_RATE * 100, 2),
                Fmt.sol(SolarchikConfig.ROYALTY_BPS / 100.0, 2),
                SolarchikConfig.STREAK_SHORT_DAYS,
                SolarchikConfig.WINDOW_SHORT_HOURS.toInt(),
                SolarchikConfig.STREAK_LONG_DAYS,
                SolarchikConfig.WINDOW_LONG_DAYS.toInt(),
            )).apply { setLineSpacing(0f, 1.3f) }, 10))
            addView(Ui.top(Ui.label(ctx, ctx.getString(R.string.settings_treasury)), 12))
            addView(Ui.top(Ui.text(ctx, SolarchikConfig.TREASURY, 12f, Ui.CYAN, 700).apply {
                setOnClickListener { copy(SolarchikConfig.TREASURY) }
            }, 4))
        })

        addView(section(R.string.settings_notes, R.drawable.ic_timer, Ui.PURPLE).apply {
            notesState = Ui.column(ctx)
            addView(Ui.top(notesState, 8))
            listOf(
                "noteStreak" to R.string.note_streak_toggle,
                "noteReward" to R.string.note_reward_toggle,
                "noteWindow" to R.string.note_window_toggle,
                "noteReport" to R.string.note_report_toggle,
            ).forEach { (key, label) ->
                addView(Ui.top(switchRow(ctx.getString(label), host.save.noteOn(key)) { _, on ->
                    host.save.setNote(key, on)
                    if (on) host.requestNotifications(fromUser = false)
                }, 8))
            }
        })

        addView(section(R.string.settings_language, R.drawable.ic_nav_yard, Ui.GREEN).apply {
            addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.settings_language_body)), 8))
            if (Build.VERSION.SDK_INT >= 33) {
                addView(Ui.top(Ui.button(ctx, ctx.getString(R.string.settings_language_open), Ui.Btn.GHOST) {
                    runCatching {
                        host.startActivity(Intent(Settings.ACTION_APP_LOCALE_SETTINGS, Uri.parse("package:" + ctx.packageName)))
                    }
                }, 12))
            }
        })

        addView(section(R.string.settings_about, R.drawable.ic_launcher, Ui.GOLD, tint = false).apply {
            addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.settings_about_body, BuildConfig.VERSION_NAME)), 8))
        })
    }

    private fun section(title: Int, icon: Int, color: Int, tint: Boolean = true): LinearLayout = Ui.card(ctx).apply {
        val r = Ui.row(ctx, gap = 12)
        if (tint) r.addView(Ui.iconBadge(ctx, icon, color, 36))
        else r.addView(Ui.image(ctx, icon), LinearLayout.LayoutParams(dp(36), dp(36)))
        r.addView(Ui.weight(Ui.h2(ctx, ctx.getString(title))))
        addView(r)
    }

    private fun switchRow(label: String, on: Boolean, cb: (CompoundButton, Boolean) -> Unit): View {
        val r = Ui.row(ctx)
        r.addView(Ui.weight(Ui.body(ctx, label)))
        val sw = Switch(ctx).apply {
            isChecked = on
            thumbTintList = android.content.res.ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(Ui.GOLD, Ui.MUTED),
            )
            trackTintList = android.content.res.ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(Ui.withAlpha(Ui.GOLD, 0x66), Ui.STROKE),
            )
            setOnCheckedChangeListener(cb)
        }
        r.addView(sw)
        return r
    }

    override fun onShow() {
        render()
        refreshBalance()
    }

    private fun refreshBalance() {
        if (!host.wallet.connected) return
        host.scope.launch {
            host.wallet.balanceSol().onSuccess { balance = it; render() }
        }
    }

    override fun render() {
        if (!this::walletBox.isInitialized) return
        renderNotes()
        val w = host.wallet
        networkBody.text = ctx.getString(
            R.string.join_dot,
            ctx.getString(if (w.mainnet) R.string.network_mainnet else R.string.network_devnet),
            ctx.getString(if (w.isSeeker) R.string.settings_network_seeker else R.string.settings_network_other),
        )

        walletBox.removeAllViews()
        val head = Ui.row(ctx, gap = 12)
        head.addView(Ui.iconBadge(ctx, R.drawable.ic_wallet, Ui.GOLD, 36))
        head.addView(Ui.weight(Ui.h2(ctx, ctx.getString(R.string.settings_wallet))))
        head.addView(Ui.pill(ctx, w.clusterName, if (w.mainnet) Ui.GREEN else Ui.CYAN))
        walletBox.addView(head)
        if (!w.connected) {
            walletBox.addView(Ui.top(Ui.muted(ctx, ctx.getString(R.string.settings_wallet_none)), 10))
            walletBox.addView(Ui.top(Ui.button(ctx, ctx.getString(R.string.wallet_connect), Ui.Btn.PRIMARY, R.drawable.ic_wallet) { connect() }, 14))
            return
        }
        walletBox.addView(Ui.top(Ui.text(ctx, w.address, 13f, Ui.CYAN, 700).apply { setOnClickListener { copy(w.address) } }, 12))
        val balRow = Ui.row(ctx)
        balRow.addView(Ui.weight(Ui.label(ctx, ctx.getString(R.string.settings_balance))))
        balRow.addView(Ui.text(ctx, balance?.let { ctx.getString(R.string.sol_unit, Fmt.sol(it)) } ?: "—", 22f, Ui.TEXT, 900).apply {
            setOnClickListener { refreshBalance() }
        })
        walletBox.addView(Ui.top(balRow, 12))
        if (!w.mainnet) {
            val label = if (airdropping) ctx.getString(R.string.settings_airdrop_busy) else ctx.getString(R.string.settings_airdrop, Fmt.sol(SolarchikConfig.AIRDROP_SOL))
            val b = Ui.button(ctx, label, Ui.Btn.SECONDARY, R.drawable.ic_gift) { airdrop() }
            Ui.setEnabled(b, !airdropping)
            walletBox.addView(Ui.top(b, 14))
        }
        val actions = Ui.row(ctx, gap = 10)
        actions.addView(Ui.weight(Ui.button(ctx, ctx.getString(R.string.open_explorer), Ui.Btn.GHOST) {
            host.openUrl(host.explorerAddress(w.address, w.clusterName))
        }))
        actions.addView(Ui.weight(Ui.button(ctx, ctx.getString(R.string.settings_disconnect), Ui.Btn.GHOST) {
            w.forget()
            balance = null
            host.renderAll()
        }))
        walletBox.addView(Ui.top(actions, 10))
    }

    private fun renderNotes() {
        notesState.removeAllViews()
        val ok = net.solardepin.solarchik.notify.Notes.allowed(ctx)
        notesState.addView(Ui.muted(ctx, ctx.getString(R.string.notes_how), 12f))
        if (ok) {
            notesState.addView(Ui.top(Ui.pill(ctx, ctx.getString(R.string.notes_allowed), Ui.GREEN, R.drawable.ic_check), 8))
        } else {
            notesState.addView(Ui.top(Ui.text(ctx, ctx.getString(R.string.notes_blocked), 13f, Ui.AMBER, 700), 8))
            notesState.addView(Ui.top(Ui.button(ctx, ctx.getString(R.string.notes_allow), Ui.Btn.SECONDARY, R.drawable.ic_timer) {
                host.requestNotifications(fromUser = true)
            }, 10))
        }
    }

    private fun connect() {
        host.scope.launch {
            host.wallet.connect(host.sender)
                .onSuccess { refreshBalance() }
                .onFailure { host.toast(host.errorText(it)) }
            host.renderAll()
        }
    }

    private fun airdrop() {
        if (airdropping || host.wallet.mainnet) return
        airdropping = true
        render()
        host.scope.launch {
            host.wallet.airdrop()
                .onSuccess {
                    host.toast(ctx.getString(R.string.settings_airdrop_ok))
                    delay(4000)
                    host.wallet.balanceSol().onSuccess { b -> balance = b }
                }
                .onFailure { host.toast(ctx.getString(R.string.settings_airdrop_fail)) }
            airdropping = false
            render()
        }
    }

    private fun copy(text: String) {
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("address", text))
        host.toast(ctx.getString(R.string.copied))
    }
}
