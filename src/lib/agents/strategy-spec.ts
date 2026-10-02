/**
 * Strategy NFT spec: the strategy an agent trades, stored in its Core Attributes.
 * Shared by the browser (editor, engine gate), the server (validation, position
 * checks, on-chain writes) and the tests. Pure: no network, no Node-only APIs.
 *
 * On-chain keys (Attributes plugin, update authority = server mint key):
 *   strategy  lo lanes on, pw windows, ab ask band, ps stake SOL, pe edge bps,
 *             sr risk, sl stop %, tp take %, rl rules DSL, pf/pm/pwin derived
 *   identity  sx schema, sv version, sh hash (base58 sha256 of the canonical spec),
 *             sc lastChangedAt (unix s), su sale unlock (unix s): = sc at mint (v1, no lock),
 *             = sc + 240 h after any strategy change
 *   results   rn trades, rw win rate %, rpnl realized SOL (all since sc),
 *             a7 / a30 / apr  APR % over 7 d / 30 d / since change, pu written at (unix s),
 *             jobs/wins/losses/pnl lifetime (server positions)
 */
import { encodeBase58 } from "./base58.ts";

export const SPEC_SCHEMA = 1;
/** Sale lock after a strategy change (not at mint). */
export const SALE_LOCK_HOURS = 240;
export const SALE_LOCK_MS = SALE_LOCK_HOURS * 3_600_000;
export const SPEC_STAKE_MIN = 0.005;
export const SPEC_STAKE_MAX = 0.02;
export const RULES_MAX_CHARS = 160;
export const RULES_MAX_COUNT = 6;
/** Server price read lags the client's quote; band checks allow this much drift. */
export const PRICE_DRIFT = 0.05;

export type SpecLane = "crypto" | "events" | "weather";
export type SpecRisk = "calm" | "balanced" | "risky";
export const SPEC_LANES: readonly SpecLane[] = ["crypto", "events", "weather"];
export const SPEC_WINDOWS: readonly number[] = [5, 15, 60, 240];
export const SPEC_RISKS: readonly SpecRisk[] = ["calm", "balanced", "risky"];

export type StrategySpec = {
  lanes: SpecLane[];
  windows: number[];
  risk: SpecRisk;
  stakeSol: number;
  askLo: number;
  askHi: number;
  edgeBps: number;
  stopPct: number;
  takePct: number;
  rules: string;
};

/* ------------------------------ rules DSL ------------------------------ */
// rule  := ("allow" | "deny") [yes | no] [if cond (and cond)*]
// cond  := var op value     var: price | hour | window | lane | stake
// op    := < <= > >= = !=   rules are split by ";" or new lines
// price = price of the side being bought (0..1), hour = UTC hour, window = minutes (0 off-crypto)

export type RuleVar = "price" | "hour" | "window" | "lane" | "stake";
export type RuleOp = "<" | "<=" | ">" | ">=" | "=" | "!=";
export type RuleCond = { v: RuleVar; op: RuleOp; value: number | string };
export type Rule = { kind: "allow" | "deny"; side: "yes" | "no" | null; conds: RuleCond[] };
export type TradeCtx = { side: "yes" | "no"; price: number; hour: number; window: number; lane: SpecLane; stake: number };

const VARS: Record<RuleVar, { min: number; max: number } | "lane"> = {
  price: { min: 0, max: 1 },
  hour: { min: 0, max: 23 },
  window: { min: 0, max: 240 },
  stake: { min: 0, max: SPEC_STAKE_MAX },
  lane: "lane",
};

