import { decideBetOnServer, decideCloseOnServer, type DecideTwap } from "./decide.server";
import { cryptoBand, windowLabelOf } from "./classes";
import { deriveDepositWallet } from "./deposit-wallet";
import { GROK_MODEL } from "./grok-model";
import { readTwapSnapshot } from "./twap.server";
import type { TwapSnapshot, TwapWindow } from "./twap";
import { isSportsMarket, isTempQuestion, loadTempBoard } from "./weather.server";
import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";

const RPC = "https://polygon-bor-rpc.publicnode.com";
const PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const EXCHANGE = "0xE111180000d2663C0091e4f400237545B87B996B";
const NEG_EXCHANGE = "0xe2222d279d744050d28e00520010520000310F59";
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const ADAPTER = "0xAdA100Db00Ca00073811820692005400218FcE1f";
const NEG_ADAPTER = "0xadA2005600Dec949baf300f4C6120000bDB6eAab";
const ORDER_FLOOR = 1;

const ctfReadAbi = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "payoutDenominator",
    stateMutability: "view",
    inputs: [{ name: "conditionId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type PolyBalances = { pol: number | null; pusd: number | null };

export type GrokTrace = {
  action: "yes" | "no" | "skip" | "sell" | "hold";
  confidence: number;
  why: string;
  ms: number;
  lane: "crypto" | "events" | "weather";
  question: string | null;
  model: string;
  priceToBeat: number | null;
  currentRef: number | null;
  delta: number | null;
  secondsLeft: number | null;
  /** 5m / 15m / 1h / 4h. Null on events. */
  windowLabel: string | null;
  /** Both Chainlink windows at decision time. Null on events. */
  twapLine: string | null;
  /** Ask of the chosen side. Entry price, not a probability. */
  entryAsk: number | null;
};

export type PolyTicket = {
  question: string;
  outcome: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: string;
  spend: string;
  shares: string;
  makerAmount: string;
  takerAmount: string;
  negRisk: boolean;
  exchange: string;
  action: "yes" | "no" | "sell";
  confidence: number;
  why: string;
  model: string;
  grokMs: number;
  allowance: string;
  lane: "crypto" | "events" | "weather";
  category: string;
  /** Taker rate from Gamma feeSchedule. Null when the API did not say. */
  feeRate: number | null;
  feeLabel: string;
  endLabel: string;
  priceToBeat: number | null;
  currentRef: number | null;
  delta: number | null;
  secondsLeft: number | null;
  /** Set on a crypto ticket. Events stay null. */
  twapLine: string | null;
  /** 5m / 15m / 1h / 4h when the ticket is a BTC window. */
  windowLabel: string | null;
  /** Buy price of the open position. Set only on a SELL ticket. */
  entryPrice: string | null;
  /** Crypto ask corridor from the strategy that built the ticket. */
  askLo?: number;
  askHi?: number;
  /** Weather lane only. Null means the station did not answer — never a fake 0. */
  station?: string | null;
  forecastHigh?: number | null;
  observedHigh?: number | null;
  tempUnit?: "F" | "C" | null;
};

export type PolyReview =
  | { ok: false; error: string }
  | { ok: true; place: false; why: string; grok: GrokTrace | null; asked?: boolean }
  | ({ ok: true; place: true } & PolyTicket);

type GammaMarket = {
  id?: string;
  question?: string;
  slug?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  negRisk?: boolean;
  volume?: string;
  closed?: boolean;
  endDate?: string;
  eventStartTime?: string;
  conditionId?: string;
  feesEnabled?: boolean;
  feeType?: string;
  feeSchedule?: { rate?: number } | null;
};

function padAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function rpc(method: string, params: unknown[]): Promise<string | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string; error?: unknown };
    if (body.error || typeof body.result !== "string") return null;
    return body.result;
  } catch {
    return null;
  }
}

function hexToBig(hex: string | null): bigint | null {
  if (!hex || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

export async function readPolyBalances(address: string): Promise<PolyBalances> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { pol: null, pusd: null };
  const deposit = deriveDepositWallet(address);
  const [polHex, eoaHex, code, depHex] = await Promise.all([
    rpc("eth_getBalance", [address, "latest"]),
    rpc("eth_call", [{ to: PUSD, data: `0x70a08231${padAddress(address)}` }, "latest"]),
    deposit ? rpc("eth_getCode", [deposit, "latest"]) : Promise.resolve(null),
    deposit ? rpc("eth_call", [{ to: PUSD, data: `0x70a08231${padAddress(deposit)}` }, "latest"]) : Promise.resolve(null),
  ]);
  const pol = hexToBig(polHex);
  const eoa = hexToBig(eoaHex);
  const deployed = code != null && code !== "0x" && code !== "0x0";
  const dep = deployed ? hexToBig(depHex) : 0n;
  const pusd = eoa == null || dep == null ? null : eoa + dep;
  return {
    pol: pol == null ? null : Number(pol) / 1e18,
    pusd: pusd == null ? null : Number(pusd) / 1e6,
  };
}

export async function readAllowance(owner: string, exchange: string): Promise<bigint | null> {
  const hex = await rpc("eth_call", [
    { to: PUSD, data: `0xdd62ed3e${padAddress(owner)}${padAddress(exchange)}` },
    "latest",
  ]);
  return hexToBig(hex);
}

export async function readOutcomeApproved(owner: string, operator: string): Promise<boolean | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner) || !/^0x[0-9a-fA-F]{40}$/.test(operator)) return null;
  const op = operator.toLowerCase();
  if (op !== EXCHANGE.toLowerCase() && op !== NEG_EXCHANGE.toLowerCase() && op !== ADAPTER.toLowerCase() && op !== NEG_ADAPTER.toLowerCase()) {
    return null;
  }
  const data = encodeFunctionData({
    abi: ctfReadAbi,
    functionName: "isApprovedForAll",
    args: [owner as Hex, operator as Hex],
  });
  const hex = await rpc("eth_call", [{ to: CTF, data }, "latest"]);
  if (!hex) return null;
  try {
    return decodeFunctionResult({ abi: ctfReadAbi, functionName: "isApprovedForAll", data: hex as Hex });
  } catch {
    return null;
  }
}

function asCondition(raw: unknown): Hex | null {
  if (typeof raw !== "string") return null;
  const v = raw.startsWith("0x") || raw.startsWith("0X") ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(v) ? (v as Hex) : null;
}

