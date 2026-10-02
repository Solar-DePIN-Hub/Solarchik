import { createPublicKey, verify } from "node:crypto";
import { decodeBase58 } from "./base58.ts";
import { PROOF_MAX_SKEW_MS, proofMessage, type ProofAction, type WalletProof } from "./wallet-proof.ts";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Ed25519 check of any UTF-8 message signed by a Solana address (base58 key and signature). */
export function verifyEd25519(address: string, signature: string, message: string): boolean {
  let pub: Uint8Array;
  let sig: Uint8Array;
  try {
    pub = decodeBase58(address);
    sig = decodeBase58(signature);
  } catch {
    return false;
  }
  if (pub.length !== 32 || sig.length !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub)]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(sig));
  } catch {
    return false;
  }
}

/** Ed25519 check of a room-key proof. Pure Node crypto, no RPC. */
export function verifyProof(
  proof: WalletProof,
  action: ProofAction,
  extra: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (Math.abs(now - proof.ts) > PROOF_MAX_SKEW_MS) return { ok: false, reason: "Підпис застарів. Спробуй ще раз." };
  let pub: Uint8Array;
  let sig: Uint8Array;
  try {
    pub = decodeBase58(proof.wallet);
    sig = decodeBase58(proof.sig);
  } catch {
    return { ok: false, reason: "Підпис не читається." };
  }
  if (pub.length !== 32 || sig.length !== 64) return { ok: false, reason: "Підпис не читається." };
  if (!verifyEd25519(proof.wallet, proof.sig, proofMessage(action, proof.wallet, proof.ts, extra))) {
    return { ok: false, reason: "Підпис гаманця не збігся." };
  }
  return { ok: true };
}