export function parseRules(text: string): { ok: true; rules: Rule[] } | { ok: false; error: string } {
  const src = String(text ?? "").toLowerCase();
  if (src.length > RULES_MAX_CHARS) return { ok: false, error: `Правила довші за ${RULES_MAX_CHARS} символів.` };
  if (/[^a-z0-9.;<>=!\s\n]/.test(src)) return { ok: false, error: "У правилах лише латиниця, числа, ; < > = !" };
  const lines = src.split(/[;\n]/).map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (lines.length > RULES_MAX_COUNT) return { ok: false, error: `Не більше ${RULES_MAX_COUNT} правил.` };
  const rules: Rule[] = [];
  for (const [i, line] of lines.entries()) {
    const tag = `Правило ${i + 1}`;
    const m = line.match(/^(allow|deny)(?: (yes|no))?(?: if (.+))?$/);
    if (!m) return { ok: false, error: `${tag}: почни з allow або deny (allow yes if price < 0.4).` };
    const conds: RuleCond[] = [];
    if (m[3]) {
      for (const part of m[3].split(" and ")) {
        const c = part.trim().match(/^(price|hour|window|lane|stake) ?(<=|>=|!=|<|>|=) ?([a-z]+|\d*\.?\d+)$/);
        if (!c) return { ok: false, error: `${tag}: не розібрав «${part.trim()}».` };
        const v = c[1] as RuleVar;
        const op = c[2] as RuleOp;
        const spec = VARS[v];
        if (spec === "lane") {
          if (!SPEC_LANES.includes(c[3] as SpecLane)) return { ok: false, error: `${tag}: lane = crypto, events або weather.` };
          if (op !== "=" && op !== "!=") return { ok: false, error: `${tag}: для lane лише = або !=.` };
          conds.push({ v, op, value: c[3] });
        } else {
          const n = Number(c[3]);
          if (!Number.isFinite(n) || n < spec.min || n > spec.max) return { ok: false, error: `${tag}: ${v} від ${spec.min} до ${spec.max}.` };
          conds.push({ v, op, value: n });
        }
      }
    } else if (m[1] === "deny" && !m[2]) {
      return { ok: false, error: `${tag}: deny без умови заборонить усе.` };
    }
    rules.push({ kind: m[1] as "allow" | "deny", side: (m[2] as "yes" | "no" | undefined) ?? null, conds });
  }
  return { ok: true, rules };
}

export function formatRules(rules: Rule[]): string {
  return rules
    .map((r) => [r.kind, r.side, r.conds.length ? `if ${r.conds.map((c) => `${c.v} ${c.op} ${c.value}`).join(" and ")}` : ""].filter(Boolean).join(" "))
    .join("; ");
}

function condHolds(c: RuleCond, ctx: TradeCtx): boolean {
  const left = ctx[c.v];
  if (typeof c.value === "string") return c.op === "=" ? left === c.value : left !== c.value;
  const x = Number(left);
  const y = c.value;
  switch (c.op) {
    case "<": return x < y;
    case "<=": return x <= y + 1e-12;
    case ">": return x > y;
    case ">=": return x >= y - 1e-12;
    case "=": return Math.abs(x - y) < 1e-9;
    default: return Math.abs(x - y) >= 1e-9;
  }
}

/** deny rules win; when allow rules exist, a trade needs at least one matching allow. */
export function rulesAllow(rules: Rule[], ctx: TradeCtx): { ok: true } | { ok: false; reason: string } {
  const hits = (r: Rule) => (r.side == null || r.side === ctx.side) && r.conds.every((c) => condHolds(c, ctx));
  const denied = rules.findIndex((r) => r.kind === "deny" && hits(r));
  if (denied >= 0) return { ok: false, reason: `Правило ${denied + 1} (deny) забороняє цю угоду.` };
  const allows = rules.filter((r) => r.kind === "allow");
  if (allows.length && !allows.some(hits)) return { ok: false, reason: "Жодне правило allow не підходить." };
  return { ok: true };
}

/* ------------------------------ validation ------------------------------ */

const round = (n: number, step: number) => Math.round(n / step) * step;
const fix = (n: number, d: number) => Number(n.toFixed(d));

