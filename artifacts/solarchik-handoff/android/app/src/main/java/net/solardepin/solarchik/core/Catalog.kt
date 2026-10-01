package net.solardepin.solarchik.core

import net.solardepin.solarchik.R

/** Wire names match web NftTier. */
object AgentTier {
    const val FREE = "free"
    const val PRO = "pro"
}

/** Web NftClassId: 1 prediction, 2 dex/arb, 3 combo. */
enum class AgentClass(val id: Int, val role: String, val titleRes: Int, val shortRes: Int, val blurbRes: Int) {
    PREDICTION(1, "pred", R.string.class_pred_title, R.string.class_pred_short, R.string.class_pred_blurb),
    DEX(2, "dex", R.string.class_dex_title, R.string.class_dex_short, R.string.class_dex_blurb),
    COMBO(3, "combo", R.string.class_combo_title, R.string.class_combo_short, R.string.class_combo_blurb);

    companion object {
        fun of(id: Int): AgentClass = entries.firstOrNull { it.id == id } ?: PREDICTION
    }
}

/** One base strategy. Each base comes as FREE (`id`) and PRO (`id-pro`), like web catalog.ts withTiers. */
data class AgentSku(
    val id: String,
    val name: String,
    val agentClass: AgentClass,
    /** Lanes as web: c = crypto 15m, e = events, w = weather; dex for arb. */
    val lanes: String,
    val blurbRes: Int,
    val artRes: Int,
    val accent: Int,
) {
    fun skuId(tier: String): String = if (tier == AgentTier.PRO) "$id-pro" else id
    fun nameFor(tier: String): String =
        (if (tier == AgentTier.PRO) "$name Pro" else name).take(SolarchikConfig.CORE_NAME_MAX)
    fun priceSol(tier: String): Double = Catalog.offerFor(skuId(tier)).second
}

object Catalog {
    val skus: List<AgentSku> = listOf(
        AgentSku("sku-pred-alpha", "Bitcoin Windows #11", AgentClass.PREDICTION, "c", R.string.sku_alpha_blurb, R.drawable.robot_ember, 0xFFFF9F43.toInt()),
        AgentSku("sku-pred-events", "Events Scout #04", AgentClass.PREDICTION, "e", R.string.sku_events_blurb, R.drawable.robot_prism, 0xFFA78BFA.toInt()),
        AgentSku("sku-pred-weather", "Weather Station", AgentClass.PREDICTION, "w", R.string.sku_weather_blurb, R.drawable.robot_frost, 0xFF7AD1FF.toInt()),
        AgentSku("sku-combo-prime", "Combo Prime", AgentClass.COMBO, "cew", R.string.sku_combo_blurb, R.drawable.robot_sunflower, 0xFFF5C542.toInt()),
        AgentSku("sku-dex-arb", "Titan × Backpack", AgentClass.DEX, "dex", R.string.sku_arb_blurb, R.drawable.robot_midnight, 0xFF5BD69A.toInt()),
    )

    private val proIds = skus.map { "${it.id}-pro" }.toSet()

    /** Port of web offerFor: (tier, price). */
    fun offerFor(id: String): Pair<String, Double> =
        if (id in proIds) AgentTier.PRO to SolarchikConfig.PRO_PRICE_SOL else AgentTier.FREE to 0.0

    fun baseOf(skuId: String): AgentSku? = skus.firstOrNull { it.id == skuId.removeSuffix("-pro") }

    /** Recovers sku + tier from an on-chain Core name ("Combo Prime Pro"). */
    fun fromName(name: String): Pair<AgentSku, String>? {
        val clean = name.trim()
        for (sku in skus) {
            if (clean == sku.nameFor(AgentTier.PRO)) return sku to AgentTier.PRO
            if (clean == sku.name) return sku to AgentTier.FREE
        }
        return null
    }

    fun feeRateFor(tier: String): Double = if (tier == AgentTier.FREE) SolarchikConfig.FREE_FEE_RATE else 0.0
}
