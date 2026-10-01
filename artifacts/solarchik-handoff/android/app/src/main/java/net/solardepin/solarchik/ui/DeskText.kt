package net.solardepin.solarchik.ui

import android.content.Context
import net.solardepin.solarchik.R
import net.solardepin.solarchik.agents.engine.Block
import net.solardepin.solarchik.agents.engine.DeskEvent
import net.solardepin.solarchik.agents.engine.EventKind
import java.math.BigDecimal
import java.math.RoundingMode

/** Words desk events in the player's language. Numbers come only from the event itself. */
object DeskText {
    fun side(ctx: Context, s: String): String = when (s) {
        "up" -> ctx.getString(R.string.side_up)
        "down" -> ctx.getString(R.string.side_down)
        "yes" -> ctx.getString(R.string.side_yes)
        "no" -> ctx.getString(R.string.side_no)
        else -> s
    }

    fun conf(c: Double): String = BigDecimal(c * 100).setScale(0, RoundingMode.HALF_UP).toPlainString() + "%"

    fun block(ctx: Context, code: String, limit: Double): String = when (runCatching { Block.valueOf(code) }.getOrNull()) {
        Block.PAUSED -> ctx.getString(R.string.block_paused)
        Block.LOSSES -> ctx.getString(R.string.block_losses, limit.toInt())
        Block.TRADE -> ctx.getString(R.string.block_trade, Fmt.sol(limit))
        Block.DAY_CAP -> ctx.getString(R.string.block_day_cap, Fmt.sol(limit))
        Block.DAY_LOSS -> ctx.getString(R.string.block_day_loss, Fmt.sol(limit))
        null -> code
    }

    fun event(ctx: Context, e: DeskEvent): String = when (e.kind) {
        EventKind.WATCH -> ctx.getString(R.string.ev_watch, e.agent, e.label)
        EventKind.SKIP -> ctx.getString(R.string.ev_skip, e.agent, e.label, side(ctx, e.side), conf(e.confidence))
        EventKind.FUNDS -> ctx.getString(R.string.ev_funds, e.agent, side(ctx, e.side))
        EventKind.BLOCK -> ctx.getString(R.string.ev_block, e.agent, block(ctx, e.block, e.limit))
        EventKind.OPEN -> ctx.getString(R.string.ev_open, e.agent, side(ctx, e.side), e.label, Fmt.sol(e.stake), conf(e.confidence))
        EventKind.CLOSE -> ctx.getString(R.string.ev_close, e.agent, side(ctx, e.side), e.label, Fmt.signedSol(e.pnl, 6))
        EventKind.NODATA -> ctx.getString(R.string.ev_nodata, e.agent)
        else -> e.agent
    }
}
