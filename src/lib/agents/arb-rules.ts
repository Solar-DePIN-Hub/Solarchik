/** Arb fire rules shared by the server guard, the desk UI and the tests. No I/O here. */

export type ArbMode = "mainnet" | "sim" | "closed";

/** "shared" = Postgres via DATABASE_URL. "dev" = in-memory PGLite under `vite dev`. "none" = nothing safe to count on. */
export type ArbStore = "shared" | "dev" | "none";

export type ArbModeInfo = { mode: ArbMode; reason: string };

export type ArbLimits = {
  /** All wallets together, per UTC day. */
  dayCapSol: number;
  /** One wallet, per UTC day. */
  walletDayCapSol: number;
  walletDayFires: number;
  /** Spacing between any two fires. */
  minGapMs: number;
  /** Spacing between two fires of one wallet. */
  walletGapMs: number;
};

/** One fire moves this much SOL notional. Same as the old LIVE_MAX. */
export const ARB_FIRE_SOL = 0.005;

export const ARB_LIMITS: Record<"mainnet" | "sim", ArbLimits> = {
  mainnet: { dayCapSol: 0.02, walletDayCapSol: 0.01, walletDayFires: 2, minGapMs: 30_000, walletGapMs: 30_000 },
  sim: { dayCapSol: 1, walletDayCapSol: 0.1, walletDayFires: 20, minGapMs: 30_000, walletGapMs: 30_000 },
};

export const SIM_LABEL = "СИМУЛЯЦІЯ · devnet, без грошей";

/**
 * Mainnet only when the server flag is exactly "true" AND a shared database
 * holds the caps. Anything else is a simulation or closed. Never mainnet by default.
 */
export function arbModeFor(flag: string | undefined, store: ArbStore): ArbModeInfo {
  const wantMainnet = (flag ?? "").trim().toLowerCase() === "true";
  if (store === "none") {
    return { mode: "closed", reason: "Каса закрита: немає спільної бази (DATABASE_URL), ліміти не перевірити." };
  }
  if (wantMainnet) {
    if (store !== "shared") return { mode: "closed", reason: "Mainnet вимкнено: потрібна спільна база (DATABASE_URL)." };
    return { mode: "mainnet", reason: "Mainnet увімкнено на сервері. Ліміт каси 0.02 SOL на добу." };
  }
  return { mode: "sim", reason: `${SIM_LABEL}. Mainnet вимкнено на сервері.` };
}

export function solToLamports(sol: number): number {
  return Math.round(sol * 1e9);
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Free-mint claim lock. After this the on-chain check is the only truth again. */
export const FREE_CLAIM_LOCK_MS = 10 * 60_000;

/** Same cleanup on both sides, so the signed text matches what the server checks. */
export function cleanArbSymbol(symbol: string | undefined): string {
  const out = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 16);
  return out || "SOL";
}
