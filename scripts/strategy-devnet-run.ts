/**
 * Strategy NFTs on DEVNET with real signatures and the real server code (strategy.server.ts,
 * mint.server.ts buildCosigned, positions ledger) on a persistent PGLite database.
 * Keys: KEYS_DIR/{authority,seller,buyer}.json (devnet test keys, never mainnet; never committed).
 * Refuses to run unless the RPC's genesis hash is devnet. The server clock is never shifted:
 * the 240 h sale lock is honoured exactly as in production.
 *
 * Rule: the 240 h sale lock follows every strategy change; a fresh mint (strategy v1) is not locked.
 *
 *   PHASE=cycle    mint (v1) -> strategy change v2 (240 h lock) -> list refused by the server,
 *                  transfer refused by Core on chain (failed tx kept) -> scripted trades in the ledger ->
 *                  server writes results/APR into the NFT -> judge recompute -> faucet drip
 *   PHASE=demo     mint demo Strategy NFTs to the seller (distinct v1 strategies)
 *   PHASE=migrate  release the old mint-time lock on the demo NFTs (server syncAsset: su = sc, thaw)
 *   PHASE=market   list the demo NFTs; mint "Market Test", list it, buyer buys (5% royalty), buyer changes
 *                  the strategy -> listing refused, transfer refused on chain (lock again)
 *
 * Run: JITI_ALIAS='{"@/":"<repo>/src/"}' PHASE=cycle npx jiti scripts/strategy-devnet-run.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { mergeAttrs, mintSpecMeta, perfFromAttrs, specAttrs, specFromAttrs, specHash, validateSpec, verifyPerf, type StrategySpec } from "../src/lib/agents/strategy-spec.ts";
import { faucetDrip, FAUCET_DEFAULTS } from "../src/lib/agents/faucet.server.ts";
import { closePosition, openPosition, type PositionDeps } from "../src/lib/agents/positions-ledger.server.ts";
import { fetchCoreAgent } from "../src/lib/agents/core-owned.server.ts";
import nacl from "tweetnacl";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const RPC = process.env.SOLANA_RPC_DEVNET || "https://api.devnet.solana.com";
const PHASE = process.env.PHASE || "cycle";
const dir = process.env.KEYS_DIR || "/workspace/strategy-live";
const stateFile = process.env.STATE_FILE || `${dir}/devnet-state.json`;
const pgDir = process.env.PG_DIR || `${dir}/devnet-pg`;
const key = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"))));
const authority = key("authority");
const seller = key("seller");
const buyer = key("buyer");
const conn = new Connection(RPC, "confirmed");
if ((await conn.getGenesisHash()) !== DEVNET_GENESIS) throw new Error(`Not devnet: ${RPC}`);

type State = Record<string, unknown> & { cycle?: { asset: string }; demo?: { asset: string; name: string; hash: string; priceLamports: number }[] };
const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const out: Record<string, unknown> = {};
const ex = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const log = (k: string, v: unknown) => {
  out[k] = v;
  console.log(k, typeof v === "string" ? v : JSON.stringify(v));
};
const sigLog = (k: string, sigs: string[]) => {
  log(k, sigs);
  for (const s of sigs) console.log("   ", ex(s));
  const all = (state.sigs as { step: string; sig: string }[] | undefined) ?? [];
  for (const s of sigs) all.push({ step: k, sig: s });
  state.sigs = all;
  save();
};

if (!existsSync(pgDir)) mkdirSync(pgDir, { recursive: true });
const fresh = !existsSync(`${pgDir}/PG_VERSION`);
const pg = new PGlite(pgDir);
if (fresh) {
  for (const f of ["0002_guards.sql", "0003_mints.sql", "0004_payments.sql", "0005_positions.sql", "0006_strategy_market.sql"]) {
    await pg.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  }
}
const sql = { query: async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as never[] };
const env: S.StrategyEnv = { sql, authority, rpcUrl: RPC, treasury: PAY_WALLET, now: () => Date.now() };

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
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
    await conn.confirmTransaction(sig, "confirmed");
    const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true });
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
    name: a.name,
    owner: String(a.owner),
    attrAuthority: auth((a.attributes as { authority: { type: string; address?: unknown } } | undefined)?.authority),
    freeze: fd ? { frozen: fd.frozen, authority: auth(fd.authority) } : null,
    transferDelegate: auth(td?.authority),
    spec: specFromAttrs(attrs),
    perf: perfFromAttrs(attrs),
  };
}
const iso = (sec?: number) => (sec ? new Date(sec * 1000).toISOString() : null);

async function mintFor(owner: Keypair, label: string, skuId: string, name: string, spec: StrategySpec | null) {
  const sku = liveCatalog().find((s) => s.id === skuId);
  if (!sku) throw new Error(`sku ${skuId}`);
  const now0 = Date.now();
  const draft = { ...sku.nft, tier: "pro" as const, asset: "", owner: owner.publicKey.toBase58(), mintedAt: now0, updatedAt: now0, track: "live" as const, graduated: false, metrics: { ...sku.nft.metrics, workedSec: 0, aprPct: null } };
  let attributes = mintAttributes(draft as never, now0);
  if (spec) {
    // Strategy chosen at mint: still v1 with the mint meta (no sale lock), same as any mint.
    attributes = mergeAttrs(attributes, specAttrs(spec, mintSpecMeta(Math.floor(now0 / 1000))));
  }
  const assetKey = derivedKeypair(authority, `devnet-${label}:${now0}`);
  const built = await buildCosigned({ rpcUrl: RPC, authority, wallet: owner.publicKey.toBase58(), tier: "pro", assetKey, name, attributes });
  if (!built.ok) throw new Error(built.reason);
  return { asset: built.asset, sigs: await sendAll(owner, built.txs) };
}

/** Owner tries to move a frozen NFT. Sent without preflight so the refusal is a failed tx on chain. */
async function transferWhileLocked(asset: string, from: Keypair, to: Keypair): Promise<{ sig: string; err: unknown; logs: string[] }> {
  const su = createUmi(RPC, "confirmed").use(signerIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(from.secretKey))));
  const a = await fetchAsset(su, publicKey(asset));
  const res = await transfer(su, { asset: a, collection: { publicKey: publicKey(S.serverCollectionOf(authority)), oracles: [], lifecycleHooks: [] }, newOwner: publicKey(to.publicKey.toBase58()) }).send(su, {
    skipPreflight: true,
  });
  const sig = encodeBase58(res);
  await conn.confirmTransaction(sig, "confirmed").catch(() => null);
  let tx = null;
  for (let i = 0; i < 10 && !tx; i++) {
    tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) await new Promise((r) => setTimeout(r, 1500));
  }
  return { sig, err: tx?.meta?.err ?? "not found", logs: (tx?.meta?.logMessages ?? []).filter((l) => /Error|failed|frozen/i.test(l)) };
}

