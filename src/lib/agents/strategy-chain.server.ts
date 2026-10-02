/**
 * Builds the Metaplex Core transactions behind Strategy NFTs (devnet).
 * The server key is the collection update authority, so only it can write the
 * Attributes plugin (strategy + performance). It also becomes the FreezeDelegate
 * (sale lock / listing escrow) and the TransferDelegate of a listed asset.
 *
 *  strategy change  tx A (owner): hand Attributes to the update authority (legacy assets)
 *                                 and the FreezeDelegate to the server
 *                   tx B (server + owner as payer): write strategy attrs, freeze.
 *                   B fails on chain unless A landed (server must be the freeze authority),
 *                   so a strategy change can never land without the 240 h lock.
 *  list             owner: FreezeDelegate + TransferDelegate -> server, server freezes
 *                   (the asset stays in the seller's wallet but cannot move).
 *  buy              buyer pays seller (95%) + treasury (5% royalty), server thaws and
 *                   transfers as TransferDelegate. One transaction: no NFT without payment.
 *  thaw / unlist    server (payer): thaw, hand the freeze authority back to the owner.
 *  performance      server (payer): write results attrs.
 */
import {
  createNoopSigner,
  createSignerFromKeypair,
  publicKey,
  signTransaction,
  transactionBuilder,
  type PublicKey as UmiPublicKey,
  type Signer,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { addPlugin, approvePluginAuthority, revokePluginAuthority, transfer, updatePlugin, type AssetV1 } from "@metaplex-foundation/mpl-core";
import type { Keypair } from "@solana/web3.js";
import type { Attr } from "./strategy-spec.ts";

const SYSTEM = "11111111111111111111111111111111";

export type CoreState = {
  freeze: { frozen: boolean; authority: string } | null;
  transferDelegate: string | null;
  attributesAuthority: string | null;
};

function authOf(a: { type: string; address?: unknown } | undefined): string {
  if (!a) return "None";
  return a.type === "Address" ? String(a.address) : a.type;
}

export function coreState(asset: AssetV1): CoreState {
  const fd = asset.freezeDelegate as { frozen: boolean; authority: { type: string; address?: unknown } } | undefined;
  const td = asset.transferDelegate as { authority: { type: string; address?: unknown } } | undefined;
  const at = asset.attributes as { authority: { type: string; address?: unknown } } | undefined;
  return {
    freeze: fd ? { frozen: fd.frozen, authority: authOf(fd.authority) } : null,
    transferDelegate: td ? authOf(td.authority) : null,
    attributesAuthority: at ? authOf(at.authority) : null,
  };
}

export function serverSigner(umi: Umi, key: Keypair): Signer {
  return createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(key.secretKey));
}

/** Owner steps that make the server the freeze authority (no-op when it already is). */
function lockToServer(umi: Umi, asset: UmiPublicKey, collection: UmiPublicKey, owner: Signer, server: string, st: CoreState): TransactionBuilder | { error: string } {
  const payer = owner;
  let b = transactionBuilder();
  const fd = st.freeze;
  if (!fd) {
    return b.add(addPlugin(umi, { asset, collection, authority: owner, payer, plugin: { type: "FreezeDelegate", frozen: false, authority: { type: "Address", address: publicKey(server) } } }));
  }
  if (fd.authority === server) return b;
  if (fd.frozen && fd.authority !== "Owner") return { error: "NFT заморожено чужим делегатом." };
  if (fd.frozen) b = b.add(updatePlugin(umi, { asset, collection, authority: owner, payer, plugin: { type: "FreezeDelegate", frozen: false } }));
  return b.add(
    approvePluginAuthority(umi, { asset, collection, authority: owner, payer, plugin: { type: "FreezeDelegate" }, newAuthority: { type: "Address", address: publicKey(server) } }),
  );
}

