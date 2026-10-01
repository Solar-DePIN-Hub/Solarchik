import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createV1, ruleSet } from "@metaplex-foundation/mpl-core";
import { publicKey, createNoopSigner, signerIdentity } from "@metaplex-foundation/umi";
import { Transaction, TransactionInstruction, PublicKey, SystemProgram } from "@solana/web3.js";
const umi = createUmi("http://127.0.0.1:8899");
const P = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", A = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", T = "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic";
const payer = createNoopSigner(publicKey(P));
umi.use(signerIdentity(payer));
const asset = createNoopSigner(publicKey(A));
const b = createV1(umi, {
  asset, name: "Events Scout #04", uri: "urn:solarchik:agent",
  plugins: [
    { plugin: { __kind: "Royalties", fields: [{ basisPoints: 500, creators: [{ address: publicKey(T), percentage: 100 }], ruleSet: ruleSet("None") }] }, authority: null },
    { plugin: { __kind: "Attributes", fields: [{ attributeList: [{ key: "sku", value: "sku-pred-events" }, { key: "tier", value: "free" }, { key: "class", value: "1" }] }] }, authority: null },
  ],
});
const ix = b.getInstructions()[0];
const free = Buffer.from(ix.data).toString("hex");
const tx = new Transaction({ feePayer: new PublicKey(P), recentBlockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N" });
tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(P), toPubkey: new PublicKey(T), lamports: 100000000 }));
tx.add(new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map(k => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(ix.data) }));
const msg = tx.compileMessage().serialize().toString("hex");
console.log(JSON.stringify({ free, msg }));
