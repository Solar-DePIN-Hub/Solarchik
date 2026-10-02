import { test } from "node:test";
import assert from "node:assert/strict";
import { readCtx } from "./sol-actions.ts";
import { linkParts, looksLikeCommand, parseLocal, planAction, readyText, statusText, windowsIn, type ActSide } from "./sol-act-plan.ts";

const A = "AssetMine1111111111111111111111111111111111";
const F = "AssetFree2222222222222222222222222222222222";
const M = "AssetMkt33333333333333333333333333333333333";
const N = "AssetMkt44444444444444444444444444444444444";
const ctx = readCtx({
  agents: [
    { id: A, name: "Calm Hourly BTC", running: true, strategyNft: true, risk: "calm", windows: [60, 240], trades: 3, pnlSol: 0.0123 },
    { id: F, name: "Bitcoin Windows #11", running: false },
  ],
  market: [
    { id: M, name: "Momentum Rider 5m", priceSol: 0.12, risk: "risky", windows: [5, 15] },
    { id: N, name: "Steady Event Scout", priceSol: 0.08, risk: "balanced", windows: [240] },
  ],
  canMintFree: false,
});
const spec = { lanes: ["crypto"], windows: [60, 240], risk: "calm", stakeSol: 0.01, askLo: 0.3, askHi: 0.7, edgeBps: 100, stopPct: 30, takePct: 60, rules: "" };
const side: ActSide = {
  agents: { [A]: { spec, version: 1, aprSince: 12.5 }, [F]: {} },
  listings: { [M]: { priceLamports: 120_000_000, spec: { ...spec, lanes: ["crypto", "events"], windows: [5, 15], risk: "risky", stakeSol: 0.02 } }, [N]: { priceLamports: 80_000_000 } },
  freeName: "Bitcoin Windows #11",
};

test("commands are told apart from chat (EN/UK)", () => {
  for (const m of ["buy Momentum Rider 5m", "купи Momentum Rider", "pause my agent", "зупини агента", "set my agent to low risk 5m", "зміни стратегію на ризиковий 5 хвилин", "mint the free agent", "how is my agent doing?"]) assert.ok(looksLikeCommand(m), m);
  for (const m of ["hi Sol!", "привіт, як погода?", "tell me a joke"]) assert.ok(!looksLikeCommand(m), m);
});

test("offline parser: same targets and legal values as the server", () => {
  assert.deepEqual(parseLocal("buy the Momentum Rider", ctx), { type: "buy_strategy", listing: M });
  assert.deepEqual(parseLocal("купи Steady Event Scout", ctx), { type: "buy_strategy", listing: N });
  assert.equal(parseLocal("buy something nice", ctx), null);
  assert.deepEqual(parseLocal("зміни мого агента на ризиковий 5 хвилин", ctx), { type: "set_strategy", agent: A, risk: "risky", windows: [5] });
  assert.deepEqual(parseLocal("pause my agent", ctx), { type: "stop_agent", agent: A });
  assert.deepEqual(parseLocal("start Bitcoin Windows", ctx), { type: "start_agent", agent: F });
  assert.deepEqual(parseLocal("mint the free agent", ctx), { type: "mint_free" });
  assert.deepEqual(windowsIn("1 год і 15 хв, 4h"), [15, 60, 240]);
});

test("buy card: listing price in SOL, no lock, wallet signs", () => {
  const p = planAction({ type: "buy_strategy", listing: M }, ctx, side, "en");
  assert.equal(p.blocked, undefined);
  assert.equal(p.priceLamports, 120_000_000);
  assert.equal(p.locksSale, false);
  assert.equal(p.onChain, true);
  assert.match(p.title, /Momentum Rider 5m/);
  assert.match(readyText(p, "uk"), /^Готово до підтвердження: /);
});

test("strategy card: exact diff, template keeps the NFT's lanes, 240 h lock", () => {
  const p = planAction({ type: "set_strategy", agent: A, risk: "risky", windows: [5] }, ctx, side, "uk");
  assert.deepEqual(p.changes.map((c) => [c.key, c.from, c.to]), [["risk", "спокійний", "ризиковий"], ["windows", "60/240", "5"]]);
  assert.equal(p.locksSale, true);
  assert.equal(p.priceLamports, 0);
  const t = planAction({ type: "set_strategy", agent: A, listing: M }, ctx, side, "en");
  assert.deepEqual(t.next?.lanes, ["crypto"]);
  assert.equal(t.next?.stakeSol, 0.02);
  assert.equal(t.templateName, "Momentum Rider 5m");
  assert.equal(planAction({ type: "set_strategy", agent: A, risk: "calm" }, ctx, side, "en").blocked, "same");
});

test("blocked plans explain why and never look runnable", () => {
  assert.equal(planAction({ type: "mint_free" }, ctx, side, "en").blocked, "free_used");
  assert.equal(planAction({ type: "set_strategy", agent: F, risk: "risky" }, ctx, side, "en").blocked, "no_strategy_nft");
  assert.equal(planAction({ type: "start_agent", agent: A }, ctx, side, "en").blocked, "already_running");
  assert.equal(planAction({ type: "stop_agent", agent: F }, ctx, side, "uk").blockedText, "Bitcoin Windows #11 уже на паузі.");
  assert.equal(planAction({ type: "buy_strategy", listing: "gone" }, ctx, side, "en").blocked, "gone");
  const listed: ActSide = { ...side, agents: { ...side.agents, [A]: { spec, listed: true } } };
  assert.equal(planAction({ type: "set_strategy", agent: A, risk: "risky" }, ctx, listed, "en").blocked, "listed");
  const start = planAction({ type: "start_agent", agent: F }, ctx, side, "en");
  assert.equal(start.onChain, false);
  assert.equal(start.priceLamports, undefined);
});

test("status line and Explorer links in chat", () => {
  assert.equal(
    statusText(A, ctx, side, "en"),
    "Calm Hourly BTC is running. Trades: 3, PnL 0.0123 SOL. Strategy: Calm risk, 60/240 min windows, APR since the last change 12.5%.",
  );
  const sig = "3uGignaiGME68YTrmutt5ZfNvJ8X3qBkuDswZf7LdtGXFzfoeBPAiHmfEm61DKL7oSTLLTjK8gJYBta1srXCqwFH";
  const parts = linkParts(`Done: bought. https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].href, `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  assert.equal(linkParts("see https://evil.example/tx/abc").length, 1);
  assert.equal(linkParts("https://explorer.solana.com/tx/abc?cluster=mainnet").every((p) => !p.href), true);
});
