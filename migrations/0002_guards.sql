-- Server-side guards shared by every serverless instance.
-- Arb fire caps (global and per wallet, per UTC day), wallet-proof replay
-- protection and the short "one free strategy NFT" claim lock.
-- Amounts are lamports, times are epoch milliseconds.

create table if not exists arb_day (
  mode text not null,
  day text not null,
  spent_lamports bigint not null default 0,
  fires integer not null default 0,
  last_ms bigint not null default 0,
  primary key (mode, day)
);

create table if not exists arb_wallet_day (
  mode text not null,
  wallet text not null,
  day text not null,
  spent_lamports bigint not null default 0,
  fires integer not null default 0,
  last_ms bigint not null default 0,
  primary key (mode, wallet, day)
);

create table if not exists arb_fires (
  id bigserial primary key,
  mode text not null,
  wallet text not null,
  asset text not null,
  symbol text not null,
  dir text not null,
  size_lamports bigint not null,
  status text not null,
  detail text not null default '',
  created_ms bigint not null,
  updated_ms bigint not null
);

create index if not exists arb_fires_wallet_idx on arb_fires (wallet, created_ms);

create table if not exists wallet_proofs (
  wallet text not null,
  action text not null,
  ts bigint not null,
  created_ms bigint not null,
  primary key (wallet, action, ts)
);

create index if not exists wallet_proofs_created_idx on wallet_proofs (created_ms);

create table if not exists free_mint_claims (
  wallet text primary key,
  claimed_ms bigint not null
);
