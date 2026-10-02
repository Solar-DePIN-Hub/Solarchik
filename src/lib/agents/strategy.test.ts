import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Keypair } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey, createNoopSigner } from "@metaplex-foundation/umi";
import type { AssetV1 } from "@metaplex-foundation/mpl-core";
import {
  SALE_LOCK_HOURS,
  attrsEqual,
  checkTrade,
  computePerf,
  exitByRule,
  laneOfMarket,
  listPriceOk,
  lockLabel,
  mergeAttrs,
  parseRules,
  perfAttrs,
  perfFromAttrs,
  rulesAllow,
  saleLockLeftMs,
  sha256,
  specAttrs,
  specFromAttrs,
  specFromStrategy,
  specHash,
  splitSale,
  unlockSecFor,
  mintSpecMeta,
  mintLockToRelease,
  validateSpec,
  verifyPerf,
  explorerUrl,
  type StrategySpec,
} from "./strategy-spec.ts";
import { faucetDrip, FAUCET_DEFAULTS, isDevnetRpc, type FaucetDeps } from "./faucet.server.ts";
import { proofMessage } from "./wallet-proof.ts";
import { encodeBase58 } from "./base58.ts";
import { buildBuyTx, buildListTx, buildStrategyTxs, coreState, thawBuilder, txSize } from "./strategy-chain.server.ts";
import type { GuardSql } from "./guard-ledger.server.ts";
import { closePosition, openPosition, type PositionDeps } from "./positions-ledger.server.ts";
import * as ledger from "./strategy-ledger.server.ts";

const DAY = 86_400_000;
const base: StrategySpec = {
  lanes: ["crypto"],
  windows: [15],
  risk: "balanced",
  stakeSol: 0.02,
  askLo: 0.2,
  askHi: 0.8,
  edgeBps: 18,
  stopPct: 50,
  takePct: 100,
  rules: "",
};