log("rpc", RPC);
log("phase", PHASE);
for (const kp of [authority, seller, buyer]) log(`balance ${kp.publicKey.toBase58()}`, (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL);
log("server authority", authority.publicKey.toBase58());
log("server collection", S.serverCollectionOf(authority));
state.collection = S.serverCollectionOf(authority);
state.authority = authority.publicKey.toBase58();
save();

const cycleSpec = validateSpec({ lanes: ["crypto"], windows: [15, 60], risk: "calm", stakeSol: 0.015, askLo: 0.2, askHi: 0.8, edgeBps: 25, stopPct: 40, takePct: 80, rules: "allow yes if price <= 0.6; allow no if price <= 0.6; deny if hour < 1" });
if (!cycleSpec.ok) throw new Error(cycleSpec.errors.join(" "));

if (PHASE === "cycle") {
  // 1. mint (seller pays; server co-signs; frozen under the server from the first second)
  const m = await mintFor(seller, "cycle", "sku-pred-alpha-pro", "Lock Test BTC Windows", null);
  const asset = m.asset;
  state.cycle = { asset };
  save();
  sigLog("1 mint txs", m.sigs);
  log("1 asset", asset);
  const c1 = await chain(asset);
  log("1 chain after mint", { owner: c1.owner, attrAuthority: c1.attrAuthority, freeze: c1.freeze, version: c1.spec?.version, hash: c1.spec?.hash, hashOk: c1.spec?.hashOk, changedAt: iso(c1.spec?.changedSec), unlockAt: iso(c1.spec?.unlockSec) });

  // 2. strategy change -> v2, lock reset to +240 h
  await new Promise((r) => setTimeout(r, 4000));
  const prep = await S.prepareStrategy(env, { proof: proof(seller, "strategy", S.strategyExtra(asset, cycleSpec.spec)), asset, spec: cycleSpec.spec });
  if (!prep.ok) throw new Error(prep.reason);
  const sSigs = await sendAll(seller, prep.txs);
  sigLog("2 strategy change txs", sSigs);
  log("2 confirm", await S.confirmStrategy(env, { asset, version: prep.version, sig: sSigs[sSigs.length - 1] }));
  const c2 = await chain(asset);
  log("2 chain after change", { version: c2.spec?.version, hash: c2.spec?.hash, expectedHash: specHash(cycleSpec.spec), hashOk: c2.spec?.hashOk, changedAt: iso(c2.spec?.changedSec), unlockAt: iso(c2.spec?.unlockSec), lockHours: c2.spec ? (c2.spec.unlockSec - c2.spec.changedSec) / 3600 : null, freeze: c2.freeze, attrAuthority: c2.attrAuthority });

  // 3. locked: the server refuses the listing; Core refuses the transfer on chain
  log("3 list while locked", await S.prepareList(env, { proof: proof(seller, "market", S.listExtra(asset, 50_000_000)), asset, priceLamports: 50_000_000 }));
  const t = await transferWhileLocked(asset, seller, buyer);
  sigLog("3 direct transfer while locked (expected to FAIL on chain)", [t.sig]);
  log("3 transfer result", { err: t.err, logs: t.logs });
  log("3 owner after refused transfer", (await chain(asset)).owner);

  // 4. results: scripted trades in the server ledger (simulated prices), server writes APR/PnL on chain
  const ownerNow = seller.publicKey.toBase58();
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
  const t0 = Date.now() - 4000;
  log("4 off-strategy open (stake 0.02 > 0.015)", await openPosition(mk(t0, 0.4), { wallet: ownerNow, fillId: "dev-off", asset, book: "poly:devnet-sim", side: "yes", stakeLamports: 20_000_000 }));
  for (const [i, [entry, exit]] of [[0.4, 0.48], [0.5, 0.45], [0.3, 0.36]].entries()) {
    const o = await openPosition(mk(t0 + i * 1000, entry), { wallet: ownerNow, fillId: `dev-${i}`, asset, book: "poly:devnet-sim", side: "yes", stakeLamports: 15_000_000 });
    if (!o.ok) throw new Error(o.reason);
    const c = await closePosition(mk(t0 + i * 1000 + 500, exit), { wallet: ownerNow, fillId: `dev-${i}` });
    if (!c.ok) throw new Error(c.reason);
  }
  const sync = await S.syncAsset(env, asset);
  if (!sync.ok) throw new Error(sync.reason);
  if (sync.perfSig) sigLog("4 server results write (APR/PnL) tx", [sync.perfSig]);
  log("4 sync", { perfSig: sync.perfSig, thawSig: sync.thawSig, perf: sync.perf && { trades: sync.perf.trades, realizedSol: sync.perf.realizedSol, winRatePct: sync.perf.winRatePct, apr7: sync.perf.apr7, apr30: sync.perf.apr30, aprSince: sync.perf.aprSince } });
  const c4 = await chain(asset);
  log("4 chain results", c4.perf);
  log("4 still frozen under server (no early thaw)", c4.freeze);
  const info = await S.strategyInfo(env, asset);
  if (info.ok && info.chain && info.perf) {
    const v = verifyPerf(info.records, info.chain.changedSec, info.perf);
    log("4 judge verify", { ok: v.ok, mismatches: v.mismatches, recomputed: { trades: v.recomputed.trades, aprSince: v.recomputed.aprSince, apr7: v.recomputed.apr7 }, onChain: info.perf });
  }

  // 5. judge faucet: one drip to a fresh wallet, the second ask the same day is refused
  {
    const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
    const judge = Keypair.generate();
    const fdeps = {
      sql, rpcUrl: RPC, now: Date.now(), caps: { ...FAUCET_DEFAULTS, dripLamports: 20_000_000 }, faucet: authority,
      balance: (w: string) => conn.getBalance(new PublicKey(w)),
      send: (to: string, lamports: number) => sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: new PublicKey(to), lamports })), [authority], { commitment: "confirmed" }),
    };
    const sign = (ts: number) => ({ wallet: judge.publicKey.toBase58(), ts, sig: encodeBase58(nacl.sign.detached(new TextEncoder().encode(proofMessage("faucet", judge.publicKey.toBase58(), ts, "devnet")), judge.secretKey)) });
    const first = await faucetDrip(fdeps as never, { proof: sign(Date.now()), ip: "devnet-run" });
    const again = await faucetDrip({ ...fdeps, now: Date.now() + 1 } as never, { proof: sign(Date.now() + 1), ip: "devnet-run" });
    if ((first as { sig?: string }).sig) sigLog("5 faucet drip tx", [(first as { sig: string }).sig]);
    log("5 faucet", { judge: judge.publicKey.toBase58(), first, again, balance: await conn.getBalance(judge.publicKey) });
  }
}

