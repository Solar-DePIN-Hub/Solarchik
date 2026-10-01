package net.solardepin.solarchik.ui

import android.content.Context
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.launch
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.sol.ChatTurn
import net.solardepin.solarchik.sol.DailyReport
import net.solardepin.solarchik.sol.Report
import net.solardepin.solarchik.sol.SolChat
import net.solardepin.solarchik.sol.SolChatStore
import net.solardepin.solarchik.sol.SolEars
import net.solardepin.solarchik.sol.SolVoice
import net.solardepin.solarchik.ui.Ui.dp

/** Sol: daily note from real numbers, chat with the friend worker, voice in and out (EN/UK). */
class SolScreen(host: MainActivity) : Screen(host) {
    private lateinit var bubble: TextView
    private lateinit var report: LinearLayout
    private lateinit var chatList: LinearLayout
    private lateinit var input: EditText
    private lateinit var status: TextView
    private lateinit var micBtn: TextView
    private val chat = SolChat()
    private val store = SolChatStore(host)
    private var voice: SolVoice? = null
    private var ears: SolEars? = null
    private var sending = false
    private var listening = false
    /** Sol's retelling of today's note, accepted only if it adds no number. */
    private var retold: Pair<String, String>? = null // day to text
    private var plainWhy: Int = 0
    private var retelling = false

