package net.solardepin.solarchik.agents

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
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

    fun agents(): List<OwnedAgent> = readList(KEY_AGENTS, OwnedAgent.serializer())

    /**
     * Reads a stored list. If the blob does not decode as a whole (corrupt write, or a record shape
     * from another build), the raw text is kept aside under `<key>.unreadable` and every record
     * that still decodes is salvaged, so the next write does not wipe the player's agents or ledger.
     */
    private fun <T> readList(key: String, item: KSerializer<T>): List<T> {
        val raw = prefs.getString(key, null) ?: return emptyList()
        runCatching { json.decodeFromString(ListSerializer(item), raw) }.onSuccess { return it }
        if (!prefs.contains("$key$BAD")) prefs.edit().putString("$key$BAD", raw).apply()
        val arr = runCatching { json.parseToJsonElement(raw) as? JsonArray }.getOrNull() ?: return emptyList()
        return arr.mapNotNull { e -> runCatching { json.decodeFromJsonElement(item, e) }.getOrNull() }
    }

    fun unreadable(key: String = KEY_AGENTS): String? = prefs.getString("$key$BAD", null)

    fun agentsFor(owner: String, cluster: String): List<OwnedAgent> =
        agents().filter { it.owner == owner && it.cluster == cluster }

    // commit(): Minter saves the pending record right before the wallet opens; it must be on disk
    // if the app is killed while the wallet sends.
    @android.annotation.SuppressLint("ApplySharedPref")
    fun upsert(agent: OwnedAgent) {
        val all = agents().filter { it.asset != agent.asset } + agent
        prefs.edit().putString(KEY_AGENTS, json.encodeToString(ListSerializer(OwnedAgent.serializer()), all.takeLast(200))).commit()
    }

    @android.annotation.SuppressLint("ApplySharedPref")
    fun remove(asset: String) {
        val all = agents().filter { it.asset != asset }
        prefs.edit().putString(KEY_AGENTS, json.encodeToString(ListSerializer(OwnedAgent.serializer()), all)).commit()
    }

    /** One FREE per wallet: any FREE record for this wallet that the chain has not ruled out. */
    fun freeClaimed(owner: String, cluster: String): Boolean =
        agentsFor(owner, cluster).any { it.tier == "free" && it.status != OwnedAgent.STATUS_MISSING }

    fun fees(): List<FeeRow> = FeeLedger.sanitize(readList(KEY_FEES, FeeRow.serializer()))

    fun addFee(row: FeeRow) {
        val all = (listOf(row) + fees().filter { it.id != row.id }).take(200)
        prefs.edit().putString(KEY_FEES, json.encodeToString(ListSerializer(FeeRow.serializer()), all)).apply()
    }

    /** Rewrites fee rows in place, keeping their order (used after a fee payment lands). */
    fun updateFees(transform: (FeeRow) -> FeeRow) {
        val all = fees().map(transform)
        prefs.edit().putString(KEY_FEES, json.encodeToString(ListSerializer(FeeRow.serializer()), all)).apply()
    }

    companion object {
        const val KEY_AGENTS = "owned.v1"
        const val KEY_FEES = "fees.v1"
        const val BAD = ".unreadable"
    }
}
