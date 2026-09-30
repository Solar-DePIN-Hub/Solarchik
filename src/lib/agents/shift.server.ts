import { readFileSync } from "node:fs";
import type { ArbQuote, PolyMarketQuote, Quote, WhirlQuote } from "./engine";
import { arbNets } from "./engine";
import { bookTop, loadSpots, USDC_MINT, type SpotMarket } from "./arb-markets.server";
import { deskHeaders, DESK_ORIGIN, grokChat } from "./grok-fetch";
import { GROK_MODEL } from "./grok-model";
import { geminiTalk } from "./gemini-live.server";
import type { ShiftInput, ShiftOk, ShiftResult } from "./shift-types";

let quoteCache: { at: number; quote: Quote } | null = null;

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

const GAMMA_HEADERS = { accept: "application/json", "user-agent": "Solarchik/1.0" };

function windowFromSlug(slug: string): number | null {
  if (slug.includes("updown-5m")) return 5;
  if (slug.includes("updown-15m")) return 15;
  if (slug.includes("updown-4h")) return 240;
  return null;
}

function isBitcoinTopic(question: string, slug: string): boolean {
  return /bitcoin|\bbtc\b/i.test(question) || slug.includes("btc-");
}

function toPoly(raw: Record<string, unknown>, forcedWindow?: number | null): PolyMarketQuote | null {
  if (raw.closed === true || raw.active === false || raw.acceptingOrders === false) return null;
  const outcomes = asList(raw.outcomes);
  const prices = asList(raw.outcomePrices).map(Number);
  if (!outcomes.length || !prices.length) return null;
  let i = outcomes.findIndex((o) => o.toLowerCase() === "yes" || o.toLowerCase() === "up");
  if (i < 0) i = 0;
  const yes = prices[i];
  if (!Number.isFinite(yes) || yes <= 0.02 || yes >= 0.98) return null;
  const question = String(raw.question || raw.title || "").trim();
  const id = String(raw.id || raw.slug || "");
  const slug = String(raw.slug || "");
  if (!question || !id) return null;
  const windowMin = forcedWindow ?? windowFromSlug(slug);
  const btc = windowMin != null || isBitcoinTopic(question, slug);
  const volume = Number(raw.volume24hr ?? raw.volumeNum ?? raw.volume ?? 0);
  const end = Date.parse(String(raw.endDate || ""));
  const noIdx = outcomes.findIndex((_, idx) => idx !== i);
  return {
    id,
    question: question.slice(0, 140),
    yesLabel: outcomes[i].slice(0, 32),
    noLabel: (noIdx >= 0 ? outcomes[noIdx] : "No").slice(0, 32),
    yes,
    focus: btc ? "btc" : "events",
    windowMin: windowMin ?? null,
    volume: Number.isFinite(volume) ? volume : 0,
    endMs: Number.isFinite(end) ? end : null,
  };
}

