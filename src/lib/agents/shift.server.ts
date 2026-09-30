import type { ArbQuote, PolyMarketQuote, Quote, WhirlQuote } from "./engine";
import { grokChat } from "./grok-fetch";
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

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ARB_SOL = 0.1;

async function backpackBook(): Promise<{ bid: number; ask: number } | null> {
  const res = await fetch("https://api.backpack.exchange/api/v1/depth?symbol=SOL_USDC", {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { bids?: [string, string][]; asks?: [string, string][] };
  const bid = Number(body.bids?.at(-1)?.[0]);
  const ask = Number(body.asks?.[0]?.[0]);
  if (!(bid > 0) || !(ask > bid)) return null;
  return { bid, ask };
}

async function jupiterOut(inputMint: string, outputMint: string, amount: string): Promise<number | null> {
  const url = new URL("https://lite-api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", "30");
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Solarchik/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { outAmount?: string };
  const out = Number(body.outAmount);
  return Number.isFinite(out) && out > 0 ? out : null;
}

function titanKeyFromEnv(): string {
  return (process.env.TITAN_API_KEY || process.env.TITAN_JWT || "").trim();
}

async function titanOut(inputMint: string, outputMint: string, amount: string, key: string): Promise<number | null> {
  if (!key) return null;
  const url = new URL("https://portal.api.titan.exchange/api/v1/quote/swap");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", "30");
  const res = await fetch(url, {
    headers: { "x-api-key": key, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { outAmount?: string | number; quote?: { outAmount?: string | number } };
  const out = Number(body.outAmount ?? body.quote?.outAmount);
  return Number.isFinite(out) && out > 0 ? out : null;
}

async function legOut(inputMint: string, outputMint: string, amount: string): Promise<number | null> {
  return jupiterOut(inputMint, outputMint, amount);
}

/** Backpack top of book plus the on-chain price of ARB_SOL. Titan when a key exists, otherwise Jupiter. */
export async function readArb(passedKey = ""): Promise<ArbQuote | null> {
  const book = await backpackBook();
  if (!book) return null;
  const key = titanKeyFromEnv() || passedKey.trim().slice(0, 256);
  const lamports = String(Math.round(ARB_SOL * 1_000_000_000));
  const usdcIn = String(Math.round(book.ask * ARB_SOL * 1_000_000));
  const titanSell = key ? await titanOut(SOL_MINT, USDC_MINT, lamports, key).catch(() => null) : null;
  const titanBuy = titanSell ? await titanOut(USDC_MINT, SOL_MINT, usdcIn, key).catch(() => null) : null;
  const via = titanSell && titanBuy ? "titan" : "jupiter";
  const sellRaw = via === "titan" ? titanSell : await legOut(SOL_MINT, USDC_MINT, lamports);
  const buyRaw = via === "titan" ? titanBuy : await legOut(USDC_MINT, SOL_MINT, usdcIn);
  if (!sellRaw || !buyRaw) {
    return { bid: book.bid, ask: book.ask, sellPx: 0, buyPx: 0, chain: "none", sizeSol: ARB_SOL };
  }
  const sellPx = sellRaw / 1_000_000 / ARB_SOL;
  const solOut = buyRaw / 1_000_000_000;
  const buyPx = usdcIn === "0" || !(solOut > 0) ? 0 : Number(usdcIn) / 1_000_000 / solOut;
  if (!(sellPx > 20 && sellPx < 10_000 && buyPx > 20 && buyPx < 10_000)) return null;
  return { bid: book.bid, ask: book.ask, sellPx, buyPx, chain: via, sizeSol: ARB_SOL };
}

export async function fetchQuotes(keywords: string[] = [], titanKey = ""): Promise<Quote | null> {
  const wantTitan = Boolean(titanKeyFromEnv() || titanKey.trim());
  const fresh = quoteCache && Date.now() - quoteCache.at < 20_000 ? quoteCache.quote : null;
  const missing = keywords.filter((raw) => {
    const q = raw.trim().toLowerCase();
    if (!q || q.includes("/") || /^\d+$/.test(q)) return false;
    return !fresh?.polymarkets.some((m) => m.question.toLowerCase().includes(q) || m.yesLabel.toLowerCase().includes(q));
  });
  if (fresh && missing.length === 0 && (!wantTitan || fresh.arb?.chain === "titan")) return fresh;
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
    readArb(titanKey).catch(() => null),
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
