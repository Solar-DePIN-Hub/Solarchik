package net.solardepin.solarchik.game

import net.solardepin.solarchik.R

/** Localized names and portraits for the shop gear (web i18n robot.* / skin.*). */
object GearNames {
    fun robot(id: String): Int = when (id) {
        "sunflower" -> R.string.robot_sunflower
        "midnight" -> R.string.robot_midnight
        "emberkit" -> R.string.robot_emberkit
        "frostkit" -> R.string.robot_frostkit
        "mosskit" -> R.string.robot_mosskit
        "copperkit" -> R.string.robot_copperkit
        "carbonkit" -> R.string.robot_carbonkit
        "hetman" -> R.string.robot_hetman
        "prismkit" -> R.string.robot_prismkit
        else -> R.string.robot_stock
    }

    fun portrait(id: String): Int = when (id) {
        "sunflower" -> R.drawable.run_bot_sunflower
        "midnight" -> R.drawable.run_bot_midnight
        "emberkit" -> R.drawable.run_bot_emberkit
        "frostkit" -> R.drawable.run_bot_frostkit
        "mosskit" -> R.drawable.run_bot_mosskit
        "copperkit" -> R.drawable.run_bot_copperkit
        "carbonkit" -> R.drawable.run_bot_carbonkit
        "hetman" -> R.drawable.run_bot_hetman
        "prismkit" -> R.drawable.run_bot_prismkit
        else -> R.drawable.run_bot_stock
    }

    fun skin(id: String): Int = when (id) {
        "gold" -> R.string.skin_gold
        "moss" -> R.string.skin_moss
        "frost" -> R.string.skin_frost
        "storm" -> R.string.skin_storm
        "cherry" -> R.string.skin_cherry
        "copper" -> R.string.skin_copper
        "night" -> R.string.skin_night
        "lime" -> R.string.skin_lime
        "ember" -> R.string.skin_ember
        "ocean" -> R.string.skin_ocean
        "sand" -> R.string.skin_sand
        "violet" -> R.string.skin_violet
        "carbon" -> R.string.skin_carbon
        "rose" -> R.string.skin_rose
        "mint" -> R.string.skin_mint
        "sunset" -> R.string.skin_sunset
        "polar" -> R.string.skin_polar
        "magma" -> R.string.skin_magma
        "prism" -> R.string.skin_prism
        else -> R.string.skin_flag
    }

    fun quest(id: String): Int = when (id) {
        "clock" -> R.string.quest_clock
        "suns" -> R.string.quest_suns
        "combo" -> R.string.quest_combo
        "b_stomp" -> R.string.quest_b_stomp
        "b_grind" -> R.string.quest_b_grind
        "b_under" -> R.string.quest_b_under
        "b_suns" -> R.string.quest_b_suns
        else -> R.string.quest_chest_name
    }

    /** Reveal line for a quest / chest / milestone reward. */
    fun reward(ctx: android.content.Context, r: Reward): String {
        if (!r.milestone) return ctx.getString(quest(r.id))
        val m = RunQuests.MILESTONES.firstOrNull { it.id == r.id } ?: return r.id
        val title = when (m.kind) {
            "distance" -> ctx.getString(R.string.ms_distance, m.target)
            "suns" -> ctx.getString(R.string.ms_suns, m.target)
            else -> ctx.getString(R.string.ms_streak, m.target)
        }
        return ctx.getString(R.string.milestones_title) + " · " + title
    }
}
