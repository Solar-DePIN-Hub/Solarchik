import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createNoopSigner, createSignerFromKeypair, publicKey, signTransaction, type Signer, type Umi } from "@metaplex-foundation/umi";
import { create, createCollection } from "@metaplex-foundation/mpl-core";
import type { Keypair } from "@solana/web3.js";
import { liveCatalog } from "./catalog";
import { attrList } from "./core-attrs";
import { mergeAttrs, specAttrs, specFromStrategy, unlockSecFor } from "./strategy-spec";
import { ROYALTY_BPS } from "./fees.config";
import { PAY_WALLET } from "@/lib/game/pay";
import { COLLECTION_NAME, type AgentNft } from "./types";
import { arbStore } from "./arb-guard.server";
import { verifyProof } from "./wallet-proof.server";
import type { WalletProof } from "./wallet-proof";
import { derivedKeypair } from "./secret-key.server";
import { mintAuthority, serverCollectionKeypair } from "./mint-authority.server";
import {
  CLIENT_SLOT_MS,
  checkProPaymentTx,
  freeAssetLabel,
  legacyMintFitsPayment,
  mintModeFor,
  mintUri,
  proAssetLabel,
  type MintMode,
  type MintTier,
  type ParsedPaymentTx,
} from "./mint-rules";
import type { GuardSql } from "./guard-ledger.server";

/**
 * Server side of the strategy-NFT mint.
 * With MINT_AUTHORITY_SECRET the server builds the whole Core transaction:
 * the asset joins the server collection, whose update authority is that key,
 * so Core refuses the mint without the server signature. The browser only
 * adds the payer signature; any change breaks the server signatures.
 * Tier is written to the URI, which only the server can change.
 * Asset addresses are derived from the server key: one per wallet for Free,
 * one per payment signature for Pro. Core refuses to create an account that
 * exists, so a second mint for the same wallet/payment fails on-chain even
 * without a database or when two requests race.
 */

const PUBLIC_DEVNET = "https://api.devnet.solana.com";
const TREASURY = PAY_WALLET;

function devnetUrl(): string {
  return (process.env.SOLANA_RPC_DEVNET || "").trim() || PUBLIC_DEVNET;
}

export type MintStatus = {
  pro: { mode: MintMode; reason: string };
  free: { mode: MintMode; reason: string };
  authority: string | null;
  collection: string | null;
};

export function mintStatusOnServer(): MintStatus {
  const key = mintAuthority();
  const cfg = { hasKey: key !== null, store: arbStore(), dev: Boolean(import.meta.env.DEV) };
  return {
    pro: mintModeFor("pro", cfg),
    free: mintModeFor("free", cfg),
    authority: key ? key.publicKey.toBase58() : null,
    collection: key ? serverCollectionKeypair(key).publicKey.toBase58() : null,
  };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(devnetUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "rpc error");
  return body.result as T;
}

