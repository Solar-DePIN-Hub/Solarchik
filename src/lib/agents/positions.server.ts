/**
 * Server functions behind the web prediction desk's fee accounting:
 * - open/close a position: the server takes entry/exit prices from its own
 *   Polymarket read and the time from its own clock, checks the NFT owner and
 *   tier on devnet, and stores PnL + owed fee in Postgres (agent_positions);
 * - clock-in: the server verifies the player's signed memo (message or memo tx)
 *   and stores the day (clock_days);
 * - fee-free window: the server replays verified days through fee-windows.ts
 *   rules and starts the next window at server time (fee_window_starts).
 * Every call carries a room-key proof (single use). No database: closed.
 */
import { arbStore } from "./arb-guard.server";
import type { GuardSql } from "./guard-ledger.server";
import type { WalletProof } from "./wallet-proof";
import { verifyEd25519, verifyProof } from "./wallet-proof.server";
import { checkClockTx, clockDayAllowed, clockExtra, clockMemoDay, closeExtra, openExtra, type PositionSide } from "./position-rules";
import type { CloseResult, FeeBalance, OpenResult, PositionDeps } from "./positions-ledger.server";
import type { ParsedTx } from "./payment-rules";

const GAMMA = "https://gamma-api.polymarket.com";

async function openSql(): Promise<GuardSql | null> {
  if (arbStore() === "none") return null;
  try {
    const { getSql } = await import("@/lib/db");
    return await getSql();
  } catch {
    return null;
  }
}

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

