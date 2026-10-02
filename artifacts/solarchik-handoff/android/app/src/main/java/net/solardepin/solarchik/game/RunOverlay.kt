package net.solardepin.solarchik.game

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import net.solardepin.solarchik.R
import net.solardepin.solarchik.game.run.ChapterId
import net.solardepin.solarchik.game.run.DeathKind
import net.solardepin.solarchik.game.run.Phase
import net.solardepin.solarchik.game.run.RunSim
import kotlin.math.ceil

/**
 * The DOM layer of the web runner, as Android views over the RunView surface: HUD (pause,
 * hearts, score, distance, time of day), hint line, countdown / chapter banner, Sol caption,
 * mic, music toggle, slide button, and the pause / result / CLOCK IN cards.
 * Tailwind sizes of RoofRun.tsx are kept 1:1 in dp. UI thread only.
 */
@SuppressLint("ViewConstructor", "ClickableViewAccessibility")
class RunOverlay(private val ctx: Context, private val actions: Actions) : FrameLayout(ctx) {

    interface Actions {
        fun pauseToggle()
        fun resume()
        fun yard()
        fun again()
        fun sign()
        fun musicToggle()
        fun mic()
        fun slideDown()
        fun slideUp()
    }

    companion object {
        val BG = Color.parseColor("#0B1620")
        val ELEVATED = Color.parseColor("#183041")
        val FG = Color.parseColor("#E8F0F5")
        val PRIMARY = Color.parseColor("#E8B931")
        val PRIMARY_FG = Color.parseColor("#0B1620")
        val MUTED = Color.parseColor("#8AA0AE")
        val OK = Color.parseColor("#6FBF4A")
        val DANGER = Color.parseColor("#E0564A")

        fun alpha(c: Int, a: Float) = Color.argb((a * 255).toInt(), Color.red(c), Color.green(c), Color.blue(c))

        fun chapterRes(id: ChapterId) = when (id) {
            ChapterId.SUNRISE -> R.string.ch_sunrise
            ChapterId.VILLAGE -> R.string.ch_village
            ChapterId.STORM -> R.string.ch_storm
            ChapterId.NIGHT -> R.string.ch_night
            ChapterId.SERPENT -> R.string.ch_serpent
        }

        /** Chapter banner (web shows the sim's English banner; localized here). */
        fun bannerRes(id: ChapterId) = when (id) {
            ChapterId.SUNRISE -> R.string.ch_banner_sunrise
            ChapterId.VILLAGE -> R.string.ch_banner_village
            ChapterId.STORM -> R.string.ch_banner_storm
            ChapterId.NIGHT -> R.string.ch_banner_night
            ChapterId.SERPENT -> R.string.ch_banner_serpent
        }
    }

    private val dm = resources.displayMetrics
    private fun dp(v: Float) = (v * dm.density).toInt()
    private fun dp(v: Int) = dp(v.toFloat())
    private val display: Typeface? = runCatching { ResourcesCompat.getFont(ctx, R.font.fredoka_semibold) }.getOrNull()
    private val body: Typeface? = runCatching { ResourcesCompat.getFont(ctx, R.font.nunito_bold) }.getOrNull()

    private fun box(color: Int, radius: Float) = GradientDrawable().apply { setColor(color); cornerRadius = radius * dm.density }