export function validateSpec(raw: unknown): { ok: true; spec: StrategySpec } | { ok: false; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const lanesIn = Array.isArray(r.lanes) ? r.lanes.map(String) : [];
  const lanes = SPEC_LANES.filter((l) => lanesIn.includes(l));
  if (!lanes.length || lanes.length !== lanesIn.length || lanesIn.length !== new Set(lanesIn).size) errors.push("Смуги: crypto, events, weather (хоч одна, без повторів).");
  const winIn = Array.isArray(r.windows) ? r.windows.map(Number) : [];
  const windows = SPEC_WINDOWS.filter((w) => winIn.includes(w));
  if (winIn.some((w) => !SPEC_WINDOWS.includes(w))) errors.push("Вікна: лише 5, 15, 60, 240 хв.");
  if (lanes.includes("crypto") && !windows.length) errors.push("Для crypto потрібне хоч одне вікно.");
  const risk = SPEC_RISKS.includes(r.risk as SpecRisk) ? (r.risk as SpecRisk) : null;
  if (!risk) errors.push("Ризик: calm, balanced або risky.");
  const stake = Number(r.stakeSol);
  if (!Number.isFinite(stake) || stake < SPEC_STAKE_MIN - 1e-12 || stake > SPEC_STAKE_MAX + 1e-12) errors.push(`Ставка від ${SPEC_STAKE_MIN} до ${SPEC_STAKE_MAX} SOL.`);
  const askLo = Number(r.askLo);
  const askHi = Number(r.askHi);
  if (!Number.isFinite(askLo) || !Number.isFinite(askHi) || askLo < 0.05 || askHi > 0.95 || askLo >= askHi) errors.push("Коридор ціни: 0.05 ≤ від < до ≤ 0.95.");
  const edge = Number(r.edgeBps);
  if (!Number.isFinite(edge) || edge < 0 || edge > 500) errors.push("Перевага (edge) від 0 до 500 bps.");
  const stop = Number(r.stopPct);
  if (!Number.isInteger(stop) || stop < 1 || stop > 100) errors.push("Стоп від 1 до 100 % ставки (ціле).");
  const take = Number(r.takePct);
  if (!Number.isInteger(take) || take < 1 || take > 500) errors.push("Тейк від 1 до 500 % ставки (ціле).");
  const parsed = parseRules(typeof r.rules === "string" ? r.rules : "");
  if (!parsed.ok) errors.push(parsed.error);
  if (errors.length || !risk || !parsed.ok) return { ok: false, errors };
  return {
    ok: true,
    spec: {
      lanes,
      windows: lanes.includes("crypto") ? windows : [],
      risk,
      stakeSol: fix(round(stake, 0.0001), 4),
      askLo: fix(round(askLo, 0.01), 2),
      askHi: fix(round(askHi, 0.01), 2),
      edgeBps: Math.round(edge),
      stopPct: stop,
      takePct: take,
      rules: formatRules(parsed.rules),
    },
  };
}

/* ------------------------------ hash (sha256) ------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 4, (len * 8) >>> 0);
  view.setUint32(total - 8, Math.floor((len * 8) / 2 ** 32));
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

/** Canonical JSON (fixed key order) of a validated spec. */
export function canonicalSpec(spec: StrategySpec): string {
  return JSON.stringify([SPEC_SCHEMA, spec.lanes, spec.windows, spec.risk, spec.stakeSol, spec.askLo, spec.askHi, spec.edgeBps, spec.stopPct, spec.takePct, spec.rules]);
}

export function specHash(spec: StrategySpec): string {
  return encodeBase58(sha256(new TextEncoder().encode(canonicalSpec(spec))));
}

/* ------------------------------ attributes ------------------------------ */

export type Attr = { key: string; value: string };
export type SpecMeta = { version: number; changedSec: number; unlockSec: number };
const LANE_CH: Record<SpecLane, string> = { crypto: "c", events: "e", weather: "w" };

export const SPEC_KEYS = ["lo", "pw", "ab", "ps", "pe", "pf", "sr", "sl", "tp", "rl", "sx", "sv", "sh", "sc", "su"] as const;
export const PERF_KEYS = ["rn", "rw", "rpnl", "a7", "a30", "apr", "pu", "jobs", "wins", "losses", "pnl"] as const;

export function specAttrs(spec: StrategySpec, meta: SpecMeta): Attr[] {
  const pf = spec.lanes.length > 1 ? "mix" : spec.lanes[0] === "events" ? "evt" : spec.lanes[0] === "weather" ? "wx" : "btc";
  const wins = spec.windows.length ? spec.windows : [15];
  return [
    ["lo", spec.lanes.map((l) => LANE_CH[l]).join("")],
    ["pw", wins.join(".")],
    ["ab", `${spec.askLo}-${spec.askHi}`],
    ["ps", String(spec.stakeSol)],
    ["pe", spec.edgeBps.toFixed(1)],
    ["pf", pf],
    ["sr", spec.risk],
    ["sl", String(spec.stopPct)],
    ["tp", String(spec.takePct)],
    ["rl", spec.rules],
    ["sx", String(SPEC_SCHEMA)],
    ["sv", String(meta.version)],
    ["sh", specHash(spec)],
    ["sc", String(meta.changedSec)],
    ["su", String(meta.unlockSec)],
  ].map(([key, value]) => ({ key, value }));
}