describe("strategy spec: validation", () => {
  it("accepts a good spec and normalizes it", () => {
    const r = validateSpec({ ...base, lanes: ["events", "crypto"], windows: [60, 15], stakeSol: 0.012345, askLo: 0.234, rules: "ALLOW yes IF price<0.5" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.spec.lanes, ["crypto", "events"]);
    assert.deepEqual(r.spec.windows, [15, 60]);
    assert.equal(r.spec.stakeSol, 0.0123);
    assert.equal(r.spec.askLo, 0.23);
    assert.equal(r.spec.rules, "allow yes if price < 0.5");
  });
  it("refuses every bad field with a reason", () => {
    const bad = (patch: Record<string, unknown>) => {
      const r = validateSpec({ ...base, ...patch });
      assert.equal(r.ok, false, JSON.stringify(patch));
    };
    bad({ lanes: [] });
    bad({ lanes: ["crypto", "crypto"] });
    bad({ lanes: ["stocks"] });
    bad({ windows: [] });
    bad({ windows: [15, 30] });
    bad({ risk: "yolo" });
    bad({ stakeSol: 0.021 });
    bad({ stakeSol: 0.001 });
    bad({ askLo: 0.8, askHi: 0.2 });
    bad({ askHi: 0.99 });
    bad({ edgeBps: 900 });
    bad({ stopPct: 0 });
    bad({ stopPct: 12.5 });
    bad({ takePct: 600 });
    bad({ rules: "buy everything" });
    bad({ rules: "x".repeat(200) });
  });
  it("events-only spec needs no windows", () => {
    const r = validateSpec({ ...base, lanes: ["events"], windows: [] });
    assert.ok(r.ok && r.spec.windows.length === 0);
  });
  it("default spec from a local strategy is valid", () => {
    const s = specFromStrategy({ lanes: ["crypto", "events"], laneOn: { events: false }, windows: [5], maxStakeSol: 0.5, risk: "risky" });
    assert.deepEqual(s.lanes, ["crypto"]);
    assert.equal(s.stakeSol, 0.02, "clamped to the 0.02 cap");
    assert.equal(s.risk, "risky");
    assert.ok(validateSpec(s).ok);
  });
});

describe("strategy spec: rules DSL", () => {
  const ctx = { side: "yes" as const, price: 0.4, hour: 12, window: 15, lane: "crypto" as const, stake: 0.01 };
  it("parses and explains errors", () => {
    assert.ok(parseRules("allow yes if price < 0.45; deny if hour < 6").ok);
    assert.ok(parseRules("allow if lane = events and stake <= 0.01\nallow no").ok);
    const e = parseRules("allow if colour = red");
    assert.ok(!e.ok && /не розібрав/.test(e.error));
    assert.equal(parseRules("deny").ok, false, "bare deny would block everything");
    assert.equal(parseRules("allow if lane < crypto").ok, false);
    assert.equal(parseRules("allow if price < 2").ok, false);
    assert.equal(parseRules("allow; allow; allow; allow; allow; allow; allow").ok, false, "max 6 rules");
  });
  it("deny wins, allow is required when present, side-specific rules", () => {
    const rules = (t: string) => {
      const p = parseRules(t);
      assert.ok(p.ok);
      return p.ok ? p.rules : [];
    };
    assert.ok(rulesAllow([], ctx).ok, "no rules = everything the fields allow");
    assert.ok(rulesAllow(rules("allow yes if price <= 0.45"), ctx).ok);
    assert.equal(rulesAllow(rules("allow yes if price <= 0.35"), ctx).ok, false);
    assert.equal(rulesAllow(rules("allow no"), ctx).ok, false, "only no allowed");
    assert.equal(rulesAllow(rules("allow; deny if hour >= 12"), ctx).ok, false, "deny beats allow");
    assert.ok(rulesAllow(rules("deny no if price > 0.3"), ctx).ok, "deny for the other side");
    assert.equal(rulesAllow(rules("deny if lane = crypto and window = 15"), ctx).ok, false);
    assert.ok(rulesAllow(rules("deny if lane != crypto"), ctx).ok);
  });
});

describe("strategy spec: hash + attributes", () => {
  it("sha256 matches node crypto", () => {
    for (const text of ["", "abc", "x".repeat(1000), "солярчик"]) {
      const bytes = new TextEncoder().encode(text);
      assert.equal(Buffer.from(sha256(bytes)).toString("hex"), createHash("sha256").update(bytes).digest("hex"));
    }
  });
  it("hash changes with any field and stays the same for the same spec", () => {
    assert.equal(specHash(base), specHash({ ...base }));
    assert.notEqual(specHash(base), specHash({ ...base, stopPct: 51 }));
    assert.notEqual(specHash(base), specHash({ ...base, rules: "allow yes" }));
    assert.ok(specHash(base).length <= 44);
  });
  it("attributes round-trip, and a tampered value fails the hash", () => {
    const spec = { ...base, lanes: ["crypto", "weather"] as StrategySpec["lanes"], windows: [5, 240], rules: "allow yes if price < 0.6; deny if hour < 3" };
    const attrs = specAttrs(spec, { version: 3, changedSec: 1_700_000_000, unlockSec: unlockSecFor(1_700_000_000) });
    const back = specFromAttrs(attrs);
    assert.ok(back);
    assert.deepEqual(back?.spec, spec);
    assert.equal(back?.version, 3);
    assert.equal(back?.hashOk, true);
    assert.equal(back?.unlockSec, 1_700_000_000 + 240 * 3600);
    const tampered = attrs.map((a) => (a.key === "ps" ? { ...a, value: "0.019" } : a));
    assert.equal(specFromAttrs(tampered)?.hashOk, false);
    assert.equal(specFromAttrs([{ key: "class", value: "1" }]), null, "legacy asset has no spec");
  });
  it("merge replaces keys and keeps the rest", () => {
    const merged = mergeAttrs([{ key: "class", value: "1" }, { key: "ps", value: "0.5" }], [{ key: "ps", value: "0.02" }]);
    assert.deepEqual(merged, [{ key: "class", value: "1" }, { key: "ps", value: "0.02" }]);
    assert.ok(attrsEqual([{ key: "a", value: "1" }, { key: "b", value: "2" }], [{ key: "b", value: "2" }, { key: "a", value: "1" }]));
  });
});

describe("strategy spec: sale lock", () => {
  it("is 240 h from the last change", () => {
    assert.equal(SALE_LOCK_HOURS, 240);
    const changed = 1_700_000_000;
    assert.equal(unlockSecFor(changed) - changed, 864_000);
    assert.equal(saleLockLeftMs(unlockSecFor(changed), changed * 1000), 240 * 3_600_000);
    assert.equal(saleLockLeftMs(unlockSecFor(changed), (changed + 864_000) * 1000), 0);
    assert.equal(lockLabel(0), "відкрито");
    assert.equal(lockLabel(3_600_000 * 239 + 60_000 * 5), "239 год 05 хв");
  });
  it("does not start at mint: v1 unlocks at the mint second; a change locks 240 h", () => {
    const mintSec = 1_790_000_000;
    const m = mintSpecMeta(mintSec);
    assert.deepEqual(m, { version: 1, changedSec: mintSec, unlockSec: mintSec });
    assert.equal(saleLockLeftMs(m.unlockSec, mintSec * 1000), 0, "listable right after mint");
    const back = specFromAttrs(specAttrs(base, m));
    assert.equal(back?.unlockSec, back?.changedSec);
    const changeSec = mintSec + 60;
    assert.equal(saleLockLeftMs(unlockSecFor(changeSec), changeSec * 1000), 240 * 3_600_000, "any change re-locks for 240 h");
  });
  it("releases only an old-rule mint lock (v1, su > sc, never changed through the server)", () => {
    const sc = 1_790_000_000;
    assert.equal(mintLockToRelease({ version: 1, changedSec: sc, unlockSec: unlockSecFor(sc) }, 0), true);
    assert.equal(mintLockToRelease({ version: 1, changedSec: sc, unlockSec: unlockSecFor(sc) }, 1), false, "a server-signed first save is a change");
    assert.equal(mintLockToRelease({ version: 2, changedSec: sc, unlockSec: unlockSecFor(sc) }, 0), false, "v2+ keeps its lock");
    assert.equal(mintLockToRelease({ version: 1, changedSec: sc, unlockSec: sc }, 0), false, "nothing to release");
  });
  it("the co-signed mint writes the v1 meta without a lock and does not freeze", () => {
    const src = readFileSync(new URL("./mint.server.ts", import.meta.url), "utf8");
    assert.match(src, /specAttrs\(spec, mintSpecMeta\(nowSec\)\)/);
    assert.match(src, /type: "FreezeDelegate", frozen: false, authority: \{ type: "Owner" \}/);
    assert.doesNotMatch(src, /type: "FreezeDelegate", frozen: true/);
  });
});

describe("strategy spec: trades follow the chain", () => {
  const t = { side: "yes", yesPx: 0.4, lane: "crypto" as const, window: 15, stakeSol: 0.01, hourUtc: 10 };
  it("checks lane, window, stake, price band and rules", () => {
    assert.ok(checkTrade(base, t).ok);
    assert.equal(checkTrade(base, { ...t, lane: "events", window: 0 }).ok, false, "lane off");
    assert.equal(checkTrade(base, { ...t, window: 60 }).ok, false, "window off");
    assert.equal(checkTrade(base, { ...t, stakeSol: 0.021 }).ok, false, "stake over spec");
    assert.equal(checkTrade(base, { ...t, yesPx: 0.1 }).ok, false, "price below band");
    assert.ok(checkTrade(base, { ...t, yesPx: 0.17 }).ok, "inside drift");
    assert.equal(checkTrade(base, { ...t, side: "no", yesPx: 0.05 }).ok, false, "no side pays 0.95");
    assert.equal(checkTrade({ ...base, rules: "deny if hour < 12" }, t).ok, false);
    assert.ok(checkTrade({ ...base, rules: "allow no; allow yes if price <= 0.4" }, t).ok);
  });
  it("stop / take on the stake", () => {
    assert.equal(exitByRule(base, "yes", 0.5, 0.24), "stop");
    assert.equal(exitByRule(base, "yes", 0.5, 0.3), null);
    assert.equal(exitByRule(base, "yes", 0.4, 0.8), "take");
    assert.equal(exitByRule(base, "no", 0.5, 0.76), "stop", "no loses when yes rises");
    assert.equal(exitByRule(base, "yes", 0, 0.5), null);
  });
  it("lane from the market slug", () => {
    assert.deepEqual(laneOfMarket({ slug: "btc-updown-15m-1759400000" }), { lane: "crypto", window: 15 });
    assert.deepEqual(laneOfMarket({ slug: "btc-updown-4h-1759400000" }), { lane: "crypto", window: 240 });
    assert.deepEqual(laneOfMarket({ slug: "bitcoin-up-or-down-october-2-2026-10am-et" }), { lane: "crypto", window: 60 });
    assert.equal(laneOfMarket({ slug: "highest-temperature-in-nyc", question: "" }).lane, "weather");
    assert.equal(laneOfMarket({ slug: "will-x-win", question: "Will X win?" }).lane, "events");
  });
});

describe("strategy spec: performance + APR", () => {
  const now = Date.UTC(2026, 9, 2);
  it("APR = PnL / capital × 365 / days, since the change, min 1 day", () => {
    const changed = now - 10 * DAY;
    const trades = [
      { openedMs: changed - DAY, closedMs: changed - DAY + 1, stakeLamports: 20_000_000, pnlLamports: 50_000_000 }, // before change: ignored
      { openedMs: now - 9 * DAY, closedMs: now - 9 * DAY, stakeLamports: 20_000_000, pnlLamports: 2_000_000 },
      { openedMs: now - 2 * DAY, closedMs: now - 2 * DAY, stakeLamports: 10_000_000, pnlLamports: -1_000_000 },
      { openedMs: now - DAY, closedMs: now - DAY, stakeLamports: 20_000_000, pnlLamports: 1_000_000 },
    ];
    const p = computePerf(trades, changed, now);
    assert.equal(p.trades, 3);
    assert.equal(p.wins, 2);
    assert.equal(p.losses, 1);
    assert.equal(p.realizedSol, 0.002);
    assert.equal(p.winRatePct, 66.7);
    // since change: 0.002 / 0.02 × 365 / 10 × 100 = 365%
    assert.equal(p.aprSince, 365);
    // 7 d: trades at -2d and -1d: 0 / 0.02 → 0%
    assert.equal(p.apr7, 0);
    // 30 d is clamped to the change (10 d) → same as since change
    assert.equal(p.apr30, 365);
    assert.deepEqual(p.history.map((h) => h.cumSol), [0.002, 0.001, 0.002]);
  });
  it("no trades = no APR; a fresh change uses a 1-day floor", () => {
    assert.equal(computePerf([], now - DAY, now).aprSince, null);
    const p = computePerf([{ openedMs: now - 1000, closedMs: now, stakeLamports: 20_000_000, pnlLamports: 200_000 }], now - 60_000, now);
    assert.equal(p.aprSince, 365, "0.0002/0.02 × 365 × 100 over the 1-day floor");
  });
  it("results attributes round-trip", () => {
    const p = computePerf([{ openedMs: now - DAY, closedMs: now, stakeLamports: 20_000_000, pnlLamports: 1_000_000 }], now - 2 * DAY, now);
    const attrs = perfAttrs(p, { trades: 5, wins: 3, losses: 2, pnlSol: 0.004 }, now);
    const back = perfFromAttrs(attrs);
    assert.equal(back?.trades, 1);
    assert.equal(back?.aprSince, p.aprSince);
    assert.equal(back?.apr7, p.apr7);
    assert.equal(back?.realizedSol, 0.001);
    assert.equal(attrs.find((a) => a.key === "jobs")?.value, "5");
  });
});

describe("market rules", () => {
  it("5% royalty, integer lamports, seller gets the rest", () => {
    assert.deepEqual(splitSale(100_000_000), { seller: 95_000_000, royalty: 5_000_000 });
    const odd = splitSale(1_000_001);
    assert.equal(odd.seller + odd.royalty, 1_000_001);
    assert.ok(listPriceOk(10_000_000));
    assert.equal(listPriceOk(999_999), false);
    assert.equal(listPriceOk(1.5e6 + 0.5), false);
  });
});

/* ------------------------------ Core transactions ------------------------------ */

function fakeAsset(opts: {
  owner: string;
  collection: string;
  attrAuth?: "Owner" | "UpdateAuthority";
  freeze?: { frozen: boolean; authority: string } | null;
  transfer?: string | null;
  attrs?: { key: string; value: string }[];
}): AssetV1 {
  const auth = (a: string) => (a === "Owner" || a === "UpdateAuthority" ? { type: a } : { type: "Address", address: publicKey(a) });
  return {
    publicKey: publicKey(Keypair.generate().publicKey.toBase58()),
    owner: publicKey(opts.owner),
    updateAuthority: { type: "Collection", address: publicKey(opts.collection) },
    name: "Agent",
    uri: "urn:solarchik:agent:pro",
    oracles: [],
    lifecycleHooks: [],
    ...(opts.attrAuth ? { attributes: { authority: auth(opts.attrAuth), attributeList: opts.attrs ?? [] } } : {}),
    ...(opts.freeze ? { freezeDelegate: { authority: auth(opts.freeze.authority), frozen: opts.freeze.frozen } } : {}),
    ...(opts.transfer ? { transferDelegate: { authority: auth(opts.transfer) } } : {}),
  } as unknown as AssetV1;
}

describe("Core transactions (built offline)", () => {
  const umi = createUmi("http://127.0.0.1:1");
  const authority = Keypair.generate();
  const server = authority.publicKey.toBase58();
  const owner = Keypair.generate().publicKey.toBase58();
  const buyer = Keypair.generate().publicKey.toBase58();
  const collection = Keypair.generate().publicKey.toBase58();
  const blockhash = Keypair.generate().publicKey.toBase58();
  // A full combo agent's legacy attributes + the longest allowed rules (160 chars).
  const legacy = [["class","3"],["tr","pro"],["role","combo"],["track","live"],["days","90"],["grad","0"],["wh","123"],["ws","3599"],["apr","12.5"],["xp","1234"],["jobs","123"],["wins","60"],["losses","63"],["pnl","0.01234"],["pm","Bitcoin"],["pv","poly"],["pf","mix"],["ln","cew"],["lo","cew"],["ed","2"],["wo","0"],["pwin","15"],["pw","5.15.60.240"],["ab","0.15-0.85"],["pe","18.0"],["ps","0.02"],["dp","SOL/USDC"],["di","900"],["da","0.02"],["dsl","40"],["dd","both"]].map(([key, value]) => ({ key, value }));
  const longRules = "allow yes if price < 0.45 and hour >= 6; allow no if price < 0.45 and hour >= 6; deny if stake > 0.015 and lane = events; deny if hour < 3 and window = 5";
  const attrs = mergeAttrs(
    legacy,
    specAttrs({ ...base, lanes: ["crypto", "events", "weather"], windows: [5, 15, 60, 240], rules: longRules }, { version: 12, changedSec: 1_700_000_000, unlockSec: unlockSecFor(1_700_000_000) }).concat(
      perfAttrs(computePerf([], 0, 0), { trades: 1234, wins: 600, losses: 634, pnlSol: -0.12345 }, Date.now()),
    ),
  );
  const decode = (b64: string) => umi.transactions.deserialize(Uint8Array.from(Buffer.from(b64, "base64")));
  const signedBy = (b64: string, key: string) => {
    const tx = decode(b64);
    const i = tx.message.accounts.findIndex((a) => String(a) === key);
    return i >= 0 && i < tx.message.header.numRequiredSignatures && tx.signatures[i].some((x) => x !== 0);
  };

  it("the longest rules still fit", () => assert.ok(longRules.length <= 160 && validateSpec({ ...base, rules: longRules }).ok));
  it("legacy asset: tx A hands Attributes + freeze to the server, tx B writes and freezes (server-signed)", async () => {
    const asset = fakeAsset({ owner, collection, attrAuth: "Owner", freeze: { frozen: true, authority: "Owner" } });
    const r = await buildStrategyTxs({ umi, authority, asset, collection, attrs, blockhash });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.txs.length, 2);
    const [a, b] = r.txs.map(decode);
    assert.equal(a.message.instructions.length, 3, "approve Attributes, thaw (owner), approve freeze");
    assert.equal(b.message.instructions.length, 2, "write attrs + freeze");
    assert.equal(signedBy(r.txs[0], server), false, "A is owner-only");
    assert.equal(signedBy(r.txs[1], server), true, "B carries the server signature");
    assert.equal(String(b.message.accounts[0]), owner, "owner pays");
    for (const tx of r.txs) assert.ok(Buffer.from(tx, "base64").length <= 1232, "fits a packet");
  });
  it("fresh mint (thawed, owner-held freeze): a strategy change hands the freeze to the server and freezes", async () => {
    const asset = fakeAsset({ owner, collection, attrAuth: "UpdateAuthority", freeze: { frozen: false, authority: "Owner" } });
    const r = await buildStrategyTxs({ umi, authority, asset, collection, attrs, blockhash });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.txs.length, 2);
    const [a, b] = r.txs.map(decode);
    assert.equal(a.message.instructions.length, 1, "owner approves the freeze to the server");
    assert.equal(b.message.instructions.length, 2, "write attrs + freeze (the 240 h lock)");
    assert.equal(signedBy(r.txs[1], server), true);
  });
  it("server-locked asset: only tx B", async () => {
    const asset = fakeAsset({ owner, collection, attrAuth: "UpdateAuthority", freeze: { frozen: true, authority: server } });
    const r = await buildStrategyTxs({ umi, authority, asset, collection, attrs, blockhash });
    assert.ok(r.ok && r.txs.length === 1);
  });
  it("refuses a freeze held by a stranger", async () => {
    const asset = fakeAsset({ owner, collection, attrAuth: "UpdateAuthority", freeze: { frozen: true, authority: buyer } });
    const r = await buildStrategyTxs({ umi, authority, asset, collection, attrs, blockhash });
    assert.equal(r.ok, false);
  });
  it("list: transfer delegate + server freeze; buy: pays 95/5 and transfers in one tx", async () => {
    const asset = fakeAsset({ owner, collection, attrAuth: "UpdateAuthority", freeze: { frozen: false, authority: "Owner" } });
    const l = await buildListTx({ umi, authority, asset, collection, blockhash });
    assert.ok(l.ok);
    if (!l.ok) return;
    assert.equal(decode(l.txs[0]).message.instructions.length, 3, "approve freeze, add transfer delegate, freeze");
    assert.ok(signedBy(l.txs[0], server));
    const notEscrowed = await buildBuyTx({ umi, authority, asset, collection, buyer, sellerLamports: 95, royaltyLamports: 5, treasury: collection, blockhash });
    assert.equal(notEscrowed.ok, false, "no escrow, no sale");
    const listed = fakeAsset({ owner, collection, attrAuth: "UpdateAuthority", freeze: { frozen: true, authority: server }, transfer: server });
    const treasury = Keypair.generate().publicKey.toBase58();
    const b = await buildBuyTx({ umi, authority, asset: listed, collection, buyer, sellerLamports: 9_500_000, royaltyLamports: 500_000, treasury, blockhash });
    assert.ok(b.ok);
    if (!b.ok) return;
    const tx = decode(b.txs[0]);
    assert.equal(String(tx.message.accounts[0]), buyer, "buyer pays the fee");
    assert.equal(tx.message.instructions.length, 4, "pay seller, pay royalty, thaw, transfer");
    const lam = (i: number) => Number(Buffer.from(tx.message.instructions[i].data).readBigUInt64LE(4));
    assert.equal(lam(0), 9_500_000);
    assert.equal(lam(1), 500_000);
    assert.equal(String(tx.message.accounts[tx.message.instructions[0].accountIndexes[1]]), owner, "seller paid");
    assert.equal(String(tx.message.accounts[tx.message.instructions[1].accountIndexes[1]]), treasury, "royalty to treasury");
    assert.ok(signedBy(b.txs[0], server));
  });
  it("thaw after the lock hands control back and drops the listing delegate", () => {
    const listed = fakeAsset({ owner, collection, attrAuth: "UpdateAuthority", freeze: { frozen: true, authority: server }, transfer: server });
    const b = thawBuilder(umi, authority, listed, collection, true);
    assert.equal(b?.items.length, 3);
    const free = fakeAsset({ owner, collection, attrAuth: "UpdateAuthority", freeze: { frozen: false, authority: "Owner" } });
    assert.equal(thawBuilder(umi, authority, free, collection, true), null);
    assert.deepEqual(coreState(listed), { freeze: { frozen: true, authority: server }, transferDelegate: server, attributesAuthority: "UpdateAuthority" });
    assert.ok(txSize(umi, b!, createNoopSigner(publicKey(server))) < 1232);
  });
});

