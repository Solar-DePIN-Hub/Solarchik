package net.solardepin.solarchik.game

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import net.solardepin.solarchik.R
import net.solardepin.solarchik.game.run.BanterKind
import net.solardepin.solarchik.game.run.Ev
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunAudio
import net.solardepin.solarchik.game.run.RunBanter
import net.solardepin.solarchik.game.run.ScriptLine
import net.solardepin.solarchik.sol.SolChat
import net.solardepin.solarchik.sol.SolChatStore
import net.solardepin.solarchik.sol.SolEars
import net.solardepin.solarchik.sol.SolRules
import net.solardepin.solarchik.sol.SolVoice
import net.solardepin.solarchik.core.StreakRules

/**
 * Port of the web RunRadio: Sol talks during the run (a cheer at the start, a line on a fall,
 * scripted moments like the last heart, one every ~35 s) and the mic button asks Sol something
 * mid-run (only while paused; see RunActivity). Every line is live AI (SolChat, scene "run") from a
 * cue written in the app language, so the reply comes back in that language. Only when Sol is
 * unreachable does the line fall back to the runBanter packs / scripted strings, tagged "Offline".
 * Spoken with Sol's neural voice (system TTS offline) and shown as a small caption.
 * UI thread only.
 */
class RunRadio(
    private val context: Context,
    private val scope: CoroutineScope,
    private val lang: String,
    private val audio: RunAudio?,
    private val onCaption: (String) -> Unit,
    private val onListening: (Boolean) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val chat = SolChat()
    private val store = SolChatStore(context)
    private var voice: SolVoice? = null
    private var ears: SolEars? = null
    private var last: RunHud? = null
    private var started = false
    private var lastBanter = 0L
    private var banterAfter = 0L
    private var chatOpen = false
    private var chatTurn = 0
    private var talkingUntil = 0L
    private var lastHeartSaid = false
    var live = false
    var paused = false
        set(v) { field = v; if (v) hush() }
    var listening = false
        private set
    private var heard = ""

    private val clearCaption = Runnable { onCaption("") }
    private val unduck = Runnable { audio?.duck(false) }
    private val periodic = object : Runnable {
        override fun run() {
            val h = last
            if (live && !paused && h != null && h.phase == Phase.RUNNING) banter(RunBanter.periodicKind(h.bonus, h.combo, h.hearts), h)
            main.postDelayed(this, 35_000)
        }
    }
    private val listenTimeout = Runnable { if (listening) stopListen() }

    fun begin() {
        started = false
        lastHeartSaid = false
        main.removeCallbacks(periodic)
        main.postDelayed(periodic, 35_000)
    }

    private fun show(text: String) {
        onCaption(text)
        main.removeCallbacks(clearCaption)
        main.postDelayed(clearCaption, (2600L + 45L * text.length).coerceAtMost(5200L))
    }

    private fun hush() {
        talkingUntil = 0
        voice?.stop()
        audio?.duck(false)
    }

    private fun speak(text: String, offline: Boolean = false) {
        val spoken = SolRules.tidy(text).trim()
        if (spoken.isEmpty()) return
        hush()
        show(if (offline) context.getString(R.string.run_offline_tag) + " · " + spoken else spoken)
        val ms = (55L * spoken.split(Regex("\\s+")).size + 400).coerceAtMost(9000)
        talkingUntil = System.currentTimeMillis() + ms
        audio?.duck(true)
        main.removeCallbacks(unduck)
        main.postDelayed(unduck, ms)
        val v = voice ?: SolVoice(context).also { voice = it }
        v.speak(spoken, lang)
    }

    private fun talking() = System.currentTimeMillis() < talkingUntil
    private fun inPlayerChat() = chatOpen || System.currentTimeMillis() < banterAfter

    private fun context(h: RunHud) = RunBanter.context(h.meters, h.chapter, h.combo, h.suns, h.hearts, lang)

    /** Game events of one step plus the HUD after it. */
    fun push(events: List<Ev>, hud: RunHud) {
        last = hud
        val line = RunBanter.scripted(hud.meters.toDouble(), hud.death, hud.hearts, events, GameSave.GOAL_M, lastHeartSaid)
        if (line == ScriptLine.LAST_HEART) lastHeartSaid = true
        if (line != null) scripted(line, hud)
        if (hud.phase == Phase.RUNNING && !started) {
            started = true
            banter(BanterKind.GO, hud)
        }
        for (ev in events) {
            if (line != null && ev == Ev.DEAD) continue
            RunBanter.eventToBanter(ev)?.let { banter(it, hud) }
        }
    }

    fun onHud(hud: RunHud) {
        last = hud
        if (hud.phase == Phase.RUNNING && !started) {
            started = true
            banter(BanterKind.GO, hud)
        }
    }

    /** Scripted moment: live AI line from a localized cue; the scripted string only offline. */
    private fun scripted(line: ScriptLine, hud: RunHud) {
        if (!live || listening || inPlayerChat()) return
        val cue = when (line) {
            ScriptLine.CLOCK_READY -> context.getString(R.string.run_cue_clock_ready, GameSave.GOAL_M)
            ScriptLine.FIRST_ROOF -> context.getString(R.string.run_cue_first_roof)
            ScriptLine.LAST_HEART -> context.getString(R.string.run_cue_last_heart)
        }
        lastBanter = System.currentTimeMillis()
        talkingUntil = System.currentTimeMillis() + 2500 // hold other banter until the reply lands
        scope.launch {
            val r = runCatching { ask(cue, hud) }.getOrNull()
            if (inPlayerChat() || paused && line == ScriptLine.LAST_HEART) return@launch
            if (r != null && !r.fallback && r.text.isNotBlank()) speak(r.text) else speak(scriptText(line), offline = true)
        }
    }

    private fun scriptText(line: ScriptLine): String = when (line) {
        ScriptLine.CLOCK_READY -> context.getString(R.string.banter_clock_ready, GameSave.GOAL_M)
        ScriptLine.FIRST_ROOF -> context.getString(R.string.banter_first_roof)
        ScriptLine.LAST_HEART -> context.getString(R.string.banter_last_heart)
    }

    private fun banter(kind: BanterKind, hud: RunHud) {
        if (!live || paused || listening || inPlayerChat()) return
        val now = System.currentTimeMillis()
        if (kind != BanterKind.GO && kind != BanterKind.DEAD && now - lastBanter < 32_000) return
        if (talking() && kind != BanterKind.DEAD) return
        val cue = cueFor(kind, hud)
        lastBanter = now
        scope.launch {
            val r = runCatching { ask(cue, hud) }.getOrNull()
            if (inPlayerChat() || paused && kind != BanterKind.DEAD) return@launch
            if (r != null && !r.fallback && r.text.isNotBlank()) speak(r.text)
            else RunBanter.pick(kind, lang, hud.chapter).takeIf { it.isNotEmpty() }?.let { speak(it, offline = true) }
        }
    }

    /** The event in the app language (an English cue made Sol answer a Ukrainian player in English). */
    private fun cueFor(kind: BanterKind, h: RunHud): String = when (kind) {
        BanterKind.GO -> context.getString(R.string.run_cue_go)
        BanterKind.DEAD -> context.getString(R.string.run_cue_dead, h.meters)
        BanterKind.BONUS -> context.getString(R.string.run_cue_bonus)
        BanterKind.COMBO -> context.getString(R.string.run_cue_combo, h.combo)
        BanterKind.HURT -> context.getString(R.string.run_cue_hurt, h.hearts)
        else -> context.getString(R.string.run_cue_progress, h.meters)
    }

    private suspend fun ask(message: String, hud: RunHud?) = chat.ask(
        message, lang, store.playerId(), store.conversationId(StreakRules.dayKey(System.currentTimeMillis())),
        store.turns().takeLast(6), scene = "run", context = hud?.let { context(it) }.orEmpty(),
    )

    // ---- mic (web startListen / stopListen) ----

    /** Call after RECORD_AUDIO was granted. */
    fun startListen() {
        if (paused || !live || listening) return
        val e = ears ?: SolEars(context).also { ears = it }
        if (!e.available()) return
        chatTurn += 1
        chatOpen = true
        hush()
        heard = ""
        listening = true
        onListening(true)
        show(context.getString(R.string.run_listening))
        audio?.play("tick")
        val turn = chatTurn
        e.listen(lang, onPartial = { heard = it }) { text ->
            if (turn != chatTurn || !listening) return@listen
            listening = false
            onListening(false)
            main.removeCallbacks(listenTimeout)
            val said = text?.takeIf { it.isNotBlank() } ?: heard
            if (said.isNotBlank()) askPlayer(said) else endChat(turn, false)
        }
        main.removeCallbacks(listenTimeout)
        main.postDelayed(listenTimeout, 5000)
    }

    fun stopListen() {
        if (!listening) return
        listening = false
        onListening(false)
        main.removeCallbacks(listenTimeout)
        ears?.stop()
        val said = heard.trim()
        heard = ""
        if (said.isNotEmpty()) askPlayer(said) else endChat(chatTurn, false)
    }

    private fun askPlayer(text: String) {
        val turn = chatTurn
        chatOpen = true
        show(text)
        audio?.play("tick")
        scope.launch {
            val r = runCatching { ask(text, last) }.getOrNull()
            if (turn != chatTurn) return@launch
            if (r == null) audio?.play("hurt") else speak(r.text)
            endChat(turn)
        }
    }

    private fun endChat(turn: Int, cooldown: Boolean = true) {
        if (turn != chatTurn) return
        chatOpen = false
        if (cooldown) {
            banterAfter = System.currentTimeMillis() + 30_000
            lastBanter = System.currentTimeMillis()
        }
    }

    fun shutdown() {
        main.removeCallbacksAndMessages(null)
        ears?.stop()
        voice?.shutdown()
    }
}
