import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { ARB_LIMITS, FREE_CLAIM_LOCK_MS, arbModeFor, cleanArbSymbol } from "./arb-rules.ts";
import { claimFreeLock, reserveArb, settleArb, spendProofOnce, type GuardSql } from "./guard-ledger.server.ts";
import { encodeBase58 } from "./base58.ts";
import { proofMessage, readProof } from "./wallet-proof.ts";
import { verifyProof } from "./wallet-proof.server.ts";
import { deskOriginAllowed, deskRouteOf, rateLimiter } from "./desk-proxy-rules.ts";

function testWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const wallet = encodeBase58(new Uint8Array(raw));
  const proof = (action: "arb" | "free-mint", extra: string, ts: number) => ({
    wallet,
    ts,
    sig: encodeBase58(new Uint8Array(sign(null, Buffer.from(proofMessage(action, wallet, ts, extra)), privateKey))),
  });
  return { wallet, proof };
}

describe("arb mode", () => {
  it("is never mainnet by default", () => {
    assert.equal(arbModeFor(undefined, "shared").mode, "sim");
    assert.equal(arbModeFor("", "shared").mode, "sim");
    assert.equal(arbModeFor("1", "shared").mode, "sim");
    assert.equal(arbModeFor("yes", "shared").mode, "sim");
  });
  it("mainnet needs the flag and a shared DB", () => {
    assert.equal(arbModeFor("true", "shared").mode, "mainnet");
    assert.equal(arbModeFor("TRUE", "shared").mode, "mainnet");
    assert.equal(arbModeFor("true", "dev").mode, "closed");
    assert.equal(arbModeFor("true", "none").mode, "closed");
  });
  it("fails closed with no shared store", () => {
    assert.equal(arbModeFor(undefined, "none").mode, "closed");
    assert.equal(arbModeFor(undefined, "dev").mode, "sim");
  });
  it("mainnet caps match the documented numbers", () => {
    assert.deepEqual(ARB_LIMITS.mainnet, { dayCapSol: 0.02, walletDayCapSol: 0.01, walletDayFires: 2, minGapMs: 30_000, walletGapMs: 30_000 });
  });
  it("cleans symbols the same way on both sides", () => {
    assert.equal(cleanArbSymbol("sol"), "SOL");
    assert.equal(cleanArbSymbol("j/to!"), "JTO");
    assert.equal(cleanArbSymbol(""), "SOL");
  });
});

describe("wallet proof", () => {
  const w = testWallet();
  const now = 1_800_000_000_000;
  it("accepts a fresh signature over the exact text", () => {
    const p = w.proof("arb", "A:SOL:asset", now);
    assert.deepEqual(readProof(p), p);
    assert.deepEqual(verifyProof(p, "arb", "A:SOL:asset", now + 1000), { ok: true });
  });
  it("rejects another action, other fields, or a stale time", () => {
    const p = w.proof("arb", "A:SOL:asset", now);
    assert.equal(verifyProof(p, "free-mint", "A:SOL:asset", now).ok, false);
    assert.equal(verifyProof(p, "arb", "B:SOL:asset", now).ok, false);
    assert.equal(verifyProof(p, "arb", "A:SOL:asset", now + 121_000).ok, false);
    assert.equal(verifyProof({ ...p, wallet: testWallet().wallet }, "arb", "A:SOL:asset", now).ok, false);
  });
  it("readProof drops junk", () => {
    assert.equal(readProof(null), null);
    assert.equal(readProof({ wallet: "x", ts: 1, sig: "y" }), null);
  });
});

