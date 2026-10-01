package net.solardepin.solarchik.agents.engine

/** Where a strategy reads its market. All public endpoints, no keys. */
enum class Source(val mode: Mode, val windowMin: Int, val edgeBps: Double) {
    /** Coinbase BTC-USD spot (Kraken fallback). */
    BTC(Mode.EDGE, 15, 15.0),
    /** Polymarket Gamma events beyond Bitcoin; follows the favorite outcome. */
    EVENTS(Mode.FAVORITE, 30, 0.0),
    /** Open-Meteo Kyiv temperature (as Kelvin so bps stay meaningful). */
    WEATHER(Mode.EDGE, 60, 25.0),
    /** Backpack SOL_USDC last price (Coinbase SOL-USD fallback). */
    SOL(Mode.EDGE, 10, 20.0);

    enum class Mode { EDGE, FAVORITE }
}

object Strategies {
    /** Confidence floor for every entry. Same 65% as web commitBrain. */
    const val MIN_CONFIDENCE = 0.65
    /** Smallest position worth opening. */
    const val MIN_STAKE = 0.001
    /** Paper desk starts with this many virtual SOL. */
    const val PAPER_PURSE = 1.0
    /** Favorites above this are already decided; below 65% they are noise. */
    const val FAVORITE_MAX = 0.94

    fun sources(skuId: String): List<Source> = when (skuId.removeSuffix("-pro")) {
        "sku-pred-alpha" -> listOf(Source.BTC)
        "sku-pred-events" -> listOf(Source.EVENTS)
        "sku-pred-weather" -> listOf(Source.WEATHER)
        "sku-combo-prime" -> listOf(Source.BTC, Source.EVENTS, Source.WEATHER)
        "sku-dex-arb" -> listOf(Source.SOL)
        else -> listOf(Source.BTC)
    }

    /**
     * Edge mode: a move equal to the edge is 65% confidence, three edges is 95%.
     * Enters only at or above [MIN_CONFIDENCE], so "≥65%" is literally the rule.
     */
    fun edgeConfidence(moveBps: Double, edgeBps: Double): Double =
        if (edgeBps <= 0) 0.0 else minOf(0.95, 0.5 + 0.15 * kotlin.math.abs(moveBps) / edgeBps)
}
