-- Verified on-chain payments. One row per transaction signature (never reused).
-- kind 'arb-credit' (mainnet deposit to the arb treasury, asset = NFT) or
-- 'fee' (devnet Free-tier profit fee, ref = ledger row id). Lamports, epoch ms.
create table if not exists chain_payments (
  sig text primary key,
  kind text not null,
  cluster text not null,
  wallet text not null,
  asset text not null default '',
  ref text not null default '',
  lamports bigint not null,
  recorded_ms bigint not null
);

create index if not exists chain_payments_asset_idx on chain_payments (kind, asset);
create index if not exists chain_payments_wallet_idx on chain_payments (kind, wallet);
create unique index if not exists chain_payments_fee_ref_idx on chain_payments (wallet, ref) where kind = 'fee';

-- Re-issued agents: arb credit of the old (pre-co-sign) asset follows the new one.
create table if not exists asset_links (
  new_asset text primary key,
  old_asset text not null,
  wallet text not null,
  created_ms bigint not null
);