/** Legacy keys nothing reads any more; dropped on server writes so a 160-char rule still fits one transaction. */
export const COMPACT_DROP = ["pv", "pwin", "pm", "grad", "track", "days"];

/** Replaces `next` keys in `base`, keeps the rest in order (minus COMPACT_DROP). */
export function mergeAttrs(base: Attr[], next: Attr[]): Attr[] {
  const map = new Map(next.map((a) => [a.key, a.value]));
  const out = base.filter((a) => !map.has(a.key) && !COMPACT_DROP.includes(a.key)).map((a) => ({ key: a.key, value: a.value }));
  return out.concat(next.map((a) => ({ key: a.key, value: a.value })));
}

export type ChainSpec = { spec: StrategySpec; version: number; hash: string; hashOk: boolean; changedSec: number; unlockSec: number };

/** Reads the spec back from attributes. Null when the asset carries no spec (legacy). */
export function specFromAttrs(attrs: Map<string, string> | Attr[]): ChainSpec | null {
  const map = attrs instanceof Map ? attrs : new Map(attrs.map((a) => [a.key, a.value]));
  const hash = map.get("sh");
  if (!hash) return null;
  const lo = map.get("lo") ?? "";
  const band = (map.get("ab") ?? "").match(/^(\d*\.?\d+)-(\d*\.?\d+)$/);
  const lanes = SPEC_LANES.filter((l) => lo.includes(LANE_CH[l]));
  const raw = {
    lanes,
    windows: lanes.includes("crypto") ? (map.get("pw") ?? "").split(".").map(Number).filter((n) => SPEC_WINDOWS.includes(n)) : [],
    risk: map.get("sr"),
    stakeSol: Number(map.get("ps")),
    askLo: band ? Number(band[1]) : NaN,
    askHi: band ? Number(band[2]) : NaN,
    edgeBps: Number(map.get("pe")),
    stopPct: Number(map.get("sl")),
    takePct: Number(map.get("tp")),
    rules: map.get("rl") ?? "",
  };
  const checked = validateSpec(raw);
  if (!checked.ok) return null;
  const version = Number(map.get("sv"));
  const changedSec = Number(map.get("sc"));
  const unlockSec = Number(map.get("su"));
  return {
    spec: checked.spec,
    version: Number.isFinite(version) ? version : 0,
    hash,
    hashOk: specHash(checked.spec) === hash,
    changedSec: Number.isFinite(changedSec) ? changedSec : 0,
    unlockSec: Number.isFinite(unlockSec) ? unlockSec : 0,
  };
}

/* ------------------------------ sale lock ------------------------------ */

/** Unlock after a strategy change: the sale lock runs 240 h from the change. */
export function unlockSecFor(changedSec: number): number {
  return changedSec + SALE_LOCK_HOURS * 3600;
}

/** Spec meta written at mint: strategy v1, no sale lock (unlock = the mint second). */
export function mintSpecMeta(nowSec: number): SpecMeta {
  return { version: 1, changedSec: nowSec, unlockSec: nowSec };
}

/**
 * A v1 spec still carrying the old mint-time lock (su > sc) and never changed through the server:
 * under the corrected rule the lock only follows a strategy change, so this lock is released.
 */
export function mintLockToRelease(c: { version: number; changedSec: number; unlockSec: number }, serverVersions: number): boolean {
  return c.version === 1 && c.unlockSec > c.changedSec && serverVersions === 0;
}

export function saleLockLeftMs(unlockSec: number, nowMs: number): number {
  return Math.max(0, unlockSec * 1000 - nowMs);
}

