/**
 * Strategy NFTs on the server: validate + sign strategy changes, results job,
 * marketplace (list / buy / unlist) with the server as freeze + transfer delegate.
 * Every function takes a StrategyEnv so the same code runs in the server
 * functions (env from process) and in the devnet live test (PGLite + test key).
 */
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey, type Umi } from "@metaplex-foundation/umi";
import { fetchAsset, type AssetV1 } from "@metaplex-foundation/mpl-core";
import type { Keypair } from "@solana/web3.js";
import type { GuardSql } from "./guard-ledger.server.ts";
import { spendProofOnce } from "./guard-ledger.server.ts";
import { derivedKeypair } from "./secret-key.server.ts";
import { verifyProof } from "./wallet-proof.server.ts";
import type { WalletProof } from "./wallet-proof.ts";
import {
  attrsEqual,
  computePerf,
  exitByRule,
  listPriceOk,
  mergeAttrs,
  perfAttrs,
  perfFromAttrs,
  specAttrs,
  specFromAttrs,
  specHash,
  splitSale,
  unlockSecFor,
  validateSpec,
  type Attr,
  type ChainPerf,
  type ChainSpec,
  type Perf,
  type SpecLane,
  type StrategySpec,
} from "./strategy-spec.ts";
import { buildBuyTx, buildListTx, buildStrategyTxs, coreState, perfBuilder, serverSigner, thawBuilder } from "./strategy-chain.server.ts";
import * as ledger from "./strategy-ledger.server.ts";
import { closeRow, type PositionDeps } from "./positions-ledger.server.ts";

export type StrategyEnv = {
  sql: GuardSql | null;
  authority: Keypair | null;
  rpcUrl: string;
  treasury: string;
  now: () => number;
  /** Server Polymarket yes price for the stop/take sweep. */
  price?: (book: string) => Promise<number | null>;
};

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

function umiOf(env: StrategyEnv): Umi {
  return createUmi(env.rpcUrl, "confirmed");
}

export function serverCollectionOf(authority: Keypair): string {
  return derivedKeypair(authority, "mint-collection").publicKey.toBase58();
}

type Loaded = { asset: AssetV1; collection: string; attrs: Attr[]; map: Map<string, string>; chain: ChainSpec | null; trusted: boolean };

async function load(env: StrategyEnv, umi: Umi, address: string): Promise<Loaded | Fail> {
  if (!env.authority) return fail("На сервері немає ключа мінту (MINT_AUTHORITY_SECRET).");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return fail("Погана адреса NFT.");
  let asset: AssetV1;
  try {
    asset = await fetchAsset(umi, publicKey(address));
  } catch {
    return fail("NFT не знайдено на Devnet.");
  }
  const ua = asset.updateAuthority as { type: string; address?: unknown };
  const collection = ua.type === "Collection" && ua.address ? String(ua.address) : "";
  if (collection !== serverCollectionOf(env.authority)) return fail("NFT не з колекції сервера: спершу перенеси його (кнопка «Перенести»).");
  const attrs = (asset.attributes?.attributeList ?? []).map((a) => ({ key: a.key, value: a.value }));
  const map = new Map(attrs.map((a) => [a.key, a.value]));
  // Only attributes under the collection update authority (server) are trusted: an owner-managed list could carry a fake spec or APR.
  const trusted = coreState(asset).attributesAuthority === "UpdateAuthority";
  return { asset, collection, attrs, map, chain: trusted ? specFromAttrs(map) : null, trusted };
}

function nftLanes(map: Map<string, string>): SpecLane[] | null {
  const role = map.get("role");
  const cls = map.get("class");
  if (role === "dex" || (cls === "2" && role !== "combo")) return null;
  const ln = map.get("ln");
  if (ln) return (["crypto", "events", "weather"] as const).filter((l) => ln.includes(l === "crypto" ? "c" : l === "events" ? "e" : "w"));
  if (role === "combo") return ["crypto", "events", "weather"];
  const pf = map.get("pf");
  return pf === "evt" ? ["events"] : pf === "wx" ? ["weather"] : pf === "mix" ? ["crypto", "events", "weather"] : ["crypto"];
}