/** Yes/Up price of one Polymarket market, open or resolved (a resolved market reads 0 or 1). */
export async function polyYesPrice(book: string): Promise<number | null> {
  const id = book.replace(/^poly:/, "");
  if (!/^[\w-]{1,100}$/.test(id)) return null;
  const url = /^\d+$/.test(id) ? `${GAMMA}/markets/${id}` : `${GAMMA}/markets/slug/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "Solarchik/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const raw = (await res.json()) as Record<string, unknown>;
  const outcomes = asList(raw.outcomes);
  const prices = asList(raw.outcomePrices).map(Number);
  if (!outcomes.length || !prices.length) return null;
  let i = outcomes.findIndex((o) => o.toLowerCase() === "yes" || o.toLowerCase() === "up");
  if (i < 0) i = 0;
  const px = prices[i];
  return Number.isFinite(px) && px >= 0 && px <= 1 ? px : null;
}

async function coreAgent(asset: string): Promise<{ owner: string; free: boolean } | null> {
  const { fetchCoreAgent, isFreeTier } = await import("./core-owned.server");
  const agent = await fetchCoreAgent(asset);
  return agent ? { owner: agent.owner, free: isFreeTier(agent) } : null;
}

function deps(sql: GuardSql): PositionDeps {
  return { sql, now: Date.now(), price: polyYesPrice, agent: coreAgent };
}

async function guard(
  proof: WalletProof | null,
  action: "position" | "clock" | "fee-window",
  extra: string,
  spendKey: string,
): Promise<{ ok: true; sql: GuardSql; wallet: string } | { ok: false; reason: string; retry: boolean }> {
  if (!proof) return { ok: false, reason: "Немає підпису гаманця кімнати.", retry: false };
  const signed = verifyProof(proof, action, extra);
  if (!signed.ok) return { ok: false, reason: signed.reason, retry: false };
  const sql = await openSql();
  if (!sql) return { ok: false, reason: "Немає бази (DATABASE_URL): сервер не веде позиції.", retry: true };
  try {
    const { spendProofOnce } = await import("./guard-ledger.server");
    if (!(await spendProofOnce(sql, proof.wallet, spendKey, proof.ts, Date.now()))) return { ok: false, reason: "Цей підпис уже використано.", retry: false };
  } catch {
    return { ok: false, reason: "База не відповіла.", retry: true };
  }
  return { ok: true, sql, wallet: proof.wallet };
}

export async function openPositionOnServer(input: {
  proof: WalletProof | null;
  fillId: string;
  asset: string;
  book: string;
  side: PositionSide | null;
  stakeLamports: number;
}): Promise<OpenResult> {
  const { fillId, asset, book, side, stakeLamports } = input;
  if (!fillId || !asset || !book || !side) return { ok: false, reason: "Погані дані позиції.", retry: false };
  const g = await guard(input.proof, "position", openExtra({ fillId, asset, book, side, stakeLamports }), "position-open");
  if (!g.ok) return g;
  try {
    const { openPosition } = await import("./positions-ledger.server");
    return await openPosition(deps(g.sql), { wallet: g.wallet, fillId, asset, book, side, stakeLamports });
  } catch {
    return { ok: false, reason: "Сервер не відповів.", retry: true };
  }
}

export async function closePositionOnServer(input: { proof: WalletProof | null; fillId: string }): Promise<CloseResult> {
  if (!input.fillId) return { ok: false, reason: "Погані дані позиції.", retry: false };
  const g = await guard(input.proof, "position", closeExtra(input.fillId), "position-close");
  if (!g.ok) return g;
  try {
    const { closePosition } = await import("./positions-ledger.server");
    return await closePosition(deps(g.sql), { wallet: g.wallet, fillId: input.fillId });
  } catch {
    return { ok: false, reason: "Сервер не відповів.", retry: true };
  }
}

export type ClockResult = { ok: true; fresh: boolean } | { ok: false; reason: string; retry: boolean };

export async function recordClockOnServer(input: {
  proof: WalletProof | null;
  clockAddress: string;
  clockSig: string;
  kind: "tx" | "message";
  cluster: "mainnet" | "devnet";
  memo: string;
}): Promise<ClockResult> {
  const { clockAddress, clockSig, memo } = input;
  const day = clockMemoDay(memo);
  if (!day || clockAddress.length < 32 || clockSig.length < 64) return { ok: false, reason: "Погані дані відмітки.", retry: false };
  if (!clockDayAllowed(day, Date.now())) return { ok: false, reason: "Відмітка застара для сервера.", retry: false };
  if (!input.proof) return { ok: false, reason: "Немає підпису гаманця кімнати.", retry: false };
  const room = verifyProof(input.proof, "clock", clockExtra({ clockAddress, clockSig, memo }));
  if (!room.ok) return { ok: false, reason: room.reason, retry: false };
  if (input.kind === "message") {
    if (!verifyEd25519(clockAddress, clockSig, memo)) return { ok: false, reason: "Підпис відмітки не збігся.", retry: false };
  } else {
    let tx: ParsedTx;
    try {
      if (input.cluster === "mainnet") {
        const { readMainnetTxOnServer } = await import("./mainnet.server");
        tx = (await readMainnetTxOnServer(clockSig)) as ParsedTx;
      } else {
        const { devnetTx } = await import("./payments.server");
        tx = await devnetTx(clockSig);
      }
    } catch {
      return { ok: false, reason: "Мережа не відповіла.", retry: true };
    }
    const checked = checkClockTx(tx, { address: clockAddress, day });
    if (!checked.ok) return { ok: false, reason: checked.reason, retry: !tx };
  }
  const g = await guard(input.proof, "clock", clockExtra({ clockAddress, clockSig, memo }), "clock");
  if (!g.ok) return g;
  try {
    const { recordClockDay } = await import("./positions-ledger.server");
    const res = await recordClockDay(g.sql, { wallet: g.wallet, day, clockAddress, clockSig, now: Date.now() });
    return res.ok ? res : { ...res, retry: false };
  } catch {
    return { ok: false, reason: "База не відповіла.", retry: true };
  }
}

export type WindowResult =
  | { ok: true; fresh: boolean; windowId: string; kind: "h48" | "d7"; startedMs: number; endsMs: number }
  | { ok: false; reason: string; retry: boolean };

export async function startFeeWindowOnServer(input: { proof: WalletProof | null }): Promise<WindowResult> {
  const g = await guard(input.proof, "fee-window", "start", "fee-window");
  if (!g.ok) return g;
  try {
    const { startFeeWindow } = await import("./positions-ledger.server");
    const res = await startFeeWindow(g.sql, g.wallet, Date.now());
    if (!res.ok) return { ...res, retry: false };
    return { ok: true, fresh: res.fresh, ...res.start };
  } catch {
    return { ok: false, reason: "База не відповіла.", retry: true };
  }
}

export async function feeBalanceOnServer(wallet: string): Promise<({ ok: true } & FeeBalance) | { ok: false; reason: string }> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return { ok: false, reason: "Погана адреса." };
  const sql = await openSql();
  if (!sql) return { ok: false, reason: "Немає бази." };
  try {
    const ledger = await import("./positions-ledger.server");
    await ledger.closeStale(deps(sql), wallet);
    return { ok: true, ...(await ledger.feeBalance(sql, wallet)) };
  } catch {
    return { ok: false, reason: "База не відповіла." };
  }
}