export function lockLabel(leftMs: number): string {
  if (leftMs <= 0) return "відкрито";
  const totalMin = Math.ceil(leftMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} год ${String(m).padStart(2, "0")} хв`;
}

/* ------------------------------ trades ------------------------------ */

export function laneOfMarket(m: { slug?: string; question?: string }): { lane: SpecLane; window: number } {
  const slug = String(m.slug ?? "").toLowerCase();
  const q = String(m.question ?? "").toLowerCase();
  const up = slug.match(/^btc-updown-(5m|15m|4h)-\d+$/);
  if (up) return { lane: "crypto", window: up[1] === "5m" ? 5 : up[1] === "15m" ? 15 : 240 };
  if (/^bitcoin-up-or-down-[a-z]+-\d+-\d{4}-\d{1,2}(am|pm)-et$/.test(slug)) return { lane: "crypto", window: 60 };
  if (/temperature|highest temp|°f|°c/.test(`${slug} ${q}`)) return { lane: "weather", window: 0 };
  return { lane: "events", window: 0 };
}

export type TradeInput = { side: string; yesPx: number; lane: SpecLane; window: number; stakeSol: number; hourUtc: number };

/** Does this trade follow the on-chain strategy? Used by the engine before opening and by the server on open. */
export function checkTrade(spec: StrategySpec, t: TradeInput, drift = PRICE_DRIFT): { ok: true } | { ok: false; reason: string } {
  if (!spec.lanes.includes(t.lane)) return { ok: false, reason: `Смуга ${t.lane} вимкнена в стратегії NFT.` };
  if (t.lane === "crypto" && t.window > 0 && !spec.windows.includes(t.window)) return { ok: false, reason: `Вікно ${t.window} хв не в стратегії NFT.` };
  if (!(t.stakeSol > 0) || t.stakeSol > spec.stakeSol + 1e-9) return { ok: false, reason: `Ставка ${t.stakeSol} більша за ${spec.stakeSol} SOL зі стратегії.` };
  const side = t.side === "yes" || t.side === "long" ? "yes" : "no";
  const price = side === "yes" ? t.yesPx : 1 - t.yesPx;
  if (!(price >= 0 && price <= 1)) return { ok: false, reason: "Немає ціни." };
  if (t.lane === "crypto" && (price < spec.askLo - drift || price > spec.askHi + drift)) {
    return { ok: false, reason: `Ціна ${price.toFixed(2)} поза коридором ${spec.askLo}–${spec.askHi}.` };
  }
  const parsed = parseRules(spec.rules);
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  return rulesAllow(parsed.rules, { side, price, hour: t.hourUtc, window: t.window, lane: t.lane, stake: t.stakeSol });
}

/** Stop/take from the spec: close when PnL of the stake crosses -stop% or +take%. */
export function exitByRule(spec: Pick<StrategySpec, "stopPct" | "takePct">, side: string, entryYes: number, nowYes: number): "stop" | "take" | null {
  if (!(entryYes > 0 && entryYes < 1) || !(nowYes >= 0 && nowYes <= 1)) return null;
  const yes = side === "yes" || side === "long";
  const entry = yes ? entryYes : 1 - entryYes;
  const now = yes ? nowYes : 1 - nowYes;
  if (!(entry > 0)) return null;
  const pct = ((now - entry) / entry) * 100;
  if (pct <= -spec.stopPct) return "stop";
  if (pct >= spec.takePct) return "take";
  return null;
}

/* ------------------------------ performance ------------------------------ */

export type ClosedTrade = { openedMs: number; closedMs: number; stakeLamports: number; pnlLamports: number };
export type Perf = {
  trades: number;
  wins: number;
  losses: number;
  realizedSol: number;
  winRatePct: number | null;
  apr7: number | null;
  apr30: number | null;
  aprSince: number | null;
  history: { t: number; cumSol: number }[];
};

const DAY_MS = 86_400_000;

/**
 * APR over a window = realized PnL / capital × 365 / days × 100, where the window
 * starts at max(now − W, lastChangedAt), capital = largest stake in the window
 * (what the strategy needs on hand), days = window length, at least 1 day.
 * Only trades opened after the last strategy change count.
 */
export function aprOver(trades: ClosedTrade[], fromMs: number, nowMs: number): number | null {
  const rows = trades.filter((t) => t.closedMs >= fromMs && t.closedMs <= nowMs);
  if (!rows.length) return null;
  const capital = Math.max(...rows.map((t) => t.stakeLamports));
  if (!(capital > 0)) return null;
  const pnl = rows.reduce((s, t) => s + t.pnlLamports, 0);
  const days = Math.max(nowMs - fromMs, DAY_MS) / DAY_MS;
  const apr = (pnl / capital) * (365 / days) * 100;
  return Math.max(-99_999, Math.min(99_999, fix(apr, 1)));
}

export function computePerf(all: ClosedTrade[], changedMs: number, nowMs: number): Perf {
  const trades = all.filter((t) => t.openedMs >= changedMs && t.closedMs <= nowMs).sort((a, b) => a.closedMs - b.closedMs);
  const wins = trades.filter((t) => t.pnlLamports > 0).length;
  const losses = trades.filter((t) => t.pnlLamports < 0).length;
  let cum = 0;
  const history = trades.map((t) => {
    cum += t.pnlLamports;
    return { t: t.closedMs, cumSol: fix(cum / 1e9, 6) };
  });
  return {
    trades: trades.length,
    wins,
    losses,
    realizedSol: fix(cum / 1e9, 6),
    winRatePct: trades.length ? fix((wins / trades.length) * 100, 1) : null,
    apr7: aprOver(trades, Math.max(nowMs - 7 * DAY_MS, changedMs), nowMs),
    apr30: aprOver(trades, Math.max(nowMs - 30 * DAY_MS, changedMs), nowMs),
    aprSince: aprOver(trades, changedMs, nowMs),
    history,
  };
}

export function perfAttrs(perf: Perf, lifetime: { trades: number; wins: number; losses: number; pnlSol: number }, nowMs: number): Attr[] {
  const pct = (v: number | null) => (v == null ? "" : String(v));
  return [
    ["rn", String(perf.trades)],
    ["rw", pct(perf.winRatePct)],
    ["rpnl", perf.realizedSol.toFixed(5)],
    ["a7", pct(perf.apr7)],
    ["a30", pct(perf.apr30)],
    ["apr", pct(perf.aprSince)],
    ["pu", String(Math.floor(nowMs / 1000))],
    ["jobs", String(lifetime.trades)],
    ["wins", String(lifetime.wins)],
    ["losses", String(lifetime.losses)],
    ["pnl", lifetime.pnlSol.toFixed(5)],
  ].map(([key, value]) => ({ key, value }));
}

export type ChainPerf = { trades: number; winRatePct: number | null; realizedSol: number; apr7: number | null; apr30: number | null; aprSince: number | null; writtenSec: number };

export function perfFromAttrs(attrs: Map<string, string> | Attr[]): ChainPerf | null {
  const map = attrs instanceof Map ? attrs : new Map(attrs.map((a) => [a.key, a.value]));
  if (!map.has("pu")) return null;
  const opt = (k: string) => {
    const v = map.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    trades: opt("rn") ?? 0,
    winRatePct: opt("rw"),
    realizedSol: opt("rpnl") ?? 0,
    apr7: opt("a7"),
    apr30: opt("a30"),
    aprSince: opt("apr"),
    writtenSec: opt("pu") ?? 0,
  };
}

/**
 * Judge check: recompute the on-chain results from the listed trade records with the
 * same formula the server used, at the write time stored on chain (pu). Pure; runs in the browser.
 */
export type PerfCheck = { ok: boolean; recomputed: Perf; mismatches: string[]; newer: number; asOfMs: number };
export function verifyPerf(trades: ClosedTrade[], changedSec: number, onChain: ChainPerf): PerfCheck {
  const asOfMs = onChain.writtenSec * 1000;
  const r = computePerf(trades, changedSec * 1000, asOfMs);
  const mismatches: string[] = [];
  const eq = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 1e-9);
  if (r.trades !== onChain.trades) mismatches.push(`trades ${r.trades} ≠ ${onChain.trades}`);
  if (!eq(r.winRatePct, onChain.winRatePct)) mismatches.push(`win% ${r.winRatePct} ≠ ${onChain.winRatePct}`);
  if (!eq(Number(r.realizedSol.toFixed(5)), onChain.realizedSol)) mismatches.push(`pnl ${r.realizedSol.toFixed(5)} ≠ ${onChain.realizedSol}`);
  if (!eq(r.apr7, onChain.apr7)) mismatches.push(`apr7 ${r.apr7} ≠ ${onChain.apr7}`);
  if (!eq(r.apr30, onChain.apr30)) mismatches.push(`apr30 ${r.apr30} ≠ ${onChain.apr30}`);
  if (!eq(r.aprSince, onChain.aprSince)) mismatches.push(`apr ${r.aprSince} ≠ ${onChain.aprSince}`);
  const newer = trades.filter((t) => t.openedMs >= changedSec * 1000 && t.closedMs > asOfMs).length;
  return { ok: mismatches.length === 0, recomputed: r, mismatches, newer, asOfMs };
}

export const EXPLORER = "https://explorer.solana.com";
/** Solana Explorer (devnet) link for an address / asset or a transaction. */
export function explorerUrl(kind: "address" | "tx", id: string): string {
  return `${EXPLORER}/${kind}/${id}?cluster=devnet`;
}
/** Metaplex Core explorer: shows the asset's plugins (Attributes, FreezeDelegate) as decoded fields. */
export function coreExplorerUrl(asset: string): string {
  return `https://core.metaplex.com/explorer/${asset}?env=devnet`;
}