/* ------------------------------ ledger (PGLite) ------------------------------ */

describe("ledger: positions follow the on-chain strategy; listings", () => {
  let sql: GuardSql;
  const t0 = Date.UTC(2026, 9, 2, 10);
  const specAsset = new Map(specAttrs({ ...base, rules: "deny if hour < 6" }, { version: 1, changedSec: t0 / 1000 - 3600, unlockSec: unlockSecFor(t0 / 1000 - 3600) }).map((a) => [a.key, a.value]));
  const deps = (now: number, px: number): PositionDeps => ({
    sql,
    now,
    price: async () => px,
    agent: async (a) => (a === "SpecAsset" ? { owner: "roomA", free: false, attrs: specAsset } : a === "Tampered" ? { owner: "roomA", free: false, attrs: new Map([...specAsset, ["ps", "0.019"]]) } : null),
    market: async (book) => (book === "poly:evt" ? { lane: "events", window: 0 } : { lane: "crypto", window: book === "poly:60" ? 60 : 15 }),
  });
  before(async () => {
    const pg = new PGlite();
    for (const f of ["0002_guards.sql", "0003_mints.sql", "0004_payments.sql", "0005_positions.sql", "0006_strategy_market.sql"]) {
      await pg.exec(readFileSync(new URL(`../../../migrations/${f}`, import.meta.url), "utf8"));
    }
    sql = { query: async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as never[] };
  });
  it("refuses trades off the on-chain strategy and records the hash on ones that follow it", async () => {
    const open = (id: string, book: string, stake: number, px = 0.4, now = t0) =>
      openPosition(deps(now, px), { wallet: "roomA", fillId: id, asset: "SpecAsset", book, side: "yes", stakeLamports: stake });
    const offLane = await open("f1", "poly:evt", 10_000_000);
    assert.ok(!offLane.ok && /смуга|Смуга/.test(offLane.reason));
    const offWindow = await open("f2", "poly:60", 10_000_000);
    assert.ok(!offWindow.ok && /Вікно/.test(offWindow.reason));
    const offBand = await open("f3", "poly:15", 10_000_000, 0.05);
    assert.ok(!offBand.ok && /коридор/.test(offBand.reason));
    const offRule = await open("f4", "poly:15", 10_000_000, 0.4, Date.UTC(2026, 9, 2, 3));
    assert.ok(!offRule.ok && /deny/.test(offRule.reason));
    const tampered = await openPosition(deps(t0, 0.4), { wallet: "roomA", fillId: "f5", asset: "Tampered", book: "poly:15", side: "yes", stakeLamports: 10_000_000 });
    assert.ok(!tampered.ok && /хеш/.test(tampered.reason));
    const good = await open("f6", "poly:15", 10_000_000);
    assert.ok(good.ok);
    const rows = await sql.query<{ strategy_hash: string }>("select strategy_hash from agent_positions where id = 'f6'");
    assert.equal(rows[0].strategy_hash, specAsset.get("sh"));
    const closed = await closePosition(deps(t0 + 60_000, 0.5), { wallet: "roomA", fillId: "f6" });
    assert.ok(closed.ok && closed.pnlLamports === 2_500_000);
    const trades = await ledger.closedTradesOf(sql, "SpecAsset");
    assert.equal(trades.length, 1);
    assert.deepEqual(await ledger.assetsToSync(sql), ["SpecAsset"]);
    await ledger.notePerfWrite(sql, "SpecAsset", "sig1", "[]", t0 + 120_000);
    assert.deepEqual(await ledger.assetsToSync(sql), [], "nothing new after the write");
    await sql.query("insert into chain_payments (sig, kind, cluster, wallet, asset, ref, lamports, recorded_ms) values ('feeSig', 'fee', 'devnet', 'roomA', 'SpecAsset', 'f6', 125000, 1)");
    const recs = await ledger.tradeRecordsOf(sql, "SpecAsset");
    assert.equal(recs.length, 1);
    assert.deepEqual(recs[0].feeSigs, ["feeSig"]);
    assert.equal(recs[0].strategyHash, specAsset.get("sh"));
    assert.equal((await ledger.perfWriteOf(sql, "SpecAsset"))?.sig, "sig1");
  });
  it("listing lifecycle: pending → active → sold once; versions confirm only what the server signed", async () => {
    await ledger.recordPendingVersion(sql, { asset: "A1", version: 2, owner: "s", hash: "h2", spec: base, changedMs: 1, unlockMs: 2 });
    assert.equal(await ledger.confirmVersion(sql, "A1", 2, "forged", ""), false);
    assert.equal(await ledger.confirmVersion(sql, "A1", 2, "h2", "sigX"), true);
    assert.ok((await ledger.upsertListing(sql, { asset: "A1", seller: "s", priceLamports: 10_000_000, specHash: "h2", now: 1 })).ok);
    assert.equal(await ledger.markSold(sql, { asset: "A1", buyer: "b", sig: "x", priceLamports: 1, royaltyLamports: 0, seller: "s", now: 2 }), false, "pending cannot sell");
    assert.ok(await ledger.setListingStatus(sql, "A1", ["pending"], "active", 3));
    const other = await ledger.upsertListing(sql, { asset: "A1", seller: "intruder", priceLamports: 1_000_000, specHash: "h2", now: 4 });
    assert.equal(other.ok, false, "someone else cannot relist an active listing");
    assert.equal((await ledger.activeListings(sql)).length, 1);
    assert.ok(await ledger.markSold(sql, { asset: "A1", buyer: "b", sig: "sale1", priceLamports: 10_000_000, royaltyLamports: 500_000, seller: "s", now: 5 }));
    assert.equal(await ledger.markSold(sql, { asset: "A1", buyer: "c", sig: "sale2", priceLamports: 10_000_000, royaltyLamports: 500_000, seller: "s", now: 6 }), false, "sold once");
    assert.equal((await ledger.salesOf(sql, "A1")).length, 1);
    assert.equal((await ledger.activeListings(sql)).length, 0);
  });
});

