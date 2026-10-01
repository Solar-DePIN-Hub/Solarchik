import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { ARB_LIMITS, arbModeFor, cleanArbSymbol } from "./arb-rules.ts";
import { claimMintSlot, reserveArb, settleArb, spendProofOnce, type GuardSql } from "./guard-ledger.server.ts";
import { CLIENT_SLOT_MS, COSIGN_SLOT_MS, PRO_LAMPORTS, checkProPaymentTx, mintModeFor, mintUri, proMemo, tierFromUri } from "./mint-rules.ts";
import { PAY_WALLET } from "../game/pay.ts";
import { Keypair } from "@solana/web3.js";
import { backpackFromFile, backpackFromText, derivedKeypair, keypairFromText } from "./secret-key.server.ts";
import { encodeBase58 } from "./base58.ts";
import { proofMessage, readProof } from "./wallet-proof.ts";
import { verifyProof } from "./wallet-proof.server.ts";
import { deskOriginAllowed, deskRouteOf, rateLimiter } from "./desk-proxy-rules.ts";

function testWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const wallet = encodeBase58(new Uint8Array(raw));
  const proof = (action: "arb" | "mint", extra: string, ts: number) => ({
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
    assert.equal(verifyProof(p, "mint", "A:SOL:asset", now).ok, false);
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
    await pg.exec(readFileSync(new URL("../../../migrations/0003_mints.sql", import.meta.url), "utf8"));
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
    assert.equal(await spendProofOnce(sql, "w", "mint", 1, t0), true);
  });

  it("a Pro payment mints once, never for another wallet", async () => {
    const slot = { kind: "pro" as const, key: "paysig1", wallet: "room1", asset: "assetA", now: t0, holdMs: COSIGN_SLOT_MS };
    const landed = new Set<string>();
    const isLanded = async (a: string) => landed.has(a);
    assert.deepEqual(await claimMintSlot(sql, slot, isLanded), { ok: true });
    const other = await claimMintSlot(sql, { ...slot, wallet: "room2", asset: "assetX", now: t0 + COSIGN_SLOT_MS * 5 }, isLanded);
    assert.equal(other.ok, false, "another wallet can never use the payment");
    const early = await claimMintSlot(sql, { ...slot, asset: "assetB", now: t0 + 30_000 }, isLanded);
    assert.equal(early.ok, false, "previous prepare still in flight");
    const retry = await claimMintSlot(sql, { ...slot, asset: "assetB", now: t0 + COSIGN_SLOT_MS }, isLanded);
    assert.equal(retry.ok, true, "first asset never landed, hold passed: retry allowed");
    landed.add("assetB");
    const again = await claimMintSlot(sql, { ...slot, asset: "assetC", now: t0 + COSIGN_SLOT_MS * 10 }, isLanded);
    assert.equal(again.ok, false, "payment already minted");
  });

  it("free slot per wallet; client-mode slot holds longer", async () => {
    const slot = { kind: "free" as const, key: "roomF", wallet: "roomF", asset: "", now: t0, holdMs: CLIENT_SLOT_MS };
    const never = async () => false;
    assert.equal((await claimMintSlot(sql, slot, never)).ok, true);
    assert.equal((await claimMintSlot(sql, { ...slot, now: t0 + COSIGN_SLOT_MS }, never)).ok, false);
    assert.equal((await claimMintSlot(sql, { ...slot, now: t0 + CLIENT_SLOT_MS }, never)).ok, true);
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

describe("mint rules", () => {
  const room = "Room111111111111111111111111111111111111111";
  const now = 1_800_000_000;
  const transfer = (source: string, lamports = PRO_LAMPORTS, destination = PAY_WALLET) => ({
    program: "system",
    parsed: { type: "transfer", info: { source, destination, lamports } },
  });
  const tx = (ixs: unknown[], extra: Record<string, unknown> = {}) =>
    ({ blockTime: now - 60, meta: { err: null }, transaction: { message: { instructions: ixs } }, ...extra }) as never;

  it("mode: key co-signs, no key closes Pro on deploys", () => {
    assert.equal(mintModeFor("pro", { hasKey: true, store: "shared", dev: false }).mode, "cosign");
    assert.equal(mintModeFor("free", { hasKey: true, store: "none", dev: false }).mode, "cosign");
    assert.equal(mintModeFor("pro", { hasKey: true, store: "none", dev: false }).mode, "closed");
    assert.equal(mintModeFor("pro", { hasKey: false, store: "shared", dev: false }).mode, "closed");
    assert.match(mintModeFor("pro", { hasKey: false, store: "shared", dev: false }).reason, /MINT_AUTHORITY_SECRET/);
    assert.equal(mintModeFor("pro", { hasKey: false, store: "none", dev: true }).mode, "client");
    assert.equal(mintModeFor("free", { hasKey: false, store: "none", dev: false }).mode, "client");
  });

  it("tier lives in the uri", () => {
    assert.equal(tierFromUri(mintUri("pro")), "pro");
    assert.equal(tierFromUri(mintUri("free")), "free");
    assert.equal(tierFromUri("urn:solarchik:agent"), null);
    assert.equal(tierFromUri(undefined), null);
  });

  it("accepts an exact Pro payment bound by memo or paid from the room wallet", () => {
    assert.deepEqual(checkProPaymentTx(tx([transfer("Phantom1"), { program: "spl-memo", parsed: proMemo(room) }]), room, now), { ok: true });
    assert.deepEqual(checkProPaymentTx(tx([transfer(room)]), room, now), { ok: true });
  });

  it("refuses wrong amount, wrong destination, other room, failed, old or missing tx", () => {
    assert.equal(checkProPaymentTx(null, room, now).ok, false);
    assert.equal(checkProPaymentTx(tx([transfer(room, PRO_LAMPORTS - 1)]), room, now).ok, false);
    assert.equal(checkProPaymentTx(tx([transfer(room, PRO_LAMPORTS, "Other1111")]), room, now).ok, false);
    assert.equal(checkProPaymentTx(tx([transfer("Phantom1"), { program: "spl-memo", parsed: proMemo("OtherRoom") }]), room, now).ok, false);
    assert.equal(checkProPaymentTx(tx([transfer("Phantom1")]), room, now).ok, false);
    assert.equal(checkProPaymentTx(tx([transfer(room)], { meta: { err: { x: 1 } } }), room, now).ok, false);
    assert.equal(checkProPaymentTx(tx([transfer(room)], { blockTime: now - 4 * 24 * 3600 }), room, now).ok, false);
  });
});

describe("server secrets from env", () => {
  it("keypair from base58, seed or JSON; junk is null", () => {
    const kp = Keypair.generate();
    const b58 = encodeBase58(kp.secretKey);
    assert.equal(keypairFromText(b58)?.publicKey.toBase58(), kp.publicKey.toBase58());
    assert.equal(keypairFromText(` ${JSON.stringify([...kp.secretKey])}\n`)?.publicKey.toBase58(), kp.publicKey.toBase58());
    assert.equal(keypairFromText(encodeBase58(kp.secretKey.subarray(0, 32)))?.publicKey.toBase58(), kp.publicKey.toBase58());
    assert.equal(keypairFromText(""), null);
    assert.equal(keypairFromText(undefined), null);
    assert.equal(keypairFromText("not a key 0OIl"), null);
    assert.equal(keypairFromText(encodeBase58(new Uint8Array(10))), null);
  });
  it("derived collection key is stable and differs from the parent", () => {
    const kp = Keypair.generate();
    const a = derivedKeypair(kp, "mint-collection").publicKey.toBase58();
    assert.equal(a, derivedKeypair(kp, "mint-collection").publicKey.toBase58());
    assert.notEqual(a, kp.publicKey.toBase58());
    assert.notEqual(a, derivedKeypair(kp, "other").publicKey.toBase58());
  });
  it("backpack pair from env or the old two-line file", () => {
    const seed = Buffer.alloc(32, 7).toString("base64");
    assert.equal(backpackFromText("key1", seed)?.apiKey, "key1");
    assert.equal(backpackFromText("key1", seed)?.seed.length, 32);
    assert.equal(backpackFromText("key1", Buffer.alloc(16).toString("base64")), null);
    assert.equal(backpackFromText("", seed), null);
    assert.equal(backpackFromFile(`key2\r\n${seed}\n`)?.apiKey, "key2");
    assert.equal(backpackFromFile("key2"), null);
  });
});
