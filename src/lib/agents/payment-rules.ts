/**
 * On-chain payment checks shared by the server and the tests. Pure.
 * The server reads the transaction itself (never the client's word): status,
 * age, a system transfer to the right treasury, the sender and the memo.
 */
import { ARB_TREASURY, PAY_WALLET } from "../game/pay.ts";

export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** Arb credit: 0.005 to 0.02 SOL per deposit (same bounds as the desk). */
export const ARB_CREDIT_MIN_LAMPORTS = 5_000_000;
export const ARB_CREDIT_MAX_LAMPORTS = 20_000_000;
/** A deposit older than this is not credited (the server would not have seen it fresh). */
export const ARB_CREDIT_MAX_AGE_SEC = 30 * 24 * 3600;
/** A fee transfer older than this is not recorded. */
export const FEE_MAX_AGE_SEC = 30 * 24 * 3600;
/** Free fee: 5% of profit, at most the desk trade cap. */
export const FEE_MAX_LAMPORTS = 20_000_000;

type ParsedIx = { program?: string; programId?: string; parsed?: unknown };
export type ParsedTx = {
  blockTime?: number | null;
  meta?: { err?: unknown } | null;
  transaction?: { message?: { instructions?: ParsedIx[] } };
} | null;

export type Transfer = { source: string; destination: string; lamports: number };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

export function isSignature(value: string): boolean {
  return SIG.test(value);
}

export function isAddress(value: string): boolean {
  return BASE58.test(value);
}

/** Fee memo binds the transfer to one ledger row. */
export function feeMemo(rowId: string): string {
  return `solarchik-fee:${cleanRowId(rowId)}`;
}

export function cleanRowId(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[^\w:.-]/g, "").slice(0, 64) : "";
}

export function transfersOf(tx: ParsedTx): Transfer[] {
  const out: Transfer[] = [];
  for (const ix of tx?.transaction?.message?.instructions ?? []) {
    if (ix.program !== "system") continue;
    const p = ix.parsed as { type?: string; info?: { destination?: string; lamports?: number; source?: string } } | undefined;
    if (p?.type !== "transfer") continue;
    const lamports = Number(p.info?.lamports);
    if (!Number.isFinite(lamports)) continue;
    out.push({ source: p.info?.source ?? "", destination: p.info?.destination ?? "", lamports });
  }
  return out;
}

export function memosOf(tx: ParsedTx): string[] {
  const out: string[] = [];
  for (const ix of tx?.transaction?.message?.instructions ?? []) {
    if (ix.program !== "spl-memo" && ix.programId !== MEMO_PROGRAM_ID) continue;
    if (typeof ix.parsed === "string") out.push(ix.parsed);
  }
  return out;
}

type Check = { ok: true; lamports: number } | { ok: false; reason: string };

function basic(tx: ParsedTx, nowSec: number, maxAgeSec: number): string | null {
  if (!tx) return "Транзакцію не знайдено. Зачекай підтвердження і спробуй ще раз.";
  if (tx.meta?.err) return "Транзакція впала з помилкою.";
  if (typeof tx.blockTime !== "number") return "Транзакція ще не в блоці.";
  if (nowSec - tx.blockTime > maxAgeSec) return "Транзакція застара.";
  return null;
}

/** Arb credit: room wallet -> ARB_TREASURY, memo = NFT asset address. */
export function checkArbCreditTx(tx: ParsedTx, input: { wallet: string; asset: string; nowSec: number }): Check {
  const bad = basic(tx, input.nowSec, ARB_CREDIT_MAX_AGE_SEC);
  if (bad) return { ok: false, reason: bad };
  if (!memosOf(tx).includes(input.asset)) return { ok: false, reason: "У транзакції немає мемо з адресою NFT." };
  const paid = transfersOf(tx)
    .filter((t) => t.destination === ARB_TREASURY && t.source === input.wallet)
    .reduce((sum, t) => sum + t.lamports, 0);
  if (paid < ARB_CREDIT_MIN_LAMPORTS) return { ok: false, reason: "Немає переказу від 0.005 SOL з гаманця кімнати на касу арбу." };
  if (paid > ARB_CREDIT_MAX_LAMPORTS) return { ok: false, reason: "Переказ більший за 0.02 SOL. Кредит не зараховано." };
  return { ok: true, lamports: paid };
}

/** Free fee: room wallet -> PAY_WALLET, exact lamports, memo = feeMemo(rowId). */
export function checkFeeTx(tx: ParsedTx, input: { wallet: string; rowId: string; lamports: number; nowSec: number }): Check {
  const bad = basic(tx, input.nowSec, FEE_MAX_AGE_SEC);
  if (bad) return { ok: false, reason: bad };
  if (!(input.lamports > 0) || input.lamports > FEE_MAX_LAMPORTS) return { ok: false, reason: "Сума комісії поза межами." };
  if (!memosOf(tx).includes(feeMemo(input.rowId))) return { ok: false, reason: "У транзакції немає мемо цієї комісії." };
  const paid = transfersOf(tx).some(
    (t) => t.destination === PAY_WALLET && t.source === input.wallet && t.lamports === input.lamports,
  );
  if (!paid) return { ok: false, reason: "Немає переказу цієї суми з гаманця кімнати на казну." };
  return { ok: true, lamports: input.lamports };
}