    override fun build(): View = page {
        addView(Ui.display(ctx, ctx.getString(R.string.sol_title), 26f))
        addView(Ui.muted(ctx, ctx.getString(R.string.sol_sub), 14f))

        val stage = FrameLayout(ctx).apply {
            background = Ui.gradient(intArrayOf(Ui.blend(Ui.SURFACE2, Ui.CYAN, 0.18f), Ui.SURFACE), dp(26).toFloat(), android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(250))
        }
        stage.addView(Ui.image(ctx, R.drawable.buddy_happy), FrameLayout.LayoutParams(dp(150), dp(200), Gravity.BOTTOM or Gravity.END).apply {
            bottomMargin = dp(10); rightMargin = dp(10)
        })
        bubble = Ui.text(ctx, "", 14f, Ui.TEXT, 700).apply {
            background = Ui.rounded(Ui.withAlpha(Ui.BG, 0xD8), dp(18).toFloat(), Ui.withAlpha(Ui.CYAN, 0x66), dp(1))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            maxLines = 7
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        stage.addView(bubble, FrameLayout.LayoutParams(dp(205), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            topMargin = dp(16); leftMargin = dp(14)
        })
        addView(stage)

        report = Ui.card(ctx, accent = Ui.CYAN)
        addView(report)

        addView(Ui.card(ctx, accent = Ui.GOLD).apply {
            val head = Ui.row(ctx, gap = 12)
            head.addView(Ui.iconBadge(ctx, R.drawable.ic_nav_sol, Ui.GOLD, 36))
            head.addView(Ui.weight(Ui.h2(ctx, ctx.getString(R.string.chat_title))))
            head.addView(Ui.text(ctx, ctx.getString(R.string.chat_clear), 12f, Ui.MUTED, 700).apply {
                setPadding(dp(8), dp(6), dp(8), dp(6))
                setOnClickListener { store.clear(); render() }
            })
            addView(head)
            chatList = Ui.column(ctx, gap = 8)
            addView(Ui.top(chatList, 12))
            status = Ui.muted(ctx, "", 12f).apply { visibility = View.GONE }
            addView(Ui.top(status, 8))
            val row = Ui.row(ctx, gap = 8)
            input = EditText(ctx).apply {
                hint = ctx.getString(R.string.chat_hint)
                setHintTextColor(Ui.MUTED)
                setTextColor(Ui.TEXT)
                textSize = 15f
                typeface = Ui.tfMedium()
                background = Ui.rounded(Ui.SURFACE2, dp(16).toFloat(), Ui.STROKE, dp(1))
                setPadding(dp(14), dp(10), dp(14), dp(10))
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                imeOptions = EditorInfo.IME_ACTION_SEND
                maxLines = 3
                setOnEditorActionListener { _, id, ev ->
                    if (id == EditorInfo.IME_ACTION_SEND || ev?.keyCode == KeyEvent.KEYCODE_ENTER) { send(text.toString()); true } else false
                }
            }
            row.addView(input, LinearLayout.LayoutParams(0, dp(48), 1f))
            micBtn = round(Ui.CYAN) { toggleMic() }.apply { contentDescription = "mic" }
            micBtn.setCompoundDrawablesWithIntrinsicBounds(R.drawable.ic_mic, 0, 0, 0)
            micBtn.setPadding(dp(12), 0, 0, 0)
            row.addView(micBtn, LinearLayout.LayoutParams(dp(48), dp(48)))
            row.addView(round(Ui.GOLD) { send(input.text.toString()) }.apply {
                contentDescription = ctx.getString(R.string.chat_send)
                background = Ui.rounded(Ui.GOLD, dp(16).toFloat())
                setCompoundDrawablesWithIntrinsicBounds(R.drawable.ic_send, 0, 0, 0)
                setPadding(dp(13), 0, 0, 0)
            }, LinearLayout.LayoutParams(dp(48), dp(48)))
            addView(Ui.top(row, 12))
            addView(Ui.top(Ui.switchRow(ctx, ctx.getString(R.string.chat_voice), store.voiceOn) { _, on ->
                store.voiceOn = on
                if (!on) voice?.stop()
            }, 10))
        })

    }

    private fun round(color: Int, onClick: () -> Unit): TextView = Ui.text(ctx, "", 18f, Ui.TEXT, 800).apply {
        gravity = Gravity.CENTER
        background = Ui.rounded(Ui.withAlpha(color, 0x22), dp(16).toFloat(), Ui.withAlpha(color, 0x66), dp(1))
        isClickable = true
        setOnClickListener { onClick() }
    }

    override fun onShow() {
        render()
        if (MainActivity.tickerEnabled) retellOnce()
    }

    override fun onHide() {
        ears?.stop()
        listening = false
        voice?.stop()
    }

    private fun currentReport(): Report {
        val save = host.save
        return DailyReport.build(ctx, save.today(), save.liveStreak().streak, save.signedToday(), save.todayDistance(), save.feeProgress(), host.store.fees(), host.desk.state())
    }

    override fun render() {
        if (!this::report.isInitialized) return
        val today = host.save.today()
        val rep = currentReport()
        report.removeAllViews()
        val head = Ui.row(ctx)
        head.addView(Ui.weight(Ui.label(ctx, ctx.getString(R.string.report_title), Ui.CYAN)))
        report.addView(head)
        rep.lines.forEach { report.addView(Ui.top(Ui.body(ctx, "• $it"), 8)) }
        val told = retold?.takeIf { it.first == today }?.second
        if (told != null) {
            report.addView(Ui.top(Ui.label(ctx, ctx.getString(R.string.report_retold), Ui.GOLD), 12))
            report.addView(Ui.top(Ui.text(ctx, told, 14f, Ui.TEXT, 600), 4))
        } else if (plainWhy != 0) {
            report.addView(Ui.top(Ui.muted(ctx, ctx.getString(plainWhy), 12f), 12))
        }
        report.addView(Ui.top(Ui.button(ctx, ctx.getString(R.string.report_listen), Ui.Btn.SECONDARY, R.drawable.ic_nav_sol) {
            speak(told ?: rep.script)
        }, 12))

        val turns = store.turns()
        chatList.removeAllViews()
        if (turns.isEmpty()) chatList.addView(Ui.muted(ctx, ctx.getString(R.string.chat_empty), 12f))
        turns.takeLast(8).forEach { chatList.addView(bubbleView(it)) }
        bubble.text = turns.lastOrNull { it.role == "assistant" && !it.fallback }?.text ?: told ?: tipOfDay(ctx, today)
        micBtn.alpha = if (listening) 1f else 0.9f
        micBtn.background = Ui.rounded(if (listening) Ui.withAlpha(Ui.RED, 0x55) else Ui.withAlpha(Ui.CYAN, 0x22), dp(16).toFloat(), Ui.withAlpha(if (listening) Ui.RED else Ui.CYAN, 0x88), dp(1))
    }

    private fun bubbleView(t: ChatTurn): View {
        val mine = t.role == "user"
        val wrap = LinearLayout(ctx).apply { gravity = if (mine) Gravity.END else Gravity.START }
        val col = Ui.column(ctx)
        val tv = Ui.text(ctx, t.text, 14f, if (mine) Ui.INK else Ui.TEXT, 600).apply {
            background = if (mine) Ui.rounded(Ui.GOLD, dp(16).toFloat()) else Ui.rounded(Ui.SURFACE2, dp(16).toFloat(), Ui.STROKE, dp(1))
            setPadding(dp(12), dp(9), dp(12), dp(9))
        }
        col.addView(tv)
        if (t.fallback) col.addView(Ui.top(Ui.text(ctx, ctx.getString(R.string.chat_fallback), 10f, Ui.MUTED, 700), 2))
        if (t.local) col.addView(Ui.top(Ui.text(ctx, ctx.getString(R.string.chat_rules), 10f, Ui.GOLD, 700), 2))
        wrap.addView(col, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            if (mine) leftMargin = dp(48) else rightMargin = dp(48)
        })
        return wrap
    }

