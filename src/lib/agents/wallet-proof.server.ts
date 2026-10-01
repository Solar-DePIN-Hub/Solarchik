import { createPublicKey, verify } from "node:crypto";
import { decodeBase58 } from "./base58.ts";
import { PROOF_MAX_SKEW_MS, proofMessage, type ProofAction, type WalletProof } from "./wallet-proof.ts";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

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
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub)]), format: "der", type: "spki" });
    const msg = Buffer.from(proofMessage(action, proof.wallet, proof.ts, extra), "utf8");
    if (!verify(null, msg, key, Buffer.from(sig))) return { ok: false, reason: "Підпис гаманця не збігся." };
  } catch {
    return { ok: false, reason: "Підпис гаманця не збігся." };
  }
  return { ok: true };
}