async function guard(env: StrategyEnv, proof: WalletProof | null, action: "strategy" | "market", extra: string, key: string): Promise<{ ok: true; wallet: string } | Fail> {
  if (!proof) return fail("Немає підпису гаманця.");
  const signed = verifyProof(proof, action, extra, env.now());
  if (!signed.ok) return signed;
  if (!env.sql) return fail("Немає бази (DATABASE_URL): сервер не веде стратегії.");
  try {
    if (!(await spendProofOnce(env.sql, proof.wallet, key, proof.ts, env.now()))) return fail("Цей підпис уже використано.");
  } catch {
    return fail("База не відповіла.");
  }
  return { ok: true, wallet: proof.wallet };
}

async function blockhash(umi: Umi): Promise<string> {
  return (await umi.rpc.getLatestBlockhash({ commitment: "confirmed" })).blockhash;
}

/* ------------------------------ strategy ------------------------------ */

export function strategyExtra(asset: string, spec: StrategySpec): string {
  return `${asset}:${specHash(spec)}`;
}

export type PrepareStrategyResult =
  | { ok: true; txs: string[]; version: number; hash: string; changedSec: number; unlockSec: number; spec: StrategySpec }
  | { ok: false; reason: string; errors?: string[] };

/** Validate a strategy, then build the change: attrs (server-signed) + 240 h lock. The owner signs and pays. */
export async function prepareStrategy(env: StrategyEnv, input: { proof: WalletProof | null; asset: string; spec: unknown }): Promise<PrepareStrategyResult> {
  const checked = validateSpec(input.spec);
  if (!checked.ok) return { ok: false, reason: checked.errors[0] ?? "Погана стратегія.", errors: checked.errors };
  const spec = checked.spec;
  const g = await guard(env, input.proof, "strategy", strategyExtra(input.asset, spec), "strategy");
  if (!g.ok) return g;
  const umi = umiOf(env);
  const got = await load(env, umi, input.asset);
  if ("ok" in got) return got;
  if (String(got.asset.owner) !== g.wallet) return fail("Цей NFT не в твоєму гаманці.");
  const lanes = nftLanes(got.map);
  if (!lanes) return fail("DEX-агент не має стратегії прогнозів.");
  const extra = spec.lanes.filter((l) => !lanes.includes(l));
  if (extra.length) return fail(`Цей NFT не вміє смугу ${extra.join(", ")}.`);
  if (got.chain && got.chain.hash === specHash(spec)) return fail("Стратегія та сама: нічого не змінено.");
  const listing = env.sql ? await ledger.listingOfAsset(env.sql, input.asset) : null;
  if (listing && (listing.status === "active" || listing.status === "pending")) return fail("NFT виставлено на продаж. Спершу зніми з продажу.");
  const now = env.now();
  const changedSec = Math.floor(now / 1000);
  const unlockSec = unlockSecFor(changedSec);
  const version = (got.chain?.version ?? 0) + 1;
  const trades = env.sql ? await ledger.closedTradesOf(env.sql, input.asset) : [];
  const next = mergeAttrs(
    got.attrs,
    specAttrs(spec, { version, changedSec, unlockSec }).concat(perfAttrs(computePerf(trades, changedSec * 1000, now), ledger.lifetimeOf(trades), now)),
  );
  let built;
  try {
    built = await buildStrategyTxs({ umi, authority: env.authority as Keypair, asset: got.asset, collection: got.collection, attrs: next, blockhash: await blockhash(umi) });
  } catch (e) {
    return fail(`Сервер не зібрав транзакцію: ${e instanceof Error ? e.message.slice(0, 120) : "помилка"}`);
  }
  if (!built.ok) return built;
  const hash = specHash(spec);
  if (env.sql) await ledger.recordPendingVersion(env.sql, { asset: input.asset, version, owner: g.wallet, hash, spec, changedMs: changedSec * 1000, unlockMs: unlockSec * 1000 });
  return { ok: true, txs: built.txs, version, hash, changedSec, unlockSec, spec };
}