async function serialize(umi: Umi, builder: TransactionBuilder, payer: Signer, blockhash: string, signers: Signer[]): Promise<string> {
  const tx = builder.setFeePayer(payer).setBlockhash(blockhash).build(umi);
  const signed = signers.length ? await signTransaction(tx, signers) : tx;
  return Buffer.from(umi.transactions.serialize(signed)).toString("base64");
}

export function txSize(umi: Umi, builder: TransactionBuilder, payer: Signer): number {
  return builder.setFeePayer(payer).setBlockhash("11111111111111111111111111111111").getTransactionSize(umi);
}

export type BuiltTxs = { ok: true; txs: string[] } | { ok: false; reason: string };

export async function buildStrategyTxs(input: {
  umi: Umi;
  authority: Keypair;
  asset: AssetV1;
  collection: string;
  attrs: Attr[];
  blockhash: string;
}): Promise<BuiltTxs> {
  const { umi, authority, asset } = input;
  const server = serverSigner(umi, authority);
  const owner = createNoopSigner(asset.owner);
  const col = publicKey(input.collection);
  const st = coreState(asset);
  const payer = owner;
  let a = transactionBuilder();
  if (st.attributesAuthority === "Owner") {
    a = a.add(approvePluginAuthority(umi, { asset: asset.publicKey, collection: col, authority: owner, payer, plugin: { type: "Attributes" }, newAuthority: { type: "UpdateAuthority" } }));
  } else if (st.attributesAuthority && st.attributesAuthority !== "UpdateAuthority") {
    return { ok: false, reason: "Атрибути NFT під чужим ключем." };
  }
  const lock = lockToServer(umi, asset.publicKey, col, owner, server.publicKey.toString(), st);
  if ("error" in lock) return { ok: false, reason: lock.error };
  a = a.add(lock);
  const attrPlugin = { type: "Attributes" as const, attributeList: input.attrs };
  let b = transactionBuilder().add(
    st.attributesAuthority
      ? updatePlugin(umi, { asset: asset.publicKey, collection: col, authority: server, payer, plugin: attrPlugin })
      : addPlugin(umi, { asset: asset.publicKey, collection: col, authority: server, payer, plugin: { ...attrPlugin, authority: { type: "UpdateAuthority" } } }),
  );
  b = b.add(updatePlugin(umi, { asset: asset.publicKey, collection: col, authority: server, payer, plugin: { type: "FreezeDelegate", frozen: true } }));
  if (txSize(umi, b, owner) > 1232) return { ok: false, reason: "Стратегія не влазить в одну транзакцію: скороти правила." };
  const txs: string[] = [];
  if (a.items.length) txs.push(await serialize(umi, a, owner, input.blockhash, []));
  txs.push(await serialize(umi, b, owner, input.blockhash, [server]));
  return { ok: true, txs };
}

export async function buildListTx(input: { umi: Umi; authority: Keypair; asset: AssetV1; collection: string; blockhash: string }): Promise<BuiltTxs> {
  const { umi, authority, asset } = input;
  const server = serverSigner(umi, authority);
  const serverKey = server.publicKey.toString();
  const owner = createNoopSigner(asset.owner);
  const col = publicKey(input.collection);
  const st = coreState(asset);
  const payer = owner;
  const lock = lockToServer(umi, asset.publicKey, col, owner, serverKey, st);
  if ("error" in lock) return { ok: false, reason: lock.error };
  let b = transactionBuilder().add(lock);
  if (!st.transferDelegate) {
    b = b.add(addPlugin(umi, { asset: asset.publicKey, collection: col, authority: owner, payer, plugin: { type: "TransferDelegate", authority: { type: "Address", address: publicKey(serverKey) } } }));
  } else if (st.transferDelegate !== serverKey) {
    b = b.add(
      approvePluginAuthority(umi, { asset: asset.publicKey, collection: col, authority: owner, payer, plugin: { type: "TransferDelegate" }, newAuthority: { type: "Address", address: publicKey(serverKey) } }),
    );
  }
  b = b.add(updatePlugin(umi, { asset: asset.publicKey, collection: col, authority: server, payer, plugin: { type: "FreezeDelegate", frozen: true } }));
  return { ok: true, txs: [await serialize(umi, b, owner, input.blockhash, [server])] };
}

