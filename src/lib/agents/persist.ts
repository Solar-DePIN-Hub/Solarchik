import { SAVE_VERSION, type AgentFill, type AgentNft, type LogEntry, type MarketListing, type PredLane } from "./types";
import { TRAIN_GOAL_DAYS, WORK_GOAL_SEC, clampStrategy, defaultStrategy } from "./classes";

const STATE_KEY = "solarchik.agent-state.v1";
const BACKUP_KEY = "solarchik.agent-state.bak";

export type LaneNote = {
  at: number;
  lane: PredLane;
  market: string;
  action: string;
  pct: number | null;
  why: string;
  orderId: string | null;
  status: string | null;
};

export type LastGrok = {
  action: "yes" | "no" | "skip" | "sell" | "hold";
  confidence: number;
  why: string;
  ms: number;
  lane: "crypto" | "events" | "weather";
  question: string | null;
  priceToBeat: number | null;
  currentRef: number | null;
  delta: number | null;
  secondsLeft: number | null;
  windowLabel: string | null;
  twapLine: string | null;
  entryAsk: number | null;
};

export type PolyHold = {
  orderId: string;
  tokenId: string;
  side: "BUY";
  price: string;
  spend: string;
  shares: string;
  lane?: "crypto" | "events" | "weather";
};

export type PersistedState = {
  version: number;
  sol: number;
  paperSol: number;
  nfts: AgentNft[];
  listings: MarketListing[];
  log: LogEntry[];
  fills: AgentFill[];
  lastLiveSig: string | null;
  lastLiveSigCounted: boolean;
  lastLiveAmount: number;
  lastLiveAt: number;
  liveDayKey: string;
  liveDaySpent: number;
  liveSessionSpent: number;
  liveLossStreak: number;
  polyDayKey: string;
  polyDaySpent: number;
  polyOpenId: string | null;
  polyHold: PolyHold | null;
  polyBooks: PolyHold[];
  lastGrok: LastGrok | null;
  /** Last decision per lane. No PnL. */
  laneNotes: LaneNote[];
  /** Last events/weather Grok reply. Next review of those lanes waits an hour. */
  lastEventsGrokAt: number;
  liveArmed: boolean;
  liveAck: boolean;
  autoRun: boolean;
};

export const START_SOL = 0;

const defaults = (): PersistedState => ({
  version: SAVE_VERSION,
  sol: START_SOL,
  paperSol: 0,
  nfts: [],
  listings: [],
  log: [],
  fills: [],
  lastLiveSig: null,
  lastLiveSigCounted: false,
  lastLiveAmount: 0,
  lastLiveAt: 0,
  liveDayKey: "",
  liveDaySpent: 0,
  liveSessionSpent: 0,
  liveLossStreak: 0,
  polyDayKey: "",
  polyDaySpent: 0,
  polyOpenId: null,
  polyHold: null,
  polyBooks: [],
  lastGrok: null,
  laneNotes: [],
  lastEventsGrokAt: 0,
  liveArmed: false,
  liveAck: false,
  autoRun: false,
});

function migrateNft(n: AgentNft, version: number): AgentNft | null {
  const rawClass = n.classId as number;
  if (version < 6 && rawClass === 3) return null;
  const classId = (version < 6 && rawClass === 4 ? 3 : rawClass) as AgentNft["classId"];
  if (classId !== 1 && classId !== 2 && classId !== 3) return null;
  const base = defaultStrategy();
  const raw = n.strategy;
  const pred = { ...base.prediction, ...(raw?.prediction ?? {}) };
  if (classId === 3 && !(pred.lanes && pred.lanes.length)) {
    pred.lanes = ["crypto", "events", "weather"];
    pred.laneOn = { crypto: true, events: true, weather: true };
  }
  const strategy = clampStrategy({
    prediction: pred,
    dex: { ...base.dex, ...(raw?.dex ?? {}) },
  });
  const rawMetrics = n.metrics;
  const workedSec = typeof rawMetrics?.workedSec === "number" && Number.isFinite(rawMetrics.workedSec) && rawMetrics.workedSec > 0 ? Math.floor(rawMetrics.workedSec) : 0;
  const aprPct = typeof rawMetrics?.aprPct === "number" && Number.isFinite(rawMetrics.aprPct) ? rawMetrics.aprPct : null;
  return {
    ...n,
    classId,
    track: "live",
    trainedDays: typeof n.trainedDays === "number" ? n.trainedDays : TRAIN_GOAL_DAYS,
    graduated: workedSec >= WORK_GOAL_SEC,
    strategy,
    metrics: {
      xp: rawMetrics?.xp ?? 0,
      jobs: rawMetrics?.jobs ?? 0,
      wins: rawMetrics?.wins ?? 0,
      losses: rawMetrics?.losses ?? 0,
      pnlSol: rawMetrics?.pnlSol ?? 0,
      lastJobAt: rawMetrics?.lastJobAt ?? null,
      workedSec,
      aprPct,
    },
  };
}

