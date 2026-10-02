import { test } from "node:test";
import assert from "node:assert/strict";
import { ctxLines, normalizeAction, readCtx } from "./sol-actions.ts";

const ctx = readCtx({
  agents: [
    { id: "AssetCalm111", name: "Calm Hourly BTC", running: true, strategyNft: true, risk: "calm", windows: [60, 240] },
    { id: "desk:free", name: "Free Scout", running: false },
  ],
  market: [{ id: "AV8Eg", name: "Momentum Rider 5m", priceSol: 0.12, risk: "risky", windows: [5, 15] }],
  canMintFree: true,
});

test("short ids map back to the phone's own ids", () => {
  assert.deepEqual(normalizeAction({ action: "buy_strategy", listing: "m1" }, ctx), { type: "buy_strategy", listing: "AV8Eg" });
  assert.deepEqual(normalizeAction({ action: "stop_agent", agent: "a2" }, ctx), { type: "stop_agent", agent: "desk:free" });
});

test("strategy change: legal risk/windows only, defaults to the only strategy NFT", () => {
  assert.deepEqual(normalizeAction({ action: "set_strategy", risk: "calm", windows: [5, 7, 5] }, ctx), { type: "set_strategy", agent: "AssetCalm111", risk: "calm", windows: [5] });
  assert.deepEqual(normalizeAction({ action: "set_strategy", agent: "a1", listing: "m1" }, ctx), { type: "set_strategy", agent: "AssetCalm111", listing: "AV8Eg" });
  assert.equal(normalizeAction({ action: "set_strategy", agent: "a1" }, ctx), null);
  assert.equal(normalizeAction({ action: "set_strategy", risk: "yolo" }, ctx), null);
});

test("invented targets and unknown actions are dropped", () => {
  assert.equal(normalizeAction({ action: "buy_strategy", listing: "m9" }, ctx), null);
  assert.equal(normalizeAction({ action: "buy_strategy", listing: "SomeOtherAsset" }, ctx), null);
  assert.equal(normalizeAction({ action: "transfer_all" }, ctx), null);
  assert.equal(normalizeAction({ action: "none" }, ctx), null);
  assert.deepEqual(normalizeAction({ action: "mint_free" }, ctx), { type: "mint_free" });
});

test("context lines carry names, prices and short ids", () => {
  const s = ctxLines(ctx);
  assert.match(s, /a1: Calm Hourly BTC \[strategy NFT\]; running; risk calm; windows 60\/240m/);
  assert.match(s, /m1: Momentum Rider 5m; 0.12 SOL/);
  assert.match(s, /FREE MINT AVAILABLE: yes/);
});

test("language guard ignores on-chain names, full or shortened", async () => {
  const { withoutNames } = await import("./sol-actions.ts");
  const s = withoutNames("Готово: ставлю Momentum Rider на a1, вікно 5m.", ctx);
  assert.doesNotMatch(s, /Momentum|Rider|a1|5m/);
  assert.match(s, /Готово/);
});
