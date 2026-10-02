package net.solardepin.solarchik.agents

import net.solardepin.solarchik.core.Catalog

/**
 * 0.21.8: who may run which agent. A paper run needs the agent too (it used to start every catalog
 * strategy as a free "trial"): any local record of the same base strategy that is not missing on chain,
 * minted or bought on any cluster. Devnet runs keep their stricter per-asset check in the desk.
 */
object Ownership {
    private fun base(skuId: String): String = Catalog.baseOf(skuId)?.id ?: skuId.removeSuffix("-pro")

    fun ownsSku(records: List<OwnedAgent>, skuId: String): Boolean {
        val want = base(skuId)
        return records.any { it.status != OwnedAgent.STATUS_MISSING && base(it.skuId) == want }
    }
}