function readLastGrok(raw: unknown): LastGrok | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (g.action !== "yes" && g.action !== "no" && g.action !== "skip" && g.action !== "sell" && g.action !== "hold") return null;
  if (typeof g.confidence !== "number" || !Number.isFinite(g.confidence)) return null;
  if (typeof g.why !== "string") return null;
  if (typeof g.ms !== "number" || !Number.isFinite(g.ms) || g.ms < 0) return null;
  if (g.lane !== "crypto" && g.lane !== "events" && g.lane !== "weather") return null;
  const question = typeof g.question === "string" && g.question.trim() ? g.question.replace(/\s+/g, " ").trim().slice(0, 180) : null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    action: g.action,
    confidence: Math.min(1, Math.max(0, g.confidence)),
    why: g.why.replace(/\s+/g, " ").trim().slice(0, 180),
    ms: g.ms,
    lane: g.lane,
    question,
    priceToBeat: num(g.priceToBeat),
    currentRef: num(g.currentRef),
    delta: num(g.delta),
    secondsLeft: num(g.secondsLeft),
    windowLabel: typeof g.windowLabel === "string" ? g.windowLabel.replace(/\s+/g, "").slice(0, 8) : null,
    twapLine: typeof g.twapLine === "string" ? g.twapLine.replace(/\s+/g, " ").trim().slice(0, 160) : null,
    entryAsk: num(g.entryAsk),
  };
}

function readHold(raw: unknown): PolyHold | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  const numish = (v: unknown) => typeof v === "string" && /^\d+(\.\d+)?$/.test(v) && Number(v) > 0;
  if (typeof h.orderId !== "string" || !h.orderId) return null;
  if (typeof h.tokenId !== "string" || !/^\d{6,}$/.test(h.tokenId)) return null;
  if (h.side !== "BUY") return null;
  if (typeof h.price !== "string" || typeof h.spend !== "string" || typeof h.shares !== "string") return null;
  if (!numish(h.price) || !numish(h.spend) || !numish(h.shares)) return null;
  return {
    orderId: h.orderId,
    tokenId: h.tokenId,
    side: "BUY",
    price: h.price,
    spend: h.spend,
    shares: h.shares,
    ...(h.lane === "crypto" || h.lane === "events" || h.lane === "weather" ? { lane: h.lane } : {}),
  };
}

function readLaneNotes(raw: unknown): LaneNote[] {
  if (!Array.isArray(raw)) return [];
  const out: LaneNote[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const n = row as Record<string, unknown>;
    if (n.lane !== "crypto" && n.lane !== "events" && n.lane !== "weather") continue;
    if (typeof n.at !== "number" || !Number.isFinite(n.at)) continue;
    if (typeof n.why !== "string") continue;
    const pct = typeof n.pct === "number" && Number.isFinite(n.pct) ? Math.min(1, Math.max(0, n.pct)) : null;
    out.push({
      at: n.at,
      lane: n.lane,
      market: typeof n.market === "string" ? n.market.replace(/\s+/g, " ").trim().slice(0, 120) : n.lane,
      action: typeof n.action === "string" ? n.action.slice(0, 16) : "skip",
      pct,
      why: n.why.replace(/\s+/g, " ").trim().slice(0, 180),
      orderId: typeof n.orderId === "string" && n.orderId ? n.orderId.slice(0, 80) : null,
      status: typeof n.status === "string" && n.status ? n.status.slice(0, 32) : null,
    });
    if (out.length >= 48) break;
  }
  return out;
}

function readBooks(raw: unknown): PolyHold[] {
  if (!Array.isArray(raw)) return [];
  const out: PolyHold[] = [];
  for (const row of raw) {
    const hold = readHold(row);
    if (!hold || (hold.lane !== "events" && hold.lane !== "weather")) continue;
    if (out.some((x) => x.orderId === hold.orderId || x.tokenId === hold.tokenId)) continue;
    out.push(hold);
    if (out.length >= 40) break;
  }
  return out;
}

