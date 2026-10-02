/**
 * Server-side position and fee rules. Pure: shared by positions.server.ts and the tests.
 *
 * - PnL is computed by the server from its own entry and exit prices (Polymarket
 *   yes price), never from the client's number. Same formula as the engine:
 *   pnl = stake * (exit - entry) / entry, sign flipped for no/short.
 * - owed = 5% (FREE_FEE_RATE) of a positive PnL for a Free agent whose position
 *   was opened outside every fee-free window the server started. Pro, losses and
 *   covered trades owe 0. Capped at FEE_MAX_LAMPORTS so one transfer can pay it.
 * - Fee-free windows: entitlement is replayed from server-verified clock-in days
 *   with fee-windows.ts (grantStreakRewards), activation time is server time.
 */
import { FREE_FEE_RATE } from "./fees.config.ts";
import { FEE_MAX_LAMPORTS, memosOf, type ParsedTx } from "./payment-rules.ts";
import { D7_MS, H48_MS, grantStreakRewards, utcDayKey, type FeeWindow } from "../game/fee-windows.ts";

/** Same as the desk trade cap (MAX_TRADE_SOL 0.02). */
export const STAKE_MAX_LAMPORTS = 20_000_000;
/** An open position older than this is closed by the server at its own price. */
export const POSITION_MAX_OPEN_MS = 6 * 60 * 60 * 1000;
/** If the price cannot be read for this long, the position closes flat (pnl 0). */
export const POSITION_GIVE_UP_MS = 24 * 60 * 60 * 1000;
/** A Free wallet with owed fees older than this cannot open new positions. */
export const UNPAID_GRACE_MS = 24 * 60 * 60 * 1000;

export type PositionSide = "yes" | "no" | "long" | "short";

export function readSide(raw: unknown): PositionSide | null {
  return raw === "yes" || raw === "no" || raw === "long" || raw === "short" ? raw : null;
}

/** Only Polymarket books (poly:<id or slug>) are priced by the server. */
export function readBook(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^poly:[\w-]{1,100}$/.test(s) ? s : "";
}

export function cleanFillId(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[^\w:.-]/g, "").slice(0, 64) : "";
}

export function priceOk(px: number | null | undefined): px is number {
  return typeof px === "number" && Number.isFinite(px) && px >= 0 && px <= 1;
}

/** Entry must be a tradable price (same bounds the desk uses to list a market). */
export function entryOk(px: number | null | undefined): px is number {
  return priceOk(px) && px > 0.02 && px < 0.98;
}

export function pnlLamports(stakeLamports: number, side: PositionSide, entryPx: number, exitPx: number): number {
  if (!(entryPx > 0) || !(stakeLamports > 0) || !priceOk(exitPx)) return 0;
  const raw = (stakeLamports * (exitPx - entryPx)) / entryPx;
  const signed = side === "no" || side === "short" ? -raw : raw;
  const out = Math.round(signed);
  return Object.is(out, -0) ? 0 : out;
}

export function owedLamports(input: { tier: string; pnlLamports: number; covered: boolean }): number {
  if (input.tier !== "free" || input.covered || !(input.pnlLamports > 0)) return 0;
  const cut = Math.round(input.pnlLamports * FREE_FEE_RATE);
  if (cut < 1) return 0;
  return Math.min(cut, FEE_MAX_LAMPORTS);
}

export type WindowStart = { windowId: string; kind: "h48" | "d7"; startedMs: number; endsMs: number };

/** Fee-free if the server-recorded open time is inside a window the server started. */
export function startsCover(starts: readonly WindowStart[], openedMs: number): boolean {
  if (!(openedMs > 0)) return false;
  return starts.some((w) => w.endsMs > w.startedMs && openedMs >= w.startedMs && openedMs < w.endsMs);
}

function nextDayKey(day: string): string {
  return utcDayKey(Date.parse(`${day}T00:00:00Z`) + 86_400_000);
}

