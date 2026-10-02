/**
 * Postgres side of Strategy NFTs: signed versions, listings, sales, results input.
 * No network: the chain reads/writes live in strategy.server.ts. Tests run on PGLite.
 */
import type { GuardSql } from "./guard-ledger.server.ts";
import type { ClosedTrade, StrategySpec } from "./strategy-spec.ts";

const n = (v: unknown) => Number(v ?? 0);

export type Listing = {
  asset: string;
  seller: string;
  priceLamports: number;
  specHash: string;
  status: "pending" | "active" | "sold" | "cancelled";
  listedMs: number;
  buyer: string | null;
  soldSig: string | null;
};

type ListingRow = {
  asset: string;
  seller: string;
  price_lamports: string | number;
  spec_hash: string;
  status: string;
  listed_ms: string | number;
  buyer: string | null;
  sold_sig: string | null;
};

function listingOf(r: ListingRow): Listing {
  return {
    asset: r.asset,
    seller: r.seller,
    priceLamports: n(r.price_lamports),
    specHash: r.spec_hash,
    status: (["pending", "active", "sold", "cancelled"].includes(r.status) ? r.status : "cancelled") as Listing["status"],
    listedMs: n(r.listed_ms),
    buyer: r.buyer,
    soldSig: r.sold_sig,
  };
}

export async function recordPendingVersion(
  sql: GuardSql,
  v: { asset: string; version: number; owner: string; hash: string; spec: StrategySpec; changedMs: number; unlockMs: number },
): Promise<void> {
  await sql.query(
    `insert into strategy_versions (asset, version, owner, hash, spec, changed_ms, unlock_ms, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'pending')
     on conflict (asset, version) do update set owner = excluded.owner, hash = excluded.hash, spec = excluded.spec,
       changed_ms = excluded.changed_ms, unlock_ms = excluded.unlock_ms
     where strategy_versions.status = 'pending'`,
    [v.asset, v.version, v.owner, v.hash, JSON.stringify(v.spec), v.changedMs, v.unlockMs],
  );
}

/** Marks the version the chain now shows as confirmed. False when the server never signed that hash. */
export async function confirmVersion(sql: GuardSql, asset: string, version: number, hash: string, sig: string): Promise<boolean> {
  const rows = await sql.query<{ ok: number }>(
    `update strategy_versions set status = 'confirmed', sig = coalesce($4, sig)
     where asset = $1 and version = $2 and hash = $3 returning 1 as ok`,
    [asset, version, hash, sig || null],
  );
  return rows.length > 0;
}

export async function versionsOf(sql: GuardSql, asset: string): Promise<{ version: number; hash: string; changedMs: number; status: string; sig: string | null }[]> {
  const rows = await sql.query<{ version: number; hash: string; changed_ms: string; status: string; sig: string | null }>(
    "select version, hash, changed_ms, status, sig from strategy_versions where asset = $1 order by version",
    [asset],
  );
  return rows.map((r) => ({ version: n(r.version), hash: r.hash, changedMs: n(r.changed_ms), status: r.status, sig: r.sig }));
}

export async function listingOfAsset(sql: GuardSql, asset: string): Promise<Listing | null> {
  const rows = await sql.query<ListingRow>("select * from strategy_listings where asset = $1", [asset]);
  return rows[0] ? listingOf(rows[0]) : null;
}

/** Pending listing (until the chain shows the escrow). Refuses an asset that is already listed by someone else. */
export async function upsertListing(
  sql: GuardSql,
  l: { asset: string; seller: string; priceLamports: number; specHash: string; now: number },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const prior = await listingOfAsset(sql, l.asset);
  if (prior && prior.status === "active" && prior.seller !== l.seller) return { ok: false, reason: "Цей NFT уже виставив інший власник." };
  await sql.query(
    `insert into strategy_listings (asset, seller, price_lamports, spec_hash, status, listed_ms, updated_ms)
     values ($1, $2, $3, $4, 'pending', $5, $5)
     on conflict (asset) do update set seller = excluded.seller, price_lamports = excluded.price_lamports,
       spec_hash = excluded.spec_hash, status = 'pending', listed_ms = excluded.listed_ms, updated_ms = excluded.updated_ms,
       buyer = null, sold_sig = null, sold_ms = null`,
    [l.asset, l.seller, l.priceLamports, l.specHash, l.now],
  );
  return { ok: true };
}