/** After the owner sent the change: the chain must show the signed version, frozen under the server. */
export async function confirmStrategy(env: StrategyEnv, input: { asset: string; version: number; sig?: string }): Promise<{ ok: true; version: number; hash: string; unlockSec: number } | Fail> {
  const umi = umiOf(env);
  const got = await load(env, umi, input.asset);
  if ("ok" in got) return got;
  const c = got.chain;
  if (!c || c.version !== input.version) return fail("У ланцюгу ще інша версія. Зачекай кілька секунд.");
  if (!c.hashOk) return fail("Хеш стратегії в NFT не збігся.");
  const st = coreState(got.asset);
  const server = (env.authority as Keypair).publicKey.toBase58();
  if (!st.freeze?.frozen || st.freeze.authority !== server) return fail("NFT не заморожено під сервером: замок продажу не стоїть.");
  if (env.sql && !(await ledger.confirmVersion(env.sql, input.asset, c.version, c.hash, input.sig ?? ""))) return fail("Сервер не підписував цю версію.");
  return { ok: true, version: c.version, hash: c.hash, unlockSec: c.unlockSec };
}

/* ------------------------------ results ------------------------------ */

export type SyncResult = { ok: true; closed: number; perfSig: string | null; thawSig: string | null; perf: Perf | null } | Fail;

async function sendServer(env: StrategyEnv, umi: Umi, builder: ReturnType<typeof perfBuilder>): Promise<string> {
  const server = serverSigner(umi, env.authority as Keypair);
  const res = await builder.setFeePayer(server).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
  const { encodeBase58 } = await import("./base58.ts");
  return encodeBase58(res.signature);
}

/** Stop/take sweep, results write (only when they changed) and thaw after the lock (when not listed). */
export async function syncAsset(env: StrategyEnv, asset: string): Promise<SyncResult> {
  const umi = umiOf(env);
  const got = await load(env, umi, asset);
  if ("ok" in got) return got;
  const c = got.chain;
  if (!c || !env.sql) return { ok: true, closed: 0, perfSig: null, thawSig: null, perf: null };
  const sql = env.sql;
  // Whole seconds: pu on chain is in seconds, so a judge can recompute exactly at pu.
  const now = Math.floor(env.now() / 1000) * 1000;
  let closed = 0;
  if (env.price) {
    const deps: PositionDeps = { sql, now, price: env.price, agent: async () => null };
    for (const row of await ledger.openRowsOf(sql, asset)) {
      const px = await env.price(row.book).catch(() => null);
      if (px == null) continue;
      if (exitByRule(c.spec, row.side, row.entry_px, px) && (await closeRow(deps, row, px))) closed += 1;
    }
  }
  const trades = await ledger.closedTradesOf(sql, asset);
  const perf = computePerf(trades, c.changedSec * 1000, now);
  const next = perfAttrs(perf, ledger.lifetimeOf(trades), now);
  const cur = next.map((a) => ({ key: a.key, value: got.map.get(a.key) ?? "" }));
  let perfSig: string | null = null;
  const strip = (l: Attr[]) => l.filter((a) => a.key !== "pu");
  if (!attrsEqual(strip(cur), strip(next))) {
    const merged = mergeAttrs(got.attrs, next);
    perfSig = await sendServer(env, umi, perfBuilder(umi, env.authority as Keypair, got.asset, got.collection, merged));
    await ledger.notePerfWrite(sql, asset, perfSig, JSON.stringify(next), now);
  }
  let thawSig: string | null = null;
  const listing = await ledger.listingOfAsset(sql, asset);
  const listed = listing && (listing.status === "active" || listing.status === "pending");
  const st = coreState(got.asset);
  if (!listed && now >= c.unlockSec * 1000 && st.freeze?.authority === (env.authority as Keypair).publicKey.toBase58()) {
    const fresh = perfSig ? await fetchAsset(umi, publicKey(asset)) : got.asset;
    const b = thawBuilder(umi, env.authority as Keypair, fresh, got.collection, true);
    if (b) thawSig = await sendServer(env, umi, b);
  }
  return { ok: true, closed, perfSig, thawSig, perf };
}

