-- Strategy NFTs: versions the server wrote on chain, marketplace listings and sales.
-- The chain is the source of truth for the strategy (Core Attributes); these rows
-- record what the server signed and let it refuse races (no strategy change while listed).
alter table agent_positions add column if not exists strategy_hash text;

create table if not exists strategy_versions (
  asset text not null,
  version integer not null,
  owner text not null,
  hash text not null,
  spec text not null,
  changed_ms bigint not null,
  unlock_ms bigint not null,
  status text not null default 'pending',
  sig text,
  primary key (asset, version)
);

-- One row per asset; status pending -> active -> sold | cancelled.
create table if not exists strategy_listings (
  asset text primary key,
  seller text not null,
  price_lamports bigint not null,
  spec_hash text not null,
  status text not null,
  listed_ms bigint not null,
  updated_ms bigint not null,
  buyer text,
  sold_sig text,
  sold_ms bigint
);

create index if not exists strategy_listings_status_idx on strategy_listings (status);

create table if not exists strategy_sales (
  sig text primary key,
  asset text not null,
  seller text not null,
  buyer text not null,
  price_lamports bigint not null,
  royalty_lamports bigint not null,
  sold_ms bigint not null
);

-- Last performance write per asset (what the server put on chain and when).
create table if not exists strategy_perf_writes (
  asset text primary key,
  written_ms bigint not null,
  sig text not null,
  attrs text not null
);

-- Judge onboarding faucet (devnet only): one drip per wallet per UTC day, capped per IP and per day.
create table if not exists faucet_drips (
  wallet text not null,
  day text not null,
  ip text not null,
  lamports bigint not null,
  created_ms bigint not null,
  sig text,
  primary key (wallet, day)
);

create index if not exists faucet_drips_day_idx on faucet_drips (day, ip);
