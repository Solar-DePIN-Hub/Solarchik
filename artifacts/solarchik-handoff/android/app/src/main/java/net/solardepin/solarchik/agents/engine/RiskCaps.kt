package net.solardepin.solarchik.agents.engine

import kotlinx.serialization.Serializable
import net.solardepin.solarchik.core.SolarchikConfig

/**
 * Port of web src/lib/agents/user-limits.ts. The hard caps live in [SolarchikConfig];
 * the player may only tighten them. Anything outside the range is clamped on read and write.
 */
@Serializable
data class UserCaps(
    val maxTradeSol: Double = SolarchikConfig.HARD_MAX_TRADE_SOL,
    val dayCapSol: Double = SolarchikConfig.HARD_DAY_CAP_SOL,
    val maxLosses: Int = SolarchikConfig.HARD_MAX_LOSSES,
    val dayLossSol: Double = SolarchikConfig.HARD_DAY_LOSS_SOL,
    val paused: Boolean = false,
)

/** Why a position was not opened. Codes are stable; text is localized in the UI. */
enum class Block { PAUSED, LOSSES, TRADE, DAY_CAP, DAY_LOSS }

data class BlockReason(val block: Block, val limit: Double, val user: Boolean)

object RiskCaps {
    const val MIN = 0.001

    private fun clamp(n: Double, lo: Double, hi: Double): Double = if (!n.isFinite()) hi else n.coerceIn(lo, hi)

    fun clamp(c: UserCaps): UserCaps = UserCaps(
        maxTradeSol = clamp(c.maxTradeSol, MIN, SolarchikConfig.HARD_MAX_TRADE_SOL),
        dayCapSol = clamp(c.dayCapSol, MIN, SolarchikConfig.HARD_DAY_CAP_SOL),
        maxLosses = c.maxLosses.coerceIn(1, SolarchikConfig.HARD_MAX_LOSSES),
        dayLossSol = clamp(c.dayLossSol, MIN, SolarchikConfig.HARD_DAY_LOSS_SOL),
        paused = c.paused,
    )

    /**
     * Null when a position may open. Hard caps first (always), then the stricter user caps,
     * in the same order as web userTradeBlock.
     */
    fun block(caps0: UserCaps, amount: Double, lossStreak: Int, daySpent: Double, dayLoss: Double): BlockReason? {
        val caps = clamp(caps0)
        val eps = 1e-12
        if (caps.paused) return BlockReason(Block.PAUSED, 0.0, true)
        if (lossStreak >= caps.maxLosses) {
            return BlockReason(Block.LOSSES, caps.maxLosses.toDouble(), caps.maxLosses < SolarchikConfig.HARD_MAX_LOSSES)
        }
        if (amount > caps.maxTradeSol + eps) {
            return BlockReason(Block.TRADE, caps.maxTradeSol, caps.maxTradeSol + eps < SolarchikConfig.HARD_MAX_TRADE_SOL)
        }
        if (amount > 0 && daySpent + amount > caps.dayCapSol + eps) {
            return BlockReason(Block.DAY_CAP, caps.dayCapSol, caps.dayCapSol + eps < SolarchikConfig.HARD_DAY_CAP_SOL)
        }
        if (dayLoss + eps >= caps.dayLossSol) {
            return BlockReason(Block.DAY_LOSS, caps.dayLossSol, caps.dayLossSol + eps < SolarchikConfig.HARD_DAY_LOSS_SOL)
        }
        return null
    }

    /** Web classes.ts dynamicSize with the "balanced" risk mode. */
    fun dynamicSize(max: Double, confidence: Double, free: Double): Double {
        val c = confidence.coerceIn(0.0, 1.0)
        val raw = max * (0.35 + 0.65 * c) * 0.7
        val cap = maxOf(0.0, free) * 0.12
        val n = minOf(raw, max, cap)
        return Math.round(maxOf(0.0, n) * 1e4) / 1e4
    }
}