/* ------------------------------ market ------------------------------ */

export function listExtra(asset: string, priceLamports: number): string {
  return `list:${asset}:${priceLamports}`;
}

export async function prepareList(env: StrategyEnv, input: { proof: WalletProof | null; asset: string; priceLamports: number }): Promise<{ ok: true; txs: string[]; unlockSec: number } | Fail> {
  if (!listPriceOk(input.priceLamports)) return fail("Ціна від 0.001 до 100 SOL.");
  const g = await guard(env, input.proof, "market", listExtra(input.asset, input.priceLamports), "market-list");
  if (!g.ok) return g;
  const umi = umiOf(env);
  const got = await load(env, umi, input.asset);
  if ("ok" in got) return got;
  if (String(got.asset.owner) !== g.wallet) return fail("Цей NFT не в твоєму гаманці.");
  const c = got.chain;
  if (!c || !c.hashOk) return fail("У NFT ще немає стратегії на ланцюгу. Збережи стратегію.");
  if (env.now() < c.unlockSec * 1000) return fail("Замок продажу ще діє після зміни стратегії.");
  let built;
  try {
    built = await buildListTx({ umi, authority: env.authority as Keypair, asset: got.asset, collection: got.collection, blockhash: await blockhash(umi) });
  } catch (e) {
    return fail(`Сервер не зібрав лістинг: ${e instanceof Error ? e.message.slice(0, 120) : "помилка"}`);
  }
  if (!built.ok) return built;
  const up = await ledger.upsertListing(env.sql as GuardSql, { asset: input.asset, seller: g.wallet, priceLamports: input.priceLamports, specHash: c.hash, now: env.now() });
  if (!up.ok) return up;
  return { ok: true, txs: built.txs, unlockSec: c.unlockSec };
}

async function escrowReady(env: StrategyEnv, got: Loaded, seller: string): Promise<boolean> {
  const st = coreState(got.asset);
  const server = (env.authority as Keypair).publicKey.toBase58();
  return String(got.asset.owner) === seller && st.transferDelegate === server && st.freeze?.authority === server && st.freeze.frozen === true;
}

export async function confirmList(env: StrategyEnv, input: { asset: string }): Promise<{ ok: true } | Fail> {
  if (!env.sql) return fail("Немає бази.");
  const listing = await ledger.listingOfAsset(env.sql, input.asset);
  if (!listing || (listing.status !== "pending" && listing.status !== "active")) return fail("Немає лістингу.");
  const umi = umiOf(env);
  const got = await load(env, umi, input.asset);
  if ("ok" in got) return got;
  if (!(await escrowReady(env, got, listing.seller))) return fail("Ланцюг ще не показує ескроу (заморозка + делегат переказу).");
  if (got.chain?.hash !== listing.specHash) return fail("Стратегія змінилась після виставлення.");
  await ledger.setListingStatus(env.sql, input.asset, ["pending", "active"], "active", env.now());
  return { ok: true };
}

export async function unlist(env: StrategyEnv, input: { proof: WalletProof | null; asset: string }): Promise<{ ok: true; thawSig: string | null } | Fail> {
  const g = await guard(env, input.proof, "market", `unlist:${input.asset}`, "market-unlist");
  if (!g.ok) return g;
  const listing = await ledger.listingOfAsset(env.sql as GuardSql, input.asset);
  if (!listing || listing.seller !== g.wallet || (listing.status !== "active" && listing.status !== "pending")) return fail("Немає твого лістингу.");
  await ledger.setListingStatus(env.sql as GuardSql, input.asset, ["active", "pending"], "cancelled", env.now());
  const umi = umiOf(env);
  const got = await load(env, umi, input.asset);
  if ("ok" in got) return { ok: true, thawSig: null };
  const unlocked = got.chain ? env.now() >= got.chain.unlockSec * 1000 : true;
  const b = unlocked ? thawBuilder(umi, env.authority as Keypair, got.asset, got.collection, true) : null;
  let thawSig: string | null = null;
  if (b) {
    try {
      thawSig = await sendServer(env, umi, b);
    } catch {
      /* server wallet empty: the sync job thaws later */
    }
  }
  return { ok: true, thawSig };
}

