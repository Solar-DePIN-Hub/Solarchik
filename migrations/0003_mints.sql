-- Mint entitlement slots. kind 'free' keyed by room wallet, kind 'pro' keyed by
-- the devnet payment signature (single use). asset is the server-prepared Core
-- asset address ('' for a browser-side mint). Times are epoch milliseconds.
create table if not exists mint_claims (
  kind text not null,
  key text not null,
  wallet text not null,
  asset text not null default '',
  prepared_ms bigint not null,
  primary key (kind, key)
);

create index if not exists mint_claims_wallet_idx on mint_claims (wallet);
