// Bundled by buffer-shim-web3.test.mjs with `buffer` aliased to src/polyfill.ts, exactly like the browser build.
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction, PublicKey } from "@solana/web3.js";

export function run() {
  const payer = Keypair.generate();
  const ixs = [];
  for (let i = 0; i < 8; i++) ixs.push(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000 + i }));
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: new PublicKey(new Uint8Array(32).fill(7)).toBase58(),
    instructions: ixs,
  }).compileToV0Message();
  const raw = new VersionedTransaction(msg).serialize();
  // The co-signed server mint path: deserialize, add the room signature, serialize again.
  const back = VersionedTransaction.deserialize(raw);
  back.sign([payer]);
  const again = back.serialize();
  return {
    first: raw.length,
    afterSign: again.length,
    payerKept: back.message.staticAccountKeys[0].equals(payer.publicKey),
    signed: back.signatures[0].some((b) => b !== 0),
    shim: typeof globalThis.Buffer === "function" && typeof globalThis.Buffer.prototype.utf8Write !== "function",
  };
}
