import type { AgentKind, NftMetrics, StrategyBundle, Track } from "./types";

export type ShiftInput = {
  kind: AgentKind;
  track: Track;
  nftName: string;
  strategy: StrategyBundle;
  metrics: Pick<NftMetrics, "xp" | "jobs" | "wins" | "losses" | "pnlSol">;
};

export type ShiftOk = {
  ok: true;
  provider: string;
  model: string;
  line: string;
  win: boolean;
  edgeBps?: number;
  windowMin?: number;
  slippageBps?: number;
  dcaAmountSol?: number;
  cadenceMin?: number;
  tone?: "calm" | "hype" | "research";
  draft?: string;
};

export type ShiftResult = ShiftOk | { ok: false; error: string };
