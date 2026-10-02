package net.solardepin.solarchik.ui

import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import net.solardepin.solarchik.MainActivity
import net.solardepin.solarchik.R
import net.solardepin.solarchik.game.ClockIn
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.game.GearNames
import net.solardepin.solarchik.game.Quest
import net.solardepin.solarchik.game.RunGarage
import net.solardepin.solarchik.game.RunPreview
import net.solardepin.solarchik.game.RunQuests
import net.solardepin.solarchik.game.run.RunSkin
import net.solardepin.solarchik.ui.Ui.dp

/**
 * Run tab lobby: a live frame of the run with the equipped gear, start, stats, today's quests,
 * the shop (every robot and roof skin of the web shop: preview, buy with suns, equip) and the
 * milestone track.
 */
class RunScreen(host: MainActivity) : Screen(host) {
    private val garage by lazy { RunGarage(ctx) }
    private val quests by lazy { RunQuests(ctx, garage) }

    private lateinit var stage: FrameLayout
    private lateinit var preview: ImageView
    private lateinit var lastV: TextView
    private lateinit var bestV: TextView
    private lateinit var scoreV: TextView
    private lateinit var modV: TextView
    private lateinit var balanceV: TextView
    private lateinit var modLine: TextView
    private lateinit var unlocked: TextView
    private lateinit var start: TextView
    private lateinit var questRows: LinearLayout
    private lateinit var chestV: TextView
    private lateinit var shopTabs: FrameLayout
    private lateinit var shopCount: TextView
    private lateinit var tiles: LinearLayout
    private lateinit var itemName: TextView
    private lateinit var itemHint: TextView
    private lateinit var itemBtn: TextView
    private lateinit var milestoneRows: LinearLayout
    private lateinit var shelf: HorizontalScrollView

    private var tab = 0 // 0 robots, 1 roof skins
    private var pickRobot: String? = null
    private var pickSkin: String? = null
    private var previewKey = ""
    private var shelfPlaced = false

