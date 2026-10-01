import { clampStrategy, clampWindows, dynamicSize, STRATEGY_MINUTES_PER_TICK } from "./classes";
import { rigDecide } from "./rig";
import type { AgentFill, AgentKind, AgentNft, LogEntry, OpenBook, PredictionStrategy, StrategyBundle, Track } from "./types";

/** Deck costs: 0.10% Backpack taker plus 5 bps for priority fee and a missed leg. */
export const ARB_COSTS = 0.0015;

export function arbNets(book: { ask: number; bid: number; sellPx: number; buyPx: number }): { netA: number; netB: number } {
  const netA = book.sellPx > 0 && book.ask > 0 ? book.sellPx / book.ask - 1 - ARB_COSTS : -1;
  const netB = book.buyPx > 0 && book.bid > 0 ? book.bid / book.buyPx - 1 - ARB_COSTS : -1;
  return { netA, netB };
}
export type PolyMarketQuote = {
  id: string;
  question: string;
  yesLabel: string;
  noLabel: string;
  yes: number;
  /** btc = Bitcoin Up/Down window. events = everything else. */
  focus: "btc" | "events";
  /** 5, 15, or 240 for a live BTC window. Null for other events. */
  windowMin: number | null;
  volume: number;
  endMs: number | null;
};

/** Orca Whirlpool. price is token A measured in token B. */
export type WhirlQuote = {
  address: string;
  symbolA: string;
  symbolB: string;
  price: number;
  feeBps: number;
};

export type Quote = {
  solUsd: number;
  btcUsd: number;
  polymarkets: PolyMarketQuote[];
  whirlpools: WhirlQuote[];
  /** Best book across Backpack spot markets that settle on Solana. Null when Backpack did not answer. */
  arb?: ArbQuote | null;
};

/** Best bid/ask and the on-chain price of 1 base token, in USDC. */
export type ArbQuote = {
  bid: number;
  ask: number;
  sellPx: number;
  buyPx: number;
  chain: "titan" | "jupiter" | "none";
  sizeSol: number;
  /** Backpack base symbol, e.g. SOL or JUP. */
  base: string;
  /** How many pairs had a fresh quote when this one was chosen. */
  scanned: number;
  minQty: number;
};

export type ArbHouseView = {
  bpSol: number | null;
  bpUsdc: number | null;
  chainSol: number | null;
  chainUsdc: number | null;
  houseKey: boolean;
  /** Base symbol → available on Backpack and on the Solana desk. Absent until both reads land. */
  tokens?: Record<string, { bp: number; chain: number }> | null;
  /** Server decision. "sim" never moves money; "closed" never fires. Missing = treat as mainnet rules. */
  mode?: "mainnet" | "sim" | "closed";
  modeReason?: string;
};

export type ChainJob =
  | { kind: "dex"; side: "buy" | "sell"; amount: number }
  | {
      kind: "prediction";
      phase: "lock" | "settle";
      stake: number;
      pnl: number;
      win: boolean;
      memo: string;
      fillId: string;
      asset: string;
    };

export type FillPatch = { id: string; pnl: number; status: "settled" | "withdrawn" };

export type StepResult = {
  nft: AgentNft;
  log: LogEntry | null;
  line: string;
  clockMin: number;
  anchorPx: number | null;
  anchorLabel: string | null;
  chain: ChainJob | null;
  /** Real decision (not a wait, not the first price anchor). */
  counted: boolean;
  brain: string | null;
  fill: AgentFill | null;
  fillPatch: FillPatch | null;
  /** Set only when credit, both treasuries, and the house key are all in place. */
  arbFire?: { dir: "A" | "B"; symbol: string } | null;
  /** Set when this tick should ask Grok instead of locking immediately. */
  ask?: BrainAsk | null;
};

export type BrainMarket = {
  id: string;
  question: string;
  yesLabel: string;
  noLabel: string;
  yes: number;
  windowMin: number | null;
  volume: number;
};

