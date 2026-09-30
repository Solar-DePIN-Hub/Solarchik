const KEY = "solarchik.arb-credit.v1";

export function readArbCredit(asset: string): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "") as Record<string, unknown>;
    const n = raw[asset];
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function addArbCredit(asset: string, sol: number): number {
  if (typeof localStorage === "undefined") return 0;
  const next = Math.round((readArbCredit(asset) + sol) * 1e9) / 1e9;
  let all: Record<string, number> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "") as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) all[k] = v;
    }
  } catch {
    all = {};
  }
  all[asset] = next;
  localStorage.setItem(KEY, JSON.stringify(all));
  return next;
}

export function takeArbCredit(asset: string, sol: number): number | null {
  const have = readArbCredit(asset);
  if (!(have + 1e-9 >= sol)) return null;
  const next = Math.round((have - sol) * 1e9) / 1e9;
  let all: Record<string, number> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "") as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) all[k] = v;
    }
  } catch {
    all = {};
  }
  if (next > 0) all[asset] = next;
  else delete all[asset];
  localStorage.setItem(KEY, JSON.stringify(all));
  return next;
}
