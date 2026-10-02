package net.solardepin.solarchik.game

import android.content.Context

/** A roof skin from the web skins.ts SKINS list (cost in suns, 0 = starter). */
class SkinDef(val id: String, val cost: Int)

/** A runner robot from the web robots.ts ROBOTS list. [visor] is the web visor colour. */
class RobotDef(val id: String, val cost: Int, val visor: Int)

/**
 * The web shop + inventory (save.ts suns / unlockedSkins / unlockedRobots / buySkin / buyRobot /
 * legacyUnlocks / syncUnlocks), on the native save. Suns are the in-run suns: every sun picked up
 * in a run is added to the balance, and a new player starts with 120 like the web defaultSave.
 */
class RunGarage(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE)

    /** Spendable suns (web save.suns). */
    val suns: Int get() = prefs.getInt(K_SUNS, START_SUNS)

    /** Suns ever collected (web save.totalSuns, drives the Gold legacy unlock). */
    val totalSuns: Int get() = prefs.getInt(K_TOTAL, 0)

    val skin: String get() = prefs.getString(K_SKIN, "flag").takeIf { skinUnlocked(it.orEmpty()) } ?: "flag"
    val robot: String get() = prefs.getString(K_ROBOT, "stock").takeIf { robotUnlocked(it.orEmpty()) } ?: "stock"

    private fun list(key: String): Set<String> =
        prefs.getString(key, "").orEmpty().split(',').filter { it.isNotBlank() }.toSet()

    /** web legacyUnlocks: progress-based skins that are free. */
    fun legacyUnlocks(): Set<String> {
        val p = prefs
        val out = HashSet<String>()
        if (totalSuns >= 40) out += "gold"
        if (p.getInt("bestDistance", 0) >= 800) out += "storm"
        if (p.getInt("bestDistance", 0) >= 2000) out += "night"
        if (p.getInt("runs", 0) >= 8) out += "ember"
        return out
    }

    fun skinUnlocked(id: String): Boolean = id == "flag" || id in list(K_SKINS) || id in legacyUnlocks()
    fun robotUnlocked(id: String): Boolean = id == "stock" || id in list(K_ROBOTS)

    fun ownedSkins(): Int = SKINS.count { skinUnlocked(it.id) }
    fun ownedRobots(): Int = ROBOTS.count { robotUnlocked(it.id) }

    /** web pickSkin: equip when owned, else buy (if the balance covers it) and equip. */
    fun pickSkin(id: String): Boolean {
        val def = SKINS.firstOrNull { it.id == id } ?: return false
        if (skinUnlocked(id)) { prefs.edit().putString(K_SKIN, id).apply(); return true }
        if (suns < def.cost) return false
        prefs.edit().putInt(K_SUNS, suns - def.cost).putString(K_SKINS, (list(K_SKINS) + id).joinToString(",")).putString(K_SKIN, id).apply()
        return true
    }

    /** web pickRobot: equip when owned, else buy and equip. */
    fun pickRobot(id: String): Boolean {
        val def = ROBOTS.firstOrNull { it.id == id } ?: return false
        if (robotUnlocked(id)) { prefs.edit().putString(K_ROBOT, id).apply(); return true }
        if (suns < def.cost) return false
        prefs.edit().putInt(K_SUNS, suns - def.cost).putString(K_ROBOTS, (list(K_ROBOTS) + id).joinToString(",")).putString(K_ROBOT, id).apply()
        return true
    }

    /** web recordRun: the suns picked up in a run go to the balance and the lifetime total. */
    fun addSuns(n: Int) {
        if (n <= 0) return
        prefs.edit().putInt(K_SUNS, suns + n).putInt(K_TOTAL, totalSuns + n).apply()
    }

    /** Quest / milestone suns: spendable, but not counted as picked up (Gold legacy unlock). */
    fun addReward(n: Int) {
        if (n <= 0) return
        prefs.edit().putInt(K_SUNS, suns + n).apply()
    }

    companion object {
        const val START_SUNS = 120
        private const val K_SUNS = "suns"
        private const val K_TOTAL = "totalSuns"
        private const val K_SKIN = "skin"
        private const val K_SKINS = "unlockedSkins"
        private const val K_ROBOT = "robot"
        private const val K_ROBOTS = "unlockedRobots"

        val SKINS = listOf(
            SkinDef("flag", 0), SkinDef("gold", 40), SkinDef("moss", 55), SkinDef("frost", 70), SkinDef("storm", 85),
            SkinDef("cherry", 100), SkinDef("copper", 120), SkinDef("night", 140), SkinDef("lime", 165), SkinDef("ember", 190),
            SkinDef("ocean", 220), SkinDef("sand", 250), SkinDef("violet", 290), SkinDef("carbon", 330), SkinDef("rose", 380),
            SkinDef("mint", 440), SkinDef("sunset", 510), SkinDef("polar", 590), SkinDef("magma", 680), SkinDef("prism", 800),
        )

        val ROBOTS = listOf(
            RobotDef("stock", 0, 0xFF7AD8FF.toInt()),
            RobotDef("sunflower", 90, 0xFFFFF4A8.toInt()),
            RobotDef("midnight", 140, 0xFF7EC8FF.toInt()),
            RobotDef("emberkit", 180, 0xFFFF8A3A.toInt()),
            RobotDef("frostkit", 220, 0xFFE8FBFF.toInt()),
            RobotDef("mosskit", 260, 0xFFB7E07A.toInt()),
            RobotDef("copperkit", 320, 0xFFFFC08A.toInt()),
            RobotDef("carbonkit", 380, 0xFFC8D2D8.toInt()),
            RobotDef("hetman", 450, 0xFFFFE34A.toInt()),
            RobotDef("prismkit", 600, 0xFF7EF0D4.toInt()),
        )
    }
}
