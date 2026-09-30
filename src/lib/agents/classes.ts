import type { AgentNft, AgentKind, NftClassId, PredLane, PredictionFocus, PredictionStrategy, RiskMode, StrategyBundle, Track } from "./types";

export const TRAIN_GOAL_DAYS = 90;
/** One Work tick (~1s) advances the strategy clock by this many minutes. */
export const STRATEGY_MINUTES_PER_TICK = 1;

export const CLASS_META: Record<
  NftClassId,
  {
    id: NftClassId;
    title: string;
    short: string;
    kind: AgentKind | "combo";
    blurb: string;
  }
> = {
  1: {
    id: 1,
    title: "Prediction Agent",
    short: "Прогнози",
    kind: "prediction",
    blurb: "RIG. Біткоїн — вікна Up/Down з Polymarket. Події — сам шукає фаворита.",
  },
  2: {
    id: 2,
    title: "Titan × Backpack",
    short: "Арбітраж",
    kind: "dex",
    blurb: "Усі Solana-пари Backpack проти USDC. Стріляє лише коли є край і каса.",
  },
  3: {
    id: 3,
    title: "Combo Agent",
    short: "Комбо",
    kind: "combo",
    blurb: "Один NFT: крипто 15 хв, події і погода. DEX тут немає.",
  },
};

export function kindsForClass(classId: NftClassId): AgentKind[] {
  if (classId === 2) return ["dex"];
  return ["prediction"];
}

export function classForKind(kind: AgentKind): NftClassId {
  return kind === "prediction" ? 1 : 2;
}

export const BTC_WINDOWS: { min: 5 | 15 | 60 | 240; label: string }[] = [
  { min: 5, label: "5 хв" },
  { min: 15, label: "15 хв" },
  { min: 60, label: "1 год" },
  { min: 240, label: "4 год" },
];

const BTC_WINDOW_SET = new Set<number>(BTC_WINDOWS.map((w) => w.min));

export function clampWindows(raw: number[] | undefined): number[] {
  const picked = [...new Set((raw ?? []).filter((n) => BTC_WINDOW_SET.has(n)))].sort((a, b) => a - b);
  return picked.length ? picked : [15];
}

const LANE_SET = new Set<PredLane>(["crypto", "events", "weather"]);

export function lanesForStrategy(p: PredictionStrategy, classId?: NftClassId): PredLane[] {
  const raw = (p.lanes ?? []).filter((x): x is PredLane => LANE_SET.has(x));
  const uniq = [...new Set(raw)];
  if (uniq.length) return uniq;
  if (classId === 3) return ["crypto", "events", "weather"];
  if (p.focus === "events") return ["events"];
  if (p.focus === "weather") return ["weather"];
  return ["crypto"];
}

export function laneEnabledOn(p: PredictionStrategy, lane: PredLane, classId?: NftClassId): boolean {
  const lanes = lanesForStrategy(p, classId);
  if (!lanes.includes(lane)) return false;
  return p.laneOn?.[lane] !== false;
}

export function windowLabelOf(min: number): "5m" | "15m" | "1h" | "4h" | null {
  if (min === 5) return "5m";
  if (min === 15) return "15m";
  if (min === 60) return "1h";
  if (min === 240) return "4h";
  return null;
}

export function cryptoBand(p: { askLo?: number; askHi?: number }): { lo: number; hi: number } {
  let lo = Number(p.askLo);
  let hi = Number(p.askHi);
  if (!Number.isFinite(lo)) lo = 0.15;
  if (!Number.isFinite(hi)) hi = 0.85;
  lo = Math.min(0.49, Math.max(0.05, lo));
  hi = Math.min(0.95, Math.max(0.51, hi));
  if (!(lo < hi)) return { lo: 0.15, hi: 0.85 };
  return { lo: Number(lo.toFixed(2)), hi: Number(hi.toFixed(2)) };
}

