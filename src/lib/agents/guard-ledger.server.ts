import type { Sql } from "../db.ts";
import { solToLamports, utcDay, type ArbLimits } from "./arb-rules.ts";

/** Only `.query` is used so tests can pass a bare PGLite adapter. */
export type GuardSql = Pick<Sql, "query">;

export type Reservation = {
  mode: "mainnet" | "sim";
  wallet: string;
  day: string;
  lamports: number;
  fireId: number | null;
};

/** Single-use proof. False on replay. Old rows are pruned on the way. */
export async function spendProofOnce(sql: GuardSql, wallet: string, action: string, ts: number, now: number): Promise<boolean> {
  await sql.query("delete from wallet_proofs where created_ms < $1", [now - 86_400_000]);
  const rows = await sql.query<{ ok: number }>(
    "insert into wallet_proofs (wallet, action, ts, created_ms) values ($1, $2, $3, $4) on conflict do nothing returning 1 as ok",
    [wallet, action, ts, now],
  );
  return rows.length > 0;
}

/**
 * Atomically book one fire against the wallet's day and the global day.
 * Each step is one upsert whose WHERE runs under the row lock, so two
 * instances can never both pass the same cap. A global refusal refunds the wallet.
 */
export async function reserveArb(
  sql: GuardSql,
  input: { mode: "mainnet" | "sim"; wallet: string; asset: string; symbol: string; dir: string; sol: number; limits: ArbLimits; now: number },
): Promise<{ ok: true; reservation: Reservation } | { ok: false; reason: string }> {
  const { mode, wallet, limits, now } = input;
  const day = utcDay(now);
  const lamports = solToLamports(input.sol);
  if (!(lamports > 0)) return { ok: false, reason: "Порожня угода." };
  if (lamports > solToLamports(limits.walletDayCapSol) || lamports > solToLamports(limits.dayCapSol)) {
    return { ok: false, reason: "Угода більша за денний ліміт каси." };
  }
  const walletRows = await sql.query<{ spent: number }>(
    `insert into arb_wallet_day as w (mode, wallet, day, spent_lamports, fires, last_ms)
     values ($1, $2, $3, $4, 1, $5)
     on conflict (mode, wallet, day) do update
       set spent_lamports = w.spent_lamports + excluded.spent_lamports,
           fires = w.fires + 1,
           last_ms = excluded.last_ms
       where w.spent_lamports + excluded.spent_lamports <= $6
         and w.fires + 1 <= $7
         and w.last_ms <= excluded.last_ms - $8
     returning w.spent_lamports::float8 as spent`,
    [mode, wallet, day, lamports, now, solToLamports(limits.walletDayCapSol), limits.walletDayFires, limits.walletGapMs],
  );
  if (!walletRows.length) return { ok: false, reason: "Ліміт гаманця: зачекай 30 с або до завтра (UTC)." };
  const dayRows = await sql.query<{ spent: number }>(
    `insert into arb_day as d (mode, day, spent_lamports, fires, last_ms)
     values ($1, $2, $3, 1, $4)
     on conflict (mode, day) do update
       set spent_lamports = d.spent_lamports + excluded.spent_lamports,
           fires = d.fires + 1,
           last_ms = excluded.last_ms
       where d.spent_lamports + excluded.spent_lamports <= $5
         and d.last_ms <= excluded.last_ms - $6
     returning d.spent_lamports::float8 as spent`,
    [mode, day, lamports, now, solToLamports(limits.dayCapSol), limits.minGapMs],
  );
  if (!dayRows.length) {
    await refundWallet(sql, mode, wallet, day, lamports);
    return { ok: false, reason: "Ліміт каси: зачекай 30 с або денний ліміт вичерпано." };
  }
  let fireId: number | null = null;
  try {
    const rows = await sql.query<{ id: number }>(
      `insert into arb_fires (mode, wallet, asset, symbol, dir, size_lamports, status, created_ms, updated_ms)
       values ($1, $2, $3, $4, $5, $6, 'reserved', $7, $7) returning id::float8 as id`,
      [mode, wallet, input.asset.slice(0, 64), input.symbol.slice(0, 16), input.dir.slice(0, 2), lamports, now],
    );
    fireId = rows[0]?.id ?? null;
  } catch {
    fireId = null;
  }
  return { ok: true, reservation: { mode, wallet, day, lamports, fireId } };
}

async function refundWallet(sql: GuardSql, mode: string, wallet: string, day: string, lamports: number) {
  await sql.query(
    `update arb_wallet_day set spent_lamports = greatest(0, spent_lamports - $4), fires = greatest(0, fires - 1)
     where mode = $1 and wallet = $2 and day = $3`,
    [mode, wallet, day, lamports],
  );
}

/**
 * Close a reservation. A clean miss gives the amount back (spacing stays).
 * "ok" and "broken" keep it booked. Never throws: a fire that already
 * happened must not turn into an error here.
 */
export async function settleArb(
  sql: GuardSql,
  reservation: Reservation,
  status: "ok" | "broken" | "failed",
  detail: string,
  now: number,
): Promise<void> {
  try {
    if (status === "failed") {
      await refundWallet(sql, reservation.mode, reservation.wallet, reservation.day, reservation.lamports);
      await sql.query(
        `update arb_day set spent_lamports = greatest(0, spent_lamports - $3), fires = greatest(0, fires - 1)
         where mode = $1 and day = $2`,
        [reservation.mode, reservation.day, reservation.lamports],
      );
    }
    if (reservation.fireId != null) {
      await sql.query("update arb_fires set status = $2, detail = $3, updated_ms = $4 where id = $1", [
        reservation.fireId,
        status,
        detail.slice(0, 200),
        now,
      ]);
    }
  } catch (error) {
    console.error("[arb-guard] settle failed", error instanceof Error ? error.message : error);
  }
}

/**
 * One entitlement slot: free per wallet, or one Pro payment signature.
 * First use inserts. A later use by the same wallet is allowed only when the
 * earlier prepared asset never landed on-chain and the hold time passed.
 * Another wallet can never take a slot.
 */
export async function claimMintSlot(
  sql: GuardSql,
  input: { kind: "free" | "pro"; key: string; wallet: string; asset: string; now: number; holdMs: number },
  assetLanded: (asset: string) => Promise<boolean>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { kind, key, wallet, asset, now, holdMs } = input;
  const inserted = await sql.query(
    `insert into mint_claims (kind, key, wallet, asset, prepared_ms) values ($1, $2, $3, $4, $5)
     on conflict do nothing returning 1 as ok`,
    [kind, key, wallet, asset, now],
  );
  if (inserted.length) return { ok: true };
  const rows = await sql.query<{ wallet: string; asset: string; prepared_ms: number }>(
    "select wallet, asset, prepared_ms::float8 as prepared_ms from mint_claims where kind = $1 and key = $2",
    [kind, key],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: "Спробуй ще раз." };
  const used = kind === "pro" ? "Цю оплату вже використано." : "Безкоштовний агент уже є.";
  if (row.wallet !== wallet) return { ok: false, reason: used };
  if (row.asset && (await assetLanded(row.asset))) return { ok: false, reason: used };
  if (now - row.prepared_ms < holdMs) return { ok: false, reason: "Попередній мінт ще йде. Зачекай 2–10 хв." };
  const updated = await sql.query(
    `update mint_claims set asset = $4, prepared_ms = $5
     where kind = $1 and key = $2 and wallet = $3 and prepared_ms = $6 returning 1 as ok`,
    [kind, key, wallet, asset, now, row.prepared_ms],
  );
  return updated.length ? { ok: true } : { ok: false, reason: "Спробуй ще раз." };
}