const DEMOS: { label: string; sku: string; name: string; priceSol: number; spec: unknown }[] = [
  {
    label: "demo-calm",
    sku: "sku-pred-alpha-pro",
    name: "Calm Hourly BTC",
    priceSol: 0.05,
    spec: { lanes: ["crypto"], windows: [60, 240], risk: "calm", stakeSol: 0.005, askLo: 0.35, askHi: 0.65, edgeBps: 60, stopPct: 25, takePct: 40, rules: "allow if price >= 0.4 and price <= 0.6; deny if hour < 6" },
  },
  {
    label: "demo-momentum",
    sku: "sku-pred-alpha-pro",
    name: "Momentum Rider 5m",
    priceSol: 0.12,
    spec: { lanes: ["crypto"], windows: [5, 15], risk: "risky", stakeSol: 0.02, askLo: 0.55, askHi: 0.9, edgeBps: 20, stopPct: 50, takePct: 120, rules: "allow yes if price >= 0.6; allow no if price >= 0.6; deny if price > 0.88" },
  },
  {
    label: "demo-meanrev",
    sku: "sku-combo-prime-pro",
    name: "Mean Revert Scout",
    priceSol: 0.08,
    spec: { lanes: ["crypto", "events"], windows: [15, 60], risk: "balanced", stakeSol: 0.01, askLo: 0.1, askHi: 0.4, edgeBps: 40, stopPct: 35, takePct: 150, rules: "allow if price <= 0.35; deny if price < 0.12; deny if lane = events and stake > 0.008" },
  },
];