describe("judge verify: APR recomputed from the listed records", () => {
  const changedSec = Date.UTC(2026, 9, 1) / 1000;
  const trades = [
    { openedMs: changedSec * 1000 + 1000, closedMs: changedSec * 1000 + 60_000, stakeLamports: 10_000_000, pnlLamports: 2_000_000 },
    { openedMs: changedSec * 1000 + 2000, closedMs: changedSec * 1000 + 3 * DAY, stakeLamports: 15_000_000, pnlLamports: -500_000 },
    { openedMs: changedSec * 1000 - 5000, closedMs: changedSec * 1000 + 70_000, stakeLamports: 20_000_000, pnlLamports: 9_000_000 },
  ];
  it("matches the attributes the server would write at pu, ignores newer trades and pre-change trades", () => {
    const writtenMs = changedSec * 1000 + 2 * DAY + 123_000;
    const onChain = perfFromAttrs(perfAttrs(computePerf(trades, changedSec * 1000, writtenMs), { trades: 3, wins: 2, losses: 1, pnlSol: 0 }, writtenMs));
    assert.ok(onChain);
    const v = verifyPerf(trades, changedSec, onChain);
    assert.ok(v.ok, v.mismatches.join("; "));
    assert.equal(v.recomputed.trades, 1, "only the trade opened after the change and closed before pu");
    assert.equal(v.newer, 1, "one trade closed after the write is reported as not yet on chain");
  });
  it("flags a forged APR", () => {
    const writtenMs = changedSec * 1000 + DAY;
    const onChain = perfFromAttrs(perfAttrs(computePerf(trades, changedSec * 1000, writtenMs), { trades: 0, wins: 0, losses: 0, pnlSol: 0 }, writtenMs));
    assert.ok(onChain);
    const v = verifyPerf(trades, changedSec, { ...onChain, aprSince: 99_999 });
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => m.startsWith("apr ")));
  });
  it("explorer links are devnet", () => {
    assert.equal(explorerUrl("tx", "abc"), "https://explorer.solana.com/tx/abc?cluster=devnet");
  });
});

