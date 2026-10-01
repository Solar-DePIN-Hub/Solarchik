/** User caps live in solarchik.limits.v1 next to the desk's day spend. They can only go down. */

export const HARD_MAX_TRADE = 0.02;
export const HARD_DAY_CAP = 0.3;
export const HARD_MAX_LOSSES = 2;
export const HARD_DAY_LOSS = 0.3;
const KEY = "solarchik.limits.v1";

export type UserCaps = {
  maxTradeSol: number;
  dayCapSol: number;
  maxLosses: number;
  dayLossSol: number;
  paused: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return hi;
  return Math.min(hi, Math.max(lo, n));
}

export function defaultCaps(): UserCaps {
  return {
    maxTradeSol: HARD_MAX_TRADE,
    dayCapSol: HARD_DAY_CAP,
    maxLosses: HARD_MAX_LOSSES,
    dayLossSol: HARD_DAY_LOSS,
    paused: false,
  };
}

export function readCaps(): UserCaps {
  const d = defaultCaps();
  if (typeof localStorage === "undefined") return d;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "") as Partial<UserCaps>;
    return {
      maxTradeSol: clamp(typeof raw.maxTradeSol === "number" ? raw.maxTradeSol : d.maxTradeSol, 0.001, HARD_MAX_TRADE),
      dayCapSol: clamp(typeof raw.dayCapSol === "number" ? raw.dayCapSol : d.dayCapSol, 0.001, HARD_DAY_CAP),
      maxLosses: Math.round(clamp(typeof raw.maxLosses === "number" ? raw.maxLosses : d.maxLosses, 1, HARD_MAX_LOSSES)),
      dayLossSol: clamp(typeof raw.dayLossSol === "number" ? raw.dayLossSol : d.dayLossSol, 0.001, HARD_DAY_LOSS),
      paused: raw.paused === true,
    };
  } catch {
    return d;
  }
}

export function writeCaps(next: UserCaps): UserCaps {
  const caps: UserCaps = {
    maxTradeSol: clamp(next.maxTradeSol, 0.001, HARD_MAX_TRADE),
    dayCapSol: clamp(next.dayCapSol, 0.001, HARD_DAY_CAP),
    maxLosses: Math.round(clamp(next.maxLosses, 1, HARD_MAX_LOSSES)),
    dayLossSol: clamp(next.dayLossSol, 0.001, HARD_DAY_LOSS),
    paused: next.paused === true,
  };
  if (typeof localStorage === "undefined") return caps;
  let prev: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "");
    if (parsed && typeof parsed === "object") prev = parsed as Record<string, unknown>;
  } catch {
    prev = {};
  }
  localStorage.setItem(KEY, JSON.stringify({ ...prev, ...caps }));
  return caps;
}

/** Null when the hardcoded gates still decide. A string when the user cap is stricter. */
export function userTradeBlock(amount: number, lossStreak: number, daySpent: number, dayLoss: number): string | null {
  const caps = readCaps();
  if (caps.paused) return "Агент на паузі. Угоду не відправляю.";
  if (caps.maxLosses < HARD_MAX_LOSSES && lossStreak >= caps.maxLosses) {
    return `Ліміт збитків ${caps.maxLosses}. Угоду не відправляю.`;
  }
  if (amount > 0 && caps.maxTradeSol + 1e-12 < HARD_MAX_TRADE && amount > caps.maxTradeSol) {
    return `Ліміт угоди ${caps.maxTradeSol} SOL. Угоду не відправляю.`;
  }
  if (amount > 0 && caps.dayCapSol + 1e-12 < HARD_DAY_CAP && daySpent + amount > caps.dayCapSol) {
    return `Денний ліміт ${caps.dayCapSol} SOL. Угоду не відправляю.`;
  }
  if (caps.dayLossSol + 1e-12 < HARD_DAY_LOSS && dayLoss >= caps.dayLossSol) {
    return `Денний мінус ${caps.dayLossSol} SOL. Угоду не відправляю.`;
  }
  return null;
}