if (PHASE === "demo") {
  state.demo = state.demo ?? [];
  for (const d of DEMOS) {
    if (state.demo.some((x) => x.name === d.name)) continue;
    const v = validateSpec(d.spec);
    if (!v.ok) throw new Error(`${d.name}: ${v.errors.join(" ")}`);
    const m = await mintFor(seller, d.label, d.sku, d.name, v.spec);
    state.demo.push({ asset: m.asset, name: d.name, hash: specHash(v.spec), priceLamports: Math.round(d.priceSol * LAMPORTS_PER_SOL) });
    save();
    sigLog(`demo mint ${d.name}`, m.sigs);
    const c = await chain(m.asset);
    log(`demo ${d.name}`, { asset: m.asset, owner: c.owner, version: c.spec?.version, hashOk: c.spec?.hashOk, hash: c.spec?.hash, risk: c.spec?.spec.risk, rules: c.spec?.spec.rules, freeze: c.freeze, unlockAt: iso(c.spec?.unlockSec) });
    log(`demo ${d.name} list now`, await S.prepareList(env, { proof: proof(seller, "market", S.listExtra(m.asset, Math.round(d.priceSol * LAMPORTS_PER_SOL))), asset: m.asset, priceLamports: Math.round(d.priceSol * LAMPORTS_PER_SOL) }));
    await new Promise((r) => setTimeout(r, 1500));
  }
}

