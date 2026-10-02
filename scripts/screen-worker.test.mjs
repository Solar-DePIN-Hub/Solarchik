import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker, { payProblem, usdcIn, memosOf } from "../worker/solarchik-screen.js";

const PAY = "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USER = "0f8e2c1a-1111-4a2b-9c3d-abcdefabcdef";
const SIG = "5".repeat(87);
const REF = "Ref1111111111111111111111111111111111111111";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function kv() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => void m.set(k, String(v)) };
}

function payTx({ usd = 5, memo = USER.slice(0, 32), err = null, ageSec = 60, owner = PAY, mint = USDC, ref = REF } = {}) {
  const raw = String(Math.round(usd * 1e6));
  return {
    blockTime: Math.floor(Date.now() / 1000) - ageSec,
    meta: {
      err,
      preTokenBalances: [{ mint, owner, uiTokenAmount: { amount: "1000000" } }],
      postTokenBalances: [{ mint, owner, uiTokenAmount: { amount: String(1000000 + Number(raw)) } }],
      innerInstructions: [],
      logMessages: memo ? [`Program log: Memo (len ${memo.length}): "${memo}"`] : [],
    },
    transaction: {
      message: {
        accountKeys: [{ pubkey: "Payer111111111111111111111111111111111111" }, { pubkey: ref }],
        instructions: memo ? [{ program: "spl-memo", programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", parsed: memo }] : [],
      },
    },
  };
}

/** RPC mock: getTransaction -> tx, getSignaturesForAddress -> rows. Records calls. */
function rpc({ tx = null, rows = [] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), method: body.method, params: body.params });
    const result = body.method === "getTransaction" ? tx : body.method === "getSignaturesForAddress" ? rows : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
  return calls;
}

async function call(env, path, body, method = "POST") {
  const res = await worker.fetch(
    new Request("https://solarchik-screen.example" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, json: await res.json() };
}

test("payProblem / usdcIn / memosOf on a Solana Pay USDC transfer", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(usdcIn(payTx({ usd: 5 })), 5);
  assert.deepEqual(memosOf(payTx()), [USER.slice(0, 32), USER.slice(0, 32)]);
  assert.equal(payProblem(payTx(), USER, now), "");
  assert.equal(payProblem(payTx(), USER, now, REF), "");
  assert.equal(payProblem(null, USER, now), "not_found");
  assert.equal(payProblem(payTx({ err: { InstructionError: [0, "x"] } }), USER, now), "failed_tx");
  assert.equal(payProblem(payTx({ ageSec: 40 * 24 * 3600 }), USER, now), "too_old");
  assert.equal(payProblem(payTx({ memo: "someone-else" }), USER, now), "memo_mismatch");
  assert.equal(payProblem(payTx({ memo: "" }), USER, now), "memo_mismatch");
  assert.equal(payProblem(payTx({ owner: "Other11111111111111111111111111111111111111" }), USER, now), "no_usdc_to_treasury");
  assert.equal(payProblem(payTx({ mint: "So11111111111111111111111111111111111111112" }), USER, now), "no_usdc_to_treasury");
  assert.equal(payProblem(payTx({ usd: 0.5 }), USER, now), "no_usdc_to_treasury");
  assert.equal(payProblem(payTx({ usd: 250 }), USER, now), "amount_too_large");
  assert.equal(payProblem(payTx(), USER, now, "Other11111111111111111111111111111111111111"), "wrong_reference");
});

test("topup without a payment is refused and adds nothing (the old free $5 is gone)", async () => {
  const env = { BALANCES: kv() };
  rpc();
  const r = await call(env, "/topup", { userId: USER, usd: 5, sig: "onchain" });
  assert.equal(r.status, 402);
  assert.equal(r.json.error, "PAYMENT_REQUIRED");
  assert.equal((await call(env, "/topup", { userId: "x" })).status, 400);
  assert.equal(env.BALANCES.m.size, 0);
});

test("topup with a valid signature credits the real USDC amount once", async () => {
  const env = { BALANCES: kv() };
  const calls = rpc({ tx: payTx({ usd: 7.5 }) });
  const r = await call(env, "/topup", { userId: USER, sig: SIG });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { userId: USER, usd: 7.5, added: 7.5, sig: SIG });
  assert.equal(calls[0].method, "getTransaction");
  assert.equal(calls[0].url, "https://api.mainnet-beta.solana.com");
  assert.equal(calls[0].params[1].commitment, "confirmed");
  const again = await call(env, "/topup", { userId: USER, sig: SIG });
  assert.equal(again.status, 409);
  assert.equal((await call(env, "/balance?userId=" + USER, undefined, "GET")).json.usd, 7.5);
});

test("topup refuses someone else's payment, failed tx and RPC outage", async () => {
  const env = { BALANCES: kv() };
  rpc({ tx: payTx({ memo: "another-player-id-0000000000000" }) });
  const r = await call(env, "/topup", { userId: USER, sig: SIG });
  assert.equal(r.status, 402);
  assert.deepEqual(r.json, { error: "PAYMENT_INVALID", detail: "memo_mismatch" });
  rpc({ tx: null });
  assert.equal((await call(env, "/topup", { userId: USER, sig: SIG })).json.detail, "not_found");
  globalThis.fetch = async () => {
    throw new Error("down");
  };
  assert.equal((await call(env, "/topup", { userId: USER, sig: SIG })).status, 503);
  assert.equal(await env.BALANCES.get(USER), null);
});

test("topup by Solana Pay reference finds the transfer", async () => {
  const env = { BALANCES: kv(), SOLANA_RPC: "https://rpc.example" };
  const calls = rpc({ tx: payTx({ usd: 5 }), rows: [{ signature: SIG, err: null }] });
  const r = await call(env, "/topup", { userId: USER, ref: REF });
  assert.equal(r.status, 200);
  assert.equal(r.json.added, 5);
  assert.equal(calls[0].method, "getSignaturesForAddress");
  assert.equal(calls[0].url, "https://rpc.example");
  rpc({ rows: [] });
  assert.equal((await call(env, "/topup", { userId: USER, ref: REF })).json.error, "PAYMENT_NOT_FOUND");
});

test("screen still charges credit and refuses without it", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "test" };
  const need = await call(env, "/screen", { userId: USER, text: "Hi, it's Dana from the bank" });
  assert.equal(need.status, 402);
  assert.equal(need.json.error, "NEED_TOPUP");
  await env.BALANCES.put(USER, "1");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'Who is calling?\nSUMMARY_JSON={"caller_name":"Dana","company":"bank","callback":"","intent":"","urgency":"low","spam_risk":"high","action":"ignore","notes":""}' } }] }), { status: 200 });
  const ok = await call(env, "/screen", { userId: USER, text: "Hi, it's Dana from the bank" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.summary.caller_name, "Dana");
  assert.equal(ok.json.usd, 0.8);
});