/** Same attribute values (order-insensitive)? Lets the job skip a no-op write. */
export function attrsEqual(a: Attr[], b: Attr[]): boolean {
  if (a.length !== b.length) return false;
  const m = new Map(a.map((x) => [x.key, x.value]));
  return b.every((x) => m.get(x.key) === x.value);
}

/* ------------------------------ market ------------------------------ */

export const ROYALTY_BPS_MARKET = 500;
export const LIST_MIN_LAMPORTS = 1_000_000;
export const LIST_MAX_LAMPORTS = 100_000_000_000;

/** Seller gets price − 5% royalty; the treasury gets the royalty. Integer lamports. */
export function splitSale(priceLamports: number, bps = ROYALTY_BPS_MARKET): { seller: number; royalty: number } {
  const royalty = Math.floor((priceLamports * bps) / 10_000);
  return { seller: priceLamports - royalty, royalty };
}

export function listPriceOk(lamports: number): boolean {
  return Number.isInteger(lamports) && lamports >= LIST_MIN_LAMPORTS && lamports <= LIST_MAX_LAMPORTS;
}

/** Default spec for an agent that has none yet (from its current local strategy). */
export function specFromStrategy(p: {
  lanes?: string[];
  laneOn?: Partial<Record<string, boolean>>;
  windows?: number[];
  askLo?: number;
  askHi?: number;
  edgeBps?: number;
  maxStakeSol?: number;
  risk?: string;
  stopPct?: number;
  takePct?: number;
  rules?: string;
}): StrategySpec {
  const lanes = SPEC_LANES.filter((l) => (p.lanes ?? ["crypto"]).includes(l) && p.laneOn?.[l] !== false);
  const windows = SPEC_WINDOWS.filter((w) => (p.windows ?? [15]).includes(w));
  const res = validateSpec({
    lanes: lanes.length ? lanes : ["crypto"],
    windows: windows.length ? windows : [15],
    risk: SPEC_RISKS.includes(p.risk as SpecRisk) ? p.risk : "balanced",
    stakeSol: Math.min(SPEC_STAKE_MAX, Math.max(SPEC_STAKE_MIN, Number(p.maxStakeSol) || SPEC_STAKE_MAX)),
    askLo: Number.isFinite(p.askLo) ? p.askLo : 0.15,
    askHi: Number.isFinite(p.askHi) ? p.askHi : 0.85,
    edgeBps: Math.min(500, Math.max(0, Math.round(Number(p.edgeBps) || 18))),
    stopPct: Number.isInteger(p.stopPct) ? p.stopPct : 50,
    takePct: Number.isInteger(p.takePct) ? p.takePct : 100,
    rules: p.rules ?? "",
  });
  if (res.ok) return res.spec;
  return { lanes: ["crypto"], windows: [15], risk: "balanced", stakeSol: 0.02, askLo: 0.15, askHi: 0.85, edgeBps: 18, stopPct: 50, takePct: 100, rules: "" };
}