export type BrainAsk = {
  focus: "btc" | "events";
  name: string;
  risk: "calm" | "balanced" | "risky";
  goal: string;
  edgeBps: number;
  maxStakeSol: number;
  anchorYes: number;
  moveBps: number;
  anchorLabel: string;
  markets: BrainMarket[];
};

type Book = {
  px: number;
  label: string;
  pretty: string;
  via: string;
  mode: "edge" | "favorite";
};

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function strategyNeedMin(kind: AgentKind, strategy: StrategyBundle): number {
  const s = clampStrategy(strategy);
  if (kind === "prediction") return s.prediction.windowMin;
  return Math.max(10, s.dex.dcaIntervalSec / 60);
}

function isBtc(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return s === "BTC" || s === "CBBTC" || s === "WBTC" || s.endsWith("BTC");
}

function isUsd(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return s === "USD" || s === "USDC" || s === "USDT" || s.endsWith("USD");
}

function sameLeg(symbol: string, want: string): boolean {
  if (want === "BTC") return isBtc(symbol);
  if (want === "USD") return isUsd(symbol);
  return symbol.toUpperCase() === want;
}

export function favoriteChance(m: PolyMarketQuote): number {
  return Math.max(m.yes, 1 - m.yes);
}

/** Live Bitcoin Up/Down window the person actually turned on. Soonest close wins. */
export function pickBtcWindow(strategy: PredictionStrategy, markets: PolyMarketQuote[]): PolyMarketQuote | null {
  const windows = new Set(clampWindows(strategy.windows));
  const now = Date.now();
  const open = markets.filter(
    (m) =>
      m.focus === "btc" &&
      m.windowMin != null &&
      windows.has(m.windowMin) &&
      m.yes > 0.08 &&
      m.yes < 0.92 &&
      (m.endMs == null || m.endMs > now + 20_000),
  );
  open.sort((a, b) => (a.endMs ?? Number.MAX_SAFE_INTEGER) - (b.endMs ?? Number.MAX_SAFE_INTEGER));
  return open[0] ?? null;
}

/** Non-bitcoin markets worth reading, loudest first. */
export function eventSlate(markets: PolyMarketQuote[]): PolyMarketQuote[] {
  return markets
    .filter((m) => m.focus !== "btc" && m.yes > 0.08 && m.yes < 0.92)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 6);
}

function toBrainMarket(m: PolyMarketQuote): BrainMarket {
  return {
    id: m.id,
    question: m.question,
    yesLabel: m.yesLabel,
    noLabel: m.noLabel,
    yes: Number(m.yes.toFixed(3)),
    windowMin: m.windowMin,
    volume: Math.round(m.volume),
  };
}

/** Strongest favorite that is not Bitcoin and not already decided. */
export function pickEvent(markets: PolyMarketQuote[]): PolyMarketQuote | null {
  const ranked = markets.filter((m) => {
    if (m.focus === "btc") return false;
    const fav = favoriteChance(m);
    return fav >= 0.62 && fav <= 0.94;
  });
  ranked.sort((a, b) => favoriteChance(b) - favoriteChance(a) || b.volume - a.volume);
  return ranked[0] ?? null;
}

export function matchPoly(market: string, markets: PolyMarketQuote[]): PolyMarketQuote | null {
  const key = market.trim().toLowerCase();
  if (!key) return markets[0] ?? null;
  const byId = markets.find((m) => m.id === market.trim());
  if (byId) return byId;
  const hit = markets.find(
    (m) => m.question.toLowerCase().includes(key) || m.yesLabel.toLowerCase().includes(key),
  );
  return hit ?? null;
}

