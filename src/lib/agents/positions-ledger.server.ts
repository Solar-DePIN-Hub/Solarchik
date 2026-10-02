/**
 * Postgres ledger of agent positions, verified clock-in days and fee-free windows.
 * Network reads (price, Core asset) are injected so the tests run on PGLite.
 */
import type { GuardSql } from "./guard-ledger.server.ts";
import {
  POSITION_GIVE_UP_MS,
  POSITION_MAX_OPEN_MS,
  STAKE_MAX_LAMPORTS,
  UNPAID_GRACE_MS,
  entryOk,
  grantedWindows,
  owedLamports,
  pnlLamports,
  priceOk,
  readSide,
  startsCover,
  windowToStart,
  type PositionSide,
  type WindowStart,
} from "./position-rules.ts";
import { checkTrade, specFromAttrs, type SpecLane } from "./strategy-spec.ts";

export type PositionDeps = {
  sql: GuardSql;
  now: number;
  /** Server's own Polymarket yes price for a `poly:` book, or null when unreadable. */
  price: (book: string) => Promise<number | null>;
  /** Core asset owner, tier and Attributes, or null when the asset does not exist. */
  agent: (asset: string) => Promise<{ owner: string; free: boolean; attrs?: Map<string, string> } | null>;
  /** Lane and BTC window of a `poly:` book (server's own Gamma read). Needed for Strategy NFTs. */
  market?: (book: string) => Promise<{ lane: SpecLane; window: number } | null>;
};

type Row = {
  id: string;
  wallet: string;
  asset: string;
  tier: string;
  book: string;
  side: string;
  stake_lamports: string | number;
  entry_px: number;
  opened_ms: string | number;
  status: string;
  pnl_lamports: string | number | null;
  covered: boolean;
  owed_lamports: string | number;
};

export type ClosedPosition = { id: string; tier: string; pnlLamports: number; owedLamports: number; covered: boolean; closedMs: number };

export type OpenResult =
  | { ok: true; entryPx: number; openedMs: number; tier: "free" | "pro" }
  | { ok: false; reason: string; retry: boolean; unpaidLamports?: number };

export type CloseResult = ({ ok: true } & ClosedPosition) | { ok: false; reason: string; retry: boolean };

const n = (v: unknown) => Number(v ?? 0);

export async function windowStarts(sql: GuardSql, wallet: string): Promise<WindowStart[]> {
  const rows = await sql.query<{ window_id: string; kind: string; started_ms: string; ends_ms: string }>(
    "select window_id, kind, started_ms, ends_ms from fee_window_starts where wallet = $1 order by started_ms",
    [wallet],
  );
  return rows.map((r) => ({ windowId: r.window_id, kind: r.kind === "d7" ? "d7" : "h48", startedMs: n(r.started_ms), endsMs: n(r.ends_ms) }));
}

export async function closeRow(deps: PositionDeps, row: Row, exitPx: number | null): Promise<ClosedPosition | null> {
  const side = readSide(row.side) ?? "yes";
  const pnl = exitPx == null ? 0 : pnlLamports(n(row.stake_lamports), side, row.entry_px, exitPx);
  const covered = startsCover(await windowStarts(deps.sql, row.wallet), n(row.opened_ms));
  const owed = owedLamports({ tier: row.tier, pnlLamports: pnl, covered });
  const done = await deps.sql.query<{ id: string }>(
    `update agent_positions set status = 'closed', exit_px = $2, closed_ms = $3, pnl_lamports = $4, covered = $5, owed_lamports = $6
     where id = $1 and status = 'open' returning id`,
    [row.id, exitPx ?? row.entry_px, deps.now, pnl, covered, owed],
  );
  if (!done.length) return null;
  return { id: row.id, tier: row.tier, pnlLamports: pnl, owedLamports: owed, covered, closedMs: deps.now };
}

/** Closes this wallet's positions open longer than POSITION_MAX_OPEN_MS (and, optionally, any open on `asset`). */
export async function closeStale(deps: PositionDeps, wallet: string, asset = ""): Promise<number> {
  const rows = await deps.sql.query<Row>(
    "select * from agent_positions where wallet = $1 and status = 'open' and (opened_ms < $2 or asset = $3)",
    [wallet, deps.now - POSITION_MAX_OPEN_MS, asset],
  );
  let closed = 0;
  for (const row of rows) {
    const px = await deps.price(row.book).catch(() => null);
    if (priceOk(px)) {
      if (await closeRow(deps, row, px)) closed += 1;
    } else if (deps.now - n(row.opened_ms) > POSITION_GIVE_UP_MS) {
      if (await closeRow(deps, row, null)) closed += 1;
    }
  }
  return closed;
}

