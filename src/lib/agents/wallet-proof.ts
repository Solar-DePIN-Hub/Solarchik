/** Signed wallet proofs. The room key signs a short text; the server checks it. No secret leaves the browser. */

export type ProofAction = "arb" | "mint" | "reissue";

export type WalletProof = { wallet: string; ts: number; sig: string };

/** A proof older or newer than this is refused. */
export const PROOF_MAX_SKEW_MS = 120_000;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function proofMessage(action: ProofAction, wallet: string, ts: number, extra: string): string {
  return `solarchik:${action}:v1\nwallet:${wallet}\nts:${ts}\n${extra}`;
}

/** Sanitize untrusted input from a server function call. */
export function readProof(raw: unknown): WalletProof | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const wallet = typeof o.wallet === "string" ? o.wallet.trim() : "";
  const sig = typeof o.sig === "string" ? o.sig.trim() : "";
  const ts = typeof o.ts === "number" && Number.isFinite(o.ts) ? Math.floor(o.ts) : 0;
  if (wallet.length < 32 || wallet.length > 44 || !BASE58.test(wallet)) return null;
  if (sig.length < 64 || sig.length > 100 || !BASE58.test(sig)) return null;
  if (!(ts > 0)) return null;
  return { wallet, ts, sig };
}