export function matchWhirl(market: string, quote: Quote): Book | null {
  const raw = market.trim();
  const parts = raw.toUpperCase().split("/").map((p) => p.trim());
  const pair = parts.length === 2 ? { base: parts[0], quote: parts[1] } : null;
  for (const pool of quote.whirlpools) {
    if (!(pool.price > 0)) continue;
    const forward = pair
      ? sameLeg(pool.symbolA, pair.base) && sameLeg(pool.symbolB, pair.quote)
      : `${pool.symbolA}/${pool.symbolB}`.toUpperCase().includes(raw.toUpperCase());
    const inverse =
      pair != null && sameLeg(pool.symbolB, pair.base) && sameLeg(pool.symbolA, pair.quote);
    if (forward) {
      return {
        px: pool.price,
        label: pool.address,
        pretty: `Шатбол ${pool.symbolA}/${pool.symbolB} ${fmtPx(pool.price)} · fee ${pool.feeBps} bps`,
        via: "orca",
        mode: "edge",
      };
    }
    if (inverse) {
      const px = 1 / pool.price;
      return {
        px,
        label: `${pool.address}:inv`,
        pretty: `Шатбол ${pool.symbolB}/${pool.symbolA} ${fmtPx(px)} · fee ${pool.feeBps} bps`,
        via: "orca",
        mode: "edge",
      };
    }
  }
  if (pair?.base === "BTC" && quote.btcUsd > 0) {
    return {
      px: quote.btcUsd,
      label: "coinbase:BTC",
      pretty: `Coinbase BTC ${quote.btcUsd.toFixed(0)} (пулу ${raw} на Orca немає)`,
      via: "coinbase",
      mode: "edge",
    };
  }
  if ((!pair || pair.base === "SOL") && quote.solUsd > 0 && !quote.whirlpools.length) {
    return {
      px: quote.solUsd,
      label: "coinbase:SOL",
      pretty: `Coinbase SOL ${quote.solUsd.toFixed(2)} (Orca не відповіла)`,
      via: "coinbase",
      mode: "edge",
    };
  }
  return null;
}

