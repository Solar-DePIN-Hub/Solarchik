/**
 * Devnet live check of Strategy NFTs with the real server code (strategy.server.ts,
 * mint.server.ts buildCosigned, positions ledger) on a PGLite database.
 * Keys: KEYS_DIR/{authority,seller,buyer}.json (devnet test keys, never mainnet).
 * Run: JITI_ALIAS='{"@/":"<repo>/src/"}' npx jiti scripts/strategy-devnet-live.ts
 *
 * Steps (every on-chain step prints its signature):
 *  1 mint a co-signed Strategy NFT (spec v1, frozen under the server)
 *  2 change the strategy (server-signed attrs + lock) -> v2, sale lock reset to +240 h
 *  3 list now -> refused by the server; transfer now -> refused by Core (frozen)
 *  4 server clock advanced past the lock (test env only) -> list (escrow) -> buy with a 2nd wallet
 *  5 positions for the new owner (scripted prices, PGLite) -> server writes results/APR on chain
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, publicKey, signerIdentity } from "@metaplex-foundation/umi";
import { fetchAsset, transfer } from "@metaplex-foundation/mpl-core";
import { liveCatalog } from "../src/lib/agents/catalog.ts";
import { buildCosigned, mintAttributes } from "../src/lib/agents/mint.server.ts";
import { derivedKeypair } from "../src/lib/agents/secret-key.server.ts";
import { proofMessage, type ProofAction } from "../src/lib/agents/wallet-proof.ts";
import { encodeBase58 } from "../src/lib/agents/base58.ts";
import { PAY_WALLET } from "../src/lib/game/pay.ts";
import * as S from "../src/lib/agents/strategy.server.ts";
import { specFromAttrs, perfFromAttrs, specHash, validateSpec } from "../src/lib/agents/strategy-spec.ts";
import { closePosition, openPosition, type PositionDeps } from "../src/lib/agents/positions-ledger.server.ts";
import { fetchCoreAgent } from "../src/lib/agents/core-owned.server.ts";
import nacl from "tweetnacl";

const RPC = process.env.SOLANA_RPC_DEVNET || "https://api.devnet.solana.com";
const LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
const dir = process.env.KEYS_DIR || "/workspace/strategy-live";
const key = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"))));
const authority = key("authority");
const seller = key("seller");
const buyer = key("buyer");
const conn = new Connection(RPC, "confirmed");
const out: Record<string, unknown> = {};
const log = (k: string, v: unknown) => {
  out[k] = v;
  console.log(k, typeof v === "string" ? v : JSON.stringify(v));
};

let clockShift = 0;
const pg = new PGlite();
for (const f of ["0002_guards.sql", "0003_mints.sql", "0004_payments.sql", "0005_positions.sql", "0006_strategy_market.sql"]) {
  await pg.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
}
const sql = { query: async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as never[] };
const env: S.StrategyEnv = { sql, authority, rpcUrl: RPC, treasury: PAY_WALLET, now: () => Date.now() + clockShift };

function proof(kp: Keypair, action: ProofAction, extra: string) {
  const ts = env.now();
  const sig = nacl.sign.detached(new TextEncoder().encode(proofMessage(action, kp.publicKey.toBase58(), ts, extra)), kp.secretKey);
  return { wallet: kp.publicKey.toBase58(), ts, sig: encodeBase58(sig) };
}

async function sendAll(kp: Keypair, txs: string[]): Promise<string[]> {
  const sigs: string[] = [];
  for (const b64 of txs) {
    const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    tx.sign([kp]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction(sig, "confirmed");
    const st = await conn.getSignatureStatus(sig);
    if (st.value?.err) throw new Error(`tx failed ${sig} ${JSON.stringify(st.value.err)}`);
    sigs.push(sig);
  }
  return sigs;
}

const umi = createUmi(RPC, "confirmed");
async function chain(asset: string) {
  const a = await fetchAsset(umi, publicKey(asset));
  const attrs = (a.attributes?.attributeList ?? []).map((x) => ({ key: x.key, value: x.value }));
  const fd = a.freezeDelegate as { frozen: boolean; authority: { type: string; address?: unknown } } | undefined;
  const td = a.transferDelegate as { authority: { type: string; address?: unknown } } | undefined;
  const auth = (x?: { type: string; address?: unknown }) => (x ? (x.type === "Address" ? String(x.address) : x.type) : null);
  return {
    owner: String(a.owner),
    attrAuthority: auth((a.attributes as { authority: { type: string; address?: unknown } } | undefined)?.authority),
    freeze: fd ? { frozen: fd.frozen, authority: auth(fd.authority) } : null,
    transferDelegate: auth(td?.authority),
    spec: specFromAttrs(attrs),
    perf: perfFromAttrs(attrs),
  };
}

if (LOCAL) {
  // Local validator (real mpl-core program cloned from devnet): fund the test keys and the treasury.
  for (const pk of [authority.publicKey, seller.publicKey, buyer.publicKey, new (await import("@solana/web3.js")).PublicKey(PAY_WALLET)]) {
    const sig = await conn.requestAirdrop(pk, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  }
}
log("rpc", RPC);
for (const kp of [authority, seller, buyer]) log(`balance ${kp.publicKey.toBase58()}`, (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL);
log("server authority", authority.publicKey.toBase58());
log("server collection", S.serverCollectionOf(authority));

// 1. mint
const sku = liveCatalog().find((s) => s.nft.tier !== "free" && s.nft.classId === 1) ?? liveCatalog()[0];
const now0 = Date.now();
const draft = { ...sku.nft, tier: "pro" as const, asset: "", owner: seller.publicKey.toBase58(), mintedAt: now0, updatedAt: now0, track: "live" as const, graduated: false, metrics: { ...sku.nft.metrics, workedSec: 0, aprPct: null } };
const assetKey = derivedKeypair(authority, `live-test:${now0}`);
const built = await buildCosigned({ rpcUrl: RPC, authority, wallet: seller.publicKey.toBase58(), tier: "pro", assetKey, name: `Live ${new Date(now0).toISOString().slice(11, 16)}`, attributes: mintAttributes(draft as never, now0) });
if (!built.ok) throw new Error(built.reason);
const asset = built.asset;
log("1 mint txs", await sendAll(seller, built.txs));
log("1 asset", asset);
const c1 = await chain(asset);
log("1 chain after mint", { owner: c1.owner, attrAuthority: c1.attrAuthority, freeze: c1.freeze, version: c1.spec?.version, hashOk: c1.spec?.hashOk, changedSec: c1.spec?.changedSec, unlockSec: c1.spec?.unlockSec });

// 2. change strategy -> v2, lock resets
await new Promise((r) => setTimeout(r, 3000));
const v = validateSpec({ lanes: ["crypto"], windows: [15, 60], risk: "calm", stakeSol: 0.015, askLo: 0.2, askHi: 0.8, edgeBps: 25, stopPct: 40, takePct: 80, rules: "allow yes if price <= 0.6; allow no if price <= 0.6; deny if hour < 1" });
if (!v.ok) throw new Error(v.errors.join(" "));
const prep = await S.prepareStrategy(env, { proof: proof(seller, "strategy", S.strategyExtra(asset, v.spec)), asset, spec: v.spec });
if (!prep.ok) throw new Error(prep.reason);
log("2 strategy txs", await sendAll(seller, prep.txs));
log("2 confirm", await S.confirmStrategy(env, { asset, version: prep.version }));
const c2 = await chain(asset);
log("2 chain after change", { version: c2.spec?.version, hash: c2.spec?.hash, expectedHash: specHash(v.spec), hashOk: c2.spec?.hashOk, changedSec: c2.spec?.changedSec, unlockSec: c2.spec?.unlockSec, lockHours: c2.spec ? (c2.spec.unlockSec - c2.spec.changedSec) / 3600 : null, freeze: c2.freeze, attrAuthority: c2.attrAuthority });

// 3. locked: server refuses listing, Core refuses a transfer
log("3 list while locked", await S.prepareList(env, { proof: proof(seller, "market", S.listExtra(asset, 10_000_000)), asset, priceLamports: 10_000_000 }));
try {
  const su = createUmi(RPC, "confirmed").use(signerIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(seller.secretKey))));
  const a = await fetchAsset(su, publicKey(asset));
  await transfer(su, { asset: a, collection: { publicKey: publicKey(S.serverCollectionOf(authority)), oracles: [], lifecycleHooks: [] }, newOwner: publicKey(buyer.publicKey.toBase58()) }).sendAndConfirm(su);
  log("3 direct transfer while locked", "UNEXPECTED: went through");
} catch (e) {
  const logs = ((e as { logs?: string[]; cause?: { logs?: string[] } }).logs ?? (e as { cause?: { logs?: string[] } }).cause?.logs ?? []).filter((l) => /Error|failed|frozen|Frozen|Invalid/i.test(l));
  log("3 direct transfer while locked", `refused: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300)} ${logs.join(" | ").slice(0, 300)}`);
}

// 4. past the lock (server clock only) -> list -> buy
clockShift = 241 * 3_600_000;
const price = 10_000_000;
const list = await S.prepareList(env, { proof: proof(seller, "market", S.listExtra(asset, price)), asset, priceLamports: price });
if (!list.ok) throw new Error(list.reason);
log("4 list txs", await sendAll(seller, list.txs));
log("4 confirm list", await S.confirmList(env, { asset }));
log("4 market", (await S.marketListings(env)).ok ? "listed" : "missing");
log("4 change strategy while listed", await S.prepareStrategy(env, { proof: proof(seller, "strategy", S.strategyExtra(asset, { ...v.spec, stopPct: 41 })), asset, spec: { ...v.spec, stopPct: 41 } }));
const balBefore = { seller: await conn.getBalance(seller.publicKey), treasury: await conn.getBalance(new PublicKey(PAY_WALLET)) };
const buy = await S.prepareBuy(env, { proof: proof(buyer, "market", S.buyExtra(asset, price)), asset, priceLamports: price });
if (!buy.ok) throw new Error(buy.reason);
const buySigs = await sendAll(buyer, buy.txs);
log("4 buy tx", buySigs);
log("4 confirm buy", await S.confirmBuy(env, { asset, sig: buySigs[0] }));
const balAfter = { seller: await conn.getBalance(seller.publicKey), treasury: await conn.getBalance(new PublicKey(PAY_WALLET)) };
log("4 seller +lamports", balAfter.seller - balBefore.seller);
log("4 treasury +lamports (5% royalty)", balAfter.treasury - balBefore.treasury);
const c4 = await chain(asset);
log("4 chain after buy", { owner: c4.owner, buyer: buyer.publicKey.toBase58(), freeze: c4.freeze, transferDelegate: c4.transferDelegate, version: c4.spec?.version });

// 5. results: positions for the new owner, server writes APR on chain
clockShift = 0;
const changedMs = (c4.spec?.changedSec ?? 0) * 1000;
const ownerNow = buyer.publicKey.toBase58();
const mk = (now: number, px: number): PositionDeps => ({
  sql,
  now,
  price: async () => px,
  agent: async (a) => {
    const got = await fetchCoreAgent(a);
    return got ? { owner: got.owner, free: false, attrs: got.attrs } : null;
  },
  market: async () => ({ lane: "crypto", window: 15 }),
});
await new Promise((r) => setTimeout(r, 6000));
const t = Date.now() - 4000;
const offSpec = await openPosition(mk(t, 0.4), { wallet: ownerNow, fillId: "live-off", asset, book: "poly:live", side: "yes", stakeLamports: 20_000_000 });
log("5 off-strategy open (stake 0.02 > 0.015)", offSpec);
for (const [i, [entry, exit]] of [[0.4, 0.48], [0.5, 0.45], [0.3, 0.36]].entries()) {
  const o = await openPosition(mk(t + i * 1000, entry), { wallet: ownerNow, fillId: `live-${i}`, asset, book: "poly:live", side: "yes", stakeLamports: 15_000_000 });
  if (!o.ok) throw new Error(o.reason);
  const c = await closePosition(mk(t + i * 1000 + 500, exit), { wallet: ownerNow, fillId: `live-${i}` });
  if (!c.ok) throw new Error(c.reason);
}
log("5 changedAt", new Date(changedMs).toISOString());
const sync = await S.syncAsset(env, asset);
log("5 sync", sync.ok ? { perfSig: sync.perfSig, thawSig: sync.thawSig, perf: sync.perf && { trades: sync.perf.trades, realizedSol: sync.perf.realizedSol, winRatePct: sync.perf.winRatePct, apr7: sync.perf.apr7, apr30: sync.perf.apr30, aprSince: sync.perf.aprSince } } : sync);
const c5 = await chain(asset);
log("5 chain results", c5.perf);
log("5 info", await S.strategyInfo(env, asset).then((i) => (i.ok ? { history: i.history, sales: i.sales.length, listing: i.listing?.status } : i)));
// 6. the new owner changes the strategy -> lock resets under the server; after 240 h the server thaws
const v3 = { ...v.spec, takePct: 90 };
const p3 = await S.prepareStrategy(env, { proof: proof(buyer, "strategy", S.strategyExtra(asset, v3)), asset, spec: v3 });
if (!p3.ok) throw new Error(p3.reason);
log("6 buyer strategy txs", await sendAll(buyer, p3.txs));
log("6 confirm", await S.confirmStrategy(env, { asset, version: p3.version }));
const c6 = await chain(asset);
log("6 chain after buyer change", { version: c6.spec?.version, changedSec: c6.spec?.changedSec, unlockSec: c6.spec?.unlockSec, freeze: c6.freeze, perfReset: c6.perf });
clockShift = 241 * 3_600_000;
const s6 = await S.syncAsset(env, asset);
log("6 sync after lock", s6.ok ? { thawSig: s6.thawSig, perfSig: s6.perfSig } : s6);
const c7 = await chain(asset);
log("6 chain after thaw", { freeze: c7.freeze, transferDelegate: c7.transferDelegate });
console.log("\nJSON", JSON.stringify(out));
