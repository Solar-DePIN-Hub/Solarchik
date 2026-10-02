import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker, { payProblem, usdcIn, memosOf, webhookProblem, WEBHOOK_TOLERANCE_SEC, e164, callParties, playerFor, callToken, noteText } from "../worker/solarchik-screen.js";

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

async function call(env, path, body, method = "POST", headers = {}) {
  const res = await worker.fetch(
    new Request("https://solarchik-screen.example" + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
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

// ---- auth: /sip (Standard Webhooks), /expect and /voicemail (operator token) ----

const WH_KEY = Buffer.from("solarchik-test-webhook-secret-32b").toString("base64");
const WH_SECRET = "whsec_" + WH_KEY;

function signed(body, { id = "wh_1", ts = Math.floor(Date.now() / 1000), key = WH_KEY } = {}) {
  const sig = createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` };
}

const INCOMING = JSON.stringify({ type: "realtime.call.incoming", data: { call_id: "rtc_123" } });

test("webhookProblem accepts a valid Standard Webhooks signature and rejects tampering", async () => {
  const now = Math.floor(Date.now() / 1000);
  const h = (o) => new Headers(o);
  assert.equal(await webhookProblem(WH_SECRET, h(signed(INCOMING, { ts: now })), INCOMING, now), "");
  assert.equal(await webhookProblem(WH_KEY, h(signed(INCOMING, { ts: now })), INCOMING, now), "", "prefix optional");
  const multi = signed(INCOMING, { ts: now });
  multi["webhook-signature"] = "v1,AAAA " + multi["webhook-signature"];
  assert.equal(await webhookProblem(WH_SECRET, h(multi), INCOMING, now), "", "any listed v1 signature");
  assert.equal(await webhookProblem(WH_SECRET, h({}), INCOMING, now), "missing_headers");
  assert.equal(await webhookProblem(WH_SECRET, h(signed(INCOMING, { ts: now })), INCOMING + " ", now), "bad_signature");
  const other = Buffer.from("another-secret-another-secret-32").toString("base64");
  assert.equal(await webhookProblem(WH_SECRET, h(signed(INCOMING, { ts: now, key: other })), INCOMING, now), "bad_signature");
  const old = now - WEBHOOK_TOLERANCE_SEC - 1;
  assert.equal(await webhookProblem(WH_SECRET, h(signed(INCOMING, { ts: old })), INCOMING, now), "stale_timestamp");
  assert.equal(await webhookProblem(WH_SECRET, h(signed(INCOMING, { ts: now + WEBHOOK_TOLERANCE_SEC + 1 })), INCOMING, now), "stale_timestamp");
  assert.equal(await webhookProblem(WH_SECRET, h({ ...signed(INCOMING), "webhook-timestamp": "soon" }), INCOMING, now), "bad_timestamp");
});

test("/sip with OPENAI_WEBHOOK_SECRET set: unsigned or forged calls get 401 and OpenAI is never called", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "test", OPENAI_WEBHOOK_SECRET: WH_SECRET };
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response("{}", { status: 200 });
  };
  const none = await call(env, "/sip", INCOMING);
  assert.equal(none.status, 401);
  assert.equal(none.json.detail, "missing_headers");
  const forged = await call(env, "/sip", INCOMING, "POST", signed(INCOMING, { key: Buffer.from("x".repeat(32)).toString("base64") }));
  assert.equal(forged.status, 401);
  assert.equal(seen.length, 0);
  const ok = await call(env, "/sip", INCOMING, "POST", signed(INCOMING));
  assert.equal(ok.status, 200);
  assert.equal(ok.json.accepted, true);
  assert.deepEqual(seen, ["https://api.openai.com/v1/realtime/calls/rtc_123/accept"]);
  assert.equal((await call(env, "/openai-webhook", INCOMING)).status, 401, "alias is guarded too");
});

test("/sip without the secret keeps accepting (not enforced until Vadym sets it)", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "test" };
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const r = await call(env, "/sip", INCOMING);
  assert.equal(r.status, 200);
  assert.equal(r.json.accepted, true);
});

test("/expect and /voicemail need the operator token; /inbox reads what was written", async () => {
  const open = { BALANCES: kv() };
  assert.equal((await call(open, "/expect", { userId: USER })).status, 401, "closed without SECRETARY_TOKEN");
  assert.equal((await call(open, "/voicemail", { userId: USER, text: "hi" })).status, 401);
  const env = { BALANCES: kv(), SECRETARY_TOKEN: "op-token-123" };
  assert.equal((await call(env, "/expect", { userId: USER })).status, 401);
  assert.equal((await call(env, "/expect", { userId: USER }, "POST", { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await call(env, "/voicemail", { userId: USER, text: "spam" })).status, 401);
  assert.equal(env.BALANCES.m.size, 0, "nothing written by unauthenticated calls");
  const auth = { authorization: "Bearer op-token-123" };
  assert.equal((await call(env, "/expect", { userId: USER }, "POST", auth)).status, 200);
  const vm = await call(env, "/voicemail", { text: "Call back Dana", caller: "+380000000000" }, "POST", auth);
  assert.equal(vm.status, 200);
  assert.equal(vm.json.userId, USER);
  const inbox = await call(env, "/inbox?userId=" + USER, undefined, "GET");
  assert.equal(inbox.json.items[0].text, "Call back Dana");
});

// ---- incoming calls: who is it for, billing, note tool ----

const OWNER = "owner-demo-account-0001";
const sipCall = (headers, callId = "rtc_abc") => JSON.stringify({ type: "realtime.call.incoming", data: { call_id: callId, sip_headers: headers } });
const ZADARMA = [
  { name: "From", value: '"Dana" <sip:+380671112233@pbx.zadarma.com>;tag=1' },
  { name: "To", value: "<sip:proj_123@sip.api.openai.com>" },
  { name: "Diversion", value: "<sip:+380914810885@pbx.zadarma.com>;reason=unconditional" },
];

function openai() {
  const calls = [];
  let failToolAccept = false;
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    if (failToolAccept && body?.tools) return new Response('{"error":"mcp"}', { status: 400 });
    return new Response("{}", { status: 200 });
  };
  return { calls, failTools: () => (failToolAccept = true) };
}

test("e164 and callParties read Zadarma-style SIP headers", async () => {
  assert.equal(e164("<sip:+380914810885@pbx.zadarma.com>;reason=unconditional"), "+380914810885");
  assert.equal(e164("tel:380914810885"), "+380914810885");
  assert.equal(e164("+380 91 481-08-85"), "+380914810885");
  assert.equal(e164("<sip:proj_123@sip.api.openai.com>"), "");
  assert.equal(e164("sip:0911@x"), "");
  assert.deepEqual(callParties(ZADARMA), { forwardedFrom: "+380914810885", to: "", number: "+380914810885", caller: "+380671112233" });
  const env = { BALANCES: kv(), OWNER_USER_ID: OWNER };
  assert.equal(await playerFor(env, callParties(ZADARMA)), OWNER, "default number -> owner/demo account");
  await env.BALANCES.put("phone:+380501234567", "player-two-000000001");
  const other = [{ name: "From", value: "sip:+380671112233@x" }, { name: "Diversion", value: "<sip:+380501234567@x>" }];
  assert.equal(await playerFor(env, callParties(other)), "player-two-000000001", "KV phone map wins");
  assert.equal(await playerFor({ BALANCES: kv() }, callParties(other)), "", "unmapped");
});

test("mapped call: one session is charged, the inbox shows it, accept carries the note tool", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk-test", OWNER_USER_ID: OWNER };
  await env.BALANCES.put(OWNER, "1");
  const o = openai();
  const r = await call(env, "/sip", sipCall(ZADARMA));
  assert.equal(r.status, 200);
  assert.equal(r.json.accepted, true);
  assert.equal(r.json.noteTool, true);
  assert.equal(await env.BALANCES.get(OWNER), "0.8");
  const accept = o.calls.find((c) => c.url.endsWith("/accept"));
  assert.equal(accept.body.tools[0].server_url, "https://solarchik-screen.example/mcp");
  assert.equal(accept.body.tools[0].headers["x-solarchik-call"], await callToken(env, "rtc_abc"));
  assert.equal(accept.body.tools[0].require_approval, "never");
  const inbox = JSON.parse(await env.BALANCES.get("inbox:" + OWNER));
  assert.equal(inbox[0].caller, "+380671112233");
  assert.equal(inbox[0].status, "pending");
});

test("note tool over MCP: wrong token 401, tools/list, tools/call fills the inbox line", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk-test", OWNER_USER_ID: OWNER };
  await env.BALANCES.put(OWNER, "1");
  openai();
  await call(env, "/sip", sipCall(ZADARMA));
  const bad = await call(env, "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, "POST", { "x-solarchik-call": "rtc_abc.deadbeef" });
  assert.equal(bad.status, 401);
  assert.equal((await call(env, "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
  const h = { "x-solarchik-call": await callToken(env, "rtc_abc") };
  const init = await call(env, "/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, "POST", h);
  assert.equal(init.json.result.serverInfo.name, "solarchik-secretary");
  const list = await call(env, "/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }, "POST", h);
  assert.equal(list.json.result.tools[0].name, "save_call_note");
  const args = { caller_name: "Dana", company: "Monobank", callback: "+380671112233", intent: "Card limit question", urgency: "medium", spam_risk: "low", action: "callback" };
  const saved = await call(env, "/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "save_call_note", arguments: args } }, "POST", h);
  assert.equal(saved.json.result.isError, undefined);
  const inbox = JSON.parse(await env.BALANCES.get("inbox:" + OWNER));
  assert.equal(inbox.length, 1, "the pending line is updated, not duplicated");
  assert.equal(inbox[0].status, "done");
  assert.equal(inbox[0].text, noteText(args));
  assert.match(inbox[0].text, /^Dana, Monobank: Card limit question/);
  const read = await call(env, "/inbox?userId=" + OWNER, undefined, "GET");
  assert.equal(read.json.items[0].summary.company, "Monobank");
});

test("no credit: missed-call line and reject; tool accept failure falls back; total failure refunds", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk-test", OWNER_USER_ID: OWNER };
  let o = openai();
  const poor = await call(env, "/sip", sipCall(ZADARMA, "rtc_poor"));
  assert.equal(poor.json.error, "NEED_TOPUP");
  assert.ok(o.calls.some((c) => c.url.endsWith("/rtc_poor/reject")));
  assert.equal(JSON.parse(await env.BALANCES.get("inbox:" + OWNER))[0].status, "need_topup");

  await env.BALANCES.put(OWNER, "0.4");
  o = openai();
  o.failTools();
  const fb = await call(env, "/sip", sipCall(ZADARMA, "rtc_fb"));
  assert.equal(fb.json.accepted, true);
  assert.equal(fb.json.noteTool, false);
  assert.equal(o.calls.filter((c) => c.url.endsWith("/accept")).length, 2);

  globalThis.fetch = async () => new Response("{}", { status: 500 });
  const down = await call(env, "/sip", sipCall(ZADARMA, "rtc_down"));
  assert.equal(down.json.refunded, true);
  assert.equal(await env.BALANCES.get(OWNER), "0.2", "only the answered call was charged");
});

test("POST /phone maps a forwarding number to a player (operator token only)", async () => {
  const env = { BALANCES: kv(), SECRETARY_TOKEN: "op" };
  assert.equal((await call(env, "/phone", { number: "+380501234567", userId: "player-two-000000001" })).status, 401);
  const r = await call(env, "/phone", { number: "+380 50 123 45 67", userId: "player-two-000000001" }, "POST", { authorization: "Bearer op" });
  assert.deepEqual(r.json, { number: "+380501234567", userId: "player-two-000000001" });
  assert.equal(await env.BALANCES.get("phone:+380501234567"), "player-two-000000001");
});