export async function setListingStatus(sql: GuardSql, asset: string, from: Listing["status"][], to: Listing["status"], now: number): Promise<boolean> {
  const rows = await sql.query<{ ok: number }>(
    "update strategy_listings set status = $2, updated_ms = $3 where asset = $1 and status = any($4) returning 1 as ok",
    [asset, to, now, from],
  );
  return rows.length > 0;
}

export async function markSold(
  sql: GuardSql,
  s: { asset: string; buyer: string; sig: string; priceLamports: number; royaltyLamports: number; seller: string; now: number },
): Promise<boolean> {
  const rows = await sql.query<{ ok: number }>(
    `update strategy_listings set status = 'sold', buyer = $2, sold_sig = $3, sold_ms = $4, updated_ms = $4
     where asset = $1 and status = 'active' returning 1 as ok`,
    [s.asset, s.buyer, s.sig, s.now],
  );
  if (!rows.length) return false;
  await sql.query(
    `insert into strategy_sales (sig, asset, seller, buyer, price_lamports, royalty_lamports, sold_ms)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (sig) do nothing`,
    [s.sig, s.asset, s.seller, s.buyer, s.priceLamports, s.royaltyLamports, s.now],
  );
  return true;
}

export async function activeListings(sql: GuardSql, limit = 50): Promise<Listing[]> {
  const rows = await sql.query<ListingRow>("select * from strategy_listings where status = 'active' order by listed_ms desc limit $1", [limit]);
  return rows.map(listingOf);
}

export async function salesOf(sql: GuardSql, asset: string): Promise<{ sig: string; buyer: string; seller: string; priceLamports: number; soldMs: number }[]> {
  const rows = await sql.query<{ sig: string; buyer: string; seller: string; price_lamports: string; sold_ms: string }>(
    "select sig, buyer, seller, price_lamports, sold_ms from strategy_sales where asset = $1 order by sold_ms",
    [asset],
  );
  return rows.map((r) => ({ sig: r.sig, buyer: r.buyer, seller: r.seller, priceLamports: n(r.price_lamports), soldMs: n(r.sold_ms) }));
}

/** Closed server positions of an asset (any owner): input of the results written on chain. */
export async function closedTradesOf(sql: GuardSql, asset: string): Promise<ClosedTrade[]> {
  const rows = await sql.query<{ opened_ms: string; closed_ms: string; stake_lamports: string; pnl_lamports: string }>(
    "select opened_ms, closed_ms, stake_lamports, pnl_lamports from agent_positions where asset = $1 and status = 'closed' order by closed_ms",
    [asset],
  );
  return rows.map((r) => ({ openedMs: n(r.opened_ms), closedMs: n(r.closed_ms), stakeLamports: n(r.stake_lamports), pnlLamports: n(r.pnl_lamports) }));
}

export function lifetimeOf(trades: ClosedTrade[]): { trades: number; wins: number; losses: number; pnlSol: number } {
  return {
    trades: trades.length,
    wins: trades.filter((t) => t.pnlLamports > 0).length,
    losses: trades.filter((t) => t.pnlLamports < 0).length,
    pnlSol: Number((trades.reduce((s, t) => s + t.pnlLamports, 0) / 1e9).toFixed(6)),
  };
}

export async function openRowsOf(sql: GuardSql, asset: string) {
  return sql.query<{ id: string; wallet: string; asset: string; tier: string; book: string; side: string; stake_lamports: string; entry_px: number; opened_ms: string; status: string; pnl_lamports: string | null; covered: boolean; owed_lamports: string }>(
    "select * from agent_positions where asset = $1 and status = 'open'",
    [asset],
  );
}

