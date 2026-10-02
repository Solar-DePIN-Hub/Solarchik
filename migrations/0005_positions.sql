-- Server record of agent positions (web prediction desk) and of what they owe.
-- One row per fill id (= fee ledger row id). Prices come from the server's own
-- Polymarket read, times from the server clock. Lamports, epoch ms.
-- owed_lamports = 5% of realized profit for a Free agent outside a fee-free
-- window; 0 for Pro, losses and covered trades. recordFee refuses less.
create table if not exists agent_positions (
  id text primary key,
  wallet text not null,
  asset text not null,
  tier text not null,
  book text not null,
  side text not null,
  stake_lamports bigint not null,
  entry_px double precision not null,
  opened_ms bigint not null,
  status text not null default 'open',
  exit_px double precision,
  closed_ms bigint,
  pnl_lamports bigint,
  covered boolean not null default false,
  owed_lamports bigint not null default 0
);

create index if not exists agent_positions_wallet_idx on agent_positions (wallet, status);
create index if not exists agent_positions_asset_idx on agent_positions (asset, status);

-- Clock-in days the server verified (signed memo or memo tx by the player's
-- wallet), bound to one room wallet. One wallet cannot feed two rooms a day.
create table if not exists clock_days (
  wallet text not null,
  day text not null,
  clock_address text not null,
  clock_sig text not null,
  recorded_ms bigint not null,
  primary key (wallet, day)
);

create unique index if not exists clock_days_address_idx on clock_days (clock_address, day);
create unique index if not exists clock_days_sig_idx on clock_days (clock_sig);

-- Fee-free windows the server started (server time). Entitlement is replayed
-- from clock_days with the same rules as fee-windows.ts.
create table if not exists fee_window_starts (
  wallet text not null,
  window_id text not null,
  kind text not null,
  started_ms bigint not null,
  ends_ms bigint not null,
  primary key (wallet, window_id)
);