function migrate(raw: PersistedState): PersistedState {
  const base = defaults();
  const s = { ...raw };
  const version = typeof s.version === "number" ? s.version : 1;
  const sol = typeof s.sol === "number" ? s.sol : base.sol;
  if (version < 5) {
    return {
      version: SAVE_VERSION,
      sol: 0,
      paperSol: 0,
      nfts: [],
      listings: [],
      log: [],
      fills: [],
      lastLiveSig: null,
      lastLiveSigCounted: false,
      lastLiveAmount: 0,
      lastLiveAt: 0,
      liveDayKey: "",
      liveDaySpent: 0,
      liveSessionSpent: 0,
      liveLossStreak: 0,
      polyDayKey: "",
      polyDaySpent: 0,
      polyOpenId: null,
      polyHold: null,
      polyBooks: [],
      lastGrok: null,
      laneNotes: [],
      lastEventsGrokAt: 0,
      liveArmed: false,
      liveAck: false,
      autoRun: false,
    };
  }
  const paperSol = 0;
  const nfts = Array.isArray(s.nfts)
    ? s.nfts.map((n) => migrateNft(n, version)).filter((n): n is AgentNft => n != null)
    : base.nfts;
  const listings =
    Array.isArray(s.listings) && s.listings.length
      ? s.listings
          .map((l) => {
            const nft = migrateNft(l.nft, version);
            return nft ? { ...l, nft } : null;
          })
          .filter((l): l is MarketListing => l != null)
      : base.listings;
  const log = Array.isArray(s.log)
    ? s.log
        .slice(-80)
        .map((e) =>
          (e.kind as string) === "social" ? { ...e, kind: "system" as const } : e,
        )
    : [];
  const fills = Array.isArray(s.fills)
    ? s.fills
        .filter(
          (f): f is AgentFill =>
            !!f &&
            typeof f.id === "string" &&
            typeof f.asset === "string" &&
            (f.kind === "prediction" || f.kind === "dex") &&
            (f.status === "open" || f.status === "settled" || f.status === "withdrawn"),
        )
        .slice(-160)
    : [];
  const rawSig = (s as { lastLiveSig?: unknown }).lastLiveSig;
  const lastLiveSig = typeof rawSig === "string" && rawSig.length > 0 ? rawSig : null;
  const rawCounted = (s as { lastLiveSigCounted?: unknown }).lastLiveSigCounted;
  const rawAmount = (s as { lastLiveAmount?: unknown }).lastLiveAmount;
  const lastLiveAmount = typeof rawAmount === "number" && Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0;
  const rawAt = (s as { lastLiveAt?: unknown }).lastLiveAt;
  const lastLiveAt = typeof rawAt === "number" && Number.isFinite(rawAt) && rawAt > 0 ? rawAt : 0;
  const bag = s as {
    liveDayKey?: unknown;
    liveDaySpent?: unknown;
    liveSessionSpent?: unknown;
    liveLossStreak?: unknown;
    polyDayKey?: unknown;
    polyDaySpent?: unknown;
    polyOpenId?: unknown;
    polyHold?: unknown;
    polyBooks?: unknown;
  };
  const today = new Date().toISOString().slice(0, 10);
  const storedDay = typeof bag.liveDayKey === "string" ? bag.liveDayKey : "";
  const sameDay = storedDay === today;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  let polyHold = readHold(bag.polyHold);
  let polyOpenId = typeof bag.polyOpenId === "string" && bag.polyOpenId ? bag.polyOpenId : null;
  let polyBooks = readBooks(bag.polyBooks);
  if (polyHold && (polyHold.lane === "events" || polyHold.lane === "weather")) {
    polyBooks = [polyHold, ...polyBooks.filter((b) => b.orderId !== polyHold!.orderId)].slice(0, 40);
    if (polyOpenId === polyHold.orderId) polyOpenId = null;
    polyHold = null;
  }
  return {
    version: SAVE_VERSION,
    sol,
    paperSol,
    nfts,
    listings,
    log,
    fills,
    lastLiveSig,
    lastLiveSigCounted: rawCounted === true,
    lastLiveAmount,
    lastLiveAt,
    liveDayKey: sameDay ? storedDay : today,
    liveDaySpent: sameDay ? num(bag.liveDaySpent) : 0,
    liveSessionSpent: sameDay ? num(bag.liveSessionSpent) : 0,
    liveLossStreak: Math.floor(num(bag.liveLossStreak)),
    polyDayKey: typeof bag.polyDayKey === "string" ? bag.polyDayKey : "",
    polyDaySpent: typeof bag.polyDayKey === "string" && bag.polyDayKey === today ? num(bag.polyDaySpent) : 0,
    polyOpenId,
    polyHold,
    polyBooks,
    lastGrok: readLastGrok((s as { lastGrok?: unknown }).lastGrok),
    laneNotes: readLaneNotes((s as { laneNotes?: unknown }).laneNotes),
    lastEventsGrokAt: num((s as { lastEventsGrokAt?: unknown }).lastEventsGrokAt),
    liveArmed: (s as { liveArmed?: unknown }).liveArmed === true,
    liveAck: (s as { liveAck?: unknown }).liveAck === true && (s as { liveArmed?: unknown }).liveArmed === true,
    autoRun: (s as { autoRun?: unknown }).autoRun === true,
  };
}

export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return defaults();
    return migrate(JSON.parse(raw) as PersistedState);
  } catch {
    try {
      const bak = localStorage.getItem(BACKUP_KEY);
      if (bak) return migrate(JSON.parse(bak) as PersistedState);
    } catch {
      /* fall through */
    }
    return defaults();
  }
}

export function saveState(state: PersistedState): void {
  try {
    const prev = localStorage.getItem(STATE_KEY);
    if (prev) localStorage.setItem(BACKUP_KEY, prev);
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...state, version: SAVE_VERSION }));
  } catch {
    /* private mode */
  }
}