export function buyExtra(asset: string, priceLamports: number): string {
  return `buy:${asset}:${priceLamports}`;
}

export async function prepareBuy(
  env: StrategyEnv,
  input: { proof: WalletProof | null; asset: string; priceLamports: number },
): Promise<{ ok: true; txs: string[]; sellerLamports: number; royaltyLamports: number; specHash: string } | Fail> {
  const g = await guard(env, input.proof, "market", buyExtra(input.asset, input.priceLamports), "market-buy");
  if (!g.ok) return g;
  const listing = await ledger.listingOfAsset(env.sql as GuardSql, input.asset);
  if (!listing || listing.status !== "active") return fail("Лістинг не активний.");
  if (listing.priceLamports !== input.priceLamports) return fail("Ціна змінилась. Онови ринок.");
  if (listing.seller === g.wallet) return fail("Це твій лістинг.");
  const umi = umiOf(env);
  const got = await load(env, umi, input.asset);
  if ("ok" in got) return got;
  if (!(await escrowReady(env, got, listing.seller))) {
    await ledger.setListingStatus(env.sql as GuardSql, input.asset, ["active"], "cancelled", env.now());
    return fail("Ескроу зламано (NFT рушив). Лістинг знято.");
  }
  if (!got.chain || got.chain.hash !== listing.specHash) return fail("Стратегія не та, що в лістингу.");
  const split = splitSale(listing.priceLamports);
  let built;
  try {
    built = await buildBuyTx({
      umi,
      authority: env.authority as Keypair,
      asset: got.asset,
      collection: got.collection,
      buyer: g.wallet,
      sellerLamports: split.seller,
      royaltyLamports: split.royalty,
      treasury: env.treasury,
      blockhash: await blockhash(umi),
    });
  } catch (e) {
    return fail(`Сервер не зібрав купівлю: ${e instanceof Error ? e.message.slice(0, 120) : "помилка"}`);
  }
  if (!built.ok) return built;
  return { ok: true, txs: built.txs, sellerLamports: split.seller, royaltyLamports: split.royalty, specHash: listing.specHash };
}

export async function confirmBuy(env: StrategyEnv, input: { asset: string; sig: string }): Promise<{ ok: true; buyer: string } | Fail> {
  if (!env.sql) return fail("Немає бази.");
  const listing = await ledger.listingOfAsset(env.sql, input.asset);
  if (!listing) return fail("Немає лістингу.");
  if (listing.status === "sold") return { ok: true, buyer: listing.buyer ?? "" };
  if (listing.status !== "active") return fail("Лістинг не активний.");
  const umi = umiOf(env);
  let asset: AssetV1;
  try {
    asset = await fetchAsset(umi, publicKey(input.asset));
  } catch {
    return fail("NFT не читається.");
  }
  const buyer = String(asset.owner);
  if (buyer === listing.seller) return fail("NFT ще в продавця.");
  const tx = await umi.rpc.getTransaction(Uint8Array.from((await import("./base58.ts")).decodeBase58(input.sig)), { commitment: "confirmed" }).catch(() => null);
  if (!tx || tx.meta.err) return fail("Транзакцію купівлі не знайдено.");
  const keys = tx.message.accounts.map(String);
  if (!keys.includes(input.asset) || !keys.includes(buyer)) return fail("Ця транзакція не про цей NFT.");
  const split = splitSale(listing.priceLamports);
  await ledger.markSold(env.sql, { asset: input.asset, buyer, sig: input.sig, priceLamports: listing.priceLamports, royaltyLamports: split.royalty, seller: listing.seller, now: env.now() });
  return { ok: true, buyer };
}

