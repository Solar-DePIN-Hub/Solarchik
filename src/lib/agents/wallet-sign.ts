import type { Keypair } from "@solana/web3.js";
import { encodeBase58 } from "./base58";
import { proofMessage, type ProofAction, type WalletProof } from "./wallet-proof";

/** Sign a server proof with the room key. The secret key stays in this browser. */
export async function signProof(kp: Keypair, action: ProofAction, extra: string): Promise<WalletProof> {
  const { createUmi } = await import("@metaplex-foundation/umi-bundle-defaults");
  const umi = createUmi("https://api.devnet.solana.com");
  const pair = umi.eddsa.createKeypairFromSecretKey(kp.secretKey);
  const wallet = kp.publicKey.toBase58();
  const ts = Date.now();
  const sig = umi.eddsa.sign(new TextEncoder().encode(proofMessage(action, wallet, ts, extra)), pair);
  return { wallet, ts, sig: encodeBase58(sig) };
}