/** Assets that need a results write: positions closed after the last write, or never written. */
export async function assetsToSync(sql: GuardSql, limit = 25): Promise<string[]> {
  const rows = await sql.query<{ asset: string }>(
    `select p.asset from agent_positions p
     left join strategy_perf_writes w on w.asset = p.asset
     where p.strategy_hash is not null and (w.asset is null or p.closed_ms > w.written_ms or p.status = 'open')
     group by p.asset limit $1`,
    [limit],
  );
  const listed = await sql.query<{ asset: string }>("select asset from strategy_versions where status = 'confirmed' group by asset limit $1", [limit]);
  return [...new Set([...rows.map((r) => r.asset), ...listed.map((r) => r.asset)])].slice(0, limit);
}

/** Results writes cost the server key a fee. Outside the cron they are capped. */
export const PERF_DRIFT_GAP_MS = 6 * 3_600_000;
export const PERF_HOUR_CAP = 60;

/**
 * May a non-cron caller write results now? New trades: yes (under the global hourly cap).
 * Only time-derived values moved (APR drifts with the clock): once per PERF_DRIFT_GAP_MS per asset.
 */
export async function perfWriteAllowed(sql: GuardSql, asset: string, now: number, newTrades: boolean): Promise<boolean> {
  if (!newTrades) {
    const last = await sql.query<{ written_ms: string }>("select written_ms from strategy_perf_writes where asset = $1", [asset]);
    if (last[0] && now - Number(last[0].written_ms) < PERF_DRIFT_GAP_MS) return false;
  }
  const [{ n }] = await sql.query<{ n: string }>("select count(*) as n from strategy_perf_writes where written_ms > $1", [now - 3_600_000]);
  return Number(n) < PERF_HOUR_CAP;
}

export async function notePerfWrite(sql: GuardSql, asset: string, sig: string, attrs: string, now: number): Promise<void> {
  await sql.query(
    `insert into strategy_perf_writes (asset, written_ms, sig, attrs) values ($1, $2, $3, $4)
     on conflict (asset) do update set written_ms = excluded.written_ms, sig = excluded.sig, attrs = excluded.attrs`,
    [asset, now, sig, attrs],
  );
}

/** One closed trade as a judge sees it: the server record behind the APR plus any fee tx paid for it. */
export type TradeRecord = {
  id: string;
  book: string;
  side: string;
  stakeLamports: number;
  entryPx: number;
  exitPx: number | null;
  openedMs: number;
  closedMs: number;
  pnlLamports: number;
  strategyHash: string | null;
  feeSigs: string[];
};

export async function tradeRecordsOf(sql: GuardSql, asset: string, limit = 200): Promise<TradeRecord[]> {
  const rows = await sql.query<{
    id: string; wallet: string; book: string; side: string; stake_lamports: string; entry_px: number; exit_px: number | null;
    opened_ms: string; closed_ms: string; pnl_lamports: string; strategy_hash: string | null;
  }>(
    `select id, wallet, book, side, stake_lamports, entry_px, exit_px, opened_ms, closed_ms, pnl_lamports, strategy_hash
     from agent_positions where asset = $1 and status = 'closed' order by closed_ms desc limit $2`,
    [asset, limit],
  );
  const fees = rows.length
    ? await sql.query<{ sig: string; ref: string; wallet: string }>(
        "select sig, ref, wallet from chain_payments where kind = 'fee' and ref = any($1::text[])",
        [rows.map((r) => r.id)],
      )
    : [];
  return rows
    .map((r) => ({
      id: r.id,
      book: r.book,
      side: r.side,
      stakeLamports: n(r.stake_lamports),
      entryPx: Number(r.entry_px),
      exitPx: r.exit_px == null ? null : Number(r.exit_px),
      openedMs: n(r.opened_ms),
      closedMs: n(r.closed_ms),
      pnlLamports: n(r.pnl_lamports),
      strategyHash: r.strategy_hash,
      feeSigs: fees.filter((f) => f.ref === r.id && f.wallet === r.wallet).map((f) => f.sig),
    }))
    .reverse();
}

export async function perfWriteOf(sql: GuardSql, asset: string): Promise<{ sig: string; writtenMs: number } | null> {
  const rows = await sql.query<{ sig: string; written_ms: string }>("select sig, written_ms from strategy_perf_writes where asset = $1", [asset]);
  return rows[0] ? { sig: rows[0].sig, writtenMs: n(rows[0].written_ms) } : null;
}
