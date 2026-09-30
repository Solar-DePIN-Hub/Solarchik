import type { PredictionStrategy, RiskMode } from "./types";
import { dynamicSize, edgeScale } from "./classes";

/**
 * Prediction agent.
 * RIG (0xPlaygrounds) is a Rust agent runtime: preamble, tools, then a commit.
 * This module is that same loop in the browser so a decision still lands when
 * the page is the only process. Tools run in order. The commit is what gets
 * settled on Solana afterwards.
 */
export type RigAction = "skip" | "yes" | "no" | "long" | "short";

export type RigDecision = {
  action: RigAction;
  stake: number;
  pnl: number;
  win: boolean | null;
  line: string;
  brain: "RIG";
  trace: string[];
};

type ToolResult = { name: string; out: string };

function tool(trace: ToolResult[], name: string, out: string): string {
  trace.push({ name, out });
  return out;
}

export function rigDecide(args: {
  name: string;
  tag: "PAPER" | "LIVE";
  strategy: PredictionStrategy;
  pretty: string;
  moveBps: number;
  risk: RiskMode;
  free: number;
  mode?: "edge" | "favorite";
  yesPx?: number;
}): RigDecision {
  const trace: ToolResult[] = [];
  const venue = "Polymarket";
  tool(trace, "read_book", `${venue} ${args.pretty}`);

  if (args.mode === "favorite") {
    const yes = args.yesPx ?? 0.5;
    const fav = Math.max(yes, 1 - yes);
    const action: RigAction = yes >= 0.5 ? "yes" : "no";
    tool(trace, "pick_favorite", `${action} ${(fav * 100).toFixed(0)}%`);
    if (fav < 0.62) {
      tool(trace, "commit", "skip weak");
      return {
        action: "skip",
        stake: 0,
        pnl: 0,
        win: null,
        brain: "RIG",
        trace: trace.map((t) => t.name),
        line: `RIG · ${args.name}: ${args.pretty}. Фаворит слабший за 62% — не ставлю`,
      };
    }
    const stake = dynamicSize(args.strategy.maxStakeSol, fav, args.risk, args.free);
    if (stake < 0.005) {
      tool(trace, "commit", "skip funds");
      return {
        action: "skip",
        stake: 0,
        pnl: 0,
        win: null,
        brain: "RIG",
        trace: trace.map((t) => t.name),
        line: `RIG · ${args.name}: фаворит є, вільних коштів замало — ставку не відкриваю`,
      };
    }
    tool(trace, "commit", `${action} stake ${stake} fav ${fav.toFixed(2)}`);
    return {
      action,
      stake,
      pnl: 0,
      win: null,
      brain: "RIG",
      trace: trace.map((t) => t.name),
      line: `RIG · ${args.name} [події] ${args.pretty}. Ставлю ${action}, ${stake} SOL`,
    };
  }

  const edge = args.strategy.edgeBps * edgeScale(args.risk);
  const move = args.moveBps;
  const hit = Math.abs(move) >= edge;
  tool(trace, "measure_edge", `${move.toFixed(1)} bps vs край ${edge.toFixed(1)} · ризик ${args.risk}`);

  if (!hit) {
    tool(trace, "commit", "skip stake 0");
    return {
      action: "skip",
      stake: 0,
      pnl: 0,
      win: null,
      brain: "RIG",
      trace: trace.map((t) => t.name),
      line: `RIG · ${args.name} [${args.tag}] ${venue}: ${args.pretty}. ${move.toFixed(1)} bps < край ${edge.toFixed(1)} — пропуск, ончейн 0`,
    };
  }

  const action: RigAction =
    args.strategy.venue === "polymarket" ? (move >= 0 ? "yes" : "no") : move >= 0 ? "long" : "short";
  const confidence = Math.min(1, Math.abs(move) / Math.max(edge, 1));
  const stake = dynamicSize(args.strategy.maxStakeSol, confidence, args.risk, args.free);
  if (stake < 0.005) {
    tool(trace, "commit", "skip funds");
    return {
      action: "skip",
      stake: 0,
      pnl: 0,
      win: null,
      brain: "RIG",
      trace: trace.map((t) => t.name),
      line: `RIG · ${args.name} [${args.tag}]: край пробито, але вільних коштів замало — ставку не відкриваю`,
    };
  }
  const pnl = Number((stake * (move / 10_000)).toFixed(5));
  const win = pnl >= 0;
  tool(trace, "commit", `${action} stake ${stake} conf ${confidence.toFixed(2)}`);
  return {
    action,
    stake,
    pnl,
    win,
    brain: "RIG",
    trace: trace.map((t) => t.name),
    line: `RIG · ${args.name} [${args.tag}] ${venue}: ${args.pretty}. хід ${move.toFixed(1)} bps → ${action}, ставка ${stake} (впевненість ${(confidence * 100).toFixed(0)}%)`,
  };
}
