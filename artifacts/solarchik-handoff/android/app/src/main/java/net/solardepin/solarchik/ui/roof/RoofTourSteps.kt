package net.solardepin.solarchik.ui.roof

import net.solardepin.solarchik.R
import net.solardepin.solarchik.core.SolarchikConfig

/** A devnet transaction shown as an explorer link in the judges' tour. Signatures are real; never invent one. */
data class ProofLink(val label: Int, val sig: String, val cluster: String = "devnet") {
    val url: String get() = if (cluster == "devnet") "https://explorer.solana.com/tx/$sig?cluster=devnet" else "https://explorer.solana.com/tx/$sig"
    val short: String get() = if (sig.length < 14) sig else sig.take(6) + "…" + sig.takeLast(6)
}

data class TourStep(
    val target: RoofObject?,
    val title: Int,
    val body: Int,
    val bodyArg: Int? = null,
    val links: List<ProofLink> = emptyList(),
    /** Judges' auto-play time on this step. */
    val ms: Long = 8_000,
)

object RoofTourSteps {
    /**
     * Real devnet transactions from the 0.21.9 built-in wallet run (LocalWalletDevnetIT, 2026-10-03 ~01:50 Kyiv,
     * wallet C9pVXx7ieotYjaQr76gAgx7bmA67hZQivFTZ2UxGuWnz; /workspace/apk-test/devnet-0.21.9-builtin-wallet.txt).
     * All three were re-checked as finalized with getSignatureStatuses before 0.22.0 shipped.
     */
    val MINT = ProofLink(R.string.judge_link_mint, "598nnYPz51jNodmtsphSozdnT4DfQRyMupdDWiapkqYU6beEMnhXyZba29QFZaWTB5pApmLXvyEFY5NDidXS6edJ")
    val PRO = ProofLink(R.string.judge_link_pro, "b2PztsNSiaUixeFxtfPsoFrAKzfgSU3kRDi1vDXBHVh41RaiXDKPVzV1MLtVxp8X5sm1NAMDHgmfJFR1tzCMqAJ")
    val FAUCET = ProofLink(R.string.judge_link_faucet, "Wh56r93JhEc18BDrHNUEvmfmpPZoFdsgsxv4GVHkzUExLGXtzxxiP1zNLAjh4GEjHNa2kNnJrpyxLvXCcbhFZ6o")

    private val goal = SolarchikConfig.RUN_GOAL_M

    fun full(): List<TourStep> = listOf(
        TourStep(RoofObject.SOL, R.string.tour_sol_t, R.string.tour_sol_b),
        TourStep(RoofObject.DOOR, R.string.tour_door_t, R.string.tour_door_b),
        TourStep(RoofObject.CLOCK, R.string.tour_clock_t, R.string.tour_clock_b, goal),
        TourStep(RoofObject.ANTENNA, R.string.tour_calls_t, R.string.tour_calls_b),
        TourStep(RoofObject.PANELS, R.string.tour_panels_t, R.string.tour_panels_b),
        TourStep(RoofObject.TICKER, R.string.tour_ticker_t, R.string.tour_ticker_b),
        TourStep(RoofObject.TOOLBOX, R.string.tour_tools_t, R.string.tour_tools_b),
    )

    /** ~60 s for judges. [mine] = the player's own devnet proofs (latest CLOCK IN, latest mint), if any. */
    fun judges(mine: List<ProofLink>): List<TourStep> {
        val myClock = mine.filter { it.label == R.string.judge_link_my_clock }
        return listOf(
            TourStep(null, R.string.judge_intro_t, R.string.judge_intro_b, ms = 7_000),
            TourStep(RoofObject.CLOCK, R.string.judge_clock_t, R.string.judge_clock_b, goal, links = myClock, ms = 8_000),
            TourStep(RoofObject.PANELS, R.string.judge_nft_t, R.string.judge_nft_b, links = listOf(MINT, PRO), ms = 9_000),
            TourStep(RoofObject.TOOLBOX, R.string.judge_wallet_t, R.string.judge_wallet_b, links = listOf(FAUCET), ms = 8_000),
            TourStep(RoofObject.ANTENNA, R.string.judge_sec_t, R.string.judge_sec_b, ms = 7_000),
            TourStep(RoofObject.SOL, R.string.judge_sol_t, R.string.judge_sol_b, ms = 7_000),
            TourStep(RoofObject.TICKER, R.string.judge_honest_t, R.string.judge_honest_b, ms = 7_000),
            TourStep(null, R.string.judge_proof_t, R.string.judge_proof_b, links = listOf(MINT, PRO, FAUCET) + mine, ms = 7_000),
        )
    }
}