async function payoutReady(conditionId: Hex): Promise<boolean | null> {
  const data = encodeFunctionData({
    abi: ctfReadAbi,
    functionName: "payoutDenominator",
    args: [conditionId],
  });
  const hex = await rpc("eth_call", [{ to: CTF, data }, "latest"]);
  const n = hexToBig(hex);
  if (n == null) return null;
  return n > 0n;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

type BookLevel = { price: string; size: string };

async function readBook(tokenId: string): Promise<{
  best: BookLevel | null;
  bid: BookLevel | null;
  min: number;
  tick: string;
  neg: boolean;
} | null> {
  try {
    const res = await fetch(
      `https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      asks?: BookLevel[];
      bids?: BookLevel[];
      min_order_size?: string;
      tick_size?: string;
      neg_risk?: boolean;
    };
    const asks = Array.isArray(body.asks) ? body.asks : [];
    const bids = Array.isArray(body.bids) ? body.bids : [];
    let best: BookLevel | null = null;
    for (const row of asks) {
      const price = Number(row.price);
      if (!Number.isFinite(price) || price <= 0 || price >= 1) continue;
      if (!best || price < Number(best.price)) best = row;
    }
    let bid: BookLevel | null = null;
    for (const row of bids) {
      const price = Number(row.price);
      if (!Number.isFinite(price) || price <= 0 || price >= 1) continue;
      if (!bid || price > Number(bid.price)) bid = row;
    }
    const min = Number(body.min_order_size);
    return {
      best,
      bid,
      min: Number.isFinite(min) && min > 0 ? min : 0,
      tick: String(body.tick_size ?? ""),
      neg: Boolean(body.neg_risk),
    };
  } catch {
    return null;
  }
}

function micro(human: number): bigint {
  return BigInt(Math.round(human * 1_000_000));
}

/** 10% of pUSD, never under the $1 floor, never over the balance. */
export function stakePusd(balance: number): number | null {
  if (!Number.isFinite(balance) || balance + 1e-9 < ORDER_FLOOR) return null;
  const tenth = balance * 0.1;
  return Math.min(balance, Math.max(ORDER_FLOOR, tenth));
}

function fitOrder(best: BookLevel, minShares: number, budget: number): {
  spend: string;
  shares: string;
  makerAmount: string;
  takerAmount: string;
} | null {
  const price = Number(best.price);
  const size = Number(best.size);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) return null;
  const priceMicro = micro(price);
  if (priceMicro <= 0n) return null;
  const budgetMicro = micro(budget);
  const minMicro = micro(minShares);
  const sizeMicro = micro(size);
  let shares = (budgetMicro * 1_000_000n) / priceMicro;
  if (shares > sizeMicro) shares = sizeMicro;
  if (minMicro > 0n && shares < minMicro) return null;
  const maker = (shares * priceMicro) / 1_000_000n;
  if (maker < micro(ORDER_FLOOR) || maker > budgetMicro) return null;
  return {
    spend: (Number(maker) / 1e6).toFixed(6),
    shares: (Number(shares) / 1e6).toFixed(6),
    makerAmount: maker.toString(),
    takerAmount: shares.toString(),
  };
}

const HORIZON_H = 48;

function hoursUntil(end: string | undefined, now: number): number | null {
  if (!end) return null;
  const t = Date.parse(end);
  if (!Number.isFinite(t)) return null;
  return (t - now) / 3_600_000;
}

function isCryptoMarket(market: GammaMarket): boolean {
  const feeType = String(market.feeType ?? "").toLowerCase();
  if (feeType.startsWith("crypto")) return true;
  const blob = `${market.question ?? ""} ${market.slug ?? ""}`.toLowerCase();
  return /\b(bitcoin|btc|ethereum|ether|solana|crypto|xrp|dogecoin)\b/.test(blob);
}

function feeFromApi(market: GammaMarket): number | null {
  if (market.feesEnabled !== true) return null;
  const rate = market.feeSchedule?.rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  return rate;
}

function dayRank(endIso: string | undefined, now: number): number {
  if (!endIso) return 9;
  const endDay = new Date(endIso).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
  if (endDay === today) return 0;
  if (endDay === tomorrow) return 1;
  return 2;
}

function dayWord(endIso: string, now: number): string {
  const endDay = new Date(endIso).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
  if (endDay === today) return "сьогодні";
  if (endDay === tomorrow) return "завтра";
  return "до 2 діб";
}

async function fetchGamma(url: string): Promise<GammaMarket[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = (await res.json()) as GammaMarket[];
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function loadShortMarkets(now: number, horizonH = HORIZON_H): Promise<GammaMarket[] | null> {
  const min = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
  const max = new Date(now + horizonH * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const windowed = `https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=80&end_date_min=${encodeURIComponent(min)}&end_date_max=${encodeURIComponent(max)}`;
  const hot = "https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=50&order=volume24hr&ascending=false";
  const [a, b] = await Promise.all([fetchGamma(windowed), fetchGamma(hot)]);
  if (!a && !b) return null;
  const seen = new Set<string>();
  const out: GammaMarket[] = [];
  for (const market of [...(a ?? []), ...(b ?? [])]) {
    const id = String(market.id ?? market.question ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(market);
  }
  return out;
}

const BTC_WINDOWS: { label: "5m" | "15m" | "4h"; dur: number; variant: string; twapSec: 30 | 60 }[] = [
  { label: "5m", dur: 300, variant: "fiveminute", twapSec: 30 },
  { label: "15m", dur: 900, variant: "fifteen", twapSec: 60 },
  { label: "4h", dur: 14400, variant: "fourhour", twapSec: 60 },
];

function windowSpec(
  market: GammaMarket,
): { startSec: number; endSec: number; variant: string; windowLabel: string; twapSec: 30 | 60 } | null {
  const slug = String(market.slug ?? "");
  const endMs = Date.parse(String(market.endDate ?? ""));
  if (!Number.isFinite(endMs)) return null;
  const matched = slug.match(/^btc-updown-(5m|15m|4h)-(\d+)$/);
  if (matched) {
    const row = BTC_WINDOWS.find((w) => w.label === matched[1]);
    if (!row) return null;
    const fromEvent = Date.parse(String(market.eventStartTime ?? ""));
    const startSec = Number.isFinite(fromEvent) ? Math.floor(fromEvent / 1000) : Number(matched[2]);
    return { startSec, endSec: Math.floor(endMs / 1000), variant: row.variant, windowLabel: row.label, twapSec: row.twapSec };
  }
  if (!/^bitcoin-up-or-down-[a-z]+-\d+-\d{4}-\d{1,2}(am|pm)-et$/.test(slug)) return null;
  const fromEvent = Date.parse(String(market.eventStartTime ?? ""));
  if (!Number.isFinite(fromEvent)) return null;
  return {
    startSec: Math.floor(fromEvent / 1000),
    endSec: Math.floor(endMs / 1000),
    variant: "hourly",
    windowLabel: "1h",
    twapSec: 60,
  };
}

async function loadBtcWindows(labels: ReadonlySet<string>): Promise<GammaMarket[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = BTC_WINDOWS.filter((w) => labels.has(w.label));
  const found = await Promise.all(
    rows.map(async (row) => {
      const start = nowSec - (nowSec % row.dur);
      try {
        const res = await fetch(`https://gamma-api.polymarket.com/events?slug=btc-updown-${row.label}-${start}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { markets?: GammaMarket[] }[];
        const market = Array.isArray(body) ? body[0]?.markets?.[0] : null;
        return market?.question ? market : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((m): m is GammaMarket => m != null);
}

/** Price to beat (open) from the Polymarket window feed. currentRef is Chainlink TWAP, not closePrice. */
async function readWindowRef(
  spec: { startSec: number; endSec: number; variant: string },
): Promise<{ open: number } | null> {
  try {
    const url = `https://polymarket.com/api/crypto/crypto-price?symbol=BTC&eventStartTime=${spec.startSec}&variant=${spec.variant}&endDate=${spec.endSec}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { openPrice?: unknown };
    const open = Number(body.openPrice);
    if (!Number.isFinite(open) || open <= 0) return null;
    return { open };
  } catch {
    return null;
  }
}

type CryptoAnchor = {
  priceToBeat: number;
  currentRef: number;
  delta: number;
  secondsLeft: number;
  askUp: number;
  askDown: number;
  windowLabel: string;
  twapSec: 30 | 60;
  twapPrice: string;
  twapAgeSec: number;
};

function shortPrice(exact: string): string {
  const [whole, frac = ""] = exact.split(".");
  return `${whole}.${(frac + "00").slice(0, 2)}`;
}

function twapBit(row: TwapWindow): string {
  if (!row.known) return "немає цифри";
  if (row.stale || !row.price) return "застарів";
  return `${shortPrice(row.price)} · ${row.ageSec ?? "?"} с`;
}

function twapLine(snap: TwapSnapshot): string {
  return `TWAP 30s ${twapBit(snap.w30)} / 60s ${twapBit(snap.w60)}`;
}

function twapFresh(snap: TwapSnapshot): boolean {
  const ok = (row: TwapWindow) => row.known && !row.stale && Boolean(row.price) && (row.ageSec ?? 99) <= 15;
  return ok(snap.w30) || ok(snap.w60);
}

function twapForGrok(snap: TwapSnapshot): DecideTwap {
  const one = (row: TwapWindow) => ({
    price: row.known && !row.stale ? row.price : null,
    ageSec: row.known ? row.ageSec : null,
  });
  return { w30: one(snap.w30), w60: one(snap.w60) };
}

async function reviewWeatherOnServer(address: string, skip: readonly string[] = []): Promise<PolyReview> {
  const floorBals = await readPolyBalances(address);
  if (floorBals.pusd != null && floorBals.pusd + 1e-9 < ORDER_FLOOR) {
    return { ok: true, place: false, why: "Мінімум ставки 1 pUSD. Поповни. Ордера немає.", grok: null };
  }
  const now = Date.now();
  const loaded = await loadTempBoard(now, skip);
  if (!("board" in loaded)) return { ok: true, place: false, why: loaded.why, grok: null };
  const board = loaded.board;
  const hit = board.buckets[board.hit];
  if (!hit) return { ok: true, place: false, why: "Цифра не лягає в один бакет. Ордера немає.", grok: null };
  const askedAt = Date.now();
  const decided = await decideBetOnServer({
    focus: "weather",
    name: "Погода",
    risk: "tiny",
    goal: "Лише бакет, куди лягає знятий high. Немає observedHigh — ордера немає.",
    edgeBps: 0,
    maxStakeSol: 0,
    anchorYes: 0,
    moveBps: 0,
    markets: board.buckets.map((b) => ({
      id: b.id,
      question: b.question,
      yesLabel: b.bucket,
      noLabel: "No",
      yes: 0,
      windowMin: Math.max(1, Math.round(b.hours * 60)),
      volume: b.volume,
      feeRate: b.feeRate,
      hoursLeft: b.hours,
      bucket: b.bucket,
      station: board.station,
      forecastHigh: board.forecastHigh,
      observedHigh: board.observedHigh,
      tempUnit: board.unit,
    })),
  });
  const grokMs = Date.now() - askedAt;
  if (!decided.ok) return { ok: true, place: false, why: decided.error, grok: null };
  const chosen = board.buckets.find((b) => b.id === decided.marketId) ?? null;
  const grok: GrokTrace = {
    action: decided.action,
    confidence: decided.confidence,
    why: decided.why,
    ms: grokMs,
    lane: "weather",
    question: chosen?.question ?? hit.question,
    model: GROK_MODEL,
    priceToBeat: null,
    currentRef: null,
    delta: null,
    secondsLeft: null,
    windowLabel: null,
    twapLine: null,
    entryAsk: null,
  };
  const refuse = (why: string): PolyReview => ({ ok: true, place: false, why, grok });
  if (decided.action !== "yes" || decided.confidence < 0.65 || !chosen) {
    return refuse(decided.why || `Не беру: впевненість ${Math.round(decided.confidence * 100)}%.`);
  }
  if (skip.includes(chosen.tokenYes) || board.buckets.some((b) => skip.includes(b.tokenYes))) {
    return refuse("Уже є ця ставка. Ордера немає.");
  }
  if (chosen.id !== hit.id) return refuse("Сусідній бакет. Ордера немає.");
  const book = await readBook(chosen.tokenYes);
  if (!book?.best) return refuse("Немає стакана. Ордера немає.");
  const price = Number(book.best.price);
  const bals = await readPolyBalances(address);
  if (bals.pusd == null) return refuse("немає цифри");
  if (bals.pusd + 1e-9 < ORDER_FLOOR) return refuse("Мінімум ставки 1 pUSD. Поповни. Ордера немає.");
  const tenth = stakePusd(bals.pusd);
  if (tenth == null) return refuse("Мінімум ставки 1 pUSD. Поповни. Ордера немає.");
  const minCost = book.min > 0 ? book.min * price : 0;
  if (minCost > bals.pusd + 1e-9) {
    return refuse(`Мінімум стакана ${minCost.toFixed(2)} pUSD, на балансі ${bals.pusd.toFixed(2)}. Ордера немає.`);
  }
  const budget = Math.min(bals.pusd, Math.max(tenth, minCost));
  const fitted = fitOrder(book.best, book.min, budget);
  if (!fitted || Number(fitted.spend) + 1e-9 < ORDER_FLOOR) {
    return refuse("Стакан не вміщує мінімум 1 pUSD. Ордера немає.");
  }
  const shares = Number(fitted.shares);
  const feeRate = chosen.feeRate;
  let feeLabel = "Комісія: невідома з API. Нуль не вигадую.";
  if (feeRate != null && Number.isFinite(shares)) {
    const fee = shares * feeRate * price * (1 - price);
    feeLabel = Number.isFinite(fee)
      ? `Комісія taker ${feeRate} з API · близько ${fee.toFixed(4)} pUSD`
      : `Комісія taker ${feeRate} з API. Суму не рахую.`;
  }
  const endIso = chosen.endDate;
  const exchange = book.neg || chosen.negRisk ? NEG_EXCHANGE : EXCHANGE;
  const allowance = await readAllowance(address, exchange);
  return {
    ok: true,
    place: true,
    question: chosen.question,
    outcome: chosen.bucket,
    tokenId: chosen.tokenYes,
    side: "BUY",
    price: book.best.price,
    spend: fitted.spend,
    shares: fitted.shares,
    makerAmount: fitted.makerAmount,
    takerAmount: fitted.takerAmount,
    negRisk: book.neg || chosen.negRisk,
    exchange,
    action: "yes",
    confidence: decided.confidence,
    why: decided.why,
    model: GROK_MODEL,
    grokMs,
    allowance: allowance == null ? "" : allowance.toString(),
    lane: "weather",
    category: chosen.feeType ?? "weather",
    feeRate,
    feeLabel,
    endLabel: endIso ? `${endIso} · ${dayWord(endIso, now)}` : "дата резолву невідома",
    priceToBeat: null,
    currentRef: null,
    delta: null,
    secondsLeft: null,
    twapLine: null,
    windowLabel: null,
    entryPrice: null,
    station: board.station,
    forecastHigh: board.forecastHigh,
    observedHigh: board.observedHigh,
    tempUnit: board.unit,
  };
}

export async function reviewPolymarketOnServer(
  address: string,
  _daySpent: number,
  lane: "crypto" | "events" | "weather",
  skip: readonly string[] = [],
  horizonH = HORIZON_H,
  crypto?: { windows?: number[]; askLo?: number; askHi?: number },
): Promise<PolyReview> {
  if (lane === "weather") return reviewWeatherOnServer(address, skip);
  const floorBals = await readPolyBalances(address);
  if (floorBals.pusd != null && floorBals.pusd + 1e-9 < ORDER_FLOOR) {
    return { ok: true, place: false, why: "Мінімум ставки 1 pUSD. Поповни. Ордера немає.", grok: null };
  }

  const now = Date.now();
  const horizon = horizonH === 24 ? 24 : HORIZON_H;
  const labels = new Set<string>();
  for (const min of crypto?.windows ?? [15]) {
    const label = windowLabelOf(min);
    if (label) labels.add(label);
  }
  if (!labels.size) labels.add("15m");
  const band = cryptoBand({ askLo: crypto?.askLo, askHi: crypto?.askHi });
  let twap: TwapSnapshot | null = null;
  if (lane === "crypto") {
    twap = await readTwapSnapshot(2000);
  }
  const loaded = await loadShortMarkets(now, lane === "events" ? horizon : HORIZON_H);
  if (!loaded) return { ok: false, error: "Gamma не відповіла" };
  if (lane === "crypto") {
    const extra = await loadBtcWindows(labels);
    const seen = new Set(loaded.map((m) => String(m.id ?? m.slug ?? "")));
    for (const market of extra) {
      const id = String(market.id ?? market.slug ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      loaded.push(market);
    }
  }

  const pool = loaded
    .map((market) => ({ market, hours: hoursUntil(market.endDate, now) }))
    .filter((row) => {
      if (!row.market.acceptingOrders || !row.market.enableOrderBook || !row.market.question || !row.market.clobTokenIds) {
        return false;
      }
      if (row.hours == null || row.hours <= 0 || row.hours > (lane === "events" ? horizon : HORIZON_H)) return false;
      const crypto = isCryptoMarket(row.market);
      if (lane === "crypto") return crypto;
      return !crypto && !isSportsMarket(row.market) && !isTempQuestion(`${row.market.question ?? ""} ${row.market.slug ?? ""}`);
    })
    .sort((a, b) => a.hours! - b.hours! || Number(b.market.volume) - Number(a.market.volume));

  if (!pool.length) {
    return {
      ok: true,
      place: false,
      grok: null,
      asked: lane === "crypto" ? false : undefined,
      why:
        lane === "crypto"
          ? "Немає увімкненого вікна BTC. Ордера немає."
          : "Немає події з офіційним джерелом. Ордера немає.",
    };
  }

  const anchors = new Map<string, CryptoAnchor>();
  let picked = pool.slice(0, 6);
  if (lane === "crypto") {
    let sawOpen = false;
    let sawEdge = false;
    const kept: typeof pool = [];
    const inBand = (px: number) => px > band.lo && px < band.hi;
    for (const row of pool) {
      if (kept.length >= 4) break;
      const spec = windowSpec(row.market);
      if (!spec || !labels.has(spec.windowLabel)) continue;
      const tick = spec.twapSec === 30 ? twap?.w30 : twap?.w60;
      const currentRef = tick?.price ? Number(tick.price) : NaN;
      const ref = await readWindowRef(spec);
      if (ref) sawOpen = true;
      const delta = ref && Number.isFinite(currentRef) && currentRef > 0 ? currentRef - ref.open : 0;
      const endMs = Date.parse(String(row.market.endDate ?? ""));
      const secondsLeft = Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - now) / 1000)) : 0;
      const outcomes = parseList(row.market.outcomes);
      const tokens = parseList(row.market.clobTokenIds);
      const upI = outcomes.findIndex((o) => /^up$/i.test(o));
      const downI = outcomes.findIndex((o) => /^down$/i.test(o));
      if (upI < 0 || downI < 0 || !tokens[upI] || !tokens[downI]) continue;
      const [upBook, downBook] = await Promise.all([readBook(tokens[upI]!), readBook(tokens[downI]!)]);
      const askUp = upBook?.best ? Number(upBook.best.price) : NaN;
      const askDown = downBook?.best ? Number(downBook.best.price) : NaN;
      if (!Number.isFinite(askUp) || !Number.isFinite(askDown)) continue;
      if (!inBand(askUp) && !inBand(askDown)) {
        sawEdge = true;
        continue;
      }
      const id = String(row.market.id ?? tokens[0]);
      anchors.set(id, {
        priceToBeat: ref?.open ?? currentRef,
        currentRef: Number.isFinite(currentRef) ? currentRef : ref?.open ?? 0,
        delta,
        secondsLeft,
        askUp,
        askDown,
        windowLabel: spec.windowLabel,
        twapSec: spec.twapSec,
        twapPrice: tick?.price ?? "",
        twapAgeSec: tick?.ageSec ?? 0,
      });
      kept.push(row);
    }
    if (!kept.length) {
      const why = sawEdge
        ? `Ask поза ${band.lo}–${band.hi}. Ордера немає.`
        : sawOpen
          ? "Немає стакана. Ордера немає."
          : "Немає увімкненого вікна BTC. Ордера немає.";
      return { ok: true, place: false, why, grok: null, asked: false };
    }
    picked = kept;
  }
  const eventAsks = new Map<string, { askYes: number; askNo: number }>();
  if (lane === "events") {
    const held = new Set(skip);
    const ranked = [...pool].sort(
      (a, b) => dayRank(a.market.endDate, now) - dayRank(b.market.endDate, now) || a.hours! - b.hours!,
    );
    const kept: typeof pool = [];
    let missedBook = false;
    let missedHeld = false;
    for (const row of ranked) {
      if (kept.length >= 4) break;
      if (!row.market.endDate) continue;
      const tokens = parseList(row.market.clobTokenIds);
      const outcomes = parseList(row.market.outcomes);
      if (outcomes.length < 2 || !tokens[0] || !tokens[1]) continue;
      if (tokens.some((t) => held.has(t))) {
        missedHeld = true;
        continue;
      }
      const [yesBook, noBook] = await Promise.all([readBook(tokens[0]), readBook(tokens[1])]);
      const askYes = yesBook?.best ? Number(yesBook.best.price) : NaN;
      const askNo = noBook?.best ? Number(noBook.best.price) : NaN;
      if (!Number.isFinite(askYes) || !Number.isFinite(askNo)) {
        missedBook = true;
        continue;
      }
      eventAsks.set(String(row.market.id ?? tokens[0]), { askYes, askNo });
      kept.push(row);
    }
    if (!kept.length) {
      return {
        ok: true,
        place: false,
        grok: null,
        why: missedHeld && !missedBook
          ? "Уже є ця ставка. Ордера немає."
          : missedBook
            ? "Немає стакана. Ордера немає."
            : "Немає події з офіційним джерелом. Ордера немає.",
      };
    }
    picked = kept;
  }
  const askedAt = Date.now();
  const decided = await decideBetOnServer({
    focus: lane === "crypto" ? "btc" : "events",
    name: lane === "crypto" ? "Крипто-бот" : "Бот подій",
    risk: "tiny",
    goal:
      lane === "crypto"
        ? `Вікна ${[...labels].join(", ")}. Бік з priceToBeat і currentRef, не з дешевшого ask. Купуй лише якщо ask цього боку в ${band.lo}–${band.hi}.`
        : "Лише подія з резолвом сьогодні або завтра, не крипта. Ask — ціна натовпу, не прогноз. Комісія null — не нуль. Сумнів = skip.",
    edgeBps: 0,
    maxStakeSol: 0,
    askLo: band.lo,
    askHi: band.hi,
    anchorYes: lane === "crypto" ? Number(parseList(picked[0].market.outcomePrices)[0]) || 0 : 0,
    moveBps: 0,
    twap: lane === "crypto" && twap ? twapForGrok(twap) : null,
    markets: picked.map((row) => {
      const outcomes = parseList(row.market.outcomes);
      const prices = parseList(row.market.outcomePrices);
      const yes = Number(prices[0]);
      return {
        id: String(row.market.id ?? parseList(row.market.clobTokenIds)[0]),
        question: String(row.market.question),
        yesLabel: outcomes[0] ?? "Yes",
        noLabel: outcomes[1] ?? "No",
        yes: lane === "events" ? 0 : Number.isFinite(yes) ? yes : 0,
        windowMin: Math.max(1, Math.round(row.hours! * 60)),
        volume: Number(row.market.volume) || 0,
        feeRate: feeFromApi(row.market),
        hoursLeft: row.hours,
        ...(() => {
          if (lane === "events") return {};
          const id = String(row.market.id ?? parseList(row.market.clobTokenIds)[0]);
          const anchor = anchors.get(id);
          if (!anchor) return {};
          const feeRate = feeFromApi(row.market);
          return {
            priceToBeat: anchor.priceToBeat,
            currentRef: anchor.currentRef,
            delta: anchor.delta,
            secondsLeft: anchor.secondsLeft,
            askUp: anchor.askUp,
            askDown: anchor.askDown,
            feeLabel: feeRate == null ? "невідома" : String(feeRate),
            windowLabel: anchor.windowLabel,
            resolveTwap: anchor.twapSec,
            twapPrice: anchor.twapPrice,
            twapAgeSec: anchor.twapAgeSec,
          };
        })(),
      };
    }),
  });
  const grokMs = Date.now() - askedAt;
  if (!decided.ok) return { ok: true, place: false, why: decided.error, grok: null, asked: true };

  let chosen =
    picked.find((row) => String(row.market.id ?? "") === decided.marketId) ??
    picked.find((row) => parseList(row.market.clobTokenIds)[0] === decided.marketId) ??
    null;
  if (lane === "crypto" && !chosen) chosen = picked[0] ?? null;
  const chosenId = chosen ? String(chosen.market.id ?? parseList(chosen.market.clobTokenIds)[0]) : "";
  const anchor = anchors.get(chosenId) ?? anchors.get(decided.marketId) ?? null;
  let action = decided.action;
  const confidence = decided.confidence;
  let why = decided.why;
  if (lane === "crypto" && anchor) {
    const upOk = anchor.askUp > band.lo && anchor.askUp < band.hi;
    const downOk = anchor.askDown > band.lo && anchor.askDown < band.hi;
    if (action === "yes" && !upOk) {
      action = "skip";
      why = `Ask поза ${band.lo}–${band.hi}. Ордера немає.`;
    } else if (action === "no" && !downOk) {
      action = "skip";
      why = `Ask поза ${band.lo}–${band.hi}. Ордера немає.`;
    }
  }
  const grok: GrokTrace = {
    action,
    confidence,
    why,
    ms: grokMs,
    lane,
    question: chosen ? String(chosen.market.question).slice(0, 180) : null,
    model: GROK_MODEL,
    priceToBeat: anchor?.priceToBeat ?? null,
    currentRef: anchor?.currentRef ?? null,
    delta: anchor?.delta ?? null,
    secondsLeft: anchor?.secondsLeft ?? null,
    windowLabel: anchor?.windowLabel ?? null,
    twapLine: lane === "crypto" && twap ? twapLine(twap) : null,
    entryAsk:
      anchor == null
        ? null
        : action === "yes"
          ? anchor.askUp
          : action === "no"
            ? anchor.askDown
            : null,
  };
  const refuse = (whyText: string): PolyReview => ({ ok: true, place: false, why: whyText, grok });
  if (lane !== "crypto" && (!chosen || action === "skip" || confidence < 0.65)) {
    return refuse(
      !chosen && action !== "skip"
        ? "Ринок не зі списку. Ордера немає."
        : why || `Не беру: впевненість ${Math.round(confidence * 100)}%.`,
    );
  }
  if (!chosen) return refuse("Ринок не зі списку. Ордера немає.");
  if (lane === "crypto" && anchor?.windowLabel && !labels.has(anchor.windowLabel)) {
    grok.action = "skip";
    return refuse("Це вікно вимкнене. Ордера немає.");
  }
  if (lane === "crypto" && action === "skip") {
    grok.action = "skip";
    return refuse(why || "Ордера немає.");
  }
  if (action === "skip") return refuse(why || "Край після ціни замалий. Ордера немає.");

  const market = chosen.market;
  const outcomes = parseList(market.outcomes);
  const tokens = parseList(market.clobTokenIds);
  if (tokens.length < 2 || outcomes.length < 2) {
    return refuse("Ринок без tokenId. Ордера немає.");
  }
  const upI = outcomes.findIndex((o) => /^up$/i.test(o.trim()));
  const downI = outcomes.findIndex((o) => /^down$/i.test(o.trim()));
  let sideIndex = action === "no" ? 1 : 0;
  if (lane === "crypto") {
    const found = action === "yes" ? upI : downI;
    if (found < 0 || !tokens[found]) return refuse("Немає боку Up/Down. Ордера немає.");
    sideIndex = found;
  }
  const tokenId = tokens[sideIndex];
  if (lane === "events" && tokens.some((t) => skip.includes(t))) {
    return refuse("Уже є ця ставка. Ордера немає.");
  }
  const book = await readBook(tokenId);
  if (!book || !book.best) return refuse("Немає стакана. Ордера немає.");

  const price = Number(book.best.price);
  const feeRate = feeFromApi(market);
  if (lane === "crypto") {
    if (!(price > band.lo && price < band.hi)) return refuse(`Ask поза ${band.lo}–${band.hi}. Ордера немає.`);
  }

  const bals = await readPolyBalances(address);
  if (bals.pusd == null) return refuse("немає цифри");
  if (bals.pusd + 1e-9 < ORDER_FLOOR) {
    return refuse("Мінімум ставки 1 pUSD. Поповни. Ордера немає.");
  }
  const tenth = stakePusd(bals.pusd);
  if (tenth == null) {
    return refuse("Мінімум ставки 1 pUSD. Поповни. Ордера немає.");
  }
  const minCost = book.min > 0 ? book.min * price : 0;
  if (minCost > bals.pusd + 1e-9) {
    return refuse(
      `Мінімум стакана ${minCost.toFixed(2)} pUSD, на балансі ${bals.pusd.toFixed(2)}. Ордера немає.`,
    );
  }
  const budget = Math.min(bals.pusd, Math.max(tenth, minCost));
  const fitted = fitOrder(book.best, book.min, budget);
  if (!fitted || Number(fitted.spend) + 1e-9 < ORDER_FLOOR) {
    return refuse("Стакан не вміщує мінімум 1 pUSD. Ордера немає.");
  }

  const shares = Number(fitted.shares);
  let feeLabel = "Комісія: невідома з API. Нуль не вигадую.";
  if (feeRate != null && Number.isFinite(shares)) {
    const fee = shares * feeRate * price * (1 - price);
    feeLabel = Number.isFinite(fee)
      ? `Комісія taker ${feeRate} з API · близько ${fee.toFixed(4)} pUSD`
      : `Комісія taker ${feeRate} з API. Суму не рахую.`;
  }

  const endIso = String(market.endDate ?? "");
  const exchange = book.neg || market.negRisk ? NEG_EXCHANGE : EXCHANGE;
  const allowance = await readAllowance(address, exchange);
  return {
    ok: true,
    place: true,
    question: String(market.question).slice(0, 180),
    outcome: outcomes[sideIndex] ?? action,
    tokenId,
    side: "BUY",
    price: book.best.price,
    spend: fitted.spend,
    shares: fitted.shares,
    makerAmount: fitted.makerAmount,
    takerAmount: fitted.takerAmount,
    negRisk: book.neg || Boolean(market.negRisk),
    exchange,
    action,
    confidence,
    why,
    model: GROK_MODEL,
    grokMs,
    allowance: allowance == null ? "" : allowance.toString(),
    lane,
    category: market.feeType ? String(market.feeType) : "категорія невідома",
    feeRate,
    feeLabel,
    endLabel: endIso ? `${endIso} · ${dayWord(endIso, now)}` : "дата резолву невідома",
    priceToBeat: anchor?.priceToBeat ?? null,
    currentRef: anchor?.currentRef ?? null,
    delta: anchor?.delta ?? null,
    secondsLeft: anchor?.secondsLeft ?? null,
    twapLine: lane === "crypto" && twap ? twapLine(twap) : null,
    windowLabel: anchor?.windowLabel ?? null,
    entryPrice: null,
    askLo: lane === "crypto" ? band.lo : undefined,
    askHi: lane === "crypto" ? band.hi : undefined,
  };
}

export async function holdRestOnServer(tokenId: string): Promise<{ secondsLeft: number | null; flipped: boolean | null }> {
  const market = await marketByTokenId(tokenId);
  if (!market) return { secondsLeft: null, flipped: null };
  const now = Date.now();
  const endMs = Date.parse(String(market.endDate ?? ""));
  const secondsLeft = Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - now) / 1000)) : null;
  if (!isCryptoMarket(market)) return { secondsLeft, flipped: null };
  const spec = windowSpec(market);
  if (!spec) return { secondsLeft, flipped: null };
  const outcomes = parseList(market.outcomes);
  const tokens = parseList(market.clobTokenIds);
  const label = outcomes[tokens.indexOf(tokenId)] ?? "";
  const up = /^up$/i.test(label.trim());
  const down = /^down$/i.test(label.trim());
  if (!up && !down) return { secondsLeft, flipped: null };
  const twap = await readTwapSnapshot(0);
  const tick = spec.twapSec === 30 ? twap.w30 : twap.w60;
  if (!tick.known || tick.stale || !tick.price || (tick.ageSec ?? 99) > 15) return { secondsLeft, flipped: null };
  const ref = await readWindowRef(spec);
  if (!ref) return { secondsLeft, flipped: null };
  const current = Number(tick.price);
  if (!Number.isFinite(current) || current <= 0) return { secondsLeft, flipped: null };
  const delta = current - ref.open;
  const flipped = (up && delta < 0) || (down && delta > 0);
  return { secondsLeft, flipped };
}

export async function bestAskOnServer(tokenId: string): Promise<string | null> {
  const book = await readBook(tokenId);
  return book?.best?.price ?? null;
}

export async function bestBidOnServer(tokenId: string): Promise<string | null> {
  const book = await readBook(tokenId);
  return book?.bid?.price ?? null;
}

function fitSell(sharesHuman: number, bid: BookLevel, minShares: number): {
  spend: string;
  shares: string;
  makerAmount: string;
  takerAmount: string;
} | null {
  const price = Number(bid.price);
  const size = Number(bid.size);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) return null;
  if (!Number.isFinite(sharesHuman) || sharesHuman <= 0) return null;
  const priceMicro = micro(price);
  if (priceMicro <= 0n) return null;
  const shares = micro(Math.min(sharesHuman, size));
  const minMicro = micro(minShares);
  if (minMicro > 0n && shares < minMicro) return null;
  if (shares <= 0n) return null;
  const usdc = (shares * priceMicro) / 1_000_000n;
  if (usdc <= 0n) return null;
  return {
    spend: (Number(usdc) / 1e6).toFixed(6),
    shares: (Number(shares) / 1e6).toFixed(6),
    makerAmount: shares.toString(),
    takerAmount: usdc.toString(),
  };
}

async function marketByToken(tokenId: string): Promise<GammaMarket | null> {
  const now = Date.now();
  const loaded = await loadShortMarkets(now);
  const extra = await loadBtcWindows(new Set(["5m", "15m", "4h"]));
  for (const market of [...(loaded ?? []), ...extra]) {
    if (parseList(market.clobTokenIds).includes(tokenId)) return market;
  }
  return loaded || extra.length ? null : null;
}

export async function reviewCloseOnServer(input: {
  address: string;
  tokenId: string;
  entry: string;
  shares: string;
}): Promise<PolyReview> {
  const entryPx = Number(input.entry);
  const sharesN = Number(input.shares);
  if (!input.tokenId || !Number.isFinite(entryPx) || entryPx <= 0 || !Number.isFinite(sharesN) || sharesN <= 0) {
    return { ok: true, place: false, why: "Немає відкритої позиції. Закриття немає.", grok: null };
  }
  const book = await readBook(input.tokenId);
  if (!book?.bid) {
    return { ok: true, place: false, why: "Немає стакана на продаж. Закриття немає.", grok: null };
  }
  const bidPx = Number(book.bid.price);
  if (!Number.isFinite(bidPx) || bidPx <= entryPx) {
    return { ok: true, place: false, why: "Прибутку в стакані немає. Не продаю.", grok: null };
  }
  const market = await marketByToken(input.tokenId);
  if (!market) {
    return { ok: true, place: false, why: "Ринок позиції не знайдено. Закриття немає.", grok: null };
  }
  const lane: "crypto" | "events" = isCryptoMarket(market) ? "crypto" : "events";
  const now = Date.now();
  const endIso = String(market.endDate ?? "");
  const endMs = Date.parse(endIso);
  let priceToBeat: number | null = null;
  let currentRef: number | null = null;
  let delta: number | null = null;
  let secondsLeft: number | null = Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - now) / 1000)) : null;
  let windowLabel: string | null = null;
  let twap: TwapSnapshot | null = null;
  if (lane === "crypto") {
    const spec = windowSpec(market);
    if (!spec) return { ok: true, place: false, why: "Немає price to beat. Закриття немає.", grok: null };
    twap = await readTwapSnapshot(2000);
    const tick = spec.twapSec === 30 ? twap.w30 : twap.w60;
    if (!tick.known || tick.stale || !tick.price || (tick.ageSec ?? 99) > 15) {
      return { ok: true, place: false, why: "Немає свіжого Chainlink TWAP. Закриття немає.", grok: null };
    }
    const ref = await readWindowRef(spec);
    if (!ref) return { ok: true, place: false, why: "Немає price to beat. Закриття немає.", grok: null };
    currentRef = Number(tick.price);
    if (!Number.isFinite(currentRef) || currentRef <= 0) {
      return { ok: true, place: false, why: "Немає свіжого Chainlink TWAP. Закриття немає.", grok: null };
    }
    priceToBeat = ref.open;
    delta = currentRef - priceToBeat;
    windowLabel = spec.windowLabel;
    secondsLeft = Math.max(0, spec.endSec - Math.floor(now / 1000));
  }
  const feeRate = feeFromApi(market);
  const feeLabel = feeRate == null ? "невідома" : String(feeRate);
  const askedAt = Date.now();
  const decided = await decideCloseOnServer({
    windowLabel,
    priceToBeat,
    currentRef,
    delta,
    secondsLeft,
    entry: entryPx,
    bid: bidPx,
    feeLabel,
    lane,
  });
  const grokMs = Date.now() - askedAt;
  if (!decided.ok) return { ok: true, place: false, why: decided.error, grok: null };
  const grok: GrokTrace = {
    action: decided.action,
    confidence: decided.confidence,
    why: decided.why,
    ms: grokMs,
    lane,
    question: market.question ? String(market.question).slice(0, 180) : null,
    model: GROK_MODEL,
    priceToBeat,
    currentRef,
    delta,
    secondsLeft,
    windowLabel,
    twapLine: twap ? twapLine(twap) : null,
    entryAsk: null,
  };
  if (decided.action !== "sell" || decided.confidence < 0.65) {
    return { ok: true, place: false, why: decided.why || "Не продаю.", grok };
  }
  const fresh = await readBook(input.tokenId);
  if (!fresh?.bid) {
    return { ok: true, place: false, why: "Немає стакана на продаж. Закриття немає.", grok };
  }
  if (Number(fresh.bid.price) <= entryPx) {
    return { ok: true, place: false, why: "Прибутку в стакані немає. Не продаю.", grok };
  }
  const fitted = fitSell(sharesN, fresh.bid, fresh.min);
  if (!fitted) {
    return { ok: true, place: false, why: "Мінімум стакана більший за позицію. Закриття немає.", grok };
  }
  const sellPx = Number(fresh.bid.price);
  let feeText = "Комісія: невідома з API. Нуль не вигадую.";
  if (feeRate != null) {
    const sharesOut = Number(fitted.shares);
    const fee = sharesOut * feeRate * sellPx * (1 - sellPx);
    feeText = Number.isFinite(fee)
      ? `Комісія taker ${feeRate} з API · близько ${fee.toFixed(4)} pUSD`
      : `Комісія taker ${feeRate} з API. Суму не рахую.`;
  }
  const outcomes = parseList(market.outcomes);
  const tokens = parseList(market.clobTokenIds);
  const outcome = outcomes[tokens.indexOf(input.tokenId)] ?? "SELL";
  const exchange = fresh.neg || market.negRisk ? NEG_EXCHANGE : EXCHANGE;
  return {
    ok: true,
    place: true,
    question: String(market.question ?? "відкрита позиція").slice(0, 180),
    outcome,
    tokenId: input.tokenId,
    side: "SELL",
    price: fresh.bid.price,
    spend: fitted.spend,
    shares: fitted.shares,
    makerAmount: fitted.makerAmount,
    takerAmount: fitted.takerAmount,
    negRisk: fresh.neg || Boolean(market.negRisk),
    exchange,
    action: "sell",
    confidence: decided.confidence,
    why: decided.why,
    model: GROK_MODEL,
    grokMs,
    allowance: "",
    lane,
    category: market.feeType ? String(market.feeType) : "категорія невідома",
    feeRate,
    feeLabel: feeText,
    endLabel: endIso ? `${endIso} · ${dayWord(endIso, now)}` : "дата резолву невідома",
    priceToBeat,
    currentRef,
    delta,
    secondsLeft,
    twapLine: twap ? twapLine(twap) : null,
    windowLabel,
    entryPrice: input.entry,
  };
}

export type RedeemPlan =
  | { ok: false; error: string }
  | { ok: true; redeem: false; resolved: boolean; why: string }
  | { ok: true; redeem: true; tokenId: string; conditionId: Hex; negRisk: boolean; adapter: Hex };

async function marketByTokenId(tokenId: string): Promise<GammaMarket | null> {
  if (!/^\d{6,}$/.test(tokenId)) return null;
  const rows = await fetchGamma(
    `https://gamma-api.polymarket.com/markets?clob_token_ids=${encodeURIComponent(tokenId)}`,
  );
  if (!rows?.length) return null;
  return rows.find((m) => parseList(m.clobTokenIds).includes(tokenId)) ?? rows[0] ?? null;
}

export async function reviewRedeemOnServer(tokenId: string): Promise<RedeemPlan> {
  const market = await marketByTokenId(tokenId);
  if (!market) return { ok: true, redeem: false, resolved: false, why: "" };
  const conditionId = asCondition(market.conditionId);
  const closed = market.closed === true;
  if (!conditionId) {
    if (closed) return { ok: true, redeem: false, resolved: true, why: "Редіму немає." };
    return { ok: true, redeem: false, resolved: false, why: "" };
  }
  const ready = await payoutReady(conditionId);
  if (ready == null) {
    if (closed) return { ok: true, redeem: false, resolved: true, why: "Редіму немає." };
    return { ok: true, redeem: false, resolved: false, why: "" };
  }
  if (!ready) return { ok: true, redeem: false, resolved: false, why: "" };
  const neg = Boolean(market.negRisk);
  return {
    ok: true,
    redeem: true,
    tokenId,
    conditionId,
    negRisk: neg,
    adapter: neg ? NEG_ADAPTER : ADAPTER,
  };
}

export type RedeemScan =
  | { ok: false; error: string }
  | { ok: true; redeem: false; assets: string[] }
  | {
      ok: true;
      redeem: true;
      tokenId: string;
      conditionId: Hex;
      negRisk: boolean;
      adapter: Hex;
      assets: string[];
    };

type DataPosition = {
  asset?: unknown;
  conditionId?: unknown;
  size?: unknown;
  redeemable?: unknown;
  negativeRisk?: unknown;
};

export async function scanRedeemOnServer(eoa: string): Promise<RedeemScan> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(eoa)) return { ok: false, error: "Редіму немає." };
  const deposit = deriveDepositWallet(eoa);
  if (!deposit) return { ok: false, error: "Редіму немає." };
  let rows: DataPosition[];
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/positions?user=${deposit}&sizeThreshold=0&limit=100`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    const text = await res.text();
    if (!res.ok) return { ok: false, error: (text || `data-api ${res.status}`).slice(0, 180) || "Редіму немає." };
    const body = JSON.parse(text) as unknown;
    if (!Array.isArray(body)) return { ok: false, error: "Редіму немає." };
    rows = body as DataPosition[];
  } catch {
    return { ok: false, error: "Редіму немає." };
  }
  const assets = rows
    .filter((row) => typeof row.asset === "string" && Number(row.size) > 0)
    .map((row) => String(row.asset));
  const hit = rows.find(
    (row) => row.redeemable === true && Number(row.size) > 0 && typeof row.asset === "string" && /^\d{6,}$/.test(row.asset),
  );
  if (!hit || typeof hit.asset !== "string") return { ok: true, redeem: false, assets };
  let conditionId = asCondition(hit.conditionId);
  let neg: boolean | null = typeof hit.negativeRisk === "boolean" ? hit.negativeRisk : null;
  if (!conditionId || neg == null) {
    const market = await marketByTokenId(hit.asset);
    if (!conditionId && market) conditionId = asCondition(market.conditionId);
    if (neg == null && market) neg = Boolean(market.negRisk);
  }
  if (!conditionId || neg == null) return { ok: false, error: "Редіму немає." };
  return {
    ok: true,
    redeem: true,
    tokenId: hit.asset,
    conditionId,
    negRisk: neg,
    adapter: neg ? NEG_ADAPTER : ADAPTER,
    assets,
  };
}

function clobPathAllowed(method: string, path: string): boolean {
  if (method === "POST" && (path === "/auth/api-key" || path === "/order")) return true;
  if (method === "GET" && path === "/auth/derive-api-key") return true;
  if (method === "GET" && /^\/data\/order\/0x[a-fA-F0-9]{16,128}$/.test(path)) return true;
  if (method === "DELETE" && path === "/order") return true;
  if (
    method === "GET" &&
    /^\/balance-allowance(?:\/update)?\?asset_type=CONDITIONAL&token_id=\d{6,}&signature_type=0$/.test(path)
  ) {
    return true;
  }
  return false;
}

export async function forwardClobOnServer(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; text: string }> {
  if (!clobPathAllowed(method, path)) return { status: 400, text: "Шлях CLOB не дозволений" };
  const send: Record<string, string> = { accept: "application/json" };
  for (const [key, value] of Object.entries(headers)) {
    if (/^POLY_/i.test(key) && typeof value === "string") send[key] = value.slice(0, 4000);
  }
  if (method === "POST" || method === "DELETE") send["content-type"] = "application/json";
  try {
    const res = await fetch(`https://clob.polymarket.com${path}`, {
      method,
      headers: send,
      body: method === "POST" || method === "DELETE" ? body : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 2000) };
  } catch {
    return { status: 0, text: "" };
  }
}
