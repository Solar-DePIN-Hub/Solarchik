import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { recordPayment, type GuardSql } from "./guard-ledger.server.ts";
import {
  CLOCK_MEMO,
  STAKE_MAX_LAMPORTS,
  checkClockTx,
  clockDayAllowed,
  clockMemo,
  clockMemoDay,
  grantedWindows,
  owedLamports,
  pnlLamports,
  readBook,
  readSide,
  startsCover,
  windowToStart,
} from "./position-rules.ts";
import {
  closePosition,
  closeStale,
  feeBalance,
  openPosition,
  owedFor,
  recordClockDay,
  startFeeWindow,
  unpaidOwed,
  type PositionDeps,
} from "./positions-ledger.server.ts";
import { verifyEd25519 } from "./wallet-proof.server.ts";
import { encodeBase58 } from "./base58.ts";
import { FEE_MAX_LAMPORTS, MEMO_PROGRAM_ID } from "./payment-rules.ts";
import { H48_MS, D7_MS, utcDayKey } from "../game/fee-windows.ts";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 9, 1, 12, 0, 0);

describe("position rules (pure)", () => {
  it("PnL from server prices, sign flipped for no/short", () => {
    assert.equal(pnlLamports(10_000_000, "yes", 0.5, 0.6), 2_000_000);
    assert.equal(pnlLamports(10_000_000, "no", 0.5, 0.6), -2_000_000);
    assert.equal(pnlLamports(10_000_000, "short", 0.5, 0.4), 2_000_000);
    assert.equal(pnlLamports(10_000_000, "yes", 0.5, 0.5), 0);
    assert.equal(pnlLamports(10_000_000, "yes", 0, 0.5), 0, "no entry");
    assert.equal(pnlLamports(10_000_000, "yes", 0.5, 2), 0, "bad exit price");
  });
  it("owed: 5% of profit for Free outside windows; Pro, loss, covered owe 0; capped", () => {
    assert.equal(owedLamports({ tier: "free", pnlLamports: 2_000_000, covered: false }), 100_000);
    assert.equal(owedLamports({ tier: "pro", pnlLamports: 2_000_000, covered: false }), 0);
    assert.equal(owedLamports({ tier: "free", pnlLamports: -2_000_000, covered: false }), 0);
    assert.equal(owedLamports({ tier: "free", pnlLamports: 2_000_000, covered: true }), 0);
    assert.equal(owedLamports({ tier: "free", pnlLamports: 9, covered: false }), 0, "below 1 lamport");
    assert.equal(owedLamports({ tier: "free", pnlLamports: 10 * 1e9, covered: false }), FEE_MAX_LAMPORTS);
  });
  it("reads only known sides and poly books", () => {
    assert.equal(readSide("yes"), "yes");
    assert.equal(readSide("buy"), null);
    assert.equal(readBook("poly:12345"), "poly:12345");
    assert.equal(readBook("poly:btc-updown-5m-1"), "poly:btc-updown-5m-1");
    assert.equal(readBook("dex:SOL"), "");
    assert.equal(readBook("poly:a b"), "");
  });
  it("windows: same streak rules as the app, started at server time, coverage by server open time", () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ day: utcDayKey(t0 + i * DAY), at: t0 + i * DAY }));
    const six = grantedWindows(days.slice(0, 6));
    assert.equal(six.length, 0);
    const seven = grantedWindows(days);
    assert.equal(seven.length, 1);
    assert.equal(seven[0].kind, "h48");
    const gap = grantedWindows([...days.slice(0, 3), ...days.slice(4)]);
    assert.equal(gap.length, 0, "a missed day resets the streak");
    const thirty = grantedWindows(Array.from({ length: 30 }, (_, i) => ({ day: utcDayKey(t0 + i * DAY), at: t0 + i * DAY })));
    assert.deepEqual(thirty.map((w) => w.kind).sort(), ["d7", "h48", "h48", "h48", "h48"]);
    const now = t0 + 10 * DAY;
    const pick = windowToStart(seven, [], now);
    assert.ok(pick?.fresh);
    assert.equal(pick.start.endsMs - pick.start.startedMs, H48_MS);
    assert.equal(windowToStart(seven, [pick.start], now + 1000)?.fresh, false, "live window is returned, not a second one");
    assert.equal(windowToStart(seven, [pick.start], now + H48_MS + 1), null, "spent");
    assert.equal(startsCover([pick.start], now + 5), true);
    assert.equal(startsCover([pick.start], now - 5), false);
    assert.equal(startsCover([pick.start], now + H48_MS), false);
    assert.ok(D7_MS > H48_MS);
  });
  it("clock memo format, day and age", () => {
    const memo = clockMemo("2026-10-01", 812.7, 6, "wind");
    assert.equal(memo, "solarchik clock 2026-10-01 812m s6 wind");
    assert.ok(CLOCK_MEMO.test(memo));
    assert.equal(clockMemoDay(memo), "2026-10-01");
    assert.equal(clockMemoDay("solarchik clock 2026-10-01 x"), "");
    assert.equal(clockDayAllowed("2026-10-01", t0), true);
    assert.equal(clockDayAllowed("2026-09-30", t0), true);
    assert.equal(clockDayAllowed("2026-09-29", t0), false);
    assert.equal(clockDayAllowed("2026-10-02", t0), false, "future day");
  });
  it("clock message signature is checked with the player's key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const address = encodeBase58(new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(12)));
    const memo = clockMemo("2026-10-01", 100, 1, "calm");
    const sig = encodeBase58(new Uint8Array(sign(null, Buffer.from(memo), privateKey)));
    assert.equal(verifyEd25519(address, sig, memo), true);
    assert.equal(verifyEd25519(address, sig, memo.replace("100m", "999m")), false);
  });
  it("clock tx: signer and memo for the day", () => {
    const memo = clockMemo("2026-10-01", 100, 1, "calm");
    const tx = (signer: string, text: string, extra: Record<string, unknown> = {}) =>
      ({
        blockTime: 1,
        meta: { err: null },
        transaction: {
          message: {
            accountKeys: [{ pubkey: signer, signer: true }],
            instructions: [{ program: "spl-memo", programId: MEMO_PROGRAM_ID, parsed: text }],
          },
        },
        ...extra,
      }) as never;
    assert.equal(checkClockTx(tx("Player", memo), { address: "Player", day: "2026-10-01" }).ok, true);
    assert.equal(checkClockTx(tx("Other", memo), { address: "Player", day: "2026-10-01" }).ok, false);
    assert.equal(checkClockTx(tx("Player", memo), { address: "Player", day: "2026-10-02" }).ok, false);
    assert.equal(checkClockTx(tx("Player", memo, { meta: { err: { x: 1 } } }), { address: "Player", day: "2026-10-01" }).ok, false);
    assert.equal(checkClockTx(null, { address: "Player", day: "2026-10-01" }).ok, false);
  });
});