/** Owed lamports of closed positions older than `before` that have no recorded fee payment. */
export async function unpaidOwed(sql: GuardSql, wallet: string, before: number): Promise<number> {
  const rows = await sql.query<{ owed: string | null }>(
    `select coalesce(sum(p.owed_lamports), 0) as owed from agent_positions p
     where p.wallet = $1 and p.status = 'closed' and p.owed_lamports > 0 and p.closed_ms < $2
       and not exists (select 1 from chain_payments c where c.kind = 'fee' and c.wallet = p.wallet and c.ref = p.id)`,
    [wallet, before],
  );
  return n(rows[0]?.owed);
}

export async function openPosition(
  deps: PositionDeps,
  input: { wallet: string; fillId: string; asset: string; book: string; side: PositionSide; stakeLamports: number },
): Promise<OpenResult> {
  const { sql, now } = deps;
  if (!(input.stakeLamports > 0) || input.stakeLamports > STAKE_MAX_LAMPORTS) return { ok: false, reason: "Ставка поза межами.", retry: false };
  const prior = await sql.query<Row>("select * from agent_positions where id = $1", [input.fillId]);
  if (prior[0]) {
    if (prior[0].wallet !== input.wallet) return { ok: false, reason: "Цей id позиції вже зайнятий.", retry: false };
    return { ok: true, entryPx: prior[0].entry_px, openedMs: n(prior[0].opened_ms), tier: prior[0].tier === "free" ? "free" : "pro" };
  }
  const agent = await deps.agent(input.asset).catch(() => undefined);
  if (agent === undefined) return { ok: false, reason: "Devnet не відповів.", retry: true };
  if (!agent || agent.owner !== input.wallet) return { ok: false, reason: "Цей NFT не належить гаманцю кімнати.", retry: false };
  const tier = agent.free ? "free" : "pro";
  await closeStale(deps, input.wallet, input.asset);
  if (tier === "free") {
    const unpaid = await unpaidOwed(sql, input.wallet, now - UNPAID_GRACE_MS);
    if (unpaid > 0) {
      return { ok: false, reason: `Спершу сплати комісію: ${(unpaid / 1e9).toFixed(6)} SOL.`, retry: false, unpaidLamports: unpaid };
    }
  }
  const px = await deps.price(input.book).catch(() => null);
  if (!entryOk(px)) return { ok: false, reason: "Сервер не прочитав ціну ринку.", retry: true };
  // Strategy NFT: the trade must follow the strategy stored on chain, or it is not recorded (no PnL, no APR).
  const chain = agent.attrs ? specFromAttrs(agent.attrs) : null;
  if (agent.attrs?.has("sh") && (!chain || !chain.hashOk)) return { ok: false, reason: "Стратегія в NFT пошкоджена (хеш не збігся).", retry: false };
  if (chain) {
    const info = deps.market ? await deps.market(input.book).catch(() => null) : null;
    if (!info) return { ok: false, reason: "Сервер не прочитав ринок.", retry: true };
    const check = checkTrade(chain.spec, {
      side: input.side,
      yesPx: px,
      lane: info.lane,
      window: info.window,
      stakeSol: input.stakeLamports / 1e9,
      hourUtc: new Date(now).getUTCHours(),
    });
    if (!check.ok) return { ok: false, reason: `Не за стратегією NFT: ${check.reason}`, retry: false };
  }
  await sql.query(
    `insert into agent_positions (id, wallet, asset, tier, book, side, stake_lamports, entry_px, opened_ms, strategy_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do nothing`,
    [input.fillId, input.wallet, input.asset, tier, input.book, input.side, input.stakeLamports, px, now, chain?.hash ?? null],
  );
  return { ok: true, entryPx: px, openedMs: now, tier };
}

function closedOf(row: Row): ClosedPosition {
  return {
    id: row.id,
    tier: row.tier,
    pnlLamports: n(row.pnl_lamports),
    owedLamports: n(row.owed_lamports),
    covered: row.covered,
    closedMs: n((row as Row & { closed_ms?: unknown }).closed_ms),
  };
}

export async function closePosition(deps: PositionDeps, input: { wallet: string; fillId: string }): Promise<CloseResult> {
  const rows = await deps.sql.query<Row>("select * from agent_positions where id = $1", [input.fillId]);
  const row = rows[0];
  if (!row || row.wallet !== input.wallet) return { ok: false, reason: "Сервер не бачив відкриття цієї позиції.", retry: false };
  if (row.status === "closed") return { ok: true, ...closedOf(row) };
  const px = await deps.price(row.book).catch(() => null);
  if (!priceOk(px)) return { ok: false, reason: "Сервер не прочитав ціну ринку.", retry: true };
  const closed = await closeRow(deps, row, px);
  if (closed) return { ok: true, ...closed };
  const again = await deps.sql.query<Row>("select * from agent_positions where id = $1", [input.fillId]);
  return again[0]?.status === "closed" ? { ok: true, ...closedOf(again[0]) } : { ok: false, reason: "Не вдалося закрити.", retry: true };
}