/* ------------------------------ reads ------------------------------ */

export type StrategyInfo = {
  asset: string;
  name: string;
  owner: string;
  tier: "free" | "pro";
  chain: ChainSpec | null;
  perf: ChainPerf | null;
  frozen: boolean;
  lockedByServer: boolean;
  listing: ledger.Listing | null;
  history: { t: number; cumSol: number }[];
  sales: { sig: string; buyer: string; seller: string; priceLamports: number; soldMs: number }[];
  /** Judge view: the records behind the on-chain results, newest last. */
  records: ledger.TradeRecord[];
  versions: { version: number; hash: string; changedMs: number; status: string; sig: string | null }[];
  perfWrite: { sig: string; writtenMs: number } | null;
  /** Honest label: web trades are simulated in the browser; prices/times are the server's own reads. */
  tradesSimulated: true;
};

export async function strategyInfo(env: StrategyEnv, asset: string): Promise<({ ok: true } & StrategyInfo) | Fail> {
  const umi = umiOf(env);
  const got = await load(env, umi, asset);
  if ("ok" in got) return got;
  const st = coreState(got.asset);
  const sql = env.sql;
  const trades = sql ? await ledger.closedTradesOf(sql, asset) : [];
  const perf = got.chain ? computePerf(trades, got.chain.changedSec * 1000, env.now()) : null;
  return {
    ok: true,
    asset,
    name: got.asset.name,
    owner: String(got.asset.owner),
    tier: got.asset.uri.endsWith(":free") || got.map.get("tr") === "free" ? "free" : "pro",
    chain: got.chain,
    perf: got.trusted ? perfFromAttrs(got.map) : null,
    frozen: st.freeze?.frozen === true,
    lockedByServer: st.freeze?.authority === (env.authority as Keypair).publicKey.toBase58(),
    listing: sql ? await ledger.listingOfAsset(sql, asset) : null,
    history: perf?.history ?? [],
    sales: sql ? await ledger.salesOf(sql, asset) : [],
    records: sql ? await ledger.tradeRecordsOf(sql, asset) : [],
    versions: sql ? await ledger.versionsOf(sql, asset) : [],
    perfWrite: sql ? await ledger.perfWriteOf(sql, asset) : null,
    tradesSimulated: true,
  };
}

export async function marketListings(env: StrategyEnv): Promise<{ ok: true; items: (StrategyInfo & { priceLamports: number })[] } | Fail> {
  if (!env.sql) return fail("Немає бази.");
  const items: (StrategyInfo & { priceLamports: number })[] = [];
  for (const l of await ledger.activeListings(env.sql)) {
    const info = await strategyInfo(env, l.asset);
    if (!info.ok) continue;
    if (info.owner !== l.seller || !info.lockedByServer || !info.frozen) {
      await ledger.setListingStatus(env.sql, l.asset, ["active"], "cancelled", env.now());
      continue;
    }
    const { ok: _ok, ...rest } = info;
    items.push({ ...rest, priceLamports: l.priceLamports });
  }
  return { ok: true, items };
}

/* ------------------------------ process env ------------------------------ */

export async function envFromProcess(sqlIn?: GuardSql | null): Promise<StrategyEnv> {
  const { keypairFromText } = await import("./secret-key.server.ts");
  let sql: GuardSql | null = sqlIn ?? null;
  if (sqlIn === undefined) {
    try {
      const { arbStore } = await import("./arb-guard.server");
      if (arbStore() !== "none") {
        const { getSql } = await import("@/lib/db");
        sql = await getSql();
      }
    } catch {
      sql = null;
    }
  }
  const { PAY_WALLET } = await import("@/lib/game/pay");
  const { polyYesPrice } = await import("./positions.server");
  return {
    sql,
    authority: keypairFromText(process.env.MINT_AUTHORITY_SECRET),
    rpcUrl: (process.env.SOLANA_RPC_DEVNET || "").trim() || "https://api.devnet.solana.com",
    treasury: PAY_WALLET,
    now: () => Date.now(),
    price: polyYesPrice,
  };
}