export function eventsDaysOf(p: PredictionStrategy): 1 | 2 {
  return p.eventsDays === 1 ? 1 : 2;
}

function focusForLanes(lanes: PredLane[]): PredictionFocus {
  if (lanes.length === 1 && lanes[0] === "events") return "events";
  if (lanes.length === 1 && lanes[0] === "weather") return "weather";
  if (lanes.includes("crypto")) return "btc";
  if (lanes.includes("events")) return "events";
  return "weather";
}

export function defaultStrategy(): StrategyBundle {
  return {
    prediction: {
      venue: "polymarket",
      focus: "btc",
      market: "Bitcoin",
      windows: [15],
      windowMin: 15,
      askLo: 0.15,
      askHi: 0.85,
      edgeBps: 18,
      maxStakeSol: 0.02,
      lanes: ["crypto"],
      laneOn: { crypto: true },
      eventsDays: 2,
    },
    dex: {
      pair: "SOL/USDC",
      dcaIntervalSec: 900,
      dcaAmountSol: 0.005,
      slippageBps: 50,
      side: "both",
    },
  };
}

export function clampStrategy(s: StrategyBundle): StrategyBundle {
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  const lanes = lanesForStrategy(s.prediction);
  const laneOn: Partial<Record<PredLane, boolean>> = {};
  for (const lane of lanes) laneOn[lane] = s.prediction.laneOn?.[lane] !== false;
  const focus = focusForLanes(lanes);
  const eventsDays = eventsDaysOf(s.prediction);
  const windows = clampWindows(s.prediction.windows);
  const band = cryptoBand(s.prediction);
  return {
    prediction: {
      venue: "polymarket",
      focus,
      market: focus === "events" ? "події" : focus === "weather" ? "погода" : "Bitcoin",
      windows,
      windowMin: windows[0] ?? 15,
      askLo: band.lo,
      askHi: band.hi,
      edgeBps: Number(clamp(s.prediction.edgeBps, 8, 80).toFixed(1)),
      maxStakeSol: Number(clamp(s.prediction.maxStakeSol, 0.005, 0.02).toFixed(4)),
      lanes,
      laneOn,
      eventsDays,
      weexOn: s.prediction.weexOn === true,
    },
    dex: {
      pair: (s.dex.pair.trim() || "SOL/USDC").slice(0, 32),
      dcaIntervalSec: Math.round(clamp(s.dex.dcaIntervalSec, 60, 7200)),
      dcaAmountSol: Number(clamp(s.dex.dcaAmountSol, 0.005, 0.1).toFixed(4)),
      slippageBps: Math.round(clamp(s.dex.slippageBps, 10, 120)),
      side: s.dex.side === "buy" || s.dex.side === "sell" ? s.dex.side : "both",
    },
  };
}

export function riskMul(risk: RiskMode): number {
  if (risk === "calm") return 0.4;
  if (risk === "risky") return 1;
  return 0.7;
}

export function edgeScale(risk: RiskMode): number {
  if (risk === "calm") return 1.25;
  if (risk === "risky") return 0.8;
  return 1;
}

/** Share of free funds one entry may use. */
export function purseFrac(risk: RiskMode): number {
  if (risk === "calm") return 0.08;
  if (risk === "risky") return 0.22;
  return 0.12;
}

/** Size from confidence, the risk the agent accepted, and funds that are actually free. */
export function dynamicSize(max: number, confidence: number, risk: RiskMode, free: number): number {
  const c = Math.min(1, Math.max(0, confidence));
  const raw = max * (0.35 + 0.65 * c) * riskMul(risk);
  const cap = Math.max(0, free) * purseFrac(risk);
  const n = Math.min(raw, max, cap);
  return Number(Math.max(0, n).toFixed(4));
}