if (PHASE === "migrate") {
  // Corrected rule: the demo NFTs were minted while the lock wrongly started at mint (v1, never changed).
  // The server's normal sync releases that lock (attrs su = sc, server-signed) and thaws (freeze authority back to the owner).
  for (const d of state.demo ?? []) {
    const before = await chain(d.asset);
    log(`migrate ${d.name} before`, { version: before.spec?.version, changedAt: iso(before.spec?.changedSec), unlockAt: iso(before.spec?.unlockSec), freeze: before.freeze });
    const r = await S.syncAsset(env, d.asset);
    if (!r.ok) throw new Error(`${d.name}: ${r.reason}`);
    if (r.releaseSig) sigLog(`migrate ${d.name} release mint lock (su = sc) tx`, [r.releaseSig]);
    if (r.perfSig) sigLog(`migrate ${d.name} results attrs init (0 trades) tx`, [r.perfSig]);
    if (r.thawSig) sigLog(`migrate ${d.name} thaw tx`, [r.thawSig]);
    const after = await chain(d.asset);
    log(`migrate ${d.name} after`, { version: after.spec?.version, hashOk: after.spec?.hashOk, changedAt: iso(after.spec?.changedSec), unlockAt: iso(after.spec?.unlockSec), freeze: after.freeze });
  }
  const lt = state.cycle?.asset;
  if (lt) {
    const r = await S.syncAsset(env, lt);
    const c = await chain(lt);
    log("migrate Lock Test (v2, changed) untouched", { sync: r.ok ? { releaseSig: r.releaseSig, thawSig: r.thawSig, perfSig: r.perfSig } : r, version: c.spec?.version, unlockAt: iso(c.spec?.unlockSec), freeze: c.freeze });
  }
}

