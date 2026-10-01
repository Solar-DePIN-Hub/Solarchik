import { FREE_CLAIM_LOCK_MS } from "./arb-rules";
import { arbStore } from "./arb-guard.server";
import { verifyProof } from "./wallet-proof.server";
import type { WalletProof } from "./wallet-proof";

/**
 * 1. The room key signed the request (proof of the wallet).
 * 2. Devnet shows no Core asset owned by that wallet with attribute tr=free.
 *    RPC failure refuses (fail closed).
 * 3. With a shared DB, a 10-minute claim lock stops two tabs racing the mint.
 *    Without one, step 2 alone decides.
 */
export async function checkFreeMint(proof: WalletProof | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!proof) return { ok: false, reason: "Немає підпису гаманця." };
  const signed = verifyProof(proof, "free-mint", "");
  if (!signed.ok) return signed;
  const store = arbStore();
  let sql: import("./guard-ledger.server").GuardSql | null = null;
  if (store !== "none") {
    try {
      const { getSql } = await import("@/lib/db");
      sql = await getSql();
    } catch {
      return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
    }
  }
  const ledger = await import("./guard-ledger.server");
  const now = Date.now();
  if (sql) {
    try {
      if (!(await ledger.spendProofOnce(sql, proof.wallet, "free-mint", proof.ts, now))) {
        return { ok: false, reason: "Цей підпис уже використано." };
      }
    } catch {
      return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
    }
  }
  try {
    const { fetchOwnedCoreAgents, isFreeTier } = await import("./core-owned.server");
    const owned = await fetchOwnedCoreAgents(proof.wallet);
    if (owned.some(isFreeTier)) return { ok: false, reason: "Безкоштовний агент уже є. Pro без комісії з прибутку." };
  } catch {
    return { ok: false, reason: "Не вдалося перевірити гаманець ончейн. Мінт не почато." };
  }
  if (sql) {
    try {
      if (!(await ledger.claimFreeLock(sql, proof.wallet, now, FREE_CLAIM_LOCK_MS))) {
        return { ok: false, reason: "Безкоштовний мінт уже йде. Зачекай 10 хв." };
      }
    } catch {
      return { ok: false, reason: "Сервер не відповів. Мінт не почато." };
    }
  }
  return { ok: true };
}
