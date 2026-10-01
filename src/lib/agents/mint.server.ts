import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createNoopSigner, createSignerFromKeypair, generateSigner, publicKey, signTransaction, type Signer, type Umi } from "@metaplex-foundation/umi";
import { create, createCollection } from "@metaplex-foundation/mpl-core";
import { liveCatalog } from "./catalog";
import { attrList } from "./core-attrs";
import { ROYALTY_BPS } from "./fees.config";
import { PAY_WALLET } from "@/lib/game/pay";
import { COLLECTION_NAME, type AgentNft } from "./types";
import { arbStore } from "./arb-guard.server";
import { verifyProof } from "./wallet-proof.server";
import type { WalletProof } from "./wallet-proof";
import { derivedKeypair, keypairFromText } from "./secret-key.server";
import {
  CLIENT_SLOT_MS,
  COSIGN_SLOT_MS,
  checkProPaymentTx,
  mintModeFor,
  mintUri,
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
 */

const PUBLIC_DEVNET = "https://api.devnet.solana.com";
const TREASURY = PAY_WALLET;

function devnetUrl(): string {
  return (process.env.SOLANA_RPC_DEVNET || "").trim() || PUBLIC_DEVNET;
}

function mintAuthority() {
  return keypairFromText(process.env.MINT_AUTHORITY_SECRET);
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
    collection: key ? derivedKeypair(key, "mint-collection").publicKey.toBase58() : null,
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
  const store = arbStore();
  const decided = mintModeFor(tier, { hasKey: authority !== null, store, dev: Boolean(import.meta.env.DEV) });
  if (decided.mode === "closed") return { ok: false, reason: decided.reason };

  let sql: GuardSql | null = null;
  if (store !== "none") {
    try {
      const { getSql } = await import("@/lib/db");
      sql = await getSql();
    } catch {
      return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
    }
  }
  if (tier === "pro" && !sql) return { ok: false, reason: "Pro закрито: немає бази для перевірки оплати. Нічого не списано." };
  const ledger = await import("./guard-ledger.server");
  const now = Date.now();
  if (sql) {
    try {
      if (!(await ledger.spendProofOnce(sql, wallet, "mint", proof.ts, now))) return { ok: false, reason: "Цей підпис уже використано." };
    } catch {
      return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
    }
  }

  const core = await import("./core-owned.server");
  if (tier === "free") {
    try {
      const owned = await core.fetchOwnedCoreAgents(wallet);
      if (owned.some(core.isFreeTier)) return { ok: false, reason: "Безкоштовний агент уже є. Pro без комісії з прибутку." };
    } catch {
      return { ok: false, reason: "Не вдалося перевірити гаманець ончейн. Мінт не почато." };
    }
  } else {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(paySig)) return { ok: false, reason: "Немає підпису оплати Pro." };
    try {
      const tx = await rpc<ParsedPaymentTx>("getTransaction", [
        paySig,
        { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      const paid = checkProPaymentTx(tx, wallet, Math.floor(now / 1000));
      if (!paid.ok) return paid;
    } catch {
      return { ok: false, reason: "Не вдалося перевірити оплату на Devnet. Спробуй ще раз." };
    }
  }

  const landed = async (asset: string) => {
    try {
      return await accountExists(asset);
    } catch {
      return true; // cannot tell: treat as used (fail closed)
    }
  };

  if (decided.mode === "client" || !authority) {
    if (sql) {
      try {
        const slot = await ledger.claimMintSlot(
          sql,
          { kind: tier, key: tier === "pro" ? paySig : wallet, wallet, asset: "", now, holdMs: CLIENT_SLOT_MS },
          landed,
        );
        if (!slot.ok) return slot;
      } catch {
        return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
      }
    }
    return { ok: true, mode: "client", tier };
  }

  const umi: Umi = createUmi(devnetUrl());
  const serverSigner = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(authority.secretKey));
  const colKp = derivedKeypair(authority, "mint-collection");
  const colSigner = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(colKp.secretKey));
  const payer: Signer = createNoopSigner(publicKey(wallet));
  const asset = generateSigner(umi);

  if (sql) {
    try {
      const slot = await ledger.claimMintSlot(
        sql,
        { kind: tier, key: tier === "pro" ? paySig : wallet, wallet, asset: asset.publicKey.toString(), now, holdMs: COSIGN_SLOT_MS },
        landed,
      );
      if (!slot.ok) return slot;
    } catch {
      return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
    }
  }

  try {
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
      name: draft.name.slice(0, 32),
      uri: mintUri(tier),
      plugins: [
        // Owner keeps updating stats as before; tier truth is the URI.
        { type: "Attributes", attributeList: attrList(draft), authority: { type: "Owner" } },
        {
          type: "Royalties",
          basisPoints: ROYALTY_BPS,
          creators: [{ address: publicKey(TREASURY), percentage: 100 }],
          ruleSet: { type: "None" },
        },
        { type: "FreezeDelegate", frozen: true },
      ],
    })
      .setFeePayer(payer)
      .setBlockhash(blockhash);
    txs.push(await serialize(umi, mint.build(umi), [serverSigner, asset]));
    return { ok: true, mode: "cosign", tier, asset: asset.publicKey.toString(), collection: colSigner.publicKey.toString(), txs };
  } catch (error) {
    return { ok: false, reason: `Сервер не зібрав мінт: ${error instanceof Error ? error.message.slice(0, 120) : "помилка"}` };
  }
}

async function serialize(umi: Umi, tx: Parameters<typeof signTransaction>[0], signers: Signer[]): Promise<string> {
  const signedTx = await signTransaction(tx, signers);
  return Buffer.from(umi.transactions.serialize(signedTx)).toString("base64");
}
