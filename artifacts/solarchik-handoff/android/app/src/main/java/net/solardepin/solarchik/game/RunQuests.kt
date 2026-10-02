package net.solardepin.solarchik.game

import android.content.Context
import net.solardepin.solarchik.core.StreakRules

/** What one run did, for daily quests and milestones. */
data class RunStats(
    val meters: Int,
    val suns: Int,
    val maxCombo: Int,
    val stomps: Int,
    val grinds: Int,
    val unders: Int,
)

/** A daily quest: [target] reached in one run ([perRun]) or summed over today's runs. */
class Quest(val id: String, val target: Int, val reward: Int, val perRun: Boolean)

/** A lifetime milestone (one-time sun reward). */
class Milestone(val id: String, val kind: String, val target: Int, val reward: Int)

/** Something the player just earned, shown as a reward reveal. */
data class Reward(val id: String, val suns: Int, val milestone: Boolean = false)

/**
 * Daily quests + lifetime milestones (native game layer on top of the web missions).
 *
 * The three web missions (save.ts applyRun: 2000 m, 25 suns, 8x heat in one run) are today's
 * quests, plus one rotating bounty summed over the day's runs (stomps, wire grinds, drone
 * slides or suns). Each pays suns into the [RunGarage] wallet; all four done pays the day chest.
 * Progress resets at the UTC day, like the web missionDay.
 */
class RunQuests(context: Context, private val garage: RunGarage, private val clock: () -> Long = { System.currentTimeMillis() }) {
    private val prefs = context.applicationContext.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE)

    fun today(): String = StreakRules.dayKey(clock())

    /** Today's quests: the web three + the day's bounty. */
    fun quests(day: String = today()): List<Quest> = WEB + BOUNTIES[bountyIndex(day)]

    private fun fresh() {
        val today = today()
        if (prefs.getString(K_DAY, "") == today) return
        val e = prefs.edit().putString(K_DAY, today).putString(K_DONE, "").putBoolean(K_CHEST, false)
        for (q in ALL_IDS) e.putInt(K_P + q, 0)
        e.apply()
    }

    /** Progress toward [q] today (stored; add [live] for a run in progress). */
    fun progress(q: Quest, live: RunStats? = null): Int {
        fresh()
        val stored = prefs.getInt(K_P + q.id, 0)
        if (live == null) return stored
        val v = value(q, live)
        return if (q.perRun) maxOf(stored, v) else stored + v
    }

    fun done(q: Quest): Boolean { fresh(); return q.id in doneSet() }
    fun chestOpen(): Boolean { fresh(); return prefs.getBoolean(K_CHEST, false) }

    /** Quests a run in progress has just finished (for the in-run toast); nothing is paid here. */
    fun liveDone(live: RunStats): List<Quest> = quests().filter { !done(it) && progress(it, live) >= it.target }

    private fun doneSet(): Set<String> = prefs.getString(K_DONE, "").orEmpty().split(',').filter { it.isNotBlank() }.toSet()

    private fun value(q: Quest, r: RunStats): Int = when (q.id) {
        "clock" -> r.meters
        "suns", "b_suns" -> r.suns
        "combo" -> r.maxCombo
        "b_stomp" -> r.stomps
        "b_grind" -> r.grinds
        "b_under" -> r.unders
        else -> 0
    }

    /**
     * Commits a finished run: quest progress, newly done quests, the day chest and lifetime
     * milestones. Pays every reward into the sun wallet and returns them for the reveal.
     */
    fun commit(run: RunStats): List<Reward> {
        fresh()
        val out = ArrayList<Reward>()
        val done = doneSet().toMutableSet()
        val e = prefs.edit()
        for (q in quests()) {
            val p = progress(q, run)
            e.putInt(K_P + q.id, p)
            if (q.id !in done && p >= q.target) {
                done += q.id
                out += Reward(q.id, q.reward)
            }
        }
        e.putString(K_DONE, done.joinToString(","))
        if (!prefs.getBoolean(K_CHEST, false) && quests().all { it.id in done }) {
            e.putBoolean(K_CHEST, true)
            out += Reward("chest", CHEST)
        }
        e.apply()
        garage.addReward(out.sumOf { it.suns })
        out += milestones()
        return out
    }

    // ---- milestones ----

    private fun stat(kind: String): Int = when (kind) {
        "distance" -> prefs.getInt("bestDistance", 0)
        "suns" -> garage.totalSuns
        "runs" -> prefs.getInt("runs", 0)
        "streak" -> prefs.getInt("streak", 0)
        else -> 0
    }

    fun milestoneDone(m: Milestone): Boolean = m.id in prefs.getString(K_MS, "").orEmpty().split(',')

    /** The next milestone of each kind still open (lobby track). */
    fun nextMilestones(): List<Pair<Milestone, Int>> =
        MILESTONES.groupBy { it.kind }.mapNotNull { (kind, list) -> list.firstOrNull { !milestoneDone(it) }?.let { it to stat(kind) } }

    /** Records and pays milestones reached since the last check (also after a CLOCK IN raised the streak). */
    fun milestones(): List<Reward> {
        val have = prefs.getString(K_MS, "").orEmpty().split(',').filter { it.isNotBlank() }.toMutableSet()
        val out = MILESTONES.filter { it.id !in have && stat(it.kind) >= it.target }.map { Reward(it.id, it.reward, milestone = true) }
        if (out.isEmpty()) return out
        have += out.map { it.id }
        prefs.edit().putString(K_MS, have.joinToString(",")).apply()
        garage.addReward(out.sumOf { it.suns })
        return out
    }

    companion object {
        private const val K_DAY = "questDay"
        private const val K_DONE = "questDone"
        private const val K_CHEST = "questChest"
        private const val K_P = "quest_"
        private const val K_MS = "milestones"
        const val CHEST = 50

        /** web missions (save.ts applyRun), with native sun rewards. */
        val WEB = listOf(
            Quest("clock", 2000, 30, perRun = true),
            Quest("suns", 25, 20, perRun = true),
            Quest("combo", 8, 25, perRun = true),
        )

        val BOUNTIES = listOf(
            Quest("b_stomp", 6, 20, perRun = false),
            Quest("b_grind", 4, 20, perRun = false),
            Quest("b_under", 3, 20, perRun = false),
            Quest("b_suns", 60, 25, perRun = false),
        )

        private val ALL_IDS = (WEB + BOUNTIES).map { it.id }

        val MILESTONES = listOf(
            Milestone("m_d600", "distance", 600, 30), Milestone("m_d1200", "distance", 1200, 60),
            Milestone("m_d2000", "distance", 2000, 100), Milestone("m_d3000", "distance", 3000, 160),
            Milestone("m_s100", "suns", 100, 25), Milestone("m_s500", "suns", 500, 60),
            Milestone("m_s1500", "suns", 1500, 120), Milestone("m_s4000", "suns", 4000, 250),
            Milestone("m_k3", "streak", 3, 40), Milestone("m_k7", "streak", 7, 90), Milestone("m_k30", "streak", 30, 300),
        )

        fun bountyIndex(day: String): Int {
            var h = 2166136261L
            for (ch in "bounty:$day") { h = h xor ch.code.toLong(); h = (h * 16777619L) and 0xFFFFFFFFL }
            return (h % BOUNTIES.size).toInt()
        }
    }
}
