/** Solarchik agent NFT module — Metaplex Core on the local Solana validator. */

export const SAVE_VERSION = 7 as const;
export const COLLECTION_NAME = "SolarchikAgents";
export const COLLECTION_SYMBOL = "SCLK";

/** 1 prediction, 2 dex, 3 combo (both agents). */
export type NftClassId = 1 | 2 | 3;

export type AgentKind = "prediction" | "dex";

export type AgentStatus = "idle" | "blocked" | "loading" | "working" | "stopped";

/** On-chain agent. Always live test SOL. */
export type Track = "live" | "paper";

export type PredictionVenue = "polymarket" | "whirlpool";

export type PredictionFocus = "btc" | "events" | "weather";

export type PredLane = "crypto" | "events" | "weather";

/** Seconds left in the current epoch-aligned Bitcoin 15m window. */
export function btc15SecondsLeft(nowMs = Date.now()): number {
  const nowSec = Math.floor(nowMs / 1000);
  return nowSec - (nowSec % 900) + 900 - nowSec;
}

/** Kept for older reads. Live crypto entry is not time-gated; the gate is ask 0.15–0.85. */
export const CRYPTO_ENTER_SEC = 600;

export function cryptoDeltaFloor(_secondsLeft: number): number {
  return 1;
}

export type PredictionStrategy = {
  /** polymarket = Gamma YES/NO. DEX pairs live on the dex leg, not here. */
  venue: PredictionVenue;
  market: string;
  windowMin: number;
  edgeBps: number;
  maxStakeSol: number;
  /** btc = Up/Down 15m. events = non-crypto scanner. weather = station high. */
  focus?: PredictionFocus;
  /** Polymarket BTC windows in minutes: 5, 15, 60, 240. */
  windows?: number[];
  /** Ask corridor for the crypto lane. Missing = 0.15–0.85. */
  askLo?: number;
  askHi?: number;
  /** Lanes this NFT may run. Combo lists all three. Missing = inferred from focus. */
  lanes?: PredLane[];
  /** Player switches. Missing key = on, if the lane is in `lanes`. */
  laneOn?: Partial<Record<PredLane, boolean>>;
  /** Events horizon. Only 1 or 2 days. */
  eventsDays?: 1 | 2;
  /** WEEX USDT-M BTC. Off unless the player turns it on. Not a Polymarket lane. */
  weexOn?: boolean;
};

export type DexStrategy = {
  pair: string;
  dcaIntervalSec: number;
  dcaAmountSol: number;
  slippageBps: number;
  side: "buy" | "sell" | "both";
};

export type StrategyBundle = {
  prediction: PredictionStrategy;
  dex: DexStrategy;
};

export type RiskMode = "calm" | "balanced" | "risky";

/** What the agent is currently following. Lives on the device, not in the 32-char Core attrs. */
export type AgentBrief = {
  risk: RiskMode;
  /** One sentence the desk shows as agent behavior. */
  behavior: string;
  /** Last instruction the person gave the agent. */
  goal: string;
};

/** Stake sitting in a market until the next window closes or the person pulls it. */
export type OpenBook = {
  fillId: string;
  market: string;
  side: "yes" | "no" | "long" | "short";
  stake: number;
  entryPx: number;
  openedAt: number;
  /** Gamma id this stake is locked to, so settle does not jump markets. */
  bookKey?: string;
};

export type AgentFill = {
  id: string;
  at: number;
  asset: string;
  kind: AgentKind;
  market: string;
  side: "yes" | "no" | "long" | "short" | "buy" | "sell";
  amount: number;
  pnl: number;
  status: "open" | "settled" | "withdrawn";
};

export type NftMetrics = {
  xp: number;
  jobs: number;
  wins: number;
  losses: number;
  pnlSol: number;
  lastJobAt: number | null;
  /** Wall-clock seconds the shift was actually running. Not time since mint. */
  workedSec: number;
  /** Annualized percent from settled trades. Null until there is a real sample. */
  aprPct: number | null;
};

export type NftTier = "pro" | "free";

export type AgentNft = {
  /** Metaplex Core asset address. */
  asset: string;
  collection: typeof COLLECTION_NAME;
  /** On-chain Core collection pubkey. */
  coreCollection?: string;
  classId: NftClassId;
  name: string;
  owner: string;
  mintedAt: number;
  updatedAt: number;
  track: Track;
  /** Missing on old mints. Treat as pro so they are not taxed. */
  tier?: NftTier;
  /** Simulated academy days. 90 = 3 months. */
  trainedDays: number;
  graduated: boolean;
  /** Attributes stored on the asset (Core attributes). */
  strategy: StrategyBundle;
  metrics: NftMetrics;
  brief?: AgentBrief;
  openBook?: OpenBook | null;
};

export type AgentRuntime = {
  kind: AgentKind;
  status: AgentStatus;
  sourceAsset: string | null;
  sourceClass: NftClassId | null;
  config: StrategyBundle[AgentKind] | null;
  lastLine: string;
  /** Which stack is driving this bay: RIG or Solana Agent Kit. */
  brain: string | null;
  /** Strategy-minutes elapsed toward the next job. */
  clockMin: number;
  /** Price locked at the start of the current window. */
  anchorPx: number | null;
  /** Which contract or pool the anchor belongs to. */
  anchorLabel: string | null;
  /** Wall clock when the current window started. */
  epochStartedAt: number | null;
};

export type LogEntry = {
  id: string;
  at: number;
  kind: AgentKind | "system";
  text: string;
};

export type MarketListing = {
  id: string;
  nft: AgentNft;
  priceSol: number;
  listedAt: number;
};

export type LiveSku = {
  id: string;
  priceSol: number;
  blurb: string;
  nft: AgentNft;
};

export type WalletRecord = {
  pubkey: string;
  createdAt: number;
};

export type WorkGate =
  | { ok: true; agents: AgentKind[]; assets: AgentNft[] }
  | { ok: false; reason: string };