describe("judge faucet (devnet fallback, rate-limited)", () => {
  let sql: GuardSql;
  const umi = createUmi("https://api.devnet.solana.com");
  const now0 = Date.UTC(2026, 9, 2, 12);
  const proofFor = (kp: Keypair, ts: number) => {
    const pair = umi.eddsa.createKeypairFromSecretKey(kp.secretKey);
    const wallet = kp.publicKey.toBase58();
    return { wallet, ts, sig: encodeBase58(umi.eddsa.sign(new TextEncoder().encode(proofMessage("faucet", wallet, ts, "devnet")), pair)) };
  };
  let sent: string[] = [];
  const deps = (over: Partial<FaucetDeps> = {}): FaucetDeps => ({
    sql,
    rpcUrl: "https://api.devnet.solana.com",
    now: now0,
    caps: { ...FAUCET_DEFAULTS, perIp: 2, dailyLamports: 3 * FAUCET_DEFAULTS.dripLamports },
    faucet: Keypair.generate(),
    balance: async () => 0,
    send: async (to) => {
      sent.push(to);
      return `sig${sent.length}`;
    },
    ...over,
  });
  before(async () => {
    const pg = new PGlite();
    for (const f of ["0002_guards.sql", "0006_strategy_market.sql"]) {
      if (f === "0006_strategy_market.sql") await pg.exec("create table if not exists agent_positions (id text primary key)");
      await pg.exec(readFileSync(new URL(`../../../migrations/${f}`, import.meta.url), "utf8"));
    }
    sql = { query: async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as never[] };
  });
  it("never runs on mainnet or without a signed proof", async () => {
    assert.equal(isDevnetRpc("https://mainnet.helius-rpc.com"), false);
    const r = await faucetDrip(deps({ rpcUrl: "https://api.mainnet-beta.solana.com" }), { proof: proofFor(Keypair.generate(), now0), ip: "1.1.1.1" });
    assert.ok(!r.ok && /devnet/.test(r.reason));
    const forged = { ...proofFor(Keypair.generate(), now0), wallet: Keypair.generate().publicKey.toBase58() };
    assert.equal((await faucetDrip(deps(), { proof: forged, ip: "1.1.1.1" })).ok, false);
  });
  it("one drip per wallet per day, per-IP cap, daily cap, skips funded wallets, frees the slot on a failed send", async () => {
    sent = [];
    const a = Keypair.generate();
    assert.ok((await faucetDrip(deps(), { proof: proofFor(a, now0), ip: "ip1" })).ok);
    const again = await faucetDrip(deps(), { proof: proofFor(a, now0 + 1), ip: "ip9" });
    assert.ok(!again.ok && /уже отримав/.test(again.reason));
    const rich = await faucetDrip(deps({ balance: async () => 1e9 }), { proof: proofFor(Keypair.generate(), now0), ip: "ip2" });
    assert.ok(!rich.ok && /досить/.test(rich.reason));
    const failing = Keypair.generate();
    const bad = await faucetDrip(deps({ send: async () => { throw new Error("insufficient lamports"); } }), { proof: proofFor(failing, now0), ip: "ip1" });
    assert.ok(!bad.ok && /скінчились/.test(bad.reason));
    assert.ok((await faucetDrip(deps(), { proof: proofFor(failing, now0 + 2), ip: "ip1" })).ok, "slot freed after the failed send");
    const ipCap = await faucetDrip(deps(), { proof: proofFor(Keypair.generate(), now0), ip: "ip1" });
    assert.ok(!ipCap.ok && /мережі/.test(ipCap.reason));
    assert.ok((await faucetDrip(deps(), { proof: proofFor(Keypair.generate(), now0), ip: "ip3" })).ok);
    const dayCap = await faucetDrip(deps(), { proof: proofFor(Keypair.generate(), now0), ip: "ip4" });
    assert.ok(!dayCap.ok && /вичерпано/.test(dayCap.reason));
    assert.equal(sent.length, 3);
  });
});