function fmtPx(n: number): string {
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

export function predictionHint(strategy: PredictionStrategy, quote: Quote | null): string | null {
  if (!quote) return null;
  const s = clampStrategy({ prediction: strategy, dex: { pair: "SOL/USDC", dcaIntervalSec: 900, dcaAmountSol: 0.005, slippageBps: 50, side: "both" } }).prediction;
  if (s.focus === "events") {
    const m = eventSlate(quote.polymarkets)[0] ?? null;
    if (!m) return "Поки немає подій поза біткоїном. Grok обере, коли Gamma їх віддасть.";
    const name = m.yes >= 0.5 ? m.yesLabel : m.noLabel;
    return `Grok дивиться ринки поза біткоїном. Зараз найгучніший: «${m.question}» · ${name} ${(favoriteChance(m) * 100).toFixed(0)}%`;
  }
  const live = quote.polymarkets.filter((m) => m.focus === "btc" && m.windowMin != null);
  if (!live.length) return "Gamma ще не віддала вікна Bitcoin Up/Down.";
  const picked = pickBtcWindow(s, quote.polymarkets);
  const bits = [5, 15, 240]
    .filter((min) => (s.windows ?? []).includes(min))
    .map((min) => {
      const row = live.find((m) => m.windowMin === min && m.yes > 0.08 && m.yes < 0.92);
      const label = min === 240 ? "4 год" : `${min} хв`;
      return row ? `${label} Up ${(row.yes * 100).toFixed(0)}%` : `${label} тихо`;
    });
  if (!picked) return `Обрані вікна: ${bits.join(" · ") || "немає"}. Зараз жодне не приймає ставку.`;
  return `Зараз ${picked.windowMin === 240 ? "4 год" : `${picked.windowMin} хв`}: Up ${(picked.yes * 100).toFixed(0)}%. ${bits.join(" · ")}`;
}

function bump(nft: AgentNft, now: number, win: boolean | null, pnl: number): AgentNft {
  return {
    ...nft,
    updatedAt: now,
    strategy: nft.strategy,
    metrics: {
      ...nft.metrics,
      xp: nft.metrics.xp + (win === true ? 10 : win === false ? 3 : 1),
      jobs: nft.metrics.jobs + 1,
      wins: nft.metrics.wins + (win === true ? 1 : 0),
      losses: nft.metrics.losses + (win === false ? 1 : 0),
      pnlSol: Number((nft.metrics.pnlSol + pnl).toFixed(5)),
      lastJobAt: now,
    },
  };
}

export function advanceAgent(args: {
  nft: AgentNft;
  kind: AgentKind;
  track: Track;
  now: number;
  clockMin: number;
  anchorPx: number | null;
  anchorLabel: string | null;
  quote: Quote | null;
  free: number;
  /** grok = freeze and ask. wait = Grok is already reading. rule = old edge commit. */
  decider?: "grok" | "wait" | "rule" | "capped";
  /** Live Jupiter path. Clock only — size and send live in the store, not from Devnet free. */
  liveDex?: boolean;
  /** Credit already confirmed on ARB_TREASURY for this NFT. */
  creditSol?: number;
  /** House balances. Null until the server has answered. */
  house?: ArbHouseView | null;
  liveMaxSol?: number;
}): StepResult {
  const strategy = clampStrategy(args.nft.strategy);
  const nft = { ...args.nft, strategy };
  const need = Math.max(strategyNeedMin(args.kind, strategy), STRATEGY_MINUTES_PER_TICK * 2);
  const nextClock = args.clockMin + STRATEGY_MINUTES_PER_TICK;
  const hold = (line: string, extra?: Partial<StepResult>): StepResult => ({
    nft,
    log: null,
    line,
    clockMin: extra?.clockMin ?? nextClock,
    anchorPx: extra && "anchorPx" in extra ? (extra.anchorPx ?? null) : args.anchorPx,
    anchorLabel: extra && "anchorLabel" in extra ? (extra.anchorLabel ?? null) : args.anchorLabel,
    chain: null,
    counted: false,
    brain: null,
    fill: null,
    fillPatch: null,
    ask: null,
    arbFire: null,
  });

  if (args.kind === "dex") {
    return arbDex(nft, args, hold, nextClock < need);
  }
  if (nextClock < need) {
    return hold(`За стратегією · ${Math.floor(nextClock)}/${Math.round(need)} хв`);
  }
  if (args.kind === "prediction") {
    return predictionWindow(nft, args, hold, args.free);
  }
  return hold("Цей агент не торгує");
}

function px(n: number): string {
  if (!(n > 0)) return "0";
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function arbDex(
  nft: AgentNft,
  args: {
    now: number;
    clockMin: number;
    quote: Quote | null;
    free: number;
    creditSol?: number;
    house?: ArbHouseView | null;
    liveMaxSol?: number;
  },
  hold: (line: string, extra?: Partial<StepResult>) => StepResult,
  quiet: boolean,
): StepResult {
  const book = args.quote?.arb;
  if (!book || !(book.bid > 0) || !(book.ask > book.bid)) {
    return hold("Backpack не віддав книгу", { clockMin: args.clockMin });
  }
  if (!(book.sellPx > 0) || !(book.buyPx > 0)) {
    return hold(`${book.base}/USDC ${px(book.bid)}/${px(book.ask)}. Ончейн не відповів.`, {
      anchorPx: book.ask,
      anchorLabel: book.base,
    });
  }
  const src = book.chain === "titan" ? "Titan" : "Jupiter";
  const { netA, netB } = arbNets(book);
  const side = nft.strategy.dex.side;
  const allowA = side !== "buy";
  const allowB = side !== "sell";
  const pickA = allowA && netA >= netB;
  const best = Math.max(allowA ? netA : -1, allowB ? netB : -1);
  const dir = pickA
    ? `A: купити ${book.base} на Backpack, продати через ${src}`
    : `B: купити ${book.base} через ${src}, продати на Backpack`;
  const bps = best * 10_000;
  const minBps = nft.strategy.dex.slippageBps;
  const head = `${book.base}/USDC ${px(book.bid)}/${px(book.ask)} · ${src} ${px(book.sellPx)}/${px(book.buyPx)} · ${book.scanned} пар`;
  const mark = { anchorPx: book.ask, anchorLabel: book.base };
  if (quiet) {
    return hold(`${head}. Чистий край ${bps.toFixed(1)} bps, поріг ${minBps}. Чекаю.`, mark);
  }
  if (!(best > minBps / 10_000)) {
    return hold(`${head}. Чистий край ${bps.toFixed(1)} bps, поріг ${minBps}. Край.`, mark);
  }
  const liveMax = args.liveMaxSol ?? 0.005;
  const credit = args.creditSol ?? 0;
  const house = args.house;
  if (house?.mode === "closed") {
    return hold(`${head}. ${house.modeReason || "Каса закрита."}`, mark);
  }
  // Simulation: nothing is spent, so credit and treasury balances do not gate it.
  const sim = house?.mode === "sim";
  if (!sim && !(credit + 1e-9 >= liveMax)) {
    return hold(`${head}. Немає кредиту.`, mark);
  }
  const solPx = args.quote?.solUsd && args.quote.solUsd > 0 ? args.quote.solUsd : book.base === "SOL" ? book.ask : 0;
  if (!(solPx > 0)) return hold(`${head}. Чекаю ціну SOL.`, mark);
  const qty = book.base === "SOL" ? liveMax : (liveMax * solPx) / book.ask;
  if (book.minQty > 0 && !(qty + 1e-9 >= book.minQty)) {
    return hold(`${head}. Нога менша за мінімум біржі.`, mark);
  }
  const needUsdc = qty * book.ask;
  const row = house?.tokens?.[book.base];
  const bpBase = book.base === "SOL" ? house?.bpSol : row?.bp;
  const chainBase = book.base === "SOL" ? house?.chainSol : row?.chain;
  const covered = (base: number | null | undefined, usdc: number | null | undefined) =>
    base != null && usdc != null && base + 1e-12 >= qty && usdc + 1e-9 >= needUsdc;
  if (!sim) {
    if (!house || house.bpUsdc == null || (book.base !== "SOL" && !house.tokens)) {
      return hold(`${head}. Чекаю касу.`, mark);
    }
    if (!covered(bpBase, house.bpUsdc)) {
      return hold(`${head}. Каса Backpack порожня.`, mark);
    }
    if (house.chainUsdc == null || (book.base === "SOL" ? house.chainSol == null : chainBase == null)) {
      return hold(`${head}. Чекаю касу.`, mark);
    }
    if (!covered(chainBase, house.chainUsdc)) {
      return hold(`${head}. Ончейн-каса порожня.`, mark);
    }
    if (!house.houseKey) {
      return hold(`${head}. Немає ключа каси ончейн.`, mark);
    }
  }
  const text = `${sim ? "СИМУЛЯЦІЯ · " : ""}${head}. ${dir}. Чистий край ${bps.toFixed(1)} bps. Нога ${qty.toPrecision(4)} ${book.base}.`;
  return {
    nft,
    log: { id: uid(), at: args.now, kind: "dex", text },
    line: text,
    clockMin: 0,
    anchorPx: book.ask,
    anchorLabel: book.base,
    chain: null,
    counted: true,
    brain: "Titan × Backpack",
    fill: null,
    fillPatch: null,
    arbFire: { dir: pickA ? "A" : "B", symbol: book.base },
  };
}

function predictionWindow(
  nft: AgentNft,
  args: {
    now: number;
    clockMin: number;
    anchorPx: number | null;
    anchorLabel: string | null;
    quote: Quote | null;
    decider?: "grok" | "wait" | "rule" | "capped";
  },
  hold: (line: string, extra?: Partial<StepResult>) => StepResult,
  free: number,
): StepResult {
  const s = nft.strategy.prediction;
  if (s.focus === "weather") {
    return hold("Погода йде зі станції в правилах, не з вікна біткоїна.", { clockMin: 0 });
  }
  if (!args.quote) return hold("Чекаю Gamma", { clockMin: args.clockMin });
  if (nft.openBook?.bookKey) {
    const same = bookForKey(nft.openBook.bookKey, args.quote);
    if (!same) return hold("Чекаю той самий ринок Gamma, щоб закрити ставку", { clockMin: args.clockMin });
    return settlePrediction(nft, args.now, same);
  }
  const book = s.venue === "polymarket" ? polyBook(s, args.quote) : matchWhirl(s.market, args.quote);
  if (!book) {
    const why =
      s.focus === "events"
        ? "Gamma ще не дала подій поза біткоїном"
        : "Немає живого вікна Bitcoin серед обраних";
    return hold(why, { clockMin: 0 });
  }
  if (nft.openBook) return settlePrediction(nft, args.now, book);
  if (!(args.anchorPx && args.anchorPx > 0) || args.anchorLabel !== book.label) {
    const text =
      book.mode === "favorite"
        ? `${nft.name}: дивлюсь ${book.pretty}. Grok поставить, лише якщо впевнений.`
        : `${nft.name}: якір ${book.pretty}. Далі вікно ${s.windowMin} хв. Grok ставить лише коли впевнений.`;
    return {
      nft,
      log: { id: uid(), at: args.now, kind: "prediction", text },
      line: `RIG · ${book.pretty}`,
      clockMin: 0,
      anchorPx: book.px,
      anchorLabel: book.label,
      chain: null,
      counted: false,
      brain: "RIG",
      fill: null,
      fillPatch: null,
    };
  }
  const moveBps = ((book.px - args.anchorPx) / args.anchorPx) * 10_000;
  if (args.decider === "wait") {
    return hold("Grok читає ринок…", { clockMin: args.clockMin });
  }
  if (args.decider === "capped") {
    return hold("Grok більше не ставить у цій сесії. Без його рішення ставки немає.", { clockMin: args.clockMin });
  }
  if (args.decider === "grok") {
    const markets =
      s.focus === "events"
        ? eventSlate(args.quote.polymarkets)
        : args.quote.polymarkets.filter(
            (m) => m.focus === "btc" && m.windowMin != null && (s.windows ?? []).includes(m.windowMin),
          );
    if (!markets.length) return hold("Немає ринку, який варто показувати Grok", { clockMin: 0 });
    const ask: BrainAsk = {
      focus: s.focus === "events" ? "events" : "btc",
      name: nft.name,
      risk: nft.brief?.risk ?? "balanced",
      goal: (nft.brief?.goal ?? "").slice(0, 180),
      edgeBps: s.edgeBps,
      maxStakeSol: s.maxStakeSol,
      anchorYes: args.anchorPx,
      moveBps: Number(moveBps.toFixed(1)),
      anchorLabel: book.label,
      markets: markets.slice(0, 6).map(toBrainMarket),
    };
    return {
      nft,
      log: null,
      line: "Grok читає ринок…",
      clockMin: args.clockMin,
      anchorPx: args.anchorPx,
      anchorLabel: book.label,
      chain: null,
      counted: false,
      brain: "Grok",
      fill: null,
      fillPatch: null,
      ask,
    };
  }
  if (args.decider !== "rule") {
    return hold("Без рішення Grok ставку не відкриваю", { clockMin: 0 });
  }
  return predictionStep(nft, args.now, book, moveBps, free);
}

function bookForKey(key: string, quote: Quote): Book | null {
  const id = key.replace(/^poly:/, "");
  const m = quote.polymarkets.find((row) => row.id === id);
  if (!m) return null;
  return quoteToBook(m, m.focus === "btc" ? "edge" : "favorite");
}

function quoteToBook(m: PolyMarketQuote, mode: "edge" | "favorite"): Book {
  if (mode === "favorite") {
    const name = m.yes >= 0.5 ? m.yesLabel : m.noLabel;
    return {
      px: m.yes,
      label: `poly:${m.id}`,
      pretty: `Події «${m.question}» · ${name} ${(favoriteChance(m) * 100).toFixed(0)}%`,
      via: "gamma",
      mode,
    };
  }
  const span = m.windowMin === 240 ? "4 год" : `${m.windowMin ?? "?"} хв`;
  return {
    px: m.yes,
    label: `poly:${m.id}`,
    pretty: `Біткоїн ${span} · ${m.yesLabel} ${(m.yes * 100).toFixed(1)}%`,
    via: "gamma",
    mode,
  };
}

function polyBook(s: PredictionStrategy, quote: Quote): Book | null {
  if (s.focus === "events") {
    const m = eventSlate(quote.polymarkets)[0] ?? null;
    return m ? quoteToBook(m, "favorite") : null;
  }
  const m = pickBtcWindow(s, quote.polymarkets);
  return m ? quoteToBook(m, "edge") : null;
}

function noteOpen(nft: AgentNft, now: number): AgentNft {
  return {
    ...nft,
    updatedAt: now,
    metrics: {
      ...nft.metrics,
      xp: nft.metrics.xp + 1,
      jobs: nft.metrics.jobs + 1,
      lastJobAt: now,
    },
  };
}

function noteSettle(nft: AgentNft, now: number, win: boolean, pnl: number): AgentNft {
  return {
    ...nft,
    updatedAt: now,
    openBook: null,
    metrics: {
      ...nft.metrics,
      xp: nft.metrics.xp + (win ? 8 : 2),
      wins: nft.metrics.wins + (win ? 1 : 0),
      losses: nft.metrics.losses + (win ? 0 : 1),
      pnlSol: Number((nft.metrics.pnlSol + pnl).toFixed(5)),
      lastJobAt: now,
    },
  };
}

export function commitBrain(args: {
  nft: AgentNft;
  now: number;
  quote: Quote;
  marketId: string;
  action: "yes" | "no" | "skip";
  confidence: number;
  why: string;
  free: number;
}): StepResult {
  const why = args.why.replace(/\s+/g, " ").trim().slice(0, 180);
  const market = args.quote.polymarkets.find((m) => m.id === args.marketId) ?? null;
  const book = market ? quoteToBook(market, market.focus === "btc" ? "edge" : "favorite") : null;
  const reset = (line: string): StepResult => ({
    nft: args.nft,
    log: { id: uid(), at: args.now, kind: "prediction", text: line },
    line,
    clockMin: 0,
    anchorPx: book?.px ?? null,
    anchorLabel: book?.label ?? null,
    chain: null,
    counted: false,
    brain: "Grok",
    fill: null,
    fillPatch: null,
  });
  if (!book || args.action === "skip") {
    return reset(why || "Grok: ставку не відкриваю");
  }
  const confidence = Math.min(1, Math.max(0, args.confidence));
  if (confidence < 0.65) {
    return reset(why || `Grok не впевнений (${Math.round(confidence * 100)}%). Ставку не відкриваю.`);
  }
  const stake = dynamicSize(
    args.nft.strategy.prediction.maxStakeSol,
    confidence,
    args.nft.brief?.risk ?? "balanced",
    args.free,
  );
  if (stake < 0.005) return reset(why || "Grok бачить сторону, але вільних SOL замало");
  const side = args.action;
  const fillId = uid();
  const pretty = book.pretty.slice(0, 180);
  const open: OpenBook = {
    fillId,
    market: pretty,
    side,
    stake,
    entryPx: book.px,
    openedAt: args.now,
    bookKey: book.label,
  };
  const fill: AgentFill = {
    id: fillId,
    at: args.now,
    asset: args.nft.asset,
    kind: "prediction",
    market: pretty,
    side,
    amount: stake,
    pnl: 0,
    status: "open",
  };
  const line = `Grok · ${why || side} · ставка ${stake}`;
  return {
    nft: noteOpen({ ...args.nft, openBook: open }, args.now),
    log: { id: uid(), at: args.now, kind: "prediction", text: line },
    line,
    clockMin: 0,
    anchorPx: book.px,
    anchorLabel: book.label,
    chain: {
      kind: "prediction",
      phase: "lock",
      stake,
      pnl: 0,
      win: false,
      memo: `Grok lock ${side} ${stake}`,
      fillId,
      asset: args.nft.asset,
    },
    counted: true,
    brain: "Grok",
    fill,
    fillPatch: null,
  };
}

function predictionStep(nft: AgentNft, now: number, book: Book, moveBps: number, free: number): StepResult {
  const decided = rigDecide({
    name: nft.name,
    tag: "LIVE",
    strategy: nft.strategy.prediction,
    pretty: book.pretty,
    moveBps,
    risk: nft.brief?.risk ?? "balanced",
    free,
    mode: book.mode,
    yesPx: book.px,
  });
  const base = {
    clockMin: 0,
    anchorPx: book.px,
    anchorLabel: book.label,
    brain: "RIG" as const,
  };
  if (decided.action === "skip" || decided.stake < 0.005) {
    return {
      nft,
      log: { id: uid(), at: now, kind: "prediction", text: decided.line },
      line: decided.line,
      ...base,
      chain: null,
      counted: false,
      fill: null,
      fillPatch: null,
    };
  }
  const side = decided.action;
  if (side !== "yes" && side !== "no" && side !== "long" && side !== "short") {
    return {
      nft,
      log: { id: uid(), at: now, kind: "prediction", text: decided.line },
      line: decided.line,
      ...base,
      chain: null,
      counted: false,
      fill: null,
      fillPatch: null,
    };
  }
  const fillId = uid();
  const market = book.pretty.slice(0, 180);
  const open: OpenBook = {
    fillId,
    market,
    side,
    stake: decided.stake,
    entryPx: book.px,
    openedAt: now,
    bookKey: book.label,
  };
  const fill: AgentFill = {
    id: fillId,
    at: now,
    asset: nft.asset,
    kind: "prediction",
    market,
    side,
    amount: decided.stake,
    pnl: 0,
    status: "open",
  };
  return {
    nft: noteOpen({ ...nft, openBook: open }, now),
    log: { id: uid(), at: now, kind: "prediction", text: decided.line },
    line: decided.line,
    ...base,
    chain: {
      kind: "prediction",
      phase: "lock",
      stake: decided.stake,
      pnl: 0,
      win: false,
      memo: `RIG lock ${side} ${decided.stake}`,
      fillId,
      asset: nft.asset,
    },
    counted: true,
    fill,
    fillPatch: null,
  };
}

function settlePrediction(nft: AgentNft, now: number, book: Book): StepResult {
  const ob = nft.openBook;
  if (!ob) {
    return {
      nft,
      log: null,
      line: "Немає відкритої ставки",
      clockMin: 0,
      anchorPx: book.px,
      anchorLabel: book.label,
      chain: null,
      counted: false,
      brain: "RIG",
      fill: null,
      fillPatch: null,
    };
  }
  const entry = ob.entryPx > 0 ? ob.entryPx : book.px;
  const move = entry > 0 ? ((book.px - entry) / entry) * 10_000 : 0;
  let pnl = Number((ob.stake * (move / 10_000)).toFixed(5));
  if (ob.side === "no" || ob.side === "short") pnl = Number((-pnl).toFixed(5));
  const win = pnl >= 0;
  const line = `RIG · ${nft.name}: закрив «${ob.market}». PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)}`;
  return {
    nft: noteSettle(nft, now, win, pnl),
    log: { id: uid(), at: now, kind: "prediction", text: line },
    line,
    clockMin: 0,
    anchorPx: book.px,
    anchorLabel: book.label,
    chain: {
      kind: "prediction",
      phase: "settle",
      stake: ob.stake,
      pnl,
      win,
      memo: `RIG settle ${win ? "win" : "loss"} ${pnl}`,
      fillId: ob.fillId,
      asset: nft.asset,
    },
    counted: true,
    brain: "RIG",
    fill: null,
    fillPatch: { id: ob.fillId, pnl, status: "settled" },
  };
}

export function emptyRuntimeLine(kind: AgentKind): string {
  if (kind === "prediction") return "Prediction чекає NFT класу 1 або комбо";
  return "Titan × Backpack чекає NFT класу 2";
}