if (PHASE === "market") {
  // 1. list the demo NFTs at their prices (escrow: freeze + transfer delegate to the server)
  for (const d of state.demo ?? []) {
    const l = await S.prepareList(env, { proof: proof(seller, "market", S.listExtra(d.asset, d.priceLamports)), asset: d.asset, priceLamports: d.priceLamports });
    if (!l.ok) {
      log(`market list ${d.name}`, l);
      continue;
    }
    sigLog(`market list ${d.name} (${d.priceLamports / LAMPORTS_PER_SOL} SOL) tx`, await sendAll(seller, l.txs));
    log(`market confirm ${d.name}`, await S.confirmList(env, { asset: d.asset }));
    const c = await chain(d.asset);
    log(`market ${d.name} escrow`, { owner: c.owner, freeze: c.freeze, transferDelegate: c.transferDelegate });
  }
  // 2. Market Test: fresh mint under the new rule -> list -> buy
  const m = await mintFor(seller, "market-test", "sku-pred-alpha-pro", "Market Test", null);
  const asset = m.asset;
  state.marketTest = { asset };
  save();
  sigLog("market Market Test mint tx", m.sigs);
  const c0 = await chain(asset);
  log("market Market Test after mint", { asset, owner: c0.owner, version: c0.spec?.version, hashOk: c0.spec?.hashOk, changedAt: iso(c0.spec?.changedSec), unlockAt: iso(c0.spec?.unlockSec), freeze: c0.freeze });
  const price = 20_000_000;
  const l = await S.prepareList(env, { proof: proof(seller, "market", S.listExtra(asset, price)), asset, priceLamports: price });
  if (!l.ok) throw new Error(`Market Test list: ${l.reason}`);
  sigLog("market Market Test list (0.02 SOL) tx", await sendAll(seller, l.txs));
  log("market Market Test confirm list", await S.confirmList(env, { asset }));
  const before = { seller: await conn.getBalance(seller.publicKey), treasury: await conn.getBalance(new PublicKey(PAY_WALLET)), buyer: await conn.getBalance(buyer.publicKey) };
  const b = await S.prepareBuy(env, { proof: proof(buyer, "market", S.buyExtra(asset, price)), asset, priceLamports: price });
  if (!b.ok) throw new Error(b.reason);
  log("market Market Test split", { sellerLamports: b.sellerLamports, royaltyLamports: b.royaltyLamports });
  const bs = await sendAll(buyer, b.txs);
  sigLog("market Market Test buy tx", bs);
  log("market Market Test confirm buy", await S.confirmBuy(env, { asset, sig: bs[0] }));
  const after = { seller: await conn.getBalance(seller.publicKey), treasury: await conn.getBalance(new PublicKey(PAY_WALLET)), buyer: await conn.getBalance(buyer.publicKey) };
  log("market seller +lamports (95%)", after.seller - before.seller);
  log("market treasury +lamports (5% royalty)", after.treasury - before.treasury);
  log("market buyer -lamports (price + fee)", before.buyer - after.buyer);
  const c1 = await chain(asset);
  log("market Market Test after buy", { owner: c1.owner, isBuyer: c1.owner === buyer.publicKey.toBase58(), freeze: c1.freeze, transferDelegate: c1.transferDelegate });
  // 3. the new owner changes the strategy -> 240 h lock again
  await new Promise((r) => setTimeout(r, 3000));
  const v2 = { ...cycleSpec.spec, takePct: 90 };
  const p2 = await S.prepareStrategy(env, { proof: proof(buyer, "strategy", S.strategyExtra(asset, v2)), asset, spec: v2 });
  if (!p2.ok) throw new Error(p2.reason);
  const s2 = await sendAll(buyer, p2.txs);
  sigLog("market Market Test buyer strategy change txs", s2);
  log("market Market Test confirm change", await S.confirmStrategy(env, { asset, version: p2.version, sig: s2[s2.length - 1] }));
  const c2 = await chain(asset);
  log("market Market Test after change", { owner: c2.owner, version: c2.spec?.version, hashOk: c2.spec?.hashOk, changedAt: iso(c2.spec?.changedSec), unlockAt: iso(c2.spec?.unlockSec), lockHours: c2.spec ? (c2.spec.unlockSec - c2.spec.changedSec) / 3600 : null, freeze: c2.freeze });
  log("market Market Test list after change", await S.prepareList(env, { proof: proof(buyer, "market", S.listExtra(asset, price)), asset, priceLamports: price }));
  const t = await transferWhileLocked(asset, buyer, seller);
  sigLog("market Market Test transfer while locked (expected to FAIL on chain)", [t.sig]);
  log("market Market Test transfer result", { err: t.err, logs: t.logs });
  log("market Market Test owner after refused transfer", (await chain(asset)).owner);
  const ml = await S.marketListings(env);
  log("market listings", ml.ok ? ml.items.map((i) => ({ asset: i.asset, name: i.name, priceLamports: i.priceLamports })) : ml);
}
for (const kp of [authority, seller, buyer]) log(`balance end ${kp.publicKey.toBase58()}`, (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL);
await pg.close();
console.log("\nJSON", JSON.stringify(out));
