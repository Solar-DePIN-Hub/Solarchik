import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createV1, ruleSet } from "@metaplex-foundation/mpl-core";
import { publicKey, createNoopSigner, signerIdentity } from "@metaplex-foundation/umi";
const umi = createUmi("http://127.0.0.1:8899");
const payer = createNoopSigner(publicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"));
umi.use(signerIdentity(payer));
const asset = createNoopSigner(publicKey("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T"));
const treasury = publicKey("8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic");
const b = createV1(umi, {
  asset, name: "Bitcoin Windows #11 Pro", uri: "urn:solarchik:agent",
  plugins: [
    { plugin: { __kind: "Royalties", fields: [{ basisPoints: 500, creators: [{ address: treasury, percentage: 100 }], ruleSet: ruleSet("None") }] }, authority: null },
    { plugin: { __kind: "Attributes", fields: [{ attributeList: [{ key: "sku", value: "sku-pred-alpha-pro" }, { key: "tier", value: "pro" }, { key: "class", value: "1" }] }] }, authority: null },
  ],
});
const ix = b.getInstructions()[0];
console.log(JSON.stringify({ program: ix.programId.toString(), keys: ix.keys.map(k => [k.pubkey.toString(), k.isSigner, k.isWritable]), data: Buffer.from(ix.data).toString("hex") }, null, 1));
