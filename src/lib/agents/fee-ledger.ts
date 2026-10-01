import { FREE_FEE_RATE } from "./fees.config.ts";
import type { NftTier } from "./types";
import { windowsCover, type FeeWindow } from "../game/fee-windows.ts";

export type FeeReason = "pro" | "window" | "loss" | "paper" | "charged" | "unsent";

export type FeeRow = {
  id: string;
  agent: string;
  openedAt: number;
  closedAt: number;
  pnl: number;
  fee: number;
  charged: boolean;
  reason: FeeReason;
  sig: string;
  /** True once the server read the transfer on devnet and recorded it. */
  verified?: boolean;
  /** Why the server refused to verify (final). */
  note?: string;
};

export function feeCut(pnl: number): number {
  if (!(pnl > 0)) return 0;
  const lamports = Math.round(pnl * FREE_FEE_RATE * 1e9);
  if (lamports < 1) return 0;
  return lamports / 1e9;
}

/** Coverage for a trade: any activated fee window (active or spent) that contains openedAt. */
export function feeCovered(windows: readonly FeeWindow[], openedAt: number): boolean {
  return windowsCover(windows, openedAt);
}

/** Paper never sends. Pro and losses are zero. A window stores the waived amount. */
export function planFee(input: {
  id: string;
  agent: string;
  tier: NftTier | undefined;
  openedAt: number;
  closedAt: number;
  pnl: number;
  paper: boolean;
  covered: boolean;
}): FeeRow {
  const tier: NftTier = input.tier === "free" ? "free" : "pro";
  const row = {
    id: input.id,
    agent: input.agent,
    openedAt: input.openedAt,
    closedAt: input.closedAt,
    pnl: input.pnl,
    charged: false,
    sig: "",
  };
  const would = tier === "free" && input.pnl > 0 && !input.covered ? feeCut(input.pnl) : 0;
  if (input.paper) return { ...row, fee: would, reason: "paper" };
  if (!(input.pnl > 0)) return { ...row, fee: 0, reason: "loss" };
  if (tier !== "free") return { ...row, fee: 0, reason: "pro" };
  if (input.covered) return { ...row, fee: feeCut(input.pnl), reason: "window" };
  if (would <= 0) return { ...row, fee: 0, reason: "loss" };
  return { ...row, fee: would, reason: "unsent" };
}

export function readFeeRows(raw: unknown): FeeRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FeeRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) continue;
    const reason = o.reason;
    if (reason !== "pro" && reason !== "window" && reason !== "loss" && reason !== "paper" && reason !== "charged" && reason !== "unsent") continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    out.push({
      id: o.id.slice(0, 80),
      agent: typeof o.agent === "string" ? o.agent.slice(0, 64) : "",
      openedAt: num(o.openedAt),
      closedAt: num(o.closedAt),
      pnl: num(o.pnl),
      fee: Math.max(0, num(o.fee)),
      charged: o.charged === true && reason === "charged",
      reason,
      sig: typeof o.sig === "string" ? o.sig.slice(0, 100) : "",
      ...(o.verified === true ? { verified: true } : {}),
      ...(typeof o.note === "string" && o.note ? { note: o.note.slice(0, 120) } : {}),
    });
    if (out.length >= 200) break;
  }
  return out;
}
