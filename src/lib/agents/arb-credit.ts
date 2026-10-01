/**
 * Arb credit lives on the server (verified deposits minus mainnet fires).
 * This file only keeps a display cache and the list of deposits whose server
 * claim did not finish yet, so they are retried on the next load.
 */
const KEY = "solarchik.arb-credit.v2";
const PENDING_KEY = "solarchik.arb-credit-pending.v1";

function readMap(key: string): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Last credit the server reported for this NFT (display only). */
export function readArbCredit(asset: string): number {
  const n = readMap(KEY)[asset];
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

export function writeArbCreditCache(asset: string, sol: number): void {
  if (typeof localStorage === "undefined") return;
  const all = readMap(KEY);
  if (Number.isFinite(sol) && sol > 0) all[asset] = Math.round(sol * 1e9) / 1e9;
  else delete all[asset];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or private mode */
  }
}

export type PendingCredit = { sig: string; asset: string; wallet: string };

export function readPendingCredits(): PendingCredit[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is PendingCredit => Boolean(r) && typeof r.sig === "string" && typeof r.asset === "string" && typeof r.wallet === "string")
      .slice(-20);
  } catch {
    return [];
  }
}

function writePending(rows: PendingCredit[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rows.slice(-20)));
  } catch {
    /* ignore */
  }
}

export function addPendingCredit(row: PendingCredit): void {
  if (typeof localStorage === "undefined") return;
  writePending([...readPendingCredits().filter((r) => r.sig !== row.sig), row]);
}

export function dropPendingCredit(sig: string): void {
  if (typeof localStorage === "undefined") return;
  writePending(readPendingCredits().filter((r) => r.sig !== sig));
}
