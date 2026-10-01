package net.solardepin.solarchik.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.ZoneOffset

/**
 * Exact port of web src/lib/game/fee-windows.ts (branch web-fees).
 * - Coverage: openedAt inside ANY activated window (startedAt <= openedAt < endsAt), active or spent.
 * - Ids carry the UTC grant day: `h48-<N>-<YYYY-MM-DD>`, `d7-<thirty>-<YYYY-MM-DD>`; same id once.
 *   Old ids without a day stay valid and never block new ones.
 * - At most [CAP] rows: available/active first, then the newest spent ones.
 */
object FeeWindows {
    const val CAP = 24
    val H48_MS = SolarchikConfig.WINDOW_SHORT_MS
    val D7_MS = SolarchikConfig.WINDOW_LONG_MS

    fun utcDayKey(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()
    fun h48RewardId(n: Int, now: Long) = "h48-$n-${utcDayKey(now)}"
    fun d7RewardId(thirty: Int, now: Long) = "d7-$thirty-${utcDayKey(now)}"

    /** Counts on from the highest milestone, so trimming old rows never repeats a number. */
    fun nextH48Number(rows: List<FeeWindow>): Int {
        var top = 0
        for (w in rows) if (w.kind == FeeWindow.KIND_SHORT) top = maxOf(top, w.milestone / 7)
        return maxOf(top, rows.count { it.kind == FeeWindow.KIND_SHORT }) + 1
    }

    fun trim(rows: List<FeeWindow>, cap: Int = CAP): List<FeeWindow> {
        if (rows.size <= cap) return rows
        val live = rows.filter { it.status != FeeWindow.SPENT }
        val room = maxOf(0, cap - live.size)
        val spent = rows.filter { it.status == FeeWindow.SPENT }
            .sortedByDescending { if (it.endsAt != 0L) it.endsAt else it.grantedAt }
            .take(room)
        val keep = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<FeeWindow, Boolean>()).apply {
            addAll(live.take(cap)); addAll(spent)
        }
        return rows.filter { it in keep }
    }

    fun grant(rows: List<FeeWindow>, id: String, kind: String, milestone: Int, now: Long): List<FeeWindow> {
        if (rows.any { it.id == id }) return rows
        return trim(rows + FeeWindow(id, kind, milestone, FeeWindow.AVAILABLE, grantedAt = now, startedAt = 0, endsAt = 0))
    }

    fun expire(rows: List<FeeWindow>, now: Long): List<FeeWindow> = rows.map {
        if (it.status == FeeWindow.ACTIVE && it.endsAt > 0 && it.endsAt <= now) it.copy(status = FeeWindow.SPENT) else it
    }

    fun covers(rows: List<FeeWindow>, openedAt: Long): Boolean {
        if (openedAt <= 0) return false
        return rows.any {
            (it.status == FeeWindow.ACTIVE || it.status == FeeWindow.SPENT) && it.startedAt > 0 && it.endsAt > it.startedAt &&
                openedAt >= it.startedAt && openedAt < it.endsAt
        }
    }

    data class Granted(val rows: List<FeeWindow>, val seven: Int)

    fun grantStreakRewards(rows: List<FeeWindow>, seven0: Int, thirty: Int, now: Long): Granted {
        var next = expire(rows, now)
        var seven = seven0
        if (seven >= SolarchikConfig.STREAK_SHORT_DAYS) {
            val n = nextH48Number(next)
            next = grant(next, h48RewardId(n, now), FeeWindow.KIND_SHORT, n * SolarchikConfig.STREAK_SHORT_DAYS, now)
            seven = 0
        }
        if (thirty > 0 && thirty % SolarchikConfig.STREAK_LONG_DAYS == 0) {
            next = grant(next, d7RewardId(thirty, now), FeeWindow.KIND_LONG, thirty, now)
        }
        return Granted(next, seven)
    }

    fun activate(rows: List<FeeWindow>, now: Long): List<FeeWindow> {
        val fresh = expire(rows, now)
        if (fresh.any { it.status == FeeWindow.ACTIVE && it.endsAt > now }) return fresh
        val next = fresh.firstOrNull { it.status == FeeWindow.AVAILABLE } ?: return fresh
        val dur = if (next.kind == FeeWindow.KIND_SHORT) H48_MS else D7_MS
        return fresh.map { if (it.id == next.id) it.copy(status = FeeWindow.ACTIVE, startedAt = now, endsAt = now + dur) else it }
    }

    /** Sanitize saved rows like web readWindows: read all (max 200), dedupe, then trim. */
    fun read(raw: JsonElement?): List<FeeWindow> {
        val arr = raw as? JsonArray ?: return emptyList()
        val out = ArrayList<FeeWindow>()
        val seen = HashSet<String>()
        for (row in arr.take(200)) {
            val o = row as? JsonObject ?: continue
            fun str(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            fun num(k: String): Double = (o[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() } ?: 0.0
            val id = ((o["id"] as? JsonPrimitive)?.contentOrNull ?: "").take(32)
            if (id.isEmpty() || id in seen) continue
            val kind = when (str("kind")) { "d7" -> FeeWindow.KIND_LONG; "h48" -> FeeWindow.KIND_SHORT; else -> null } ?: continue
            seen.add(id)
            val status = when (str("status")) { FeeWindow.ACTIVE, FeeWindow.SPENT, FeeWindow.AVAILABLE -> str("status")!!; else -> FeeWindow.AVAILABLE }
            out += FeeWindow(id, kind, maxOf(0, Math.floor(num("milestone")).toInt()), status, num("grantedAt").toLong(), num("startedAt").toLong(), num("endsAt").toLong())
        }
        return trim(out)
    }
}
