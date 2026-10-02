import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { ARB_LIMITS, arbModeFor, cleanArbSymbol } from "./arb-rules.ts";
import {
  arbCreditLamports,
  claimMintSlot,
  linkReissuedAsset,
  recordPayment,
  reserveArb,
  settleArb,
  spendProofOnce,
  verifiedFeeRefs,
  type GuardSql,
} from "./guard-ledger.server.ts";
import {
  CLIENT_SLOT_MS,
  COSIGN_LAUNCH_SEC,
  COSIGN_SLOT_MS,
  PRO_LAMPORTS,
  COMBO_PAID_ONLY,
  checkProPaymentTx,
  freeComboRefusal,
  isComboAttrs,
  legacyMintFitsPayment,
  freeAssetLabel,
  mintModeFor,
  mintUri,
  proAssetLabel,
  proMemo,
  tierFromUri,
} from "./mint-rules.ts";
import {
  ARB_CREDIT_MIN_LAMPORTS,
  checkArbCreditTx,
  checkFeeTx,
  cleanRowId,
  feeMemo,
} from "./payment-rules.ts";
import { ARB_TREASURY, PAY_WALLET } from "../game/pay.ts";
import { liveCatalog } from "./catalog.ts";
import { PAID_ONLY_BASE_SKUS, PRO_PRICE_SOL, offerFor } from "./fees.config.ts";
import { attrList } from "./core-attrs.ts";
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
    await pg.exec(readFileSync(new URL("../../../migrations/0004_payments.sql", import.meta.url), "utf8"));
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

  it("arb credit: verified deposits minus mainnet fires; a signature credits once", async () => {
    const asset = "CreditAsset11111111111111111111111";
    const row = { sig: "sigC1", kind: "arb-credit" as const, cluster: "mainnet" as const, wallet: "walletK", asset, ref: "", lamports: 10_000_000, now: t0 };
    assert.equal(await recordPayment(sql, row), true);
    assert.equal(await recordPayment(sql, { ...row, lamports: 20_000_000 }), false, "same signature never credits twice");
    assert.equal(await arbCreditLamports(sql, asset), 10_000_000);
    const t = Date.UTC(2026, 9, 9, 12, 0, 0);
    const r = await reserveArb(sql, { ...base, asset, wallet: "walletK", now: t });
    assert.ok(r.ok);
    assert.equal(await arbCreditLamports(sql, asset), 5_000_000, "an in-flight fire is already counted");
    await settleArb(sql, r.reservation, "failed", "miss", t + 1);
    assert.equal(await arbCreditLamports(sql, asset), 10_000_000, "a refunded fire gives the credit back");
    const sim = await reserveArb(sql, { ...base, mode: "sim", limits: ARB_LIMITS.sim, asset, wallet: "walletK", now: t + 40_000 });
    assert.ok(sim.ok);
    assert.equal(await arbCreditLamports(sql, asset), 10_000_000, "simulation never spends credit");
  });

  it("re-issued asset carries the old asset's credit", async () => {
    const oldA = "OldAsset1111111111111111111111111";
    const newA = "NewAsset1111111111111111111111111";
    await recordPayment(sql, { sig: "sigOld", kind: "arb-credit", cluster: "mainnet", wallet: "walletL", asset: oldA, ref: "", lamports: 7_000_000, now: t0 });
    assert.equal(await arbCreditLamports(sql, newA), 0);
    await linkReissuedAsset(sql, { newAsset: newA, oldAsset: oldA, wallet: "walletL", now: t0 });
    await linkReissuedAsset(sql, { newAsset: newA, oldAsset: "Other", wallet: "walletL", now: t0 });
    assert.equal(await arbCreditLamports(sql, newA), 7_000_000);
  });

  it("fee rows: one signature, one row", async () => {
    const fee = { sig: "feeSig1", kind: "fee" as const, cluster: "devnet" as const, wallet: "walletF", asset: "", ref: "row1", lamports: 50_000, now: t0 };
    assert.equal(await recordPayment(sql, fee), true);
    assert.equal(await recordPayment(sql, { ...fee, sig: "feeSig2" }), false, "same row cannot be paid by two transfers");
    assert.equal(await recordPayment(sql, { ...fee, ref: "row2" }), false, "same transfer cannot pay two rows");
    assert.deepEqual(await verifiedFeeRefs(sql, "walletF"), ["row1"]);
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

  it("mode: key co-signs (no DB needed), no key closes Pro on deploys", () => {
    assert.equal(mintModeFor("pro", { hasKey: true, store: "shared", dev: false }).mode, "cosign");
    assert.equal(mintModeFor("free", { hasKey: true, store: "none", dev: false }).mode, "cosign");
    assert.equal(mintModeFor("pro", { hasKey: true, store: "none", dev: false }).mode, "cosign");
    assert.equal(mintModeFor("pro", { hasKey: false, store: "shared", dev: false }).mode, "closed");
    assert.match(mintModeFor("pro", { hasKey: false, store: "shared", dev: false }).reason, /MINT_AUTHORITY_SECRET/);
    assert.equal(mintModeFor("pro", { hasKey: false, store: "none", dev: true }).mode, "client");
  });

  it("free without key and without DB on a deploy is closed (no race)", () => {
    assert.equal(mintModeFor("free", { hasKey: false, store: "none", dev: false }).mode, "closed");
    assert.equal(mintModeFor("free", { hasKey: false, store: "shared", dev: false }).mode, "client");
    assert.equal(mintModeFor("free", { hasKey: false, store: "none", dev: true }).mode, "client");
  });

  it("deterministic asset labels: one free per wallet, one Pro per payment", () => {
    const kp = Keypair.generate();
    const a = derivedKeypair(kp, freeAssetLabel("walletA")).publicKey.toBase58();
    assert.equal(a, derivedKeypair(kp, freeAssetLabel("walletA")).publicKey.toBase58());
    assert.notEqual(a, derivedKeypair(kp, freeAssetLabel("walletB")).publicKey.toBase58());
    assert.notEqual(a, derivedKeypair(kp, proAssetLabel("walletA")).publicKey.toBase58());
    assert.notEqual(a, derivedKeypair(Keypair.generate(), freeAssetLabel("walletA")).publicKey.toBase58());
  });

  it("legacy Pro payment (before co-sign launch) is accepted only for re-issue", () => {
    const old = tx([transfer("Phantom1")], { blockTime: COSIGN_LAUNCH_SEC - 86_400 });
    assert.equal(checkProPaymentTx(old, room, now).ok, false);
    assert.equal(checkProPaymentTx(old, room, now, { legacy: true }).ok, true);
    const late = tx([transfer("Phantom1")], { blockTime: COSIGN_LAUNCH_SEC + 60 });
    assert.equal(checkProPaymentTx(late, room, COSIGN_LAUNCH_SEC + 120, { legacy: true }).ok, false);
  });

  it("an unbound legacy payment must be tied to the old NFT by mint time", () => {
    const paidAt = COSIGN_LAUNCH_SEC - 86_400;
    const unbound = checkProPaymentTx(tx([transfer("Phantom1")], { blockTime: paidAt }), room, now, { legacy: true });
    assert.deepEqual(unbound, { ok: true, legacyPaidAt: paidAt });
    const bound = checkProPaymentTx(tx([transfer(room)], { blockTime: paidAt }), room, now, { legacy: true });
    assert.deepEqual(bound, { ok: true });
    assert.equal(legacyMintFitsPayment(paidAt, paidAt + 90), true);
    assert.equal(legacyMintFitsPayment(paidAt, paidAt + 31 * 60), false);
    assert.equal(legacyMintFitsPayment(paidAt, paidAt - 3600), false);
    assert.equal(legacyMintFitsPayment(paidAt, null), false);
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

describe("payment checks", () => {
  const room = "Room111111111111111111111111111111111111111";
  const asset = "Asset111111111111111111111111111111111111";
  const now = 1_800_000_000;
  const transfer = (source: string, destination: string, lamports: number) => ({
    program: "system",
    parsed: { type: "transfer", info: { source, destination, lamports } },
  });
  const memo = (text: string) => ({ program: "spl-memo", parsed: text });
  const tx = (ixs: unknown[], extra: Record<string, unknown> = {}) =>
    ({ blockTime: now - 60, meta: { err: null }, transaction: { message: { instructions: ixs } }, ...extra }) as never;

  it("arb credit: room wallet to the arb treasury with the NFT memo", () => {
    const ok = checkArbCreditTx(tx([memo(asset), transfer(room, ARB_TREASURY, 5_000_000)]), { wallet: room, asset, nowSec: now });
    assert.deepEqual(ok, { ok: true, lamports: 5_000_000 });
  });
  it("arb credit refuses wrong sender, recipient, memo, amount, failed, missing or old tx", () => {
    const c = (t: never) => checkArbCreditTx(t, { wallet: room, asset, nowSec: now }).ok;
    assert.equal(c(tx([memo(asset), transfer("Other", ARB_TREASURY, 5_000_000)])), false);
    assert.equal(c(tx([memo(asset), transfer(room, PAY_WALLET, 5_000_000)])), false);
    assert.equal(c(tx([memo("OtherAsset"), transfer(room, ARB_TREASURY, 5_000_000)])), false);
    assert.equal(c(tx([transfer(room, ARB_TREASURY, 5_000_000)])), false);
    assert.equal(c(tx([memo(asset), transfer(room, ARB_TREASURY, ARB_CREDIT_MIN_LAMPORTS - 1)])), false);
    assert.equal(c(tx([memo(asset), transfer(room, ARB_TREASURY, 30_000_000)])), false);
    assert.equal(c(tx([memo(asset), transfer(room, ARB_TREASURY, 5_000_000)], { meta: { err: { x: 1 } } })), false);
    assert.equal(c(tx([memo(asset), transfer(room, ARB_TREASURY, 5_000_000)], { blockTime: null })), false);
    assert.equal(c(tx([memo(asset), transfer(room, ARB_TREASURY, 5_000_000)], { blockTime: now - 40 * 86_400 })), false);
    assert.equal(c(null as never), false);
  });
  it("fee: exact amount, room wallet to pay wallet, row memo", () => {
    const rowId = "poly-123:abc";
    const good = tx([memo(feeMemo(rowId)), transfer(room, PAY_WALLET, 50_000)]);
    assert.deepEqual(checkFeeTx(good, { wallet: room, rowId, lamports: 50_000, nowSec: now }), { ok: true, lamports: 50_000 });
    assert.equal(checkFeeTx(good, { wallet: room, rowId, lamports: 49_999, nowSec: now }).ok, false);
    assert.equal(checkFeeTx(good, { wallet: room, rowId: "other", lamports: 50_000, nowSec: now }).ok, false);
    assert.equal(checkFeeTx(good, { wallet: "Other", rowId, lamports: 50_000, nowSec: now }).ok, false);
    assert.equal(checkFeeTx(tx([memo(feeMemo(rowId)), transfer(room, ARB_TREASURY, 50_000)]), { wallet: room, rowId, lamports: 50_000, nowSec: now }).ok, false);
    assert.equal(checkFeeTx(good, { wallet: room, rowId, lamports: 0, nowSec: now }).ok, false);
  });
  it("fee memo and server ref use the same cleaned row id", () => {
    assert.equal(feeMemo("a b/c?d"), `solarchik-fee:${cleanRowId("a b/c?d")}`);
    assert.equal(cleanRowId("x".repeat(100)).length, 64);
  });
});

describe("Combo is paid only", () => {
  it("the store has no free Combo; every Combo SKU is Pro at the Pro price", () => {
    const skus = liveCatalog();
    const combos = skus.filter((s) => s.nft.classId === 3);
    assert.ok(combos.length >= 1, "a Combo is still sold");
    for (const sku of combos) {
      assert.equal(sku.nft.tier, "pro", sku.id);
      assert.equal(sku.priceSol, PRO_PRICE_SOL, sku.id);
      assert.ok(sku.priceSol > 0);
    }
    assert.equal(skus.find((s) => s.id === "sku-combo-prime"), undefined, "no free Combo SKU id");
    assert.ok(skus.some((s) => s.id === "sku-combo-prime-pro"));
    assert.ok(PAID_ONLY_BASE_SKUS.has("sku-combo-prime"));
    assert.equal(offerFor("sku-combo-prime-pro").tier, "pro");
    // Free SKUs are never a combo.
    for (const sku of skus.filter((s) => s.nft.tier === "free")) {
      assert.notEqual(sku.nft.classId, 3, sku.id);
      assert.equal(sku.priceSol, 0, sku.id);
    }
  });

  it("combo attributes are recognised (role=combo, or old class 4)", () => {
    const combo = liveCatalog().find((s) => s.id === "sku-combo-prime-pro")!;
    assert.equal(isComboAttrs(attrList(combo.nft)), true);
    assert.equal(isComboAttrs(new Map([["class", "4"]])), true);
    assert.equal(isComboAttrs(new Map([["class", "3"], ["role", "combo"]])), true);
    assert.equal(isComboAttrs(new Map([["class", "1"], ["role", "pred"]])), false);
    assert.equal(isComboAttrs(new Map([["class", "2"], ["role", "dex"]])), false);
    // Old class 3 without role=combo was the social bot, not a combo.
    assert.equal(isComboAttrs(new Map([["class", "3"]])), false);
  });

  it("a free combo mint or re-issue is refused; Pro combo and free non-combo pass", () => {
    assert.equal(freeComboRefusal("free", true), COMBO_PAID_ONLY);
    assert.equal(freeComboRefusal("pro", true), null);
    assert.equal(freeComboRefusal("free", false), null);
    assert.equal(freeComboRefusal("pro", false), null);
  });

  it("the server checks it on every path: catalog mint, re-issue, and the co-signed builder", () => {
    const src = readFileSync(new URL("./mint.server.ts", import.meta.url), "utf8");
    const mint = src.slice(src.indexOf("export async function prepareMintOnServer"), src.indexOf("export type PrepareReissueResult"));
    const reissue = src.slice(src.indexOf("export async function prepareReissueOnServer"), src.indexOf("async function serialize"));
    const builder = src.slice(src.indexOf("export async function buildCosigned"), src.indexOf("export async function prepareMintOnServer"));
    // Mint: refused before any slot, proof spend or payment check.
    assert.ok(mint.indexOf("freeComboRefusal(tier, sku.nft.classId === 3)") > 0);
    assert.ok(mint.indexOf("freeComboRefusal") < mint.indexOf("mintModeFor"));
    assert.ok(mint.indexOf("freeComboRefusal") < mint.indexOf("claimMintSlot"));
    // Pro (including Pro combo) still needs a verified on-chain payment.
    assert.match(mint, /verifyProPayment\(paySig, wallet, false\)/);
    // Re-issue without a Pro payment would be free: refused for combos.
    assert.ok(reissue.indexOf("freeComboRefusal(tier, isComboAttrs(old.attrs))") > 0);
    assert.ok(reissue.indexOf("freeComboRefusal") < reissue.indexOf("buildCosigned"));
    // The builder is the last gate for any co-signed tx.
    assert.ok(builder.includes("freeComboRefusal(tier, isComboAttrs(input.attributes))"));
    // Browser store also refuses before any money or mint.
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    const buy = store.slice(store.indexOf("async buyLiveSku(id)"));
    assert.ok(buy.indexOf("sku.nft.classId === 3") < buy.indexOf("callMintStatus"));
  });
});

describe("buffer alias on the server", () => {
  it("the `buffer` shim hands back the real Node Buffer (web3 layouts need writeUIntLE)", async () => {
    const mod = await import("../../polyfill.ts");
    assert.equal(mod.Buffer, globalThis.Buffer);
    assert.equal(typeof (mod.Buffer.alloc(8) as unknown as Buffer).writeUIntLE, "function");
    const { SystemProgram, Keypair } = await import("@solana/web3.js");
    const ix = SystemProgram.transfer({ fromPubkey: Keypair.generate().publicKey, toPubkey: Keypair.generate().publicKey, lamports: 200_000_000 });
    assert.equal(ix.data.length, 12);
  });
});

describe("live trading is off by default (hackathon build)", () => {
  it("only an explicit LIVE_TRADING_ENABLED=true turns it on", async () => {
    const { liveTradingFrom, arbMainnetFlag } = await import("./live-trading.ts");
    for (const v of [undefined, null, "", "false", "0", "yes", "1", " tru e"]) assert.equal(liveTradingFrom(v as string | undefined), false, String(v));
    assert.equal(liveTradingFrom("true"), true);
    assert.equal(liveTradingFrom(" TRUE "), true);
    // Mainnet arb needs both flags.
    assert.equal(arbModeFor(arbMainnetFlag(undefined, "true"), "shared").mode, "sim");
    assert.equal(arbModeFor(arbMainnetFlag("false", "true"), "shared").mode, "sim");
    assert.equal(arbModeFor(arbMainnetFlag("true", "true"), "shared").mode, "mainnet");
  });

  it("the browser gate starts closed and every live path checks it", async () => {
    const gate = await import("./live-trading.ts");
    assert.equal(gate.liveTradingAllowed(), false);
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    const poly = src("./poly-order.ts");
    const place = poly.slice(poly.indexOf("export async function placePolyOrder"));
    assert.ok(place.indexOf("liveTradingAllowed()") > 0 && place.indexOf("liveTradingAllowed()") < place.indexOf("loadPolygonAccount()"));
    const store = src("./store.ts");
    const body = (name: string) => store.slice(store.indexOf(name), store.indexOf(name) + 400);
    for (const name of ["setLiveArmed(on) {", "setLiveAck(on) {", "async fundArbDesk(", "async claimArbDeposit(", "async buySlice(", "async prepareBridgeDeposit(", "async confirmBridge(", "async function sendLiveSwap("]) {
      assert.match(body(name), /liveTradingAllowed\(\)/, name);
    }
    const auto = store.slice(store.indexOf("setAutoRun(on) {"), store.indexOf("setAutoRun(on) {") + 900);
    assert.match(auto, /liveTradingAllowed\(\)/);
    const dep = src("./deposit.server.ts");
    assert.equal((dep.match(/liveTradingFrom\(process\.env\.LIVE_TRADING_ENABLED\)/g) || []).length, 3);
    assert.match(src("./payments.server.ts"), /LIVE_TRADING_ENABLED/);
    assert.match(src("./arb-guard.server.ts"), /arbMainnetFlag\(process\.env\.LIVE_TRADING_ENABLED, process\.env\.ARB_MAINNET_ENABLED\)/);
    assert.match(src("./mint.server.ts"), /liveTrading: liveTradingFrom\(process\.env\.LIVE_TRADING_ENABLED\)/);
  });
});

describe("native bundle default server", () => {
  it("points at the judges deployment that serves /api/native", () => {
    const src = readFileSync(new URL("./server-calls.ts", import.meta.url), "utf8");
    assert.match(src, /NATIVE_API_ORIGIN = "https:\/\/solarchik-market\.vercel\.app"/);
    assert.doesNotMatch(readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"), /solarchik-super-app/);
  });
});

describe("prediction brain: honest model label and player language", () => {
  it("falls back to Gemini when Grok is unreachable and reports which model decided", () => {
    const src = readFileSync(new URL("./decide.server.ts", import.meta.url), "utf8");
    const helper = src.slice(src.indexOf("async function completeGrok("), src.indexOf("function localizeWhy"));
    assert.match(helper, /geminiTalk\(system, user/);
    assert.match(helper, /brain: "Gemini"/);
    assert.match(helper, /brain: "Grok"/);
    assert.match(src, /brain,\n    \};/);
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    assert.match(store, /brain: res\.ok \? res\.brain : undefined/);
    assert.match(store, /locale: typeof document !== "undefined" \? document\.documentElement\.lang : undefined,\n\s+focus: ask\.focus/);
  });
});
