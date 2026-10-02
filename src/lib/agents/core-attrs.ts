import { WORK_GOAL_SEC, workedSecOf } from "./classes.ts";
import type { AgentNft } from "./types";

/** On-chain Attributes for a Solarchik Core agent. Shared by the browser mint/update and the server co-signed mint. */
export function attrList(nft: Pick<AgentNft, "classId" | "track" | "trainedDays" | "graduated" | "strategy" | "metrics" | "tier">) {
  const p = nft.strategy.prediction;
  const d = nft.strategy.dex;
  const role = nft.classId === 3 ? "combo" : nft.classId === 2 ? "dex" : "pred";
  const lanes = p.lanes ?? [];
  const on = (lane: "crypto" | "events" | "weather") => (p.laneOn?.[lane] === false ? "" : lane === "crypto" ? "c" : lane === "events" ? "e" : "w");
  const lo = lanes.map((lane) => on(lane)).join("");
  const pf = p.focus === "events" ? "evt" : p.focus === "weather" ? "wx" : lanes.length > 1 ? "mix" : "btc";
  const rows: Array<[string, string]> = [
    ["class", String(nft.classId)],
    ["tr", nft.tier === "free" ? "free" : "pro"],
    ["role", role],
    ["track", nft.track],
    ["days", String(Math.round(nft.trainedDays))],
    ["grad", workedSecOf(nft) >= WORK_GOAL_SEC ? "1" : "0"],
    ["wh", String(Math.floor(workedSecOf(nft) / 3600))],
    ["ws", String(workedSecOf(nft) % 3600)],
    ["apr", nft.metrics.aprPct == null || !Number.isFinite(nft.metrics.aprPct) ? "" : String(nft.metrics.aprPct)],
    ["xp", String(Math.round(nft.metrics.xp))],
    ["jobs", String(Math.round(nft.metrics.jobs))],
    ["wins", String(Math.round(nft.metrics.wins))],
    ["losses", String(Math.round(nft.metrics.losses))],
    ["pnl", nft.metrics.pnlSol.toFixed(5)],
    ["pm", p.focus === "events" ? "події" : p.focus === "weather" ? "погода" : "Bitcoin"],
    ["pv", "poly"],
    ["pf", pf],
    ["ln", lanes.map((lane) => (lane === "crypto" ? "c" : lane === "events" ? "e" : "w")).join("")],
    ["lo", lo],
    ["ed", p.eventsDays === 1 ? "1" : "2"],
    ["wo", p.weexOn ? "1" : "0"],
    ["pwin", String((p.windows ?? [15])[0] ?? 15)],
    ["pw", (p.windows ?? [15]).join(".")],
    ["ab", `${p.askLo ?? 0.15}-${p.askHi ?? 0.85}`],
    ["pe", p.edgeBps.toFixed(1)],
    ["ps", String(p.maxStakeSol)],
    ["dp", d.pair],
    ["di", String(Math.round(d.dcaIntervalSec))],
    ["da", String(d.dcaAmountSol)],
    ["dsl", d.slippageBps.toFixed(0)],
    ["dd", d.side],
  ];
  return rows.map(([key, value]) => ({ key, value: value.slice(0, 32) }));
}
