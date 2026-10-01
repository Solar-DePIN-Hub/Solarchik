/**
 * Fee-free windows (rewards for clock-in streaks). Pure: shared by save.ts, the
 * fee ledger and the tests. The native app mirrors these rules exactly.
 *
 * Rules:
 * - Coverage: a trade is fee-free when its openedAt falls inside ANY window the
 *   player activated (startedAt <= openedAt < endsAt), still active or already spent.
 * - Reward ids carry the UTC grant day: `h48-<N>-<YYYY-MM-DD>` and
 *   `d7-<thirty>-<YYYY-MM-DD>`. Same id on the same day is granted once.
 *   Old ids without a day (`d7-30`, `h48-2`) stay valid and never block new ones.
 * - At most FEE_WINDOW_CAP rows are kept: available and active first, then the
 *   most recent spent ones.
 */

export type FeeWindow = {
  id: string;
  kind: "h48" | "d7";
  milestone: number;
  status: "available" | "active" | "spent";
  grantedAt: number;
  startedAt: number;
  endsAt: number;
};

export const FEE_WINDOW_CAP = 24;
export const H48_MS = 48 * 60 * 60 * 1000;
export const D7_MS = 7 * 24 * 60 * 60 * 1000;

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function h48RewardId(n: number, now: number): string {
  return `h48-${n}-${utcDayKey(now)}`;
}

export function d7RewardId(thirty: number, now: number): string {
  return `d7-${thirty}-${utcDayKey(now)}`;
}

/** Next 48 h reward number. Counts from the highest milestone, so trimming old rows never repeats a number. */
export function nextH48Number(rows: FeeWindow[]): number {
  let top = 0;
  for (const w of rows) if (w.kind === "h48") top = Math.max(top, Math.floor(w.milestone / 7));
  return Math.max(top, rows.filter((w) => w.kind === "h48").length) + 1;
}

/** Keeps every available/active row and the most recent spent rows, at most `cap`, in original order. */
export function trimWindows(rows: FeeWindow[], cap = FEE_WINDOW_CAP): FeeWindow[] {
  if (rows.length <= cap) return rows;
  const live = rows.filter((w) => w.status !== "spent");
  const room = Math.max(0, cap - live.length);
  const spent = rows
    .filter((w) => w.status === "spent")
    .sort((a, b) => (b.endsAt || b.grantedAt) - (a.endsAt || a.grantedAt))
    .slice(0, room);
  const keep = new Set([...live.slice(0, cap), ...spent]);
  return rows.filter((w) => keep.has(w));
}

export function grantWindow(
  rows: FeeWindow[],
  input: { id: string; kind: FeeWindow["kind"]; milestone: number; now: number },
): FeeWindow[] {
  if (rows.some((w) => w.id === input.id)) return rows;
  return trimWindows([
    ...rows,
    {
      id: input.id,
      kind: input.kind,
      milestone: input.milestone,
      status: "available",
      grantedAt: input.now,
      startedAt: 0,
      endsAt: 0,
    },
  ]);
}

/** An active window past its end becomes spent; startedAt/endsAt are kept for coverage. */
export function expireWindows(rows: FeeWindow[], now: number): FeeWindow[] {
  return rows.map((w) => (w.status === "active" && w.endsAt > 0 && w.endsAt <= now ? { ...w, status: "spent" as const } : w));
}

/** Fee-free if openedAt is inside any activated window, active or spent. */
export function windowsCover(rows: readonly FeeWindow[], openedAt: number): boolean {
  if (!(openedAt > 0)) return false;
  return rows.some(
    (w) => (w.status === "active" || w.status === "spent") && w.startedAt > 0 && w.endsAt > w.startedAt && openedAt >= w.startedAt && openedAt < w.endsAt,
  );
}

/** Rewards for one clock-in day. Returns the new windows and the reset 7-day counter. */
export function grantStreakRewards(
  rows: FeeWindow[],
  counters: { seven: number; thirty: number },
  now: number,
): { rows: FeeWindow[]; seven: number } {
  let next = expireWindows(rows, now);
  let seven = counters.seven;
  if (seven >= 7) {
    const n = nextH48Number(next);
    next = grantWindow(next, { id: h48RewardId(n, now), kind: "h48", milestone: n * 7, now });
    seven = 0;
  }
  if (counters.thirty > 0 && counters.thirty % 30 === 0) {
    next = grantWindow(next, { id: d7RewardId(counters.thirty, now), kind: "d7", milestone: counters.thirty, now });
  }
  return { rows: next, seven };
}

export function activateWindow(rows: FeeWindow[], now: number): FeeWindow[] {
  const fresh = expireWindows(rows, now);
  if (fresh.some((w) => w.status === "active" && w.endsAt > now)) return fresh;
  const next = fresh.find((w) => w.status === "available");
  if (!next) return fresh;
  const dur = next.kind === "h48" ? H48_MS : D7_MS;
  return fresh.map((w) => (w.id === next.id ? { ...w, status: "active" as const, startedAt: now, endsAt: now + dur } : w));
}

/** Sanitize saved rows. Reads all, then trims, so new rewards are never dropped at the cap. */
export function readWindows(raw: unknown): FeeWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: FeeWindow[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, 200)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id || "").slice(0, 32);
    if (!id || seen.has(id)) continue;
    const kind = o.kind === "d7" ? "d7" : o.kind === "h48" ? "h48" : null;
    if (!kind) continue;
    const status = o.status === "active" || o.status === "spent" || o.status === "available" ? o.status : "available";
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    seen.add(id);
    out.push({
      id,
      kind,
      milestone: Math.max(0, Math.floor(num(o.milestone))),
      status,
      grantedAt: num(o.grantedAt),
      startedAt: num(o.startedAt),
      endsAt: num(o.endsAt),
    });
  }
  return trimWindows(out);
}