/** Replays verified clock-in days (ascending) through the same streak rules as save.ts stampClock. */
export function grantedWindows(days: readonly { day: string; at: number }[]): FeeWindow[] {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  let rows: FeeWindow[] = [];
  let seven = 0;
  let thirty = 0;
  let prev = "";
  for (const d of sorted) {
    if (d.day === prev) continue;
    const continued = prev !== "" && d.day === nextDayKey(prev);
    seven = continued ? seven + 1 : 1;
    thirty = continued ? thirty + 1 : 1;
    const granted = grantStreakRewards(rows, { seven, thirty }, d.at);
    rows = granted.rows;
    seven = granted.seven;
    prev = d.day;
  }
  return rows;
}

/**
 * Which window to start now: the active one if any (idempotent), else the
 * first granted window not started yet, else null.
 */
export function windowToStart(
  granted: readonly FeeWindow[],
  starts: readonly WindowStart[],
  now: number,
): { fresh: boolean; start: WindowStart } | null {
  const live = starts.find((w) => w.startedMs <= now && w.endsMs > now);
  if (live) return { fresh: false, start: live };
  const used = new Set(starts.map((w) => w.windowId));
  const next = granted.find((w) => !used.has(w.id));
  if (!next) return null;
  const dur = next.kind === "h48" ? H48_MS : D7_MS;
  return { fresh: true, start: { windowId: next.id, kind: next.kind, startedMs: now, endsMs: now + dur } };
}

export const CLOCK_MEMO = /^solarchik clock (\d{4}-\d{2}-\d{2}) \d{1,7}m s\d{1,5} [a-z]{2,12}$/;

/** The clock-in memo both apps sign: `solarchik clock <day> <m>m s<streak> <mod>`. */
export function clockMemoDay(memo: string): string {
  const m = CLOCK_MEMO.exec(memo);
  return m ? m[1] : "";
}

/** A clock-in is accepted for today or yesterday (UTC, server clock), so a late sync still counts. */
export function clockDayAllowed(day: string, now: number): boolean {
  return day === utcDayKey(now) || day === utcDayKey(now - 86_400_000);
}

/** A clock-in sent as a memo transaction: confirmed, signed by the player's wallet, memo for `day`. */
export function checkClockTx(tx: ParsedTx, input: { address: string; day: string }): { ok: true; memo: string } | { ok: false; reason: string } {
  if (!tx) return { ok: false, reason: "Транзакцію відмітки не знайдено." };
  if (tx.meta?.err) return { ok: false, reason: "Транзакція відмітки впала." };
  if (typeof tx.blockTime !== "number") return { ok: false, reason: "Транзакція відмітки ще не в блоці." };
  const keys = (tx.transaction?.message as { accountKeys?: Array<{ pubkey?: string; signer?: boolean }> } | undefined)?.accountKeys ?? [];
  if (!keys.some((k) => k.signer && k.pubkey === input.address)) return { ok: false, reason: "Відмітку підписав інший гаманець." };
  const memo = memosOf(tx).find((m) => clockMemoDay(m) === input.day);
  if (!memo) return { ok: false, reason: "У транзакції немає мемо відмітки за цей день." };
  return { ok: true, memo };
}

/** Text the room key signs for an open (bound to every field the server stores). */
export function openExtra(input: { fillId: string; asset: string; book: string; side: string; stakeLamports: number }): string {
  return `open:${input.fillId}:${input.asset}:${input.book}:${input.side}:${input.stakeLamports}`;
}

export function closeExtra(fillId: string): string {
  return `close:${fillId}`;
}

/** Text the room key signs to bind a player's clock-in proof to this room wallet. */
export function clockExtra(input: { clockAddress: string; clockSig: string; memo: string }): string {
  return `${input.clockAddress}:${input.clockSig}:${input.memo}`;
}

/** The clock-in memo text (same on web MWA and the Android wallet bridge). */
export function clockMemo(day: string, meters: number, streak: number, mod: string): string {
  return `solarchik clock ${day} ${meters | 0}m s${streak | 0} ${mod}`;
}