async function accountExists(address: string): Promise<boolean> {
  const res = await rpc<{ value: unknown | null }>("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }]);
  return Boolean(res?.value);
}

export type PrepareMintResult =
  | { ok: true; mode: "client"; tier: MintTier }
  | { ok: true; mode: "cosign"; tier: MintTier; asset: string; collection: string; txs: string[] }
  | { ok: false; reason: string };

type Attr = { key: string; value: string };

async function openSql(): Promise<GuardSql | null | "down"> {
  if (arbStore() === "none") return null;
  try {
    const { getSql } = await import("@/lib/db");
    return await getSql();
  } catch {
    return "down";
  }
}

async function verifyProPayment(
  paySig: string,
  wallet: string,
  legacy: boolean,
): Promise<{ ok: true; legacyPaidAt?: number } | { ok: false; reason: string }> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(paySig)) return { ok: false, reason: "Немає підпису оплати Pro." };
  try {
    const tx = await rpc<ParsedPaymentTx>("getTransaction", [
      paySig,
      { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
    return checkProPaymentTx(tx, wallet, Math.floor(Date.now() / 1000), { legacy });
  } catch {
    return { ok: false, reason: "Не вдалося перевірити оплату на Devnet. Спробуй ще раз." };
  }
}

/** Block time of the oldest known transaction on an account (its creation for a Core asset). Null when unknown. */
async function firstSeenSec(account: string): Promise<number | null> {
  try {
    let before: string | undefined;
    let oldest: { blockTime?: number | null; signature: string } | undefined;
    for (let page = 0; page < 5; page++) {
      const rows = await rpc<{ signature: string; blockTime?: number | null }[]>("getSignaturesForAddress", [
        account,
        { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) },
      ]);
      if (!Array.isArray(rows) || !rows.length) break;
      oldest = rows[rows.length - 1];
      if (rows.length < 1000) break;
      before = oldest.signature;
    }
    return typeof oldest?.blockTime === "number" ? oldest.blockTime : null;
  } catch {
    return null;
  }
}

/** One Free per wallet on-chain: any owned free-tier agent (server URI or legacy attribute) refuses. */
async function freeAlreadyOwned(wallet: string, except = ""): Promise<boolean> {
  const core = await import("./core-owned.server");
  const owned = await core.fetchOwnedCoreAgents(wallet);
  return owned.some((a) => a.asset !== except && core.isFreeTier(a));
}

/** Attributes of a fresh co-signed mint: catalog stats + the on-chain strategy v1 (sale lock from now). */
export function mintAttributes(draft: AgentNft, nowMs: number): Attr[] {
  const nowSec = Math.floor(nowMs / 1000);
  const spec = specFromStrategy({ ...draft.strategy.prediction, risk: draft.brief?.risk });
  return mergeAttrs(attrList(draft), specAttrs(spec, { version: 1, changedSec: nowSec, unlockSec: unlockSecFor(nowSec) }));
}

/** Builds the co-signed Core mint (and the one-time collection setup) for the room wallet to pay. */
export async function buildCosigned(input: {
  rpcUrl?: string;
  authority: Keypair;
  wallet: string;
  tier: MintTier;
  assetKey: Keypair;
  name: string;
  attributes: Attr[];
}): Promise<{ ok: true; asset: string; collection: string; txs: string[] } | { ok: false; reason: string }> {
  const { authority, wallet, tier, assetKey } = input;
  const umi: Umi = createUmi(input.rpcUrl ?? devnetUrl());
  const serverSigner = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(authority.secretKey));
  const colKp = serverCollectionKeypair(authority);
  const colSigner = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(colKp.secretKey));
  const asset = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(assetKey.secretKey));
  const payer: Signer = createNoopSigner(publicKey(wallet));
  try {
    if (await accountExists(assetKey.publicKey.toBase58())) {
      return { ok: false, reason: tier === "free" ? "Безкоштовний агент уже є." : "Цю оплату вже використано." };
    }
    const blockhash = await umi.rpc.getLatestBlockhash({ commitment: "confirmed" });
    const txs: string[] = [];
    if (!(await accountExists(colKp.publicKey.toBase58()))) {
      const setup = createCollection(umi, {
        collection: colSigner,
        name: COLLECTION_NAME,
        uri: "urn:solarchik:collection",
        updateAuthority: serverSigner.publicKey,
        payer,
      })
        .setFeePayer(payer)
        .setBlockhash(blockhash);
      txs.push(await serialize(umi, setup.build(umi), [colSigner]));
    }
    const mint = create(umi, {
      asset,
      collection: { publicKey: colSigner.publicKey },
      authority: serverSigner,
      payer,
      owner: publicKey(wallet),
      name: input.name.slice(0, 32),
      uri: mintUri(tier),
      plugins: [
        // Strategy + results are written only by the server (collection update authority).
        { type: "Attributes", attributeList: input.attributes, authority: { type: "UpdateAuthority" } },
        {
          type: "Royalties",
          basisPoints: ROYALTY_BPS,
          creators: [{ address: publicKey(TREASURY), percentage: 100 }],
          ruleSet: { type: "None" },
        },
        // Sale lock: frozen under the server until the 240 h after the strategy was set.
        { type: "FreezeDelegate", frozen: true, authority: { type: "Address", address: serverSigner.publicKey } },
      ],
    })
      .setFeePayer(payer)
      .setBlockhash(blockhash);
    txs.push(await serialize(umi, mint.build(umi), [serverSigner, asset]));
    return { ok: true, asset: assetKey.publicKey.toBase58(), collection: colKp.publicKey.toBase58(), txs };
  } catch (error) {
    return { ok: false, reason: `Сервер не зібрав мінт: ${error instanceof Error ? error.message.slice(0, 120) : "помилка"}` };
  }
}