    override fun build(): View = page {
        addView(Ui.display(ctx, ctx.getString(R.string.run_title), 26f))
        addView(Ui.muted(ctx, ctx.getString(R.string.run_sub, GameSave.GOAL_M), 14f))

        // a real frame of the run (the game's own renderer, equipped gear), not concept art
        stage = FrameLayout(ctx).apply {
            background = GradientDrawable().apply {
                setColor(Ui.SURFACE); cornerRadius = dp(26).toFloat(); setStroke(dp(1), Ui.STROKE)
            }
            clipToOutline = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(260))
            contentDescription = ctx.getString(R.string.run_preview_a11y)
        }
        val radius = dp(26).toFloat()
        preview = object : ImageView(ctx) {
            private val clip = Path()
            override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
                super.onSizeChanged(w, h, ow, oh)
                clip.reset()
                clip.addRoundRect(0f, 0f, w.toFloat(), h.toFloat(), radius, radius, Path.Direction.CW)
                if (w > 0 && h > 0) post { renderPreview() }
            }
            override fun onDraw(canvas: Canvas) {
                canvas.save()
                canvas.clipPath(clip) // rounded card corners, also without hardware outline clipping
                super.onDraw(canvas)
                canvas.restore()
            }
        }.apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        stage.addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        modV = Ui.pill(ctx, "", Ui.GOLD, icon = R.drawable.ic_nav_sol, filled = true)
        stage.addView(modV, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            topMargin = dp(14); leftMargin = dp(14)
        })
        balanceV = sunChip(16f)
        stage.addView(balanceV, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(12); rightMargin = dp(12)
        })
        addView(stage)

        start = Ui.button(ctx, ctx.getString(R.string.run_start), Ui.Btn.PRIMARY, R.drawable.ic_nav_run) { host.startRun() }
        addView(start)

        val stats = Ui.row(ctx, gap = 10)
        lastV = statCard(stats, ctx.getString(R.string.run_last))
        bestV = statCard(stats, ctx.getString(R.string.run_best))
        scoreV = statCard(stats, ctx.getString(R.string.run_best_score))
        addView(stats)

        // ---- daily quests ----
        addView(Ui.card(ctx, accent = Ui.GOLD).apply {
            val head = Ui.row(ctx).apply { gravity = Gravity.CENTER_VERTICAL }
            head.addView(Ui.label(ctx, ctx.getString(R.string.quests_title), Ui.GOLD), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            chestV = Ui.pill(ctx, "", Ui.GOLD, icon = R.drawable.ic_gift)
            head.addView(chestV)
            addView(head)
            questRows = Ui.column(ctx, gap = 12)
            addView(Ui.top(questRows, 12))
        })

        // ---- shop ----
        addView(Ui.card(ctx).apply {
            val head = Ui.row(ctx).apply { gravity = Gravity.CENTER_VERTICAL }
            head.addView(Ui.label(ctx, ctx.getString(R.string.shop_title), Ui.GOLD), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            shopCount = Ui.pill(ctx, "", Ui.CYAN)
            head.addView(shopCount)
            addView(head)
            shopTabs = FrameLayout(ctx)
            addView(Ui.top(shopTabs, 12))
            val scroller = HorizontalScrollView(ctx).apply {
                isHorizontalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER
                clipToPadding = false
            }
            tiles = Ui.row(ctx, gap = 10).apply { setPadding(0, dp(4), 0, dp(4)) }
            scroller.addView(tiles)
            shelf = scroller
            addView(scroller, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
            val detail = Ui.row(ctx, gap = 12).apply { gravity = Gravity.CENTER_VERTICAL }
            val names = Ui.column(ctx)
            itemName = Ui.h2(ctx, "")
            itemHint = Ui.muted(ctx, "", 12f)
            names.addView(itemName)
            names.addView(itemHint)
            detail.addView(names, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            itemBtn = Ui.button(ctx, "", Ui.Btn.PRIMARY) { onItemAction() }
            detail.addView(itemBtn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(detail, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
        })

        // ---- milestones ----
        addView(Ui.card(ctx).apply {
            addView(Ui.label(ctx, ctx.getString(R.string.milestones_title), Ui.CYAN))
            milestoneRows = Ui.column(ctx, gap = 10)
            addView(Ui.top(milestoneRows, 10))
        })

        addView(Ui.card(ctx).apply {
            addView(Ui.label(ctx, ctx.getString(R.string.run_today_mod), Ui.GOLD))
            modLine = Ui.body(ctx)
            addView(Ui.top(modLine, 8))
            unlocked = Ui.text(ctx, ctx.getString(R.string.run_unlocked), 14f, Ui.GREEN, 800)
            Ui.setIcon(unlocked, R.drawable.ic_check, Ui.GREEN)
            addView(Ui.top(unlocked, 10))
        })
    }

    private fun sunChip(size: Float): TextView = Ui.text(ctx, "", size, Ui.INK, 900).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(10), dp(5), dp(12), dp(5))
        background = Ui.gradient(intArrayOf(Color.parseColor("#FFE27A"), Ui.GOLD, Ui.AMBER), dp(99).toFloat(), GradientDrawable.Orientation.TOP_BOTTOM).apply {
            setStroke(dp(2), Color.parseColor("#B86A12"))
        }
        val d = ctx.getDrawable(R.drawable.ic_sun)?.mutate()
        d?.setTint(Color.parseColor("#B8560A"))
        val s = dp(size + 2)
        d?.setBounds(0, 0, s, s)
        setCompoundDrawables(d, null, null, null)
        compoundDrawablePadding = dp(5)
    }

    private fun statCard(parent: LinearLayout, title: String): TextView {
        val c = Ui.card(ctx, pad = 14)
        c.addView(Ui.label(ctx, title).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
        val v = Ui.text(ctx, "0", 20f, Ui.TEXT, 900).apply {
            maxLines = 1
            setAutoSizeTextTypeUniformWithConfiguration(12, 20, 1, android.util.TypedValue.COMPLEX_UNIT_SP)
        }
        c.addView(v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)).apply { topMargin = dp(6) })
        parent.addView(c, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        return v
    }

    override fun render() {
        if (!this::start.isInitialized) return
        val save = host.save
        lastV.text = ctx.getString(R.string.meters, save.todayDistance())
        bestV.text = ctx.getString(R.string.meters, save.bestDistance)
        scoreV.text = Fmt.count(save.bestScore)
        val mod = save.dayMod()
        modV.text = ctx.getString(R.string.mod_chip, YardScreen.modLong(ctx, mod).substringBefore(":"))
        modLine.text = YardScreen.modLong(ctx, mod)
        unlocked.visibility = if (ClockIn.ready(save)) View.VISIBLE else View.GONE
        start.text = ctx.getString(if (save.todayDistance() > 0) R.string.run_again else R.string.run_start)
        Ui.setIcon(start, R.drawable.ic_nav_run, Ui.INK)
        quests.milestones() // a CLOCK IN signed in the Yard can complete a streak milestone
        renderBalance()
        renderQuests()
        renderShop()
        renderMilestones()
        renderPreview()
    }

    private fun renderBalance() {
        balanceV.text = Fmt.count(garage.suns)
        balanceV.contentDescription = ctx.getString(R.string.shop_balance_a11y, garage.suns)
    }

    // ---- quests ----

    private fun questText(q: Quest): String = ctx.getString(GearNames.quest(q.id))

    private fun renderQuests() {
        questRows.removeAllViews()
        for (q in quests.quests()) {
            val done = quests.done(q)
            val p = quests.progress(q).coerceAtMost(q.target)
            val row = Ui.column(ctx, gap = 6)
            val top = Ui.row(ctx, gap = 8).apply { gravity = Gravity.CENTER_VERTICAL }
            if (q.id.startsWith("b_")) top.addView(Ui.pill(ctx, ctx.getString(R.string.quest_bounty), Ui.PURPLE))
            val t = Ui.text(ctx, questText(q), 14f, if (done) Ui.MUTED else Ui.TEXT, 700).apply { maxLines = 2 }
            top.addView(t, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            val reward = if (done) Ui.pill(ctx, ctx.getString(R.string.quest_done), Ui.GREEN, icon = R.drawable.ic_check)
            else rewardChip(q.reward)
            top.addView(reward)
            row.addView(top)
            if (!done) {
                val barRow = Ui.row(ctx, gap = 10).apply { gravity = Gravity.CENTER_VERTICAL }
                val bar = SolarProgress(ctx).apply { fraction = p / q.target.toFloat() }
                barRow.addView(bar, LinearLayout.LayoutParams(0, dp(8), 1f))
                barRow.addView(Ui.muted(ctx, ctx.getString(R.string.quest_progress, p, q.target), 12f))
                row.addView(barRow)
            }
            row.contentDescription = questText(q) + ", " + if (done) ctx.getString(R.string.quest_done) else ctx.getString(R.string.quest_progress, p, q.target)
            questRows.addView(row)
        }
        chestV.text = if (quests.chestOpen()) ctx.getString(R.string.quest_chest_open) else ctx.getString(R.string.quest_chest, RunQuests.CHEST)
    }

    private fun rewardChip(n: Int): TextView = Ui.pill(ctx, ctx.getString(R.string.run_reward_plus, n), Ui.GOLD, icon = R.drawable.ic_sun)

    // ---- shop ----

    private fun robotName(id: String): String = ctx.getString(GearNames.robot(id))

    private fun skinName(id: String): String = ctx.getString(GearNames.skin(id))

    private fun renderShop() {
        shopTabs.removeAllViews()
        shopTabs.addView(Ui.segmented(ctx, listOf(ctx.getString(R.string.shop_robots), ctx.getString(R.string.shop_roofs)), tab) {
            tab = it
            renderShop()
            renderPreview()
        })
        tiles.removeAllViews()
        if (tab == 0) {
            val sel = pickRobot ?: garage.robot
            shopCount.text = ctx.getString(R.string.shop_count, garage.ownedRobots(), RunGarage.ROBOTS.size)
            for (r in RunGarage.ROBOTS) {
                val img = ImageView(ctx).apply {
                    setImageResource(GearNames.portrait(r.id))
                    scaleType = ImageView.ScaleType.FIT_CENTER
                }
                tiles.addView(tile(img, robotName(r.id), r.cost, garage.robotUnlocked(r.id), garage.robot == r.id, sel == r.id) {
                    pickRobot = r.id
                    renderShop(); renderPreview()
                })
            }
            centerOn(RunGarage.ROBOTS.indexOfFirst { it.id == sel })
            val def = RunGarage.ROBOTS.first { it.id == sel }
            detail(robotName(sel), def.cost, garage.robotUnlocked(sel), garage.robot == sel, null)
        } else {
            val sel = pickSkin ?: garage.skin
            shopCount.text = ctx.getString(R.string.shop_count, garage.ownedSkins(), RunGarage.SKINS.size)
            for (k in RunGarage.SKINS) {
                tiles.addView(tile(SkinSwatch(ctx, RunSkin.of(k.id)), skinName(k.id), k.cost, garage.skinUnlocked(k.id), garage.skin == k.id, sel == k.id) {
                    pickSkin = k.id
                    renderShop(); renderPreview()
                })
            }
            centerOn(RunGarage.SKINS.indexOfFirst { it.id == sel })
            val def = RunGarage.SKINS.first { it.id == sel }
            detail(skinName(sel), def.cost, garage.skinUnlocked(sel), garage.skin == sel, legacyHint(sel))
        }
    }

    /** Keep the picked tile in view (the equipped one may sit far down the shelf). */
    private fun centerOn(index: Int) {
        if (index < 0) return
        val smooth = shelfPlaced
        shelfPlaced = true
        tiles.post {
            val v = tiles.getChildAt(index) ?: return@post
            val x = (v.left - (shelf.width - v.width) / 2).coerceAtLeast(0)
            if (smooth) shelf.smoothScrollTo(x, 0) else shelf.scrollTo(x, 0)
        }
    }

    private fun legacyHint(id: String): String? = when (id) {
        "gold" -> ctx.getString(R.string.shop_free_suns, 40)
        "storm" -> ctx.getString(R.string.shop_free_dist, 800)
        "night" -> ctx.getString(R.string.shop_free_dist, 2000)
        "ember" -> ctx.getString(R.string.shop_free_runs, 8)
        else -> null
    }

    private fun tile(art: View, name: String, cost: Int, owned: Boolean, on: Boolean, selected: Boolean, onTap: () -> Unit): View {
        val t = Ui.column(ctx).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(8), dp(8), dp(8), dp(8))
            background = Ui.rounded(
                if (selected) Ui.blend(Ui.SURFACE2, Ui.GOLD, 0.16f) else Ui.SURFACE2, dp(18).toFloat(),
                if (selected) Ui.GOLD else Ui.STROKE, dp(if (selected) 2 else 1),
            )
            isClickable = true
            isFocusable = true
            contentDescription = ctx.getString(
                R.string.shop_item_a11y, name,
                when {
                    on -> ctx.getString(R.string.shop_on)
                    owned -> ctx.getString(R.string.shop_owned)
                    else -> ctx.getString(R.string.shop_buy, cost)
                },
            )
            setOnClickListener { it.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); onTap() }
        }
        t.addView(art, LinearLayout.LayoutParams(dp(68), dp(68)))
        t.addView(Ui.text(ctx, name, 12f, Ui.TEXT, 800).apply { maxLines = 1; gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(76), ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        val tag: TextView = when {
            on -> Ui.pill(ctx, ctx.getString(R.string.shop_on), Ui.GREEN, icon = R.drawable.ic_check, filled = true)
            owned -> Ui.pill(ctx, ctx.getString(R.string.shop_owned), Ui.CYAN)
            else -> Ui.pill(ctx, Fmt.count(cost), if (garage.suns >= cost) Ui.GOLD else Ui.MUTED, icon = R.drawable.ic_sun, filled = garage.suns >= cost)
        }
        t.addView(tag, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })
        return t
    }

    private fun detail(name: String, cost: Int, owned: Boolean, on: Boolean, hint: String?) {
        itemName.text = name
        val short = (cost - garage.suns).coerceAtLeast(0)
        itemHint.text = when {
            on -> ctx.getString(R.string.shop_hint_on)
            owned -> ctx.getString(R.string.shop_hint_owned)
            hint != null -> hint
            short > 0 -> ctx.getString(R.string.shop_need, short)
            else -> ctx.getString(R.string.shop_preview)
        }
        when {
            on -> {
                itemBtn.text = ctx.getString(R.string.shop_on)
                Ui.styleButton(itemBtn, Ui.Btn.SUCCESS)
                Ui.setEnabled(itemBtn, false)
                itemBtn.alpha = 1f
            }
            owned -> {
                itemBtn.text = ctx.getString(R.string.shop_equip)
                Ui.styleButton(itemBtn, Ui.Btn.SECONDARY)
                Ui.setEnabled(itemBtn, true)
            }
            else -> {
                itemBtn.text = ctx.getString(R.string.shop_buy, cost)
                Ui.styleButton(itemBtn, Ui.Btn.PRIMARY)
                Ui.setIcon(itemBtn, R.drawable.ic_sun, Ui.INK)
                Ui.setEnabled(itemBtn, short == 0)
            }
        }
    }

    private fun onItemAction() {
        val wasOwned: Boolean
        val name: String
        val ok = if (tab == 0) {
            val id = pickRobot ?: garage.robot
            wasOwned = garage.robotUnlocked(id); name = robotName(id)
            garage.pickRobot(id)
        } else {
            val id = pickSkin ?: garage.skin
            wasOwned = garage.skinUnlocked(id); name = skinName(id)
            garage.pickSkin(id)
        }
        if (!ok) return
        if (!wasOwned) {
            host.toast(ctx.getString(R.string.shop_bought, name))
            pop(balanceV)
            pop(stage)
        }
        renderBalance()
        renderShop()
        renderPreview()
    }

    private fun pop(v: View) {
        ObjectAnimator.ofPropertyValuesHolder(
            v, PropertyValuesHolder.ofFloat(View.SCALE_X, 0.94f, 1f), PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.94f, 1f),
        ).apply { duration = 380; interpolator = OvershootInterpolator(3f) }.start()
    }

    // ---- milestones ----

    private fun renderMilestones() {
        milestoneRows.removeAllViews()
        for ((m, have) in quests.nextMilestones()) {
            val title = when (m.kind) {
                "distance" -> ctx.getString(R.string.ms_distance, m.target)
                "suns" -> ctx.getString(R.string.ms_suns, m.target)
                else -> ctx.getString(R.string.ms_streak, m.target)
            }
            val row = Ui.column(ctx, gap = 6)
            val top = Ui.row(ctx, gap = 8).apply { gravity = Gravity.CENTER_VERTICAL }
            top.addView(Ui.text(ctx, title, 14f, Ui.TEXT, 700), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            top.addView(rewardChip(m.reward))
            row.addView(top)
            val barRow = Ui.row(ctx, gap = 10).apply { gravity = Gravity.CENTER_VERTICAL }
            barRow.addView(SolarProgress(ctx, Ui.CYAN, Ui.PURPLE).apply { fraction = have / m.target.toFloat() }, LinearLayout.LayoutParams(0, dp(8), 1f))
            barRow.addView(Ui.muted(ctx, ctx.getString(R.string.quest_progress, have.coerceAtMost(m.target), m.target), 12f))
            row.addView(barRow)
            milestoneRows.addView(row)
        }
    }

    // ---- live preview ----

    private fun renderPreview() {
        if (!this::preview.isInitialized) return
        val w = preview.width
        val h = preview.height
        if (w <= 0 || h <= 0) return
        val skin = if (tab == 1) pickSkin ?: garage.skin else garage.skin
        val robot = if (tab == 0) pickRobot ?: garage.robot else garage.robot
        val key = "$skin|$robot|$w|$h"
        if (key == previewKey) return
        previewKey = key
        preview.setImageBitmap(RunPreview.render(ctx, skin, robot, w, h))
    }
}

/** Mini roof in a skin's palette (web SKIN_PAL), for the shop tiles. */
@android.annotation.SuppressLint("ViewConstructor")
class SkinSwatch(ctx: Context, private val skin: RunSkin) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()
    private val flag = skin == RunSkin.FLAG
    private val cell = if (flag) 0xFF6AAFD8.toInt() else skin.cell
    private val deep = if (flag) 0xFF3E86C4.toInt() else skin.deep
    private val lip = if (flag) 0xFFF0C14D.toInt() else skin.lip
    // same palette rules as the run's rooftop (RunRenderer.drawPlat)
    private val frame = Ui.blend(0xFFCBD3DA.toInt(), lip, 0.35f)
    private val tile = Ui.blend(0xFFB65A34.toInt(), skin.band, 0.3f)
    private val tileDark = Ui.blend(tile, 0xFF2A1810.toInt(), 0.45f)
    private var skyShader: Shader? = null
    private var glassShader: Shader? = null

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        val hf = h.toFloat()
        skyShader = LinearGradient(0f, 0f, 0f, hf, 0xFF8FD3FF.toInt(), 0xFFD8F2C8.toInt(), Shader.TileMode.CLAMP)
        glassShader = LinearGradient(0f, hf * 0.46f, 0f, hf * 0.64f, Ui.blend(cell, Color.WHITE, 0.12f), deep, Shader.TileMode.CLAMP)
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        p.shader = skyShader
        r.set(0f, 0f, w, h)
        canvas.drawRoundRect(r, h * 0.22f, h * 0.22f, p)
        p.shader = null
        p.color = 0xFFFFD24A.toInt()
        canvas.drawCircle(w * 0.76f, h * 0.24f, h * 0.1f, p)
        val left = w * 0.08f
        val right = w * 0.92f
        val top = h * 0.44f
        val deckBot = h * 0.66f
        val bot = h * 0.84f
        // ink silhouette, tile eave, deck, modules
        p.color = 0xFF2A1E16.toInt()
        r.set(left - 3, top - 3, right + 3, bot + 3); canvas.drawRoundRect(r, 8f, 8f, p)
        p.color = tileDark
        r.set(left, deckBot, right, bot); canvas.drawRoundRect(r, 6f, 6f, p)
        val tw = (right - left) / 5
        p.color = tile
        for (i in 0 until 5) {
            r.set(left + i * tw + 1, deckBot - 4, left + (i + 1) * tw - 1, bot - 2)
            canvas.drawRoundRect(r, tw / 2, tw / 2, p)
        }
        p.color = frame
        r.set(left, top, right, deckBot); canvas.drawRoundRect(r, 5f, 5f, p)
        p.shader = glassShader
        val mw = (right - left - 9) / 2
        for (m in 0 until 2) {
            r.set(left + 3 + m * (mw + 3), top + 2.5f, left + 3 + m * (mw + 3) + mw, deckBot - 2.5f)
            canvas.drawRoundRect(r, 2f, 2f, p)
        }
        p.shader = null
        p.color = skin.grid
        p.strokeWidth = 1f
        for (m in 0 until 2) {
            val mx = left + 3 + m * (mw + 3)
            for (k in 1 until 3) canvas.drawLine(mx + mw * k / 3, top + 2.5f, mx + mw * k / 3, deckBot - 2.5f, p)
        }
        p.color = 0x8CFFFFFF.toInt()
        r.set(left + 6, top + 3, left + mw * 0.7f, top + 5); canvas.drawRoundRect(r, 2f, 2f, p)
    }
}