describe("devnet demo constants", () => {
  it("are real-looking public addresses and signatures; demos listed, change locks 240 h", async () => {
    const { DEVNET_STRATEGY: d } = await import("./devnet-demo.ts");
    const addr = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const sig = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
    const m = d.marketTest;
    for (const a of [d.authority, d.collection, d.treasury, d.seller, d.buyer, d.lockTest.asset, m.asset, ...d.demos.map((x) => x.asset)]) assert.match(a, addr);
    const sigs = [
      ...d.lockTest.mintTxs, d.lockTest.strategyTx, d.lockTest.refusedTransferTx, d.lockTest.resultsTx,
      ...d.demos.flatMap((x) => [x.mintTx, x.releaseTx, x.resultsInitTx, x.thawTx, x.listTx]),
      m.mintTx, m.listTx, m.buyTx, ...m.strategyTxs, m.refusedTransferTx,
    ];
    for (const s of sigs) assert.match(s, sig);
    assert.equal(new Set(sigs).size, sigs.length, "no signature reused");
    assert.equal(new Set(d.demos.map((x) => x.asset)).size, d.demos.length);
    assert.deepEqual(d.demos.map((x) => x.priceSol), [0.05, 0.12, 0.08]);
    // The changed NFTs stay locked 240 h past the 2026-10-02 run.
    for (const u of [d.lockTest.unlockSec, m.unlockSec]) assert.ok(u - SALE_LOCK_HOURS * 3600 >= Date.UTC(2026, 9, 2) / 1000);
  });
});