export async function prepareMintOnServer(input: { proof: WalletProof | null; skuId: string; paySig: string }): Promise<PrepareMintResult> {
  const { proof, skuId, paySig } = input;
  if (!proof) return { ok: false, reason: "Немає підпису гаманця." };
  const signed = verifyProof(proof, "mint", `${skuId}:${paySig}`);
  if (!signed.ok) return signed;
  const wallet = proof.wallet;
  const sku = liveCatalog().find((s) => s.id === skuId);
  if (!sku) return { ok: false, reason: "Немає такого агента." };
  const tier: MintTier = sku.nft.tier === "free" ? "free" : "pro";
  const authority = mintAuthority();
  const decided = mintModeFor(tier, { hasKey: authority !== null, store: arbStore(), dev: Boolean(import.meta.env.DEV) });
  if (decided.mode === "closed") return { ok: false, reason: decided.reason };

  const sql = await openSql();
  if (sql === "down") return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
  const ledger = await import("./guard-ledger.server");
  const now = Date.now();
  if (sql) {
    try {
      if (!(await ledger.spendProofOnce(sql, wallet, "mint", proof.ts, now))) return { ok: false, reason: "Цей підпис уже використано." };
    } catch {
      return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
    }
  }

  if (tier === "free") {
    try {
      if (await freeAlreadyOwned(wallet)) return { ok: false, reason: "Безкоштовний агент уже є. Pro без комісії з прибутку." };
    } catch {
      return { ok: false, reason: "Не вдалося перевірити гаманець ончейн. Мінт не почато." };
    }
  } else {
    const paid = await verifyProPayment(paySig, wallet, false);
    if (!paid.ok) return paid;
  }

  if (decided.mode === "client" || !authority) {
    // Browser mint (dev, or Free on a deploy with a database): short slot lock against two tabs.
    if (sql) {
      try {
        const slot = await ledger.claimMintSlot(
          sql,
          { kind: tier, key: tier === "pro" ? paySig : wallet, wallet, asset: "", now, holdMs: CLIENT_SLOT_MS },
          async () => false,
        );
        if (!slot.ok) return slot;
      } catch {
        return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
      }
    }
    return { ok: true, mode: "client", tier };
  }

  const draft: AgentNft = {
    ...sku.nft,
    tier,
    asset: "",
    owner: wallet,
    mintedAt: now,
    updatedAt: now,
    track: "live",
    graduated: false,
    metrics: { ...sku.nft.metrics, workedSec: 0, aprPct: null },
  };
  const assetKey = derivedKeypair(authority, tier === "free" ? freeAssetLabel(wallet) : proAssetLabel(paySig));
  const attributes = mintAttributes(draft, now);
  const built = await buildCosigned({ authority, wallet, tier, assetKey, name: draft.name, attributes });
  if (!built.ok) return built;
  return { ok: true, mode: "cosign", tier, asset: built.asset, collection: built.collection, txs: built.txs };
}

export type PrepareReissueResult =
  | { ok: true; tier: MintTier; asset: string; collection: string; txs: string[] }
  | { ok: false; reason: string };

