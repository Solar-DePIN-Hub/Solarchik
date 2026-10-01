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
