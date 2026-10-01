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

export function mintModeFor(
  tier: MintTier,
  cfg: { hasKey: boolean; store: ArbStore; dev: boolean },
): { mode: MintMode; reason: string } {
  if (cfg.hasKey) {
    if (tier === "pro" && cfg.store === "none") {
      return { mode: "closed", reason: "Pro закрито: на сервері немає бази (DATABASE_URL) для перевірки оплати. Нічого не списано." };
    }
    return { mode: "cosign", reason: "Сервер підписує мінт." };
  }
  if (cfg.dev) return { mode: "client", reason: "Dev: ключа мінту немає, мінт з браузера." };
  if (tier === "pro") {
    return { mode: "closed", reason: "Pro закрито: на сервері немає ключа мінту (MINT_AUTHORITY_SECRET). Нічого не списано." };
  }
  return { mode: "client", reason: "Ключа мінту немає. Free перевіряє сервер ончейн." };
}

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
): { ok: true } | { ok: false; reason: string } {
  if (!tx) return { ok: false, reason: "Оплату не знайдено на Devnet. Зачекай підтвердження і спробуй ще раз." };
  if (tx.meta?.err) return { ok: false, reason: "Оплата впала з помилкою." };
  if (typeof tx.blockTime === "number" && nowSec - tx.blockTime > PRO_PAYMENT_MAX_AGE_SEC) {
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
  if (!bound) return { ok: false, reason: "Оплата не прив'язана до цього гаманця кімнати." };
  return { ok: true };
}
