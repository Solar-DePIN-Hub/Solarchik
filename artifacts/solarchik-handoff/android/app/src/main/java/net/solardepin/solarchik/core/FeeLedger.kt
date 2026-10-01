package net.solardepin.solarchik.core

import kotlinx.serialization.Serializable

/** Wire names match web FeeReason in src/lib/agents/fee-ledger.ts. */
object FeeReason {
    /** PRO tier: 0% performance fee. */
    const val PRO = "pro"
    /** Opened inside an active fee-free window: fee waived (amount kept for the record). */
    const val WINDOW = "window"
    /** Loss or flat: nothing to charge. */
    const val LOSS = "loss"
    /** Paper / simulation: never sends, stores what it would have been. */
    const val PAPER = "paper"
    /** Fee was sent to the treasury (sig set). */
    const val CHARGED = "charged"
    /** Fee is owed but not sent yet. */
    const val UNSENT = "unsent"

    val ALL = setOf(PRO, WINDOW, LOSS, PAPER, CHARGED, UNSENT)
}

/** One closed position. Same fields as web FeeRow. */
@Serializable
data class FeeRow(
    val id: String,
    val agent: String,
    val openedAt: Long,
    val closedAt: Long,
    val pnl: Double,
    val fee: Double,
    val charged: Boolean,
    val reason: String,
    val sig: String = "",
) {
    /** True when a fee was (or will be) taken from the player. */
    val owes: Boolean get() = reason == FeeReason.CHARGED || reason == FeeReason.UNSENT
    /** True when [fee] is an amount the player did not have to pay. */
    val waived: Boolean get() = reason == FeeReason.WINDOW || reason == FeeReason.PAPER
}

data class LedgerSummary(
    val positions: Int,
    val wins: Int,
    val pnl: Double,
    val feesOwed: Double,
    val feesCharged: Double,
    val feesWaived: Double,
)

object FeeLedger {
    /** 5% of positive PnL, rounded to whole lamports. */
    fun feeCut(pnl: Double): Double {
        if (!(pnl > 0)) return 0.0
        val lamports = Math.round(pnl * SolarchikConfig.FREE_FEE_RATE * 1e9)
        if (lamports < 1) return 0.0
        return lamports / 1e9
    }

    /**
     * Port of web planFee. Missing tier = pro (old mints are not taxed).
     * [covered] = the position was opened inside an active fee-free window.
     */
    fun planFee(
        id: String,
        agent: String,
        tier: String?,
        openedAt: Long,
        closedAt: Long,
        pnl: Double,
        paper: Boolean,
        covered: Boolean,
    ): FeeRow {
        val free = tier == AgentTier.FREE
        fun row(fee: Double, reason: String) = FeeRow(id, agent, openedAt, closedAt, pnl, fee, false, reason, "")
        val would = if (free && pnl > 0 && !covered) feeCut(pnl) else 0.0
        if (paper) return row(would, FeeReason.PAPER)
        if (!(pnl > 0)) return row(0.0, FeeReason.LOSS)
        if (!free) return row(0.0, FeeReason.PRO)
        if (covered) return row(feeCut(pnl), FeeReason.WINDOW)
        if (would <= 0) return row(0.0, FeeReason.LOSS)
        return row(would, FeeReason.UNSENT)
    }

    fun markCharged(row: FeeRow, sig: String): FeeRow =
        if (row.reason == FeeReason.UNSENT && sig.length >= 32) row.copy(reason = FeeReason.CHARGED, charged = true, sig = sig) else row

    /** Drops rows the web reader would drop; caps at 200 like web readFeeRows. */
    fun sanitize(rows: List<FeeRow>): List<FeeRow> = rows
        .filter { it.id.isNotBlank() && it.reason in FeeReason.ALL }
        .map {
            it.copy(
                id = it.id.take(80),
                agent = it.agent.take(64),
                fee = maxOf(0.0, if (it.fee.isFinite()) it.fee else 0.0),
                pnl = if (it.pnl.isFinite()) it.pnl else 0.0,
                charged = it.charged && it.reason == FeeReason.CHARGED,
                sig = it.sig.take(100),
            )
        }
        .take(200)

    fun summarize(rows: List<FeeRow>): LedgerSummary = LedgerSummary(
        positions = rows.size,
        wins = rows.count { it.pnl > 0 },
        pnl = rows.sumOf { it.pnl },
        feesOwed = rows.filter { it.reason == FeeReason.UNSENT }.sumOf { it.fee },
        feesCharged = rows.filter { it.reason == FeeReason.CHARGED }.sumOf { it.fee },
        feesWaived = rows.filter { it.waived }.sumOf { it.fee },
    )
}
