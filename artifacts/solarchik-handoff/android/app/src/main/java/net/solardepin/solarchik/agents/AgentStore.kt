package net.solardepin.solarchik.agents

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import net.solardepin.solarchik.core.FeeLedger
import net.solardepin.solarchik.core.FeeRow

/** A strategy NFT this phone minted (or found on chain for the connected wallet). */
@Serializable
data class OwnedAgent(
    val asset: String,
    val skuId: String,
    val tier: String,
    val name: String,
    val owner: String,
    val cluster: String,
    val sig: String = "",
    val mintedAt: Long = 0,
    /** pending | verified | missing */
    val status: String = STATUS_PENDING,
    val checkedAt: Long = 0,
) {
    companion object {
        const val STATUS_PENDING = "pending"
        const val STATUS_VERIFIED = "verified"
        const val STATUS_MISSING = "missing"
    }
}

/** Local records: owned agents and the fee ledger. Chain stays the source of truth for ownership. */
class AgentStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("solarchik-agents", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun agents(): List<OwnedAgent> = prefs.getString(KEY_AGENTS, null)?.let {
        runCatching { json.decodeFromString(ListSerializer(OwnedAgent.serializer()), it) }.getOrNull()
    } ?: emptyList()

    fun agentsFor(owner: String, cluster: String): List<OwnedAgent> =
        agents().filter { it.owner == owner && it.cluster == cluster }

    fun upsert(agent: OwnedAgent) {
        val all = agents().filter { it.asset != agent.asset } + agent
        prefs.edit().putString(KEY_AGENTS, json.encodeToString(ListSerializer(OwnedAgent.serializer()), all.takeLast(200))).apply()
    }

    /** One FREE per wallet: any FREE record for this wallet that the chain has not ruled out. */
    fun freeClaimed(owner: String, cluster: String): Boolean =
        agentsFor(owner, cluster).any { it.tier == "free" && it.status != OwnedAgent.STATUS_MISSING }

    fun fees(): List<FeeRow> = prefs.getString(KEY_FEES, null)?.let {
        runCatching { FeeLedger.sanitize(json.decodeFromString(ListSerializer(FeeRow.serializer()), it)) }.getOrNull()
    } ?: emptyList()

    fun addFee(row: FeeRow) {
        val all = (listOf(row) + fees().filter { it.id != row.id }).take(200)
        prefs.edit().putString(KEY_FEES, json.encodeToString(ListSerializer(FeeRow.serializer()), all)).apply()
    }

    companion object {
        private const val KEY_AGENTS = "owned.v1"
        private const val KEY_FEES = "fees.v1"
    }
}