    fun send(raw: String) {
        val msg = raw.trim()
        if (msg.isEmpty() || sending) return
        val history = store.turns()
        store.add(ChatTurn("user", msg, System.currentTimeMillis()))
        input.setText("")
        net.solardepin.solarchik.sol.SolRules.answer(ctx, msg)?.let { rule ->
            store.add(ChatTurn("assistant", rule, System.currentTimeMillis(), local = true))
            render()
            speak(rule, auto = true)
            return
        }
        sending = true
        status.text = "…"
        status.visibility = View.VISIBLE
        render()
        host.scope.launch {
            val today = host.save.today()
            val r = chat.ask(msg, host.lang, store.playerId(), store.conversationId(today), history, "yard", currentReport().script)
            store.add(ChatTurn("assistant", r.text, System.currentTimeMillis(), fallback = r.fallback))
            sending = false
            status.visibility = View.GONE
            render()
            if (!r.fallback) speak(r.text, auto = true)
        }
    }

    /** Once per day: ask Sol to retell the note; keep it only if every number is from the note. */
    private fun retellOnce() {
        val today = host.save.today()
        if (retelling || retold?.first == today) return
        retelling = true
        val rep = currentReport()
        host.scope.launch {
            val r = chat.ask(rep.script, host.lang, store.playerId(), store.conversationId(today), emptyList(), "yard", rep.script)
            retelling = false
            plainWhy = when {
                r.offline || r.fallback -> R.string.report_plain_offline
                !SolChat.onlyKnownNumbers(r.text, rep.script) -> R.string.report_plain
                else -> 0
            }
            if (plainWhy == 0) retold = today to r.text
            render()
        }
    }

    private fun speak(text: String, auto: Boolean = false) {
        if (auto && !store.voiceOn) return
        val v = voice ?: SolVoice(host).also { voice = it }
        if (!v.speak(text, host.lang)) host.toast(ctx.getString(R.string.chat_tts_missing))
    }

    private fun toggleMic() {
        if (listening) {
            ears?.stop(); listening = false; status.visibility = View.GONE; render(); return
        }
        host.withPermission(android.Manifest.permission.RECORD_AUDIO) { ok ->
            if (!ok) { host.toast(ctx.getString(R.string.chat_mic_denied)); return@withPermission }
            val e = ears ?: SolEars(host).also { ears = it }
            if (!e.available()) { host.toast(ctx.getString(R.string.chat_mic_off)); return@withPermission }
            voice?.stop()
            listening = true
            status.text = ctx.getString(R.string.chat_listening)
            status.visibility = View.VISIBLE
            render()
            e.listen(host.lang, onPartial = { status.text = it }) { said ->
                listening = false
                status.visibility = View.GONE
                render()
                if (!said.isNullOrBlank()) send(said)
            }
        }
    }

    companion object {
        private val TIPS = intArrayOf(R.string.sol_tip_1, R.string.sol_tip_2, R.string.sol_tip_3, R.string.sol_tip_4, R.string.sol_tip_5)

        /** One stable tip per UTC day. */
        fun tipOfDay(ctx: Context, day: String): String {
            val h = day.fold(7) { acc, c -> acc * 31 + c.code } and 0x7fffffff
            return ctx.getString(TIPS[h % TIPS.size])
        }
    }
}
