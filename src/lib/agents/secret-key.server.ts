import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { decodeBase58 } from "./base58.ts";

/** Parse a Solana secret from an env var: base58 (64-byte key or 32-byte seed) or a JSON byte array. Null on junk. */
export function keypairFromText(text: string | undefined | null): Keypair | null {
  const clean = (text ?? "").trim();
  if (!clean) return null;
  try {
    const bytes = clean.startsWith("[") ? Uint8Array.from(JSON.parse(clean) as number[]) : decodeBase58(clean);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    return null;
  } catch {
    return null;
  }
}

/** Deterministic child keypair (e.g. the server collection), so no second secret is needed. */
export function derivedKeypair(parent: Keypair, label: string): Keypair {
  const seed = createHash("sha256").update(`solarchik:${label}:v1`).update(parent.secretKey.subarray(0, 32)).digest();
  return Keypair.fromSeed(new Uint8Array(seed));
}

/** Backpack API key + base64 ed25519 seed (env pair, or the old two-line file). Null on junk. */
export function backpackFromText(apiKey: string | undefined | null, secret: string | undefined | null): { apiKey: string; seed: Buffer } | null {
  const key = (apiKey ?? "").trim();
  const sec = (secret ?? "").trim();
  if (!key || !sec) return null;
  const seed = Buffer.from(sec, "base64");
  return seed.length === 32 ? { apiKey: key, seed } : null;
}

/** The old server/backpack.secret format: line 1 api key, line 2 base64 seed. */
export function backpackFromFile(text: string): { apiKey: string; seed: Buffer } | null {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return backpackFromText(lines[0], lines[1]);
}

/** First non-empty env value. */
export function envFirst(...names: string[]): string {
  for (const name of names) {
    const value = (typeof process !== "undefined" ? process.env[name] : undefined)?.trim();
    if (value) return value;
  }
  return "";
}