/** After a position closes: results on chain (best effort). */
export async function syncStrategyAsset(asset: string, sql: GuardSql): Promise<void> {
  const env = await envFromProcess(sql);
  if (!env.authority) return;
  await syncAsset(env, asset);
}

/** Cron / manual job: every asset with new closes or a lock to release. */
export async function syncAllStrategies(): Promise<{ ok: true; done: { asset: string; perfSig: string | null; thawSig: string | null; error?: string }[] } | Fail> {
  const env = await envFromProcess();
  if (!env.sql || !env.authority) return fail("Немає бази або ключа мінту.");
  const done: { asset: string; perfSig: string | null; thawSig: string | null; error?: string }[] = [];
  for (const asset of await ledger.assetsToSync(env.sql)) {
    try {
      const r = await syncAsset(env, asset);
      done.push(r.ok ? { asset, perfSig: r.perfSig, thawSig: r.thawSig } : { asset, perfSig: null, thawSig: null, error: r.reason });
    } catch (e) {
      done.push({ asset, perfSig: null, thawSig: null, error: e instanceof Error ? e.message.slice(0, 120) : "error" });
    }
  }
  return { ok: true, done };
}

/* ------------------------------ one entry for web + native ------------------------------ */

export const STRATEGY_ROUTES = [
  "strategy-validate",
  "strategy-info",
  "strategy-prepare",
  "strategy-confirm",
  "strategy-sync",
  "market-list",
  "market-prepare-list",
  "market-confirm-list",
  "market-unlist",
  "market-prepare-buy",
  "market-confirm-buy",
  "faucet-drip",
] as const;
export type StrategyRoute = (typeof STRATEGY_ROUTES)[number];

/** Sanitizes untrusted input and runs one route. Used by the web server function and /api/native/<route>. */
export async function strategyRoute(route: string, body: Record<string, unknown>, opts: { cron?: boolean; env?: StrategyEnv; ip?: string } = {}): Promise<unknown> {
  const { readProof } = await import("./wallet-proof.ts");
  const b58 = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, max) : "");
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
  if (route === "strategy-validate") {
    const r = validateSpec(body.spec);
    return r.ok ? { ok: true, spec: r.spec, hash: specHash(r.spec) } : { ok: false, reason: r.errors[0], errors: r.errors };
  }
  if (route === "faucet-drip") {
    const { faucetFromProcess } = await import("./faucet.server.ts");
    return faucetFromProcess(readProof(body.proof), opts.ip ?? "unknown");
  }
  const env = opts.env ?? (await envFromProcess());
  const asset = b58(body.asset, 44);
  const proof = readProof(body.proof);
  switch (route) {
    case "strategy-info":
      return strategyInfo(env, asset);
    case "strategy-prepare":
      return prepareStrategy(env, { proof, asset, spec: body.spec });
    case "strategy-confirm":
      return confirmStrategy(env, { asset, version: int(body.version), sig: b58(body.sig, 100) });
    case "strategy-sync":
      if (asset) return syncAsset(env, asset);
      if (!opts.cron) return fail("Повний прохід лише для крону.");
      return syncAllStrategies();
    case "market-list":
      return marketListings(env);
    case "market-prepare-list":
      return prepareList(env, { proof, asset, priceLamports: int(body.priceLamports) });
    case "market-confirm-list":
      return confirmList(env, { asset });
    case "market-unlist":
      return unlist(env, { proof, asset });
    case "market-prepare-buy":
      return prepareBuy(env, { proof, asset, priceLamports: int(body.priceLamports) });
    case "market-confirm-buy":
      return confirmBuy(env, { asset, sig: b58(body.sig, 100) });
    default:
      return fail("route");
  }
}
