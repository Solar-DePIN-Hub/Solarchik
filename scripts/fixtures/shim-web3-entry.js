// Bundled by buffer-shim-web3.test.mjs with `buffer` aliased to src/polyfill.ts, exactly like the browser build.
import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction, PublicKey } from "@solana/web3.js";

export async function run() {
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
  // What actually goes on the wire: Connection.sendRawTransaction base64-encodes via toBuffer().
  let wire = "";
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    wire = body.params[0];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "1".repeat(88) }), { headers: { "content-type": "application/json" } });
  };
  await new Connection("http://127.0.0.1:8899", { fetch: fakeFetch }).sendRawTransaction(again, { skipPreflight: true });
  const wireBytes = Uint8Array.from(atob(wire), (c) => c.charCodeAt(0));
  return {
    wireOk: wireBytes.length === again.length && wireBytes.every((b, i) => b === again[i]),
    first: raw.length,
    afterSign: again.length,
    payerKept: back.message.staticAccountKeys[0].equals(payer.publicKey),
    signed: back.signatures[0].some((b) => b !== 0),
    shim: typeof globalThis.Buffer === "function" && typeof globalThis.Buffer.prototype.utf8Write !== "function",
  };
}
