package net.solardepin.solarchik.sol

/**
 * 0.21.8: an action the player asked for by voice DURING a run ("start my weather agent"). The run never
 * executes anything; the request waits here and the Sol tab shows its confirmation card after the run.
 */
object SolHandoff {
    data class Pending(val said: String, val action: SolAction, val at: Long = System.currentTimeMillis())

    @Volatile private var pending: Pending? = null

    fun put(said: String, action: SolAction) { pending = Pending(said, action) }

    /** The waiting request (once), unless it is older than [maxAgeMs]. */
    fun take(now: Long = System.currentTimeMillis(), maxAgeMs: Long = 30 * 60_000L): Pending? {
        val p = pending ?: return null
        pending = null
        return p.takeIf { now - it.at <= maxAgeMs }
    }

    fun peek(): Pending? = pending
}
