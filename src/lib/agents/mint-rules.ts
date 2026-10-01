/** Mint entitlement rules. Pure: shared by the server, the browser and the tests. */
import { PAY_WALLET } from "../game/pay.ts";
import { PRO_PRICE_SOL } from "./fees.config.ts";
import type { ArbStore } from "./arb-rules.ts";

export const PRO_LAMPORTS = Math.round(PRO_PRICE_SOL * 1e9);

/** A Pro payment older than this is not accepted for a new mint. */
export const PRO_PAYMENT_MAX_AGE_SEC = 3 * 24 * 3600;

/** A prepared co-signed mint can be re-prepared after its blockhash is surely dead. */
export const COSIGN_SLOT_MS = 2 * 60_000;
/** Without a co-signed tx the server cannot know the asset; hold the slot longer. */
export const CLIENT_SLOT_MS = 10 * 60_000;

export type MintTier = "pro" | "free";
export type MintMode = "cosign" | "client" | "closed";

/** Memo that binds a Pro payment to the room wallet that will own the NFT. */
export function proMemo(roomWallet: string): string {
  return `solarchik-pro:${roomWallet}`;
}

/** Tier lives in the asset URI. Only the collection update authority (the server) can change it. */
export function mintUri(tier: MintTier): string {
  return `urn:solarchik:agent:${tier}`;
}

export function tierFromUri(uri: string | undefined | null): MintTier | null {
  if (!uri) return null;
  if (uri.endsWith(":free")) return "free";
  if (uri.endsWith(":pro")) return "pro";
  return null;
}

/**
 * Which mint path is allowed.
 * - Key: the server co-signs. Asset addresses are derived from the key
 *   (free: per wallet, pro: per payment signature), so Core itself refuses a
 *   second mint for the same wallet / payment. No database is needed for that.
 * - No key, vite dev: browser mint.
 * - No key on a deploy: Pro closed; Free from the browser only with a database
 *   (slot lock), otherwise closed so two tabs cannot race the on-chain check.
 */
export function mintModeFor(
  tier: MintTier,
  cfg: { hasKey: boolean; store: ArbStore; dev: boolean },
): { mode: MintMode; reason: string } {
  if (cfg.hasKey) return { mode: "cosign", reason: "Сервер підписує мінт." };
  if (cfg.dev) return { mode: "client", reason: "Dev: ключа мінту немає, мінт з браузера." };
  if (tier === "pro") {
    return { mode: "closed", reason: "Pro закрито: на сервері немає ключа мінту (MINT_AUTHORITY_SECRET). Нічого не списано." };
  }
  if (cfg.store === "none") {
    return { mode: "closed", reason: "Free закрито: на сервері немає ні ключа мінту, ні бази. Нічого не списано." };
  }
  return { mode: "client", reason: "Ключа мінту немає. Free перевіряє сервер ончейн." };
}

/** Derivation labels for deterministic asset addresses (one free per wallet, one Pro per payment). */
export function freeAssetLabel(wallet: string): string {
  return `asset:free:${wallet}`;
}
export function proAssetLabel(paySig: string): string {
  return `asset:pro:${paySig}`;
}

/** Pro payments before co-signed mints went live had no memo; they may still re-issue a legacy Pro NFT. */
export const COSIGN_LAUNCH_SEC = Math.floor(Date.UTC(2026, 9, 2) / 1000);

type ParsedIx = { program?: string; programId?: string; parsed?: unknown };
export type ParsedPaymentTx = {
  blockTime?: number | null;
  meta?: { err?: unknown } | null;
  transaction?: { message?: { instructions?: ParsedIx[] } };
} | null;

/** Checks one devnet transaction: exact Pro amount to PAY_WALLET, bound to this room wallet. */
export function checkProPaymentTx(
  tx: ParsedPaymentTx,
  roomWallet: string,
  nowSec: number,
  opts: { legacy?: boolean } = {},
): { ok: true; legacyPaidAt?: number } | { ok: false; reason: string } {
  if (!tx) return { ok: false, reason: "Оплату не знайдено на Devnet. Зачекай підтвердження і спробуй ще раз." };
  if (tx.meta?.err) return { ok: false, reason: "Оплата впала з помилкою." };
  // Re-issue of a legacy Pro NFT: a payment made before co-signing went live counts without memo or age limit.
  const legacy = Boolean(opts.legacy) && typeof tx.blockTime === "number" && tx.blockTime < COSIGN_LAUNCH_SEC;
  if (!legacy && typeof tx.blockTime !== "number") return { ok: false, reason: "Оплата ще не в блоці." };
  if (!legacy && typeof tx.blockTime === "number" && nowSec - tx.blockTime > PRO_PAYMENT_MAX_AGE_SEC) {
    return { ok: false, reason: "Оплата застара для нового мінту." };
  }
  const ixs = tx.transaction?.message?.instructions ?? [];
  let source = "";
  const paid = ixs.some((ix) => {
    if (ix.program !== "system") return false;
    const p = ix.parsed as { type?: string; info?: { destination?: string; lamports?: number; source?: string } } | undefined;
    if (p?.type !== "transfer" || p.info?.destination !== PAY_WALLET || Number(p.info?.lamports) !== PRO_LAMPORTS) return false;
    source = p.info?.source ?? "";
    return true;
  });
  if (!paid) return { ok: false, reason: `У транзакції немає переказу ${PRO_PRICE_SOL} SOL на казну.` };
  const memo = proMemo(roomWallet);
  const bound =
    source === roomWallet ||
    ixs.some((ix) => (ix.program === "spl-memo" || ix.programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") && ix.parsed === memo);
  if (!bound && !legacy) return { ok: false, reason: "Оплата не прив'язана до цього гаманця кімнати." };
  // Unbound legacy payment (old flow paid from Phantom/MWA): the caller must tie it to the old NFT by time.
  if (!bound && legacy) return { ok: true, legacyPaidAt: tx.blockTime as number };
  return { ok: true };
}

/** Old flow: pay, then mint right away. An unbound legacy payment only counts for an NFT minted soon after it. */
export const LEGACY_MINT_WINDOW_SEC = 30 * 60;

export function legacyMintFitsPayment(paidAtSec: number, mintedAtSec: number | null): boolean {
  if (mintedAtSec == null || !Number.isFinite(mintedAtSec)) return false;
  return mintedAtSec >= paidAtSec - 60 && mintedAtSec <= paidAtSec + LEGACY_MINT_WINDOW_SEC;
}