async function gammaTop(): Promise<PolyMarketQuote[]> {
  const res = await fetch(
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=30&order=volume24hr&ascending=false",
    { headers: GAMMA_HEADERS, signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return [];
  return body.map((row) => toPoly(row as Record<string, unknown>)).filter((m): m is PolyMarketQuote => m != null);
}

const BTC_SPECS = [
  { tag: "5m", step: 300, min: 5 },
  { tag: "15m", step: 900, min: 15 },
  { tag: "4h", step: 14400, min: 240 },
] as const;

/** Current and next Bitcoin Up/Down window for each interval Polymarket actually lists. */
async function gammaBtcWindows(): Promise<PolyMarketQuote[]> {
  const now = Math.floor(Date.now() / 1000);
  const jobs: Array<{ slug: string; min: number }> = [];
  for (const w of BTC_SPECS) {
    const start = Math.floor(now / w.step) * w.step;
    for (const off of [0, w.step]) jobs.push({ slug: `btc-updown-${w.tag}-${start + off}`, min: w.min });
  }
  const rows = await Promise.all(
    jobs.map(async (job) => {
      try {
        const res = await fetch(`https://gamma-api.polymarket.com/markets/slug/${job.slug}`, {
          headers: GAMMA_HEADERS,
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const raw = (await res.json()) as Record<string, unknown>;
        return toPoly(raw, job.min);
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((m): m is PolyMarketQuote => m != null);
}

async function gammaSearch(q: string): Promise<PolyMarketQuote[]> {
  const url = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: GAMMA_HEADERS, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { events?: Array<{ markets?: Array<Record<string, unknown>> }> };
  const out: PolyMarketQuote[] = [];
  for (const ev of body.events ?? []) {
    for (const row of ev.markets ?? []) {
      const m = toPoly(row);
      if (m) out.push(m);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

async function orcaPools(): Promise<WhirlQuote[]> {
  const res = await fetch("https://api.orca.so/v2/solana/pools?sortBy=volume24h&size=20", {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    data?: Array<{
      address?: string;
      feeRate?: number;
      price?: string;
      tokenA?: { symbol?: string };
      tokenB?: { symbol?: string };
    }>;
  };
  const out: WhirlQuote[] = [];
  for (const p of body.data ?? []) {
    const price = Number(p.price);
    const symbolA = p.tokenA?.symbol?.trim();
    const symbolB = p.tokenB?.symbol?.trim();
    if (!p.address || !symbolA || !symbolB || !(price > 0)) continue;
    out.push({
      address: p.address,
      symbolA,
      symbolB,
      price,
      feeBps: Math.round((p.feeRate ?? 0) / 100),
    });
  }
  return out;
}

async function coinbase(): Promise<{ solUsd: number; btcUsd: number } | null> {
  const [solRes, btcRes] = await Promise.all([
    fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot", { signal: AbortSignal.timeout(4000) }),
    fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", { signal: AbortSignal.timeout(4000) }),
  ]);
  if (!solRes.ok || !btcRes.ok) return null;
  const solBody = (await solRes.json()) as { data?: { amount?: string } };
  const btcBody = (await btcRes.json()) as { data?: { amount?: string } };
  const sol = Number(solBody.data?.amount);
  const btc = Number(btcBody.data?.amount);
  if (!Number.isFinite(sol) || !Number.isFinite(btc)) return null;
  return { solUsd: sol, btcUsd: btc };
}

function mergePoly(lists: PolyMarketQuote[][]): PolyMarketQuote[] {
  const seen = new Set<string>();
  const out: PolyMarketQuote[] = [];
  for (const list of lists) {
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
      if (out.length >= 24) return out;
    }
  }
  return out;
}

const ARB_SOL = 0.1;
const ARB_BATCH = 4;

let arbCursor = 0;
const arbMem = new Map<string, { at: number; quote: ArbQuote }>();

async function quoteSpot(spot: SpotMarket, notionalUsd: number, key: string): Promise<ArbQuote | null> {
  const book = await bookTop(spot.market);
  if (!book) return null;
  const qty = Math.max(spot.minQty, notionalUsd > 0 ? notionalUsd / book.ask : spot.minQty);
  const atoms = Math.round(qty * 10 ** spot.decimals);
  const usdcIn = Math.round(book.ask * qty * 1_000_000);
  if (!(atoms > 0) || !(usdcIn > 0)) return null;
  const titanSell = await titanOut(spot.mint, USDC_MINT, String(atoms), key).catch(() => null);
  const titanBuy = titanSell ? await titanOut(USDC_MINT, spot.mint, String(usdcIn), key).catch(() => null) : null;
  const via = titanSell && titanBuy ? "titan" : "jupiter";
  const sellRaw = via === "titan" ? titanSell : await legOut(spot.mint, USDC_MINT, String(atoms));
  const buyRaw = via === "titan" ? titanBuy : await legOut(USDC_MINT, spot.mint, String(usdcIn));
  if (!sellRaw || !buyRaw) {
    return { bid: book.bid, ask: book.ask, sellPx: 0, buyPx: 0, chain: "none", sizeSol: qty, base: spot.base, scanned: 0, minQty: spot.minQty };
  }
  const sellPx = sellRaw / 1_000_000 / qty;
  const baseOut = buyRaw / 10 ** spot.decimals;
  const buyPx = baseOut > 0 ? usdcIn / 1_000_000 / baseOut : 0;
  const mid = (book.bid + book.ask) / 2;
  if (!(sellPx > mid * 0.5 && sellPx < mid * 1.5 && buyPx > mid * 0.5 && buyPx < mid * 1.5)) return null;
  return { bid: book.bid, ask: book.ask, sellPx, buyPx, chain: via, sizeSol: qty, base: spot.base, scanned: 0, minQty: spot.minQty };
}

/** Best net edge across Backpack spot markets that withdraw on Solana. A few pairs are refreshed each call. */
export async function readArb(
  passedKey = "",
  sizeSol = ARB_SOL,
  side: "buy" | "sell" | "both" = "both",
): Promise<ArbQuote | null> {
  const spots = await loadSpots();
  if (!spots.length) return null;
  const key = titanKeyFromEnv() || passedKey.trim().slice(0, 256);
  const size = Math.min(0.1, Math.max(0.005, sizeSol));
  const solSpot = spots.find((row) => row.base === "SOL") ?? null;
  const solBook = solSpot ? await bookTop(solSpot.market) : null;
  const solPx = solBook?.ask ?? 0;
  const notional = solPx > 0 ? size * solPx : 0;
  const batch: SpotMarket[] = [];
  if (solSpot) batch.push(solSpot);
  for (let i = 0; i < ARB_BATCH && spots.length; i++) batch.push(spots[(arbCursor + i) % spots.length]);
  arbCursor = (arbCursor + ARB_BATCH) % spots.length;
  const seen = new Set<string>();
  const unique = batch.filter((row) => (seen.has(row.base) ? false : (seen.add(row.base), true)));
  const quoted = await Promise.all(unique.map((row) => quoteSpot(row, notional, key).catch(() => null)));
  const now = Date.now();
  for (const row of quoted) {
    if (row) arbMem.set(row.base, { at: now, quote: row });
  }
  const fresh = [...arbMem.entries()].filter(([, row]) => now - row.at < 120_000);
  for (const [base, row] of [...arbMem.entries()]) {
    if (now - row.at >= 120_000) arbMem.delete(base);
  }
  let best: ArbQuote | null = null;
  let bestEdge = -Infinity;
  for (const [, row] of fresh) {
    const quote = row.quote;
    if (!(quote.sellPx > 0) || !(quote.buyPx > 0)) continue;
    const { netA, netB } = arbNets(quote);
    const edge = side === "sell" ? netA : side === "buy" ? netB : Math.max(netA, netB);
    if (edge > bestEdge) {
      bestEdge = edge;
      best = quote;
    }
  }
  if (!best) {
    const any = quoted.find((row) => row && row.bid > 0);
    if (!any) return null;
    return { ...any, scanned: fresh.length || 1 };
  }
  return { ...best, scanned: fresh.length };
}

async function jupiterOut(inputMint: string, outputMint: string, amount: string): Promise<number | null> {
  const bases = ["https://lite-api.jup.ag/swap/v1/quote", "https://api.jup.ag/swap/v1/quote"];
  for (const base of bases) {
    const url = new URL(base);
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amount);
    url.searchParams.set("slippageBps", "30");
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "Solarchik/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { outAmount?: string };
      const out = Number(body.outAmount);
      if (Number.isFinite(out) && out > 0) return out;
    } catch {
      /* next host */
    }
  }
  return null;
}

function titanKeyFromEnv(): string {
  const fromEnv = (process.env.TITAN_API_KEY || process.env.TITAN_JWT || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(new URL("../../../server/titan.secret", import.meta.url), "utf8").trim().slice(0, 256);
  } catch {
    return "";
  }
}

function readOutAmount(body: {
  outAmount?: string | number;
  quote?: { outAmount?: string | number };
  quotes?: Record<string, { outAmount?: string | number }>;
}): number | null {
  let out = Number(body.outAmount ?? body.quote?.outAmount);
  if (body.quotes) {
    for (const row of Object.values(body.quotes)) {
      const n = Number(row?.outAmount);
      if (n > out) out = n;
    }
  }
  return Number.isFinite(out) && out > 0 ? out : null;
}

async function titanOut(inputMint: string, outputMint: string, amount: string, key: string): Promise<number | null> {
  try {
    const desk = await fetch(`${DESK_ORIGIN}/api/titan`, {
      method: "POST",
      headers: {
        ...deskHeaders(),
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ inputMint, outputMint, amount }),
      signal: AbortSignal.timeout(8000),
    });
    if (desk.ok) {
      const n = readOutAmount((await desk.json()) as { outAmount?: string | number });
      if (n) return n;
    }
  } catch {
    /* desk down — try Titan directly */
  }
  if (!key) return null;
  const url = new URL("https://portal.api.titan.exchange/api/v1/quote/swap");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", "30");
  url.searchParams.set("userPublicKey", "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic");
  const res = await fetch(url, {
    headers: {
      "x-api-key": key,
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return readOutAmount((await res.json()) as { outAmount?: string | number });
}

async function legOut(inputMint: string, outputMint: string, amount: string): Promise<number | null> {
  return jupiterOut(inputMint, outputMint, amount);
}

export async function fetchQuotes(
  keywords: string[] = [],
  titanKey = "",
  sizeSol = ARB_SOL,
  side: "buy" | "sell" | "both" | string = "both",
): Promise<Quote | null> {
  const pick = side === "buy" || side === "sell" ? side : "both";
  const fresh = quoteCache && Date.now() - quoteCache.at < 20_000 ? quoteCache.quote : null;
  const missing = keywords.filter((raw) => {
    const q = raw.trim().toLowerCase();
    if (!q || q.includes("/") || /^\d+$/.test(q)) return false;
    return !fresh?.polymarkets.some((m) => m.question.toLowerCase().includes(q) || m.yesLabel.toLowerCase().includes(q));
  });
  if (fresh && missing.length === 0) {
    const arb = await readArb(titanKey, sizeSol, pick).catch(() => fresh.arb ?? null);
    return { ...fresh, arb };
  }
  const searches = ["Bitcoin", "Solana"];
  for (const raw of keywords) {
    const q = raw.trim();
    if (!q || q.includes("/") || /^\d+$/.test(q)) continue;
    if (searches.some((s) => s.toLowerCase() === q.toLowerCase())) continue;
    searches.push(q.slice(0, 32));
    if (searches.length >= 4) break;
  }
  const [spot, pools, btcWindows, top, arb, ...found] = await Promise.all([
    coinbase().catch(() => null),
    orcaPools().catch(() => [] as WhirlQuote[]),
    gammaBtcWindows().catch(() => [] as PolyMarketQuote[]),
    gammaTop().catch(() => [] as PolyMarketQuote[]),
    readArb(titanKey, sizeSol, pick).catch(() => null),
    ...searches.map((q) => gammaSearch(q).catch(() => [] as PolyMarketQuote[])),
  ]);
  const whirlpools = pools;
  const solPool = whirlpools.find((p) => p.symbolA === "SOL" && p.symbolB === "USDC");
  const btcPool = whirlpools.find((p) => p.symbolB === "USDC" && /btc/i.test(p.symbolA));
  const solUsd = spot?.solUsd ?? solPool?.price ?? 0;
  const btcUsd = spot?.btcUsd ?? btcPool?.price ?? 0;
  const polymarkets = mergePoly([btcWindows, top, ...found]);
  if (!(solUsd > 0) && polymarkets.length === 0 && whirlpools.length === 0) {
    return quoteCache?.quote ?? null;
  }
  const quote: Quote = { solUsd, btcUsd, polymarkets, whirlpools, arb };
  quoteCache = { at: Date.now(), quote };
  return quote;
}

function extractJson(raw: string): Record<string, unknown> | null {
  const fence = raw.trim().match(/\{[\s\S]*\}/);
  if (!fence) return null;
  try {
    return JSON.parse(fence[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function envTrim(name: string): string {
  if (import.meta.env.VITE_NATIVE === "1" || typeof process === "undefined") return "";
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

async function geminiComplete(prompt: string): Promise<{ text: string; model: string } | null> {
  return geminiTalk(
    "You are a Solana agent. Reply with a single compact JSON object. No markdown.",
    prompt,
    220,
  );
}

async function openaiCompat(
  base: string,
  key: string,
  model: string,
  prompt: string,
): Promise<{ text: string; model: string } | null> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content: "You are a Solana agent. Reply with a single compact JSON object. No markdown.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content?.trim();
  return text ? { text, model } : null;
}

async function complete(prompt: string): Promise<{ provider: string; model: string; text: string } | null> {
  const gemini = await geminiComplete(prompt).catch(() => null);
  if (gemini) return { provider: "Gemini", ...gemini };

  const openaiKey = envTrim("OPENAI_API_KEY");
  if (openaiKey) {
    const openai = await openaiCompat("https://api.openai.com/v1", openaiKey, "gpt-4o-mini", prompt).catch(
      () => null,
    );
    if (openai) return { provider: "OpenAI", ...openai };
  }

  const xaiKey = envTrim("XAI_API_KEY");
  const xai = xaiKey
    ? await openaiCompat("https://api.x.ai/v1", xaiKey, GROK_MODEL, prompt).catch(() => null)
    : await grokChat(
        {
          model: GROK_MODEL,
          temperature: 0.35,
          max_tokens: 180,
          messages: [
            { role: "system", content: "You are a Solana agent. Reply with a single compact JSON object. No markdown." },
            { role: "user", content: prompt },
          ],
        },
        12_000,
      )
        .then(async (res) => {
          if (!res.ok) return null;
          const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const text = body.choices?.[0]?.message?.content?.trim();
          return text ? { text, model: GROK_MODEL } : null;
        })
        .catch(() => null);
  if (xai) return { provider: "Grok", ...xai };
  return null;
}

function buildPrompt(input: ShiftInput, quote: Quote | null): string {
  const q = quote ? `SOL ${quote.solUsd.toFixed(2)} USD, BTC ${quote.btcUsd.toFixed(0)} USD.` : "Quotes unavailable.";
  const s = input.strategy;
  const m = input.metrics;
  const base = `${input.nftName} [${input.track}] XP ${m.xp} jobs ${m.jobs} pnl ${m.pnlSol}. ${q}`;
  if (input.kind === "prediction") {
    const venue = s.prediction.venue === "polymarket" ? "Polymarket Gamma YES/NO" : "Orca Whirlpool";
    return `${base}
Prediction agent on ${venue}. Obey the user's strategy. Do not invent new parameters.
Market ${s.prediction.market}, window ${s.prediction.windowMin}m, edge ${s.prediction.edgeBps} bps, stake ${s.prediction.maxStakeSol} SOL.
JSON keys: line (Ukrainian, ≤140 chars).`;
  }
  if (input.kind === "dex") {
    return `${base}
Titan × Backpack SOL/USDC, DRY_RUN. Do not invent a fill or a transaction.
Pair ${s.dex.pair}. Minimum gross edge ${s.dex.slippageBps} bps. Side ${s.dex.side}.
JSON keys: line (Ukrainian, ≤140 chars).`;
  }
  const venue = s.prediction.venue === "polymarket" ? "Polymarket Gamma YES/NO" : "Orca Whirlpool";
  return `${base}
Prediction agent (RIG). Obey the user's strategy. Do not invent new parameters.
Market ${s.prediction.market} on ${venue}, window ${s.prediction.windowMin}m, edge ${s.prediction.edgeBps} bps, stake ${s.prediction.maxStakeSol} SOL.
JSON keys: line (Ukrainian, ≤140 chars).`;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export async function executeShift(data: ShiftInput): Promise<ShiftResult> {
  const quote = await fetchQuotes();
  const done = await complete(buildPrompt(data, quote));
  if (!done) return { ok: false, error: "AI is not available" };
  const parsed = extractJson(done.text);
  if (!parsed) {
    return {
      ok: true,
      provider: done.provider,
      model: done.model,
      line: done.text.slice(0, 160),
      win: true,
    };
  }
  const tone = parsed.tone;
  const result: ShiftOk = {
    ok: true,
    provider: done.provider,
    model: done.model,
    line: typeof parsed.line === "string" ? parsed.line.slice(0, 180) : done.text.slice(0, 160),
    win: parsed.win === true,
    edgeBps: num(parsed.edgeBps),
    windowMin: num(parsed.windowMin),
    slippageBps: num(parsed.slippageBps),
    dcaAmountSol: num(parsed.dcaAmountSol),
    cadenceMin: num(parsed.cadenceMin),
    tone: tone === "calm" || tone === "hype" || tone === "research" ? tone : undefined,
    draft: typeof parsed.draft === "string" ? parsed.draft.slice(0, 200) : undefined,
  };
  return result;
}
