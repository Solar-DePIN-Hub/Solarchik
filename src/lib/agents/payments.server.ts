import { arbStore } from "./arb-guard.server";
import type { GuardSql } from "./guard-ledger.server";
import {
  checkArbCreditTx,
  checkFeeTx,
  cleanRowId,
  isAddress,
  isSignature,
  type ParsedTx,
} from "./payment-rules";

/**
 * Server checks for money the client says it sent. The server reads the
 * transaction itself and records the signature once in Postgres:
 * - arb credit: mainnet deposit room wallet -> arb treasury, memo = NFT asset;
 * - Free fee: devnet transfer room wallet -> pay wallet, memo solarchik-fee:<row>,
 *   at least the fee the server itself computed for that closed position
 *   (agent_positions.owed_lamports); a row the server never saw is refused.
 * No database on a deploy: closed (nothing is credited). Anyone may submit a
 * signature: the credit can only land on the wallet/asset written in the tx.
 */

const PUBLIC_DEVNET = "https://api.devnet.solana.com";

export type CreditResult = { ok: true; creditSol: number; added: number } | { ok: false; reason: string; creditSol: number | null };
export type FeeResult = { ok: true; verified: true } | { ok: false; reason: string; retry: boolean };

async function sqlOrNull(): Promise<GuardSql | null> {
  if (arbStore() === "none") return null;
  try {
    const { getSql } = await import("@/lib/db");
    return await getSql();
  } catch {
    return null;
  }
}

export async function devnetTx(sig: string): Promise<ParsedTx> {
  const url = (process.env.SOLANA_RPC_DEVNET || "").trim() || PUBLIC_DEVNET;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [sig, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = (await res.json()) as { result?: ParsedTx; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "rpc");
  return body.result ?? null;
}

export async function readArbCreditOnServer(asset: string): Promise<{ ok: true; creditSol: number } | { ok: false; reason: string }> {
  if (!isAddress(asset)) return { ok: false, reason: "Немає NFT." };
  const sql = await sqlOrNull();
  if (!sql) return { ok: false, reason: "Кредит арбу закритий: немає бази (DATABASE_URL)." };
  try {
    const { arbCreditLamports } = await import("./guard-ledger.server");
    return { ok: true, creditSol: (await arbCreditLamports(sql, asset)) / 1e9 };
  } catch {
    return { ok: false, reason: "База не відповіла." };
  }
}

export async function claimArbCreditOnServer(input: { wallet: string; asset: string; sig: string }): Promise<CreditResult> {
  const { wallet, asset, sig } = input;
  if (!isAddress(wallet) || !isAddress(asset) || !isSignature(sig)) return { ok: false, reason: "Погані дані.", creditSol: null };
  const { LIVE_OFF_REASON, liveTradingFrom } = await import("./live-trading.ts");
  if (!liveTradingFrom(process.env.LIVE_TRADING_ENABLED)) return { ok: false, reason: LIVE_OFF_REASON, creditSol: null };
  const sql = await sqlOrNull();
  if (!sql) return { ok: false, reason: "Кредит арбу закритий: немає бази (DATABASE_URL). Нічого не зараховано.", creditSol: null };
  const ledger = await import("./guard-ledger.server");
  const current = async () => {
    try {
      return (await ledger.arbCreditLamports(sql, asset)) / 1e9;
    } catch {
      return null;
    }
  };
  let tx: ParsedTx;
  try {
    const { readMainnetTxOnServer } = await import("./mainnet.server");
    tx = (await readMainnetTxOnServer(sig)) as ParsedTx;
  } catch {
    return { ok: false, reason: "Mainnet не відповів. Спробуй ще раз.", creditSol: await current() };
  }
  const checked = checkArbCreditTx(tx, { wallet, asset, nowSec: Math.floor(Date.now() / 1000) });
  if (!checked.ok) return { ok: false, reason: checked.reason, creditSol: await current() };
  try {
    const fresh = await ledger.recordPayment(sql, {
      sig,
      kind: "arb-credit",
      cluster: "mainnet",
      wallet,
      asset,
      ref: "",
      lamports: checked.lamports,
      now: Date.now(),
    });
    const creditSol = (await ledger.arbCreditLamports(sql, asset)) / 1e9;
    if (!fresh) return { ok: false, reason: "Цю транзакцію вже зараховано.", creditSol };
    return { ok: true, creditSol, added: checked.lamports / 1e9 };
  } catch {
    return { ok: false, reason: "База не відповіла. Спробуй ще раз.", creditSol: null };
  }
}

export async function recordFeeOnServer(input: { wallet: string; rowId: string; sig: string; lamports: number }): Promise<FeeResult> {
  const wallet = input.wallet;
  const rowId = cleanRowId(input.rowId);
  const lamports = Math.round(Number(input.lamports));
  if (!isAddress(wallet) || !rowId || !isSignature(input.sig)) return { ok: false, reason: "Погані дані.", retry: false };
  const sql = await sqlOrNull();
  if (!sql) return { ok: false, reason: "Немає бази: комісію не звірено.", retry: true };
  // The server decides what is owed: a closed position it recorded, 5% of its own PnL.
  try {
    const { owedFor } = await import("./positions-ledger.server");
    const owed = await owedFor(sql, wallet, rowId);
    if (!owed.ok) return owed;
    if (lamports < owed.owedLamports) {
      return { ok: false, reason: `Мало: сервер нарахував ${owed.owedLamports} лампортів за цю позицію.`, retry: false };
    }
  } catch {
    return { ok: false, reason: "База не відповіла.", retry: true };
  }
  let tx: ParsedTx;
  try {
    tx = await devnetTx(input.sig);
  } catch {
    return { ok: false, reason: "Devnet не відповів.", retry: true };
  }
  const checked = checkFeeTx(tx, { wallet, rowId, lamports, nowSec: Math.floor(Date.now() / 1000) });
  if (!checked.ok) return { ok: false, reason: checked.reason, retry: !tx };
  try {
    const { recordPayment } = await import("./guard-ledger.server");
    const fresh = await recordPayment(sql, { sig: input.sig, kind: "fee", cluster: "devnet", wallet, asset: "", ref: rowId, lamports, now: Date.now() });
    if (!fresh) {
      // Same signature or same row recorded before: fine only if it is this exact pair.
      const rows = await sql.query<{ sig: string }>("select sig from chain_payments where kind = 'fee' and wallet = $1 and ref = $2", [wallet, rowId]);
      if (rows[0]?.sig === input.sig) return { ok: true, verified: true };
      return { ok: false, reason: "Цей підпис або рядок уже звірено з іншою транзакцією.", retry: false };
    }
    return { ok: true, verified: true };
  } catch {
    return { ok: false, reason: "База не відповіла.", retry: true };
  }
}
