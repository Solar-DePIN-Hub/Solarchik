package net.solardepin.solarchik.core

import net.solardepin.solarchik.BuildConfig

/**
 * Every product number in one place. Mirrors the web rules in
 * src/lib/agents/fees.config.ts, user-limits.ts, src/lib/game/save.ts and src/lib/game/pay.ts.
 * Change a number here and the whole APK follows.
 */
object SolarchikConfig {
    // --- Strategy NFT tiers (fees.config.ts) ---
    /** PRO mint price, paid to [TREASURY]. */
    const val PRO_PRICE_SOL = 0.1
    /** FREE tier performance fee on realized profit only. PRO pays 0. */
    const val FREE_FEE_RATE = 0.05
    /** Metaplex Core Royalties plugin on both tiers. */
    const val ROYALTY_BPS = 500
    /** FREE mints allowed per wallet. */
    const val FREE_PER_WALLET = 1
    /** Paid PRO mint on mainnet (Seeker). Off until launch; devnet PRO always works. */
    val MAINNET_PAID_MINT: Boolean = BuildConfig.MAINNET_PAID_MINT

    // --- Treasury (pay.ts PAY_WALLET). Public receive address only. ---
    const val TREASURY = "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic"

    // --- Streak + fee-free windows (save.ts) ---
    /** Signed days toward one 48h window. Counter restarts after the reward. */
    const val STREAK_SHORT_DAYS = 7
    const val WINDOW_SHORT_HOURS = 48L
    /** Signed days toward one 7-day window at 30/60/90… Counter does not restart. */
    const val STREAK_LONG_DAYS = 30
    const val WINDOW_LONG_DAYS = 7L
    const val WINDOW_SHORT_MS = WINDOW_SHORT_HOURS * 60 * 60 * 1000
    const val WINDOW_LONG_MS = WINDOW_LONG_DAYS * 24 * 60 * 60 * 1000
    /** Kept UTC days of signed history (web keeps 120). */
    const val CLOCK_DAYS_KEEP = 120

    // --- Run ---
    /** Meters that unlock today's signed CLOCK IN. */
    const val RUN_GOAL_M = 1200

    // --- Agent risk caps (user-limits.ts). User caps can only go down from these. ---
    const val HARD_MAX_TRADE_SOL = 0.02
    const val HARD_DAY_CAP_SOL = 0.3
    const val HARD_MAX_LOSSES = 2
    const val HARD_DAY_LOSS_SOL = 0.3

    // --- Chain ---
    const val MPL_CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
    const val SYSTEM_PROGRAM = "11111111111111111111111111111111"
    const val MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
    const val AGENT_URI = "urn:solarchik:agent"
    const val CORE_NAME_MAX = 32
    const val RPC_DEVNET = "https://api.devnet.solana.com"
    const val RPC_MAINNET = "https://api.mainnet-beta.solana.com"
    const val AIRDROP_SOL = 1.0
    const val LAMPORTS_PER_SOL = 1_000_000_000L

    // --- Sol (AI friend worker) ---
    const val FRIEND_CHAT_URL = "https://friend.solardepin.net/v1/chat"

    fun lamports(sol: Double): Long = Math.round(sol * LAMPORTS_PER_SOL)
}