export function riskCopy(risk: RiskMode): { title: string; body: string } {
  if (risk === "risky") {
    return {
      title: "Ризиковий",
      body: "Динамічний розмір угоди від руху ринку, впевненості агента і вільних коштів. І розмір, і результат ринку визначають виграш і програш — хід різкіший.",
    };
  }
  if (risk === "calm") {
    return {
      title: "Спокійний",
      body: "Менші ставки, вищий край і вузький slippage. Агент частіше пропускає шум, ніж заходить у ринок.",
    };
  }
  return {
    title: "Зважений",
    body: "Розмір угоди залежить від руху ринку, впевненості агента і вільних коштів. Край і slippage лишаються помірними.",
  };
}

export const DEFAULT_BEHAVIOR =
  "Розмір угоди залежить від руху ринку, впевненості агента і вільних коштів.";

/** Live shift required before a secondary listing. Not calendar time since mint. */
export const WORK_GOAL_SEC = 480 * 3600;

export function workedSecOf(nft: Pick<AgentNft, "metrics">): number {
  const n = nft.metrics?.workedSec;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function workClockOn(nft: Pick<AgentNft, "classId" | "strategy">): boolean {
  if (nft.classId === 2) return false;
  return (["crypto", "events", "weather"] as const).some((lane) => laneEnabledOn(nft.strategy.prediction, lane, nft.classId));
}

export function workLabel(nft: Pick<AgentNft, "metrics">): string {
  const sec = workedSecOf(nft);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")} / 480 год`;
}

export function aprFromClosed(workedSec: number, rows: { pnl: number; amount: number }[]): number | null {
  if (workedSec < 3600 || rows.length === 0) return null;
  const pnl = rows.reduce((sum, row) => sum + (Number.isFinite(row.pnl) ? row.pnl : 0), 0);
  const cap = rows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? Math.abs(row.amount) : 0), 0);
  if (!(cap > 0)) return null;
  const pct = (pnl / cap) * (8760 / (workedSec / 3600)) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(Math.max(-9999, Math.min(9999, pct)) * 10) / 10;
}

export function aprLabel(nft: Pick<AgentNft, "metrics">): string {
  const v = nft.metrics?.aprPct;
  if (typeof v !== "number" || !Number.isFinite(v)) return "ще нема";
  return `${v.toLocaleString("uk-UA", { maximumFractionDigits: 1 })}%`;
}

export function quoteResaleSol(nft: AgentNft): number {
  const base = nft.classId === 3 ? 0.9 : nft.classId === 2 ? 0.4 : 0.32;
  const skill = nft.metrics.xp * 0.00035;
  const alpha = Math.max(nft.metrics.pnlSol, 0) * 0.55;
  return Math.round((base + skill + alpha) * 10000) / 10000;
}

export function winRate(nft: AgentNft): number {
  if (nft.metrics.jobs === 0) return 0;
  return nft.metrics.wins / nft.metrics.jobs;
}

export function canGraduate(): boolean {
  return false;
}

export function performanceGood(nft: AgentNft): boolean {
  return nft.metrics.pnlSol > 0 || winRate(nft) >= 0.5;
}

export function listEligible(nft: AgentNft): { ok: true } | { ok: false; reason: string } {
  const sec = workedSecOf(nft);
  if (sec < WORK_GOAL_SEC) {
    const h = Math.floor(sec / 3600);
    return { ok: false, reason: `Виставити можна після 480 год живої зміни. Зараз ${h} / 480.` };
  }
  return { ok: true };
}

export function patchTrack(
  nft: Omit<AgentNft, "track" | "trainedDays" | "graduated"> &
    Partial<Pick<AgentNft, "track" | "trainedDays" | "graduated">>,
  track: Track,
): AgentNft {
  const resolved = nft.track ?? track;
  return {
    ...nft,
    track: resolved,
    trainedDays: nft.trainedDays ?? (resolved === "live" ? TRAIN_GOAL_DAYS : 0),
    graduated: nft.graduated ?? resolved === "live",
  };
}
