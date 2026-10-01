import type { Keypair } from "@solana/web3.js";
import { derivedKeypair, keypairFromText } from "./secret-key.server";

/** Server mint authority from MINT_AUTHORITY_SECRET, or null. */
export function mintAuthority(): Keypair | null {
  return keypairFromText(process.env.MINT_AUTHORITY_SECRET);
}

/** The server collection every co-signed agent joins (derived from the authority). */
export function serverCollectionKeypair(authority: Keypair): Keypair {
  return derivedKeypair(authority, "mint-collection");
}

/** Address of the server collection, or null when no authority is configured. */
export function serverCollectionAddress(): string | null {
  const key = mintAuthority();
  return key ? serverCollectionKeypair(key).publicKey.toBase58() : null;
}