/**
 * Migration for agents minted before co-signing (they live in per-room collections
 * where the owner can edit everything). The server mints a new co-signed copy into
 * its collection with the same name, class, strategy and stats; the browser then
 * burns the old one. Tier: Free by default (one per wallet, old asset excluded), or
 * Pro with a Pro payment (bound as for a new mint, or any payment made before co-signing
 * went live). The derived asset address makes every wallet/payment usable once.
 */
export async function prepareReissueOnServer(input: { proof: WalletProof | null; oldAsset: string; paySig: string }): Promise<PrepareReissueResult> {
  const { proof, oldAsset, paySig } = input;
  if (!proof) return { ok: false, reason: "Немає підпису гаманця." };
  const signed = verifyProof(proof, "reissue", `${oldAsset}:${paySig}`);
  if (!signed.ok) return signed;
  const authority = mintAuthority();
  if (!authority) return { ok: false, reason: "Перенос закрито: на сервері немає ключа мінту." };
  const wallet = proof.wallet;
  const sql = await openSql();
  if (sql === "down") return { ok: false, reason: "Сервер не відповів." };
  if (sql) {
    try {
      const { spendProofOnce } = await import("./guard-ledger.server");
      if (!(await spendProofOnce(sql, wallet, "reissue", proof.ts, Date.now()))) return { ok: false, reason: "Цей підпис уже використано." };
    } catch {
      return { ok: false, reason: "Сервер не відповів." };
    }
  }
  const core = await import("./core-owned.server");
  const collection = serverCollectionKeypair(authority).publicKey.toBase58();
  let old: Awaited<ReturnType<typeof core.fetchCoreAgent>>;
  try {
    old = await core.fetchCoreAgent(oldAsset);
  } catch {
    return { ok: false, reason: "Не вдалося прочитати NFT ончейн." };
  }
  if (!old || old.owner !== wallet) return { ok: false, reason: "Цей NFT не в твоєму гаманці." };
  if (old.collection === collection) return { ok: false, reason: "Цей NFT уже в колекції сервера." };
  if (!old.attrs.has("class")) return { ok: false, reason: "Це не агент Solarchik." };

  const tier: MintTier = paySig ? "pro" : "free";
  if (tier === "pro") {
    const paid = await verifyProPayment(paySig, wallet, true);
    if (!paid.ok) return paid;
    if (paid.legacyPaidAt != null) {
      const mintedAt = await firstSeenSec(oldAsset);
      if (!legacyMintFitsPayment(paid.legacyPaidAt, mintedAt)) {
        return { ok: false, reason: "Ця оплата не схожа на оплату саме цього NFT (мінт мав бути до 30 хв після оплати)." };
      }
    }
  } else {
    try {
      if (await freeAlreadyOwned(wallet, oldAsset)) {
        return { ok: false, reason: "Безкоштовний агент уже є. Для Pro додай підпис оплати Pro." };
      }
    } catch {
      return { ok: false, reason: "Не вдалося перевірити гаманець ончейн." };
    }
  }
  const attributes: Attr[] = [...old.attrs.entries()]
    .filter(([key]) => key !== "tr")
    .map(([key, value]) => ({ key, value }))
    .concat([{ key: "tr", value: tier }]);
  const assetKey = derivedKeypair(authority, tier === "free" ? freeAssetLabel(wallet) : proAssetLabel(paySig));
  const built = await buildCosigned({ authority, wallet, tier, assetKey, name: old.name || "Solarchik agent", attributes });
  if (!built.ok) return built;
  if (sql) {
    try {
      const { linkReissuedAsset } = await import("./guard-ledger.server");
      await linkReissuedAsset(sql, { newAsset: built.asset, oldAsset, wallet, now: Date.now() });
    } catch {
      return { ok: false, reason: "Сервер не відповів." };
    }
  }
  return { ok: true, tier, asset: built.asset, collection: built.collection, txs: built.txs };
}

async function serialize(umi: Umi, tx: Parameters<typeof signTransaction>[0], signers: Signer[]): Promise<string> {
  const signedTx = await signTransaction(tx, signers);
  return Buffer.from(umi.transactions.serialize(signedTx)).toString("base64");
}
