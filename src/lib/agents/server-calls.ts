/**
 * Guarded server calls (arb fire, arb house, mint).
 * Web: TanStack server functions on the same origin.
 * Native bundle: plain HTTPS to the deployed server (/api/native/*); the server code is not bundled.
 */
import type { ArbHouse } from "./arb-house";
import type { WalletProof } from "./wallet-proof";
import type { MintStatus, PrepareMintResult, PrepareReissueResult } from "./mint.server";
import type { CreditResult, FeeResult } from "./payments.server";
import type { ArbFireResult } from "./arb-guard.server";
import type { ClockResult, WindowResult } from "./positions.server";
import type { CloseResult, FeeBalance, OpenResult } from "./positions-ledger.server";

export const NATIVE_API_ORIGIN = "https://solarchik-super-app.vercel.app";

const NATIVE = import.meta.env.VITE_NATIVE === "1";

function nativeOrigin(): string {
  const configured = (import.meta.env.VITE_DESK_PROXY_ORIGIN as string | undefined)?.trim();
  return (configured || NATIVE_API_ORIGIN).replace(/\/+$/, "");
}

async function nativePost<T>(route: string, body: unknown, ms = 30_000): Promise<T> {
  const res = await fetch(`${nativeOrigin()}/api/native/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(ms),
  });
  const json = (await res.json().catch(() => null)) as T | null;
  if (!json) throw new Error(`native api ${res.status}`);
  return json;
}

export async function callArbFire(data: { dir: "A" | "B"; symbol: string; asset: string; proof: WalletProof }): Promise<ArbFireResult> {
  if (NATIVE) return nativePost<ArbFireResult>("arb-fire", data, 60_000);
  const { fireArb } = await import("./arb-house");
  return fireArb({ data });
}

export async function callArbHouse(): Promise<ArbHouse> {
  if (NATIVE) return nativePost<ArbHouse>("arb-house", {});
  const { readArbHouse } = await import("./arb-house");
  return readArbHouse();
}

export async function callMintStatus(): Promise<MintStatus> {
  if (NATIVE) return nativePost<MintStatus>("mint-status", {});
  const { readMintStatus } = await import("./mint");
  return readMintStatus();
}

export async function callPrepareMint(data: { proof: WalletProof; skuId: string; paySig: string }): Promise<PrepareMintResult> {
  if (NATIVE) return nativePost<PrepareMintResult>("mint-prepare", data);
  const { prepareMint } = await import("./mint");
  return prepareMint({ data });
}

export async function callPrepareReissue(data: { proof: WalletProof; oldAsset: string; paySig: string }): Promise<PrepareReissueResult> {
  if (NATIVE) return nativePost<PrepareReissueResult>("mint-reissue", data);
  const { prepareReissue } = await import("./mint");
  return prepareReissue({ data });
}

export async function callReadArbCredit(asset: string): Promise<{ ok: true; creditSol: number } | { ok: false; reason: string }> {
  if (NATIVE) return nativePost("arb-credit", { asset });
  const { readArbCreditFn } = await import("./payments");
  return readArbCreditFn({ data: { asset } });
}

export async function callClaimArbCredit(data: { wallet: string; asset: string; sig: string }): Promise<CreditResult> {
  if (NATIVE) return nativePost<CreditResult>("arb-credit-claim", data);
  const { claimArbCreditFn } = await import("./payments");
  return claimArbCreditFn({ data });
}

export async function callRecordFee(data: { wallet: string; rowId: string; sig: string; lamports: number }): Promise<FeeResult> {
  if (NATIVE) return nativePost<FeeResult>("fee-record", data);
  const { recordFeeFn } = await import("./payments");
  return recordFeeFn({ data });
}

export async function callOpenPosition(data: {
  proof: WalletProof;
  fillId: string;
  asset: string;
  book: string;
  side: string;
  stakeLamports: number;
}): Promise<OpenResult> {
  if (NATIVE) return nativePost<OpenResult>("position-open", data);
  const { openPositionFn } = await import("./payments");
  return openPositionFn({ data });
}

export async function callClosePosition(data: { proof: WalletProof; fillId: string }): Promise<CloseResult> {
  if (NATIVE) return nativePost<CloseResult>("position-close", data);
  const { closePositionFn } = await import("./payments");
  return closePositionFn({ data });
}

export async function callRecordClock(data: {
  proof: WalletProof;
  clockAddress: string;
  clockSig: string;
  kind: "tx" | "message";
  cluster: "mainnet" | "devnet";
  memo: string;
}): Promise<ClockResult> {
  if (NATIVE) return nativePost<ClockResult>("clock-record", data);
  const { recordClockFn } = await import("./payments");
  return recordClockFn({ data });
}

export async function callStartFeeWindow(data: { proof: WalletProof }): Promise<WindowResult> {
  if (NATIVE) return nativePost<WindowResult>("fee-window-start", data);
  const { startFeeWindowFn } = await import("./payments");
  return startFeeWindowFn({ data });
}

export async function callFeeBalance(wallet: string): Promise<({ ok: true } & FeeBalance) | { ok: false; reason: string }> {
  if (NATIVE) return nativePost("fee-balance", { wallet });
  const { feeBalanceFn } = await import("./payments");
  return feeBalanceFn({ data: { wallet } });
}

/** Strategy NFTs + marketplace: one route table on the server (strategy.server STRATEGY_ROUTES). */
export async function callStrategy<T = { ok: boolean; reason?: string }>(route: string, body: Record<string, unknown>): Promise<T> {
  if (NATIVE) return nativePost<T>(route, body, 60_000);
  const { strategyCallFn } = await import("./payments");
  const res = await strategyCallFn({ data: { route, body } });
  return JSON.parse(res.json) as T;
}