describe("positions ledger on Postgres (PGLite)", () => {
  let sql: GuardSql;
  const prices = new Map<string, number | null>();
  const agents = new Map<string, { owner: string; free: boolean }>();
  const deps = (now: number): PositionDeps => ({
    sql,
    now,
    price: async (book) => prices.get(book) ?? null,
    agent: async (asset) => agents.get(asset) ?? null,
  });
  before(async () => {
    const pg = new PGlite();
    for (const f of ["0002_guards.sql", "0003_mints.sql", "0004_payments.sql", "0005_positions.sql", "0006_strategy_market.sql"]) {
      await pg.exec(readFileSync(new URL(`../../../migrations/${f}`, import.meta.url), "utf8"));
    }
    sql = { query: async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as never[] };
    agents.set("FreeAsset", { owner: "roomA", free: true });
    agents.set("ProAsset", { owner: "roomA", free: false });
    agents.set("OtherAsset", { owner: "roomB", free: true });
  });

  it("open takes the server price and refuses foreign NFTs and oversize stakes", async () => {
    prices.set("poly:1", 0.5);
    const ok = await openPosition(deps(t0), { wallet: "roomA", fillId: "f1", asset: "FreeAsset", book: "poly:1", side: "yes", stakeLamports: 10_000_000 });
    assert.deepEqual(ok, { ok: true, entryPx: 0.5, openedMs: t0, tier: "free" });
    const foreign = await openPosition(deps(t0), { wallet: "roomA", fillId: "f2", asset: "OtherAsset", book: "poly:1", side: "yes", stakeLamports: 1 });
    assert.equal(foreign.ok, false);
    const big = await openPosition(deps(t0), { wallet: "roomA", fillId: "f3", asset: "FreeAsset", book: "poly:1", side: "yes", stakeLamports: STAKE_MAX_LAMPORTS + 1 });
    assert.equal(big.ok, false);
    const stolenId = await openPosition(deps(t0), { wallet: "roomB", fillId: "f1", asset: "OtherAsset", book: "poly:1", side: "yes", stakeLamports: 1000 });
    assert.equal(stolenId.ok, false, "fill id bound to its wallet");
  });

  it("close uses the server exit price; owed = 5% of server PnL; recordFee check needs the server row", async () => {
    prices.set("poly:1", 0.6);
    const closed = await closePosition(deps(t0 + 60_000), { wallet: "roomA", fillId: "f1" });
    assert.equal(closed.ok, true);
    if (!closed.ok) return;
    assert.equal(closed.pnlLamports, 2_000_000);
    assert.equal(closed.owedLamports, 100_000);
    const again = await closePosition(deps(t0 + 120_000), { wallet: "roomA", fillId: "f1" });
    assert.equal(again.ok && again.owedLamports, 100_000, "idempotent, price does not move after close");
    assert.deepEqual(await owedFor(sql, "roomA", "f1"), { ok: true, owedLamports: 100_000 });
    assert.equal((await owedFor(sql, "roomB", "f1")).ok, false, "other wallet");
    assert.equal((await owedFor(sql, "roomA", "never-opened")).ok, false, "unknown row is refused");
    assert.equal((await closePosition(deps(t0), { wallet: "roomA", fillId: "never-opened" })).ok, false);
  });

  it("Pro and losing trades owe 0", async () => {
    prices.set("poly:2", 0.4);
    await openPosition(deps(t0 + 1000), { wallet: "roomA", fillId: "p1", asset: "ProAsset", book: "poly:2", side: "yes", stakeLamports: 10_000_000 });
    prices.set("poly:2", 0.8);
    const pro = await closePosition(deps(t0 + 2000), { wallet: "roomA", fillId: "p1" });
    assert.equal(pro.ok && pro.owedLamports, 0);
    assert.equal(pro.ok && pro.pnlLamports > 0, true);
    const r = await owedFor(sql, "roomA", "p1");
    assert.equal(r.ok, false, "nothing owed: recordFee refuses a fee for this row");
  });

  it("unpaid owed blocks new Free opens after the grace period, until the fee is recorded", async () => {
    assert.equal(await unpaidOwed(sql, "roomA", t0 + DAY + 61_000), 100_000);
    prices.set("poly:3", 0.5);
    const blocked = await openPosition(deps(t0 + DAY + 70_000), { wallet: "roomA", fillId: "f4", asset: "FreeAsset", book: "poly:3", side: "yes", stakeLamports: 1_000_000 });
    assert.equal(blocked.ok, false);
    assert.equal(!blocked.ok && blocked.unpaidLamports, 100_000);
    const proOk = await openPosition(deps(t0 + DAY + 70_000), { wallet: "roomA", fillId: "p2", asset: "ProAsset", book: "poly:3", side: "yes", stakeLamports: 1_000_000 });
    assert.equal(proOk.ok, true, "Pro is never blocked");
    await recordPayment(sql, { sig: "s".repeat(64), kind: "fee", cluster: "devnet", wallet: "roomA", asset: "", ref: "f1", lamports: 100_000, now: t0 + DAY });
    assert.equal(await unpaidOwed(sql, "roomA", t0 + DAY + 61_000), 0);
    const open = await openPosition(deps(t0 + DAY + 80_000), { wallet: "roomA", fillId: "f4", asset: "FreeAsset", book: "poly:3", side: "yes", stakeLamports: 1_000_000 });
    assert.equal(open.ok, true);
    const bal = await feeBalance(sql, "roomA");
    assert.equal(bal.owedLamports, 100_000);
    assert.equal(bal.paidLamports, 100_000);
    assert.equal(bal.dueLamports, 0);
  });

  it("positions left open are closed by the server at its own price", async () => {
    prices.set("poly:3", 0.75);
    const n = await closeStale(deps(t0 + DAY + 80_000 + 7 * 3600_000), "roomA");
    assert.ok(n >= 1);
    const r = await owedFor(sql, "roomA", "f4");
    assert.deepEqual(r, { ok: true, owedLamports: 25_000 }, "1_000_000 * 0.5 profit * 5%");
  });

  it("clock days: one per room per day, one room per player wallet per day", async () => {
    assert.deepEqual(await recordClockDay(sql, { wallet: "roomC", day: "2026-10-01", clockAddress: "phantom1", clockSig: "sig1", now: t0 }), { ok: true, fresh: true });
    assert.deepEqual(await recordClockDay(sql, { wallet: "roomC", day: "2026-10-01", clockAddress: "phantom1", clockSig: "sig1", now: t0 }), { ok: true, fresh: false });
    assert.equal((await recordClockDay(sql, { wallet: "roomD", day: "2026-10-01", clockAddress: "phantom1", clockSig: "sig2", now: t0 })).ok, false);
    assert.equal((await recordClockDay(sql, { wallet: "roomD", day: "2026-10-02", clockAddress: "phantom2", clockSig: "sig1", now: t0 })).ok, false, "signature reuse");
  });

  it("fee-free window: needs 7 verified days; started at server time; covers only opens inside it", async () => {
    assert.equal((await startFeeWindow(sql, "roomE", t0)).ok, false, "no verified days");
    for (let i = 0; i < 7; i++) {
      const at = t0 + i * DAY;
      await recordClockDay(sql, { wallet: "roomE", day: utcDayKey(at), clockAddress: "phantomE", clockSig: `sigE${i}`, now: at });
    }
    const start = t0 + 7 * DAY;
    const w = await startFeeWindow(sql, "roomE", start);
    assert.equal(w.ok && w.fresh, true);
    const w2 = await startFeeWindow(sql, "roomE", start + 1000);
    assert.equal(w2.ok && w2.fresh, false, "same live window");
    agents.set("FreeE", { owner: "roomE", free: true });
    prices.set("poly:9", 0.5);
    await openPosition(deps(start + 10), { wallet: "roomE", fillId: "e1", asset: "FreeE", book: "poly:9", side: "yes", stakeLamports: 10_000_000 });
    prices.set("poly:9", 0.6);
    const inside = await closePosition(deps(start + 20), { wallet: "roomE", fillId: "e1" });
    assert.equal(inside.ok && inside.covered, true);
    assert.equal(inside.ok && inside.owedLamports, 0);
    prices.set("poly:9", 0.5);
    await openPosition(deps(start + H48_MS + 10), { wallet: "roomE", fillId: "e2", asset: "FreeE", book: "poly:9", side: "yes", stakeLamports: 10_000_000 });
    prices.set("poly:9", 0.6);
    const after = await closePosition(deps(start + H48_MS + 20), { wallet: "roomE", fillId: "e2" });
    assert.equal(after.ok && after.covered, false);
    assert.equal(after.ok && after.owedLamports, 100_000);
    assert.equal((await startFeeWindow(sql, "roomE", start + H48_MS + 30)).ok, false, "window used up");
  });
});