/** What recordFee needs: the server's owed amount for one closed position of this wallet. */
export async function owedFor(
  sql: GuardSql,
  wallet: string,
  id: string,
): Promise<{ ok: true; owedLamports: number } | { ok: false; reason: string; retry: boolean }> {
  const rows = await sql.query<Row>("select * from agent_positions where id = $1", [id]);
  const row = rows[0];
  if (!row || row.wallet !== wallet) return { ok: false, reason: "Сервер не має цієї позиції: комісію не звірено.", retry: false };
  if (row.status !== "closed") return { ok: false, reason: "Позиція ще відкрита на сервері.", retry: true };
  const owed = n(row.owed_lamports);
  if (!(owed > 0)) return { ok: false, reason: "За цю позицію сервер комісії не нараховував.", retry: false };
  return { ok: true, owedLamports: owed };
}

export type FeeBalance = { owedLamports: number; paidLamports: number; dueLamports: number; open: number; dueIds: string[] };

export async function feeBalance(sql: GuardSql, wallet: string): Promise<FeeBalance> {
  const rows = await sql.query<{ id: string; status: string; owed_lamports: string; paid: string | null }>(
    `select p.id, p.status, p.owed_lamports,
       (select sum(c.lamports) from chain_payments c where c.kind = 'fee' and c.wallet = p.wallet and c.ref = p.id) as paid
     from agent_positions p where p.wallet = $1`,
    [wallet],
  );
  let owed = 0;
  let paid = 0;
  let open = 0;
  const dueIds: string[] = [];
  for (const r of rows) {
    if (r.status === "open") open += 1;
    owed += n(r.owed_lamports);
    paid += n(r.paid);
    if (n(r.owed_lamports) > 0 && !(n(r.paid) >= n(r.owed_lamports))) dueIds.push(r.id);
  }
  return { owedLamports: owed, paidLamports: paid, dueLamports: Math.max(0, owed - paid), open, dueIds: dueIds.slice(0, 50) };
}

/** One verified clock-in day per room wallet, and one room per player wallet per day. */
export async function recordClockDay(
  sql: GuardSql,
  input: { wallet: string; day: string; clockAddress: string; clockSig: string; now: number },
): Promise<{ ok: true; fresh: boolean } | { ok: false; reason: string }> {
  const prior = await sql.query<{ wallet: string; clock_address: string }>(
    "select wallet, clock_address from clock_days where (wallet = $1 and day = $2) or (clock_address = $3 and day = $2) or clock_sig = $4",
    [input.wallet, input.day, input.clockAddress, input.clockSig],
  );
  if (prior.some((r) => r.wallet === input.wallet)) return { ok: true, fresh: false };
  if (prior.length) return { ok: false, reason: "Цей гаманець уже відмітився за іншу кімнату сьогодні." };
  const rows = await sql.query<{ ok: number }>(
    `insert into clock_days (wallet, day, clock_address, clock_sig, recorded_ms) values ($1, $2, $3, $4, $5)
     on conflict do nothing returning 1 as ok`,
    [input.wallet, input.day, input.clockAddress, input.clockSig, input.now],
  );
  return rows.length ? { ok: true, fresh: true } : { ok: false, reason: "Цей день уже записано." };
}

export async function serverWindows(sql: GuardSql, wallet: string) {
  const days = await sql.query<{ day: string; recorded_ms: string }>("select day, recorded_ms from clock_days where wallet = $1", [wallet]);
  return grantedWindows(days.map((d) => ({ day: d.day, at: n(d.recorded_ms) })));
}

/** Starts the next server-granted window at server time (or returns the live one). */
export async function startFeeWindow(
  sql: GuardSql,
  wallet: string,
  now: number,
): Promise<{ ok: true; fresh: boolean; start: WindowStart } | { ok: false; reason: string }> {
  const granted = await serverWindows(sql, wallet);
  const starts = await windowStarts(sql, wallet);
  const pick = windowToStart(granted, starts, now);
  if (!pick) return { ok: false, reason: "Сервер не бачить доступного вікна: потрібні підтверджені відмітки (7 днів поспіль або 30)." };
  if (!pick.fresh) return { ok: true, fresh: false, start: pick.start };
  const s = pick.start;
  const rows = await sql.query<{ ok: number }>(
    `insert into fee_window_starts (wallet, window_id, kind, started_ms, ends_ms) values ($1, $2, $3, $4, $5)
     on conflict do nothing returning 1 as ok`,
    [wallet, s.windowId, s.kind, s.startedMs, s.endsMs],
  );
  if (!rows.length) return { ok: false, reason: "Вікно вже запущено. Онови сторінку." };
  return { ok: true, fresh: true, start: s };
}
