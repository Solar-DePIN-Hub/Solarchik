package net.solardepin.solarchik.ui

import android.content.Context

/**
 * Display names for agents and strategy NFTs. The on-chain names stay English (they are minted
 * that way and Explorer shows them); the Ukrainian UI shows a translation (0.21.7, owner list:
 * "Weather Station", "Events Scout #04", "Bitcoin Windows #11", "Hourly BTC", "Medium Risk Sol"…).
 * NFT/devnet/SOL/BTC and numbers stay as they are.
 */
object AgentNames {
    private val EXACT_UK = linkedMapOf(
        "Bitcoin Windows" to "Біткоїн-вікна",
        "Events Scout" to "Розвідник подій",
        "Weather Station" to "Метеостанція",
        "Combo Prime" to "Комбо Прайм",
        "Backpack SOL Desk" to "SOL-деск Backpack",
        "Titan × Backpack" to "SOL-деск Backpack",
    )
    /** Strategy-title words (server strategy names like "Calm Hourly BTC", "Medium Risk Sol"). */
    private val WORDS_UK = listOf(
        "Medium Risk" to "середній ризик",
        "Low Risk" to "низький ризик",
        "High Risk" to "високий ризик",
        "Momentum Rider" to "Хвиля імпульсу",
        "Mean Reversion" to "Повернення до середнього",
        "Hourly" to "щогодинна",
        "Daily" to "щоденна",
        "Calm" to "Спокійна",
        "Steady" to "Рівна",
        "Bold" to "Смілива",
        "Fast" to "Швидка",
        "Strategy" to "Стратегія",
        "Free" to "Безкоштовний",
        "Sol" to "SOL",
    )

    fun display(ctx: Context, name: String): String =
        if (ctx.resources.configuration.locales[0].language == "uk") uk(name) else name

    fun uk(name: String): String {
        var out = name
        for ((en, uk) in EXACT_UK) if (out.contains(en)) out = out.replace(en, uk)
        if (out.endsWith(" Pro")) out = out.removeSuffix(" Pro") + " · Про"
        for ((en, uk) in WORDS_UK) out = out.replace(Regex("\\b" + Regex.escape(en) + "\\b"), uk)
        // capitalise the first letter after word swaps ("щогодинна BTC" -> "Щогодинна BTC")
        return out.replaceFirstChar { it.uppercase() }
    }
}