describe("guard ledger on Postgres (PGLite)", () => {
  let sql: GuardSql;
  before(async () => {
    const pg = new PGlite();
    await pg.exec(readFileSync(new URL("../../../migrations/0002_guards.sql", import.meta.url), "utf8"));
    sql = { query: async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as never[] };
  });
  const base = { mode: "mainnet" as const, asset: "Asset1111111111111111111111111111", symbol: "SOL", dir: "A", sol: 0.005, limits: ARB_LIMITS.mainnet };
  const t0 = Date.UTC(2026, 9, 1, 12, 0, 0);

  it("enforces 30 s spacing, per-wallet and global day caps", async () => {
    const a = await reserveArb(sql, { ...base, wallet: "walletA", now: t0 });
    assert.equal(a.ok, true);
    const tooSoon = await reserveArb(sql, { ...base, wallet: "walletB", now: t0 + 10_000 });
    assert.equal(tooSoon.ok, false, "global 30 s gap");
    const a2 = await reserveArb(sql, { ...base, wallet: "walletA", now: t0 + 31_000 });
    assert.equal(a2.ok, true);
    const a3 = await reserveArb(sql, { ...base, wallet: "walletA", now: t0 + 62_000 });
    assert.equal(a3.ok, false, "wallet cap 0.01 / 2 fires");
    const b1 = await reserveArb(sql, { ...base, wallet: "walletB", now: t0 + 93_000 });
    assert.equal(b1.ok, true);
    const b2 = await reserveArb(sql, { ...base, wallet: "walletB", now: t0 + 124_000 });
    assert.equal(b2.ok, true, "global reaches 0.02");
    const c1 = await reserveArb(sql, { ...base, wallet: "walletC", now: t0 + 155_000 });
    assert.equal(c1.ok, false, "global cap 0.02");
    const wc = await sql.query<{ fires: number }>("select fires from arb_wallet_day where wallet = 'walletC'");
    assert.equal(wc[0]?.fires ?? 0, 0, "wallet refunded when the global cap refuses");
    const next = await reserveArb(sql, { ...base, wallet: "walletC", now: t0 + 86_400_000 });
    assert.equal(next.ok, true, "new UTC day");
  });

  it("a failed fire is refunded, an ok fire stays booked", async () => {
    const t = Date.UTC(2026, 9, 5, 12, 0, 0);
    const r = await reserveArb(sql, { ...base, wallet: "walletD", now: t });
    assert.ok(r.ok);
    await settleArb(sql, r.reservation, "failed", "no book", t + 1);
    const day = await sql.query<{ spent: number }>("select spent_lamports::float8 as spent from arb_day where mode = 'mainnet' and day = '2026-10-05'");
    assert.equal(day[0]?.spent, 0);
    const r2 = await reserveArb(sql, { ...base, wallet: "walletD", now: t + 31_000 });
    assert.ok(r2.ok);
    await settleArb(sql, r2.reservation, "ok", "bp titan", t + 32_000);
    const day2 = await sql.query<{ spent: number }>("select spent_lamports::float8 as spent from arb_day where mode = 'mainnet' and day = '2026-10-05'");
    assert.equal(day2[0]?.spent, 5_000_000);
    const fires = await sql.query<{ status: string }>("select status from arb_fires where wallet = 'walletD' order by id");
    assert.deepEqual(fires.map((f) => f.status), ["failed", "ok"]);
  });

  it("sim and mainnet caps are separate", async () => {
    const t = Date.UTC(2026, 9, 7, 12, 0, 0);
    const m = await reserveArb(sql, { ...base, wallet: "walletE", now: t });
    const s = await reserveArb(sql, { ...base, mode: "sim", limits: ARB_LIMITS.sim, wallet: "walletE", now: t });
    assert.ok(m.ok && s.ok);
  });

  it("a proof works once", async () => {
    assert.equal(await spendProofOnce(sql, "w", "arb", 1, t0), true);
    assert.equal(await spendProofOnce(sql, "w", "arb", 1, t0), false);
    assert.equal(await spendProofOnce(sql, "w", "free-mint", 1, t0), true);
  });

  it("free claim lock holds 10 minutes", async () => {
    assert.equal(await claimFreeLock(sql, "wf", t0, FREE_CLAIM_LOCK_MS), true);
    assert.equal(await claimFreeLock(sql, "wf", t0 + 60_000, FREE_CLAIM_LOCK_MS), false);
    assert.equal(await claimFreeLock(sql, "wf", t0 + FREE_CLAIM_LOCK_MS, FREE_CLAIM_LOCK_MS), true);
  });
});

describe("desk proxy rules", () => {
  it("only grok and titan routes", () => {
    assert.equal(deskRouteOf("/api/desk/grok"), "grok");
    assert.equal(deskRouteOf("/api/desk/titan/"), "titan");
    assert.equal(deskRouteOf("/api/desk/poly"), null);
    assert.equal(deskRouteOf("/api/desk/../poly"), null);
  });
  it("origin allow list", () => {
    assert.equal(deskOriginAllowed(null, "https://a.app", ""), true);
    assert.equal(deskOriginAllowed("https://a.app", "https://a.app", ""), true);
    assert.equal(deskOriginAllowed("https://evil.example", "https://a.app", ""), false);
    assert.equal(deskOriginAllowed("https://b.app", "https://a.app", "https://b.app, https://c.app"), true);
  });
  it("rate limiter", () => {
    const allow = rateLimiter(2);
    assert.equal(allow("ip", 0), true);
    assert.equal(allow("ip", 1), true);
    assert.equal(allow("ip", 2), false);
    assert.equal(allow("ip", 60_001), true);
  });
});