function solTransfer(from: Signer, to: string, lamports: number) {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, BigInt(lamports), true);
  return {
    instruction: {
      programId: publicKey(SYSTEM),
      keys: [
        { pubkey: from.publicKey, isSigner: true, isWritable: true },
        { pubkey: publicKey(to), isSigner: false, isWritable: true },
      ],
      data,
    },
    signers: [from],
    bytesCreatedOnChain: 0,
  };
}

export async function buildBuyTx(input: {
  umi: Umi;
  authority: Keypair;
  asset: AssetV1;
  collection: string;
  buyer: string;
  sellerLamports: number;
  royaltyLamports: number;
  treasury: string;
  blockhash: string;
}): Promise<BuiltTxs> {
  const { umi, authority, asset } = input;
  const server = serverSigner(umi, authority);
  const buyer = createNoopSigner(publicKey(input.buyer));
  const col = publicKey(input.collection);
  const st = coreState(asset);
  const serverKey = server.publicKey.toString();
  const payer = buyer;
  if (st.transferDelegate !== serverKey) return { ok: false, reason: "Продавець не передав серверу право переказу (лістинг не активний)." };
  if (!st.freeze || st.freeze.authority !== serverKey || !st.freeze.frozen) return { ok: false, reason: "NFT не заморожено під лістинг." };
  let b = transactionBuilder()
    .add(solTransfer(buyer, String(asset.owner), input.sellerLamports))
    .add(solTransfer(buyer, input.treasury, input.royaltyLamports))
    .add(updatePlugin(umi, { asset: asset.publicKey, collection: col, authority: server, payer, plugin: { type: "FreezeDelegate", frozen: false } }));
  b = b.add(transfer(umi, { asset, collection: { publicKey: col, oracles: [], lifecycleHooks: [] }, authority: server, payer, newOwner: publicKey(input.buyer) }));
  return { ok: true, txs: [await serialize(umi, b, buyer, input.blockhash, [server])] };
}

/** Server-paid: thaw and hand the freeze authority back to the owner; optionally drop the listing delegate. */
export function thawBuilder(umi: Umi, authority: Keypair, asset: AssetV1, collection: string, dropTransfer: boolean): TransactionBuilder | null {
  const server = serverSigner(umi, authority);
  const serverKey = server.publicKey.toString();
  const col = publicKey(collection);
  const st = coreState(asset);
  const payer = server;
  let b = transactionBuilder();
  if (st.freeze?.authority === serverKey) {
    if (st.freeze.frozen) b = b.add(updatePlugin(umi, { asset: asset.publicKey, collection: col, authority: server, payer, plugin: { type: "FreezeDelegate", frozen: false } }));
    b = b.add(revokePluginAuthority(umi, { asset: asset.publicKey, collection: col, authority: server, payer, plugin: { type: "FreezeDelegate" } }));
  }
  if (dropTransfer && st.transferDelegate === serverKey) {
    b = b.add(revokePluginAuthority(umi, { asset: asset.publicKey, collection: col, authority: server, payer, plugin: { type: "TransferDelegate" } }));
  }
  return b.items.length ? b : null;
}

export function perfBuilder(umi: Umi, authority: Keypair, asset: AssetV1, collection: string, attrs: Attr[]): TransactionBuilder {
  const server = serverSigner(umi, authority);
  const payer = server;
  return transactionBuilder().add(
    updatePlugin(umi, { asset: asset.publicKey, collection: publicKey(collection), authority: server, payer, plugin: { type: "Attributes", attributeList: attrs } }),
  );
}