    private fun label(text: String = "", size: Float, color: Int = FG, face: Typeface? = display, track: Float = 0f) = TextView(ctx).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(color)
        typeface = face ?: Typeface.DEFAULT_BOLD
        letterSpacing = track
        includeFontPadding = false
    }

    private fun icon(res: Int, tint: Int, sizeDp: Int) = ImageView(ctx).apply {
        setImageResource(res)
        imageTintList = ColorStateList.valueOf(tint)
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    private fun iconButton(res: Int, bg: Drawable, sizeDp: Int, iconDp: Int, tint: Int, desc: String, onTap: () -> Unit) = FrameLayout(ctx).apply {
        background = bg
        contentDescription = desc
        isClickable = true
        isFocusable = true
        addView(icon(res, tint, iconDp), LayoutParams(dp(iconDp), dp(iconDp), Gravity.CENTER))
        setOnClickListener { onTap() }
        layoutParams = LayoutParams(dp(sizeDp), dp(sizeDp))
    }

    // ---- HUD ----
    private val hud = FrameLayout(ctx)
    private val pauseBtn: FrameLayout
    private val pauseIcon: ImageView
    private val hearts = LinearLayout(ctx)
    private val heartViews = ArrayList<ImageView>()
    private val shieldView: ImageView
    private val scoreV: TextView
    private val distV: TextView
    private val chapterV: TextView
    private val grindV: TextView
    private val flightV: TextView
    private val hintV: TextView
    private val gardenV: TextView
    private val countdownV: TextView
    private val announceV: TextView
    private val slideBtn: LinearLayout
    private val musicBtn: FrameLayout
    private val musicIcon: ImageView
    private val micBtn: FrameLayout
    private val captionRow: LinearLayout
    private val captionV: TextView
    val buddy: ImageView

    // ---- cards ----
    private val pauseLayer = FrameLayout(ctx)
    private val pauseStats: TextView
    private val deadLayer = FrameLayout(ctx)
    private val deadTitle: TextView
    private val deadReached: TextView
    private val deadStats: TextView
    private val clockLayer = FrameLayout(ctx)
    private val clockTitle: TextView
    private val clockStats: TextView
    private val signBtn: TextView

    private var last: RunHud? = null
    private var paused = false
    private var listening = false

    init {
        clipChildren = false
        addView(hud, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        // top-left: pause · hearts · score
        val tl = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        pauseBtn = iconButton(R.drawable.ic_run_pause, box(alpha(BG, 0.55f), 6f), 44, 20, FG, ctx.getString(R.string.run_pause)) { actions.pauseToggle() }
        pauseIcon = pauseBtn.getChildAt(0) as ImageView
        tl.addView(pauseBtn, LinearLayout.LayoutParams(dp(44), dp(44)).apply { marginEnd = dp(8) })
        hearts.apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = box(alpha(BG, 0.55f), 6f)
            setPadding(dp(10), dp(6), dp(10), dp(6))
        }
        for (i in 0 until RunSim.HEARTS) {
            val hv = icon(R.drawable.ic_run_heart, PRIMARY, 20)
            heartViews += hv
            hearts.addView(hv, LinearLayout.LayoutParams(dp(20), dp(20)).apply { if (i > 0) marginStart = dp(4) })
        }
        shieldView = icon(R.drawable.ic_run_shield, OK, 20)
        hearts.addView(shieldView, LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginStart = dp(4) })
        tl.addView(hearts, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(32)).apply { marginEnd = dp(8) })
        scoreV = label("0", 18f).apply {
            background = box(alpha(BG, 0.55f), 6f)
            setPadding(dp(10), 0, dp(10), 0)
            gravity = Gravity.CENTER
            minWidth = dp(32)
        }
        tl.addView(scoreV, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(32)))
        hud.addView(tl, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply { leftMargin = dp(12); topMargin = dp(12) })

        // top-right: distance · time of day · grind / flight
        val tr = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END }
        distV = label("0m", 18f).apply { background = box(alpha(BG, 0.8f), 6f); setPadding(dp(10), dp(6), dp(10), dp(6)) }
        tr.addView(distV, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        chapterV = label("", 11f, PRIMARY, track = 0.025f).apply { background = box(alpha(BG, 0.8f), 6f); setPadding(dp(8), dp(3), dp(8), dp(3)) }
        tr.addView(chapterV, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        grindV = label(ctx.getString(R.string.run_grind), 14f, BG).apply { background = box(OK, 6f); setPadding(dp(10), dp(4), dp(10), dp(4)); visibility = GONE }
        tr.addView(grindV, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        flightV = label("", 14f, PRIMARY_FG).apply { background = box(PRIMARY, 6f); setPadding(dp(10), dp(4), dp(10), dp(4)); visibility = GONE }
        tr.addView(flightV, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        hud.addView(tr, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply { rightMargin = dp(12); topMargin = dp(12) })

        // bottom hint / garden banner
        hintV = label(ctx.getString(R.string.run_hint), 14f, alpha(FG, 0.8f), track = 0.025f).apply { gravity = Gravity.CENTER }
        hud.addView(hintV, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(16) })
        gardenV = label(ctx.getString(R.string.run_garden), 16f, PRIMARY_FG).apply {
            background = box(PRIMARY, 8f); setPadding(dp(12), dp(8), dp(12), dp(8)); gravity = Gravity.CENTER; visibility = GONE
        }
        hud.addView(gardenV, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(16) })

        // countdown + chapter banner (positioned by percentage in onLayout)
        countdownV = label("", 60f, PRIMARY).apply { gravity = Gravity.CENTER; setShadowLayer(dp(2).toFloat(), 0f, dp(1).toFloat(), alpha(Color.BLACK, 0.25f)); visibility = GONE }
        hud.addView(countdownV, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.TOP))
        announceV = label("", 36f, PRIMARY, track = 0.025f).apply { gravity = Gravity.CENTER; setShadowLayer(dp(2).toFloat(), 0f, dp(1).toFloat(), alpha(Color.BLACK, 0.25f)); visibility = GONE }
        hud.addView(announceV, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.TOP))

        // Sol caption + mic + music
        captionRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM; visibility = GONE }
        buddy = ImageView(ctx).apply { scaleType = ImageView.ScaleType.FIT_END; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
        captionRow.addView(buddy, LinearLayout.LayoutParams(dp(32), dp(36)).apply { marginEnd = dp(6) })
        captionV = label("", 12f, FG, body).apply {
            background = box(alpha(BG, 0.8f), 16f); setPadding(dp(10), dp(6), dp(10), dp(6)); maxWidth = dp(240 - 38)
            setLineSpacing(0f, 1.2f); ellipsize = TextUtils.TruncateAt.END; maxLines = 4
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        captionRow.addView(captionV, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        hud.addView(captionRow, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply { leftMargin = dp(70); bottomMargin = dp(70) })

        micBtn = iconButton(R.drawable.ic_run_mic, GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(PRIMARY) }, 56, 24, PRIMARY_FG, ctx.getString(R.string.run_talk)) { actions.mic() }
        hud.addView(micBtn, LayoutParams(dp(56), dp(56), Gravity.BOTTOM or Gravity.START).apply { leftMargin = dp(12); bottomMargin = dp(67) })
        musicBtn = iconButton(R.drawable.ic_run_volume, box(alpha(BG, 0.55f), 6f), 44, 20, FG, ctx.getString(R.string.run_mute)) { actions.musicToggle() }
        musicIcon = musicBtn.getChildAt(0) as ImageView
        hud.addView(musicBtn, LayoutParams(dp(44), dp(44), Gravity.BOTTOM or Gravity.START).apply { leftMargin = dp(12); bottomMargin = dp(16) })

        // slide button (hold)
        slideBtn = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            background = box(alpha(BG, 0.75f), 16f)
            elevation = dp(6).toFloat()
            minimumWidth = dp(64)
            setPadding(dp(12), 0, dp(12), 0)
            contentDescription = ctx.getString(R.string.run_slide)
            isClickable = true
            addView(icon(R.drawable.ic_run_slide, FG, 20))
            addView(label(ctx.getString(R.string.run_slide), 14f).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(4) })
            setOnTouchListener { _, e ->
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> actions.slideDown()
                    MotionEvent.ACTION_UP -> actions.slideUp()
                    MotionEvent.ACTION_CANCEL -> actions.slideUp()
                }
                true
            }
            // TalkBack / switch access click: one slide press (touch uses the hold above)
            setOnClickListener { actions.slideDown(); actions.slideUp() }
        }
        hud.addView(slideBtn, LayoutParams(LayoutParams.WRAP_CONTENT, dp(64), Gravity.END or Gravity.TOP).apply { rightMargin = dp(12) })

        // ---- pause card ----
        pauseLayer.visibility = GONE
        pauseLayer.isClickable = true
        val pc = card()
        pc.addView(label(ctx.getString(R.string.run_paused), 14f, PRIMARY, track = 0.16f))
        pc.addView(label(ctx.getString(R.string.run_breath), 30f).apply { (layoutParams as? LinearLayout.LayoutParams)?.topMargin = dp(4) }, lp(top = 4))
        pauseStats = label("", 14f, MUTED, body)
        pc.addView(pauseStats, lp(top = 8))
        pc.addView(button(ctx.getString(R.string.run_resume), true, 48, 16f, R.drawable.ic_run_play) { actions.resume() }, lp(top = 20, h = 48))
        pc.addView(button(ctx.getString(R.string.run_yard), false, 48, 15f, R.drawable.ic_run_home) { actions.yard() }, lp(top = 8, h = 48))
        pauseLayer.addView(pc, LayoutParams(dp(384), LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        addView(pauseLayer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        // ---- result card (dead) ----
        deadLayer.visibility = GONE
        deadLayer.isClickable = true
        deadLayer.setBackgroundColor(alpha(Color.BLACK, 0.5f))
        val dc = card()
        dc.addView(label(ctx.getString(R.string.run_daily), 14f, PRIMARY, track = 0.16f))
        deadTitle = label("", 30f)
        dc.addView(deadTitle, lp(top = 4))
        deadReached = label("", 14f, PRIMARY)
        dc.addView(deadReached, lp(top = 4))
        deadStats = label("", 14f, MUTED, body)
        dc.addView(deadStats, lp(top = 8))
        dc.addView(button(ctx.getString(R.string.run_again_full), true, 64, 24f, null) { actions.again() }, lp(top = 20, h = 64))
        dc.addView(button(ctx.getString(R.string.run_yard), false, 48, 15f, R.drawable.ic_run_home) { actions.yard() }, lp(top = 8, h = 48))
        deadLayer.addView(dc, LayoutParams(dp(384), LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        addView(deadLayer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        // ---- CLOCK IN card (goal reached) ----
        clockLayer.visibility = GONE
        clockLayer.isClickable = true
        clockLayer.setBackgroundColor(alpha(Color.BLACK, 0.5f))
        val cc = card()
        cc.addView(label(ctx.getString(R.string.run_goal_label, GameSave.GOAL_M), 14f, PRIMARY, track = 0.16f))
        clockTitle = label("", 30f)
        cc.addView(clockTitle, lp(top = 4))
        clockStats = label("", 14f, MUTED, body)
        cc.addView(clockStats, lp(top = 8))
        signBtn = button(ctx.getString(R.string.run_sign_btn), true, 64, 24f, null) { actions.sign() }
        cc.addView(signBtn, lp(top = 20, h = 64))
        cc.addView(button(ctx.getString(R.string.run_again_full), false, 48, 15f, null) { actions.again() }, lp(top = 8, h = 48))
        cc.addView(button(ctx.getString(R.string.run_yard), false, 48, 15f, R.drawable.ic_run_home) { actions.yard() }, lp(top = 8, h = 48))
        clockLayer.addView(cc, LayoutParams(dp(384), LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        addView(clockLayer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    private fun lp(top: Int = 0, h: Int = 0) = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (h > 0) dp(h) else LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

    private fun card() = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = box(BG, 12f)
        elevation = dp(12).toFloat()
        setPadding(dp(24), dp(24), dp(24), dp(24))
    }

    private fun button(text: String, primary: Boolean, hDp: Int, size: Float, iconRes: Int?, onTap: () -> Unit): TextView = label(text, size, if (primary) PRIMARY_FG else FG, if (primary) display else body).apply {
        gravity = Gravity.CENTER
        background = box(if (primary) PRIMARY else ELEVATED, if (primary) 8f else 6f)
        minHeight = dp(hDp)
        isClickable = true
        isFocusable = true
        if (iconRes != null) {
            val d = ResourcesCompat.getDrawable(resources, iconRes, null)?.mutate()
            d?.setTint(if (primary) PRIMARY_FG else FG)
            d?.setBounds(0, 0, dp(16), dp(16))
            setCompoundDrawablesRelative(d, null, null, null)
            compoundDrawablePadding = dp(8)
            // keep icon + label centred together
            val w = paint.measureText(text) + dp(24)
            setPadding(0, 0, 0, 0)
            post { val pad = ((width - w) / 2).toInt().coerceAtLeast(0); setPadding(pad, 0, pad, 0) }
        }
        setOnClickListener { onTap() }
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        super.onLayout(changed, l, t, r, b)
        val h = b - t
        // web: countdown top 28%, banner top 26%, slide button centred on 48%
        countdownV.translationY = h * 0.28f - countdownV.top
        announceV.translationY = h * 0.26f - announceV.top
        slideBtn.translationY = h * 0.48f - slideBtn.height / 2f - slideBtn.top
    }

    /** Safe-area insets (display cutout) for the HUD, like env(safe-area-inset-*). */
    fun setSafeInsets(left: Int, top: Int, right: Int, bottom: Int) {
        hud.setPadding(left, top, right, bottom)
    }

    fun setMuted(muted: Boolean) {
        musicIcon.setImageResource(if (muted) R.drawable.ic_run_volume_off else R.drawable.ic_run_volume)
        musicBtn.contentDescription = ctx.getString(if (muted) R.string.run_unmute else R.string.run_mute)
    }

    fun setCaption(text: String) {
        captionV.text = text
        captionRow.visibility = if (text.isEmpty()) GONE else VISIBLE
    }

    fun setListening(on: Boolean) {
        listening = on
        (micBtn.background as? GradientDrawable)?.setColor(if (on) DANGER else PRIMARY)
        micBtn.contentDescription = ctx.getString(if (on) R.string.run_talk_stop else R.string.run_talk)
        (micBtn.getChildAt(0) as ImageView).imageTintList = ColorStateList.valueOf(if (on) FG else PRIMARY_FG)
    }

    fun setMicAvailable(on: Boolean) { micBtn.tag = on; refreshVisibility() }

    fun setPaused(p: Boolean) {
        paused = p
        pauseIcon.setImageResource(if (p) R.drawable.ic_run_play else R.drawable.ic_run_pause)
        pauseBtn.contentDescription = ctx.getString(if (p) R.string.run_resume else R.string.run_pause)
        last?.let { pauseStats.text = ctx.getString(R.string.run_stats, it.meters, it.score, it.suns) }
        refreshVisibility()
    }

    private fun refreshVisibility() {
        val h = last
        val dead = h?.phase == Phase.DEAD
        val clock = h?.clockOpen == true
        val live = h != null && (h.phase == Phase.RUNNING || h.phase == Phase.COUNTDOWN) && !clock
        pauseBtn.visibility = if (dead) GONE else VISIBLE // web: shown unless dead (under the CLOCK IN card)
        pauseLayer.visibility = if (paused && !dead && !clock) VISIBLE else GONE
        slideBtn.visibility = if (!dead && !paused && h?.bonus != true && !clock) VISIBLE else GONE
        micBtn.visibility = if (live && !paused && micBtn.tag != false) VISIBLE else GONE
        hintV.visibility = if (h?.phase == Phase.RUNNING && !h.bonus && !clock) VISIBLE else GONE
        gardenV.visibility = if (h?.bonus == true) VISIBLE else GONE
        countdownV.visibility = if (h?.phase == Phase.COUNTDOWN && !paused) VISIBLE else GONE
        announceV.visibility = if (h != null && h.announceOn && h.phase == Phase.RUNNING && h.announce.isNotEmpty()) VISIBLE else GONE
        deadLayer.visibility = if (dead && !clock && h!!.meters < GameSave.GOAL_M) VISIBLE else GONE
        clockLayer.visibility = if (clock) VISIBLE else GONE
    }

    fun bind(h: RunHud, signed: Boolean = false) {
        last = h
        for (i in heartViews.indices) {
            val on = i < h.hearts
            heartViews[i].setImageResource(if (on) R.drawable.ic_run_heart else R.drawable.ic_run_heart_empty)
            heartViews[i].imageTintList = ColorStateList.valueOf(if (on) PRIMARY else alpha(FG, 0.25f))
        }
        shieldView.visibility = if (h.shield > 0) VISIBLE else GONE
        hearts.contentDescription = ctx.getString(if (h.shield > 0) R.string.run_hearts_shield_a11y else R.string.run_hearts_a11y, h.hearts)
        scoreV.text = String.format(java.util.Locale.ROOT, "%d", h.score) // web: plain tabular digits
        scoreV.contentDescription = ctx.getString(R.string.run_score_a11y, h.score)
        distV.text = ctx.getString(R.string.run_meters, h.meters)
        chapterV.text = ctx.getString(chapterRes(h.chapter))
        grindV.visibility = if (h.grind && !h.bonus) VISIBLE else GONE
        flightV.visibility = if (h.bonus) VISIBLE else GONE
        if (h.bonus) flightV.text = ctx.getString(R.string.run_flight, ceil(h.bonusLeft).toInt())
        countdownV.text = if (h.countdown > 0.28) ceil(h.countdown).toInt().toString() else ctx.getString(R.string.run_go)
        announceV.text = if (h.announce.isEmpty()) "" else ctx.getString(bannerRes(h.chapter))
        if (h.phase == Phase.DEAD || h.clockOpen) {
            deadTitle.text = ctx.getString(if (h.death == DeathKind.HIT) R.string.run_hit else R.string.run_fell)
            deadReached.text = ctx.getString(R.string.run_reached, ctx.getString(chapterRes(h.chapter)))
            val heat = ctx.getString(R.string.run_stats_heat, h.meters, h.score, h.suns, h.maxCombo)
            deadStats.text = if (h.didBonus) ctx.getString(R.string.run_stats_garden, heat) else heat
            clockStats.text = ctx.getString(R.string.run_stats, h.meters, h.score, h.suns)
            setSigned(signed)
        }
        refreshVisibility()
    }

    fun setSigned(signed: Boolean) {
        clockTitle.text = ctx.getString(if (signed) R.string.run_signed_title else R.string.run_sign_now)
        signBtn.text = ctx.getString(if (signed) R.string.run_signed_btn else R.string.run_sign_btn)
        signBtn.isEnabled = !signed
        signBtn.alpha = if (signed) 0.6f else 1f
    }
}
