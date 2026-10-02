// Tests for the 0.21.8 worker changes: RPC choice for top-ups, once-only incoming calls (call room + markers),
// the after-call note, and the Sol chat/voice routes. Run: node --test worker/solarchik-screen.test.mjs
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker, {
  RPCS, rpcUrls, handleIncoming, finishNote, transcriptLine, CallRoom, AUTO_NOTE_EMPTY, NOTE_FIRST, voiceFor,
  solAction, solCtxLines, solSystem, readChatStream, resetDedupMemory, SOL_DEFAULT_VOICE, solRateOk,
} from "./solarchik-screen.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetDedupMemory();
});

function kv() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => void m.set(k, String(v)), delete: async (k) => void m.delete(k) };
}
async function call(env, path, body, method = "POST", headers = {}, ctx) {
  const res = await worker.fetch(
    new Request("https://solarchik-screen.example" + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
    ctx,
  );
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  return { status: res.status, json: j, text, headers: res.headers };
}

const USER = "0f8e2c1a-1111-4a2b-9c3d-abcdefabcdef";
const OWNER = "owner-demo-account-0001";
const SIG = "5".repeat(87);
const REF = "Ref1111111111111111111111111111111111111111";
const ZADARMA = [
  { name: "From", value: '"Dana" <sip:+380638500117@pbx.zadarma.com>;tag=1' },
  { name: "To", value: "<sip:proj_123@sip.api.openai.com>" },
  { name: "P-Called-Party-ID", value: "<sip:+380914810885@pbx.zadarma.com>" },
];

// ---------------- top-up RPC ----------------

test("RPC list: SOLANA_RPC first, every public fallback after mainnet-beta (403 from Workers)", () => {
  assert.equal(RPCS[0], "https://api.mainnet-beta.solana.com");
  assert.ok(RPCS.includes("https://solana-rpc.publicnode.com"));
  assert.ok(RPCS.includes("https://public.rpc.solanavibestation.com"));
  assert.deepEqual(rpcUrls({ SOLANA_RPC: "https://my.rpc/x" })[0], "https://my.rpc/x");
  assert.equal(new Set(rpcUrls({ SOLANA_RPC: RPCS[1] })).size, RPCS.length, "no duplicates");
});

test("topup by reference: a 403 host and a pruned node ([] history) fall through to the node that has the payment", async () => {
  const env = { BALANCES: kv() };
  const PAY = "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic";
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const memo = USER.slice(0, 32);
  const tx = {
    blockTime: Math.floor(Date.now() / 1000) - 60,
    meta: {
      err: null,
      preTokenBalances: [{ mint: USDC, owner: PAY, uiTokenAmount: { amount: "0" } }],
      postTokenBalances: [{ mint: USDC, owner: PAY, uiTokenAmount: { amount: "3000000" } }],
      innerInstructions: [],
      logMessages: [],
    },
    transaction: { message: { accountKeys: [{ pubkey: REF }], instructions: [{ program: "spl-memo", parsed: memo }] } },
  };
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const { method } = JSON.parse(init.body);
    seen.push(new URL(url).host + ":" + method);
    if (String(url).includes("mainnet-beta")) return new Response('{"jsonrpc":"2.0","error":{"code":403,"message":"blocked"},"id":1}', { status: 403 });
    if (String(url).includes("publicnode")) return Response.json({ jsonrpc: "2.0", id: 1, result: method === "getTransaction" ? null : [] });
    return Response.json({ jsonrpc: "2.0", id: 1, result: method === "getTransaction" ? tx : [{ signature: SIG, err: null }] });
  };
  const r = await call(env, "/topup", { userId: USER, ref: REF });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.added, 3);
  assert.deepEqual(seen.slice(0, 3), ["api.mainnet-beta.solana.com:getSignaturesForAddress", "solana-rpc.publicnode.com:getSignaturesForAddress", "public.rpc.solanavibestation.com:getSignaturesForAddress"]);
});

test("topup by reference with no payment yet: every node empty -> PAYMENT_NOT_FOUND (not RPC_UNAVAILABLE)", async () => {
  globalThis.fetch = async (url) =>
    String(url).includes("mainnet-beta") ? new Response("{}", { status: 403 }) : Response.json({ jsonrpc: "2.0", id: 1, result: [] });
  const r = await call({ BALANCES: kv() }, "/topup", { userId: USER, ref: REF });
  assert.equal(r.status, 402);
  assert.equal(r.json.error, "PAYMENT_NOT_FOUND");
});

test("GET /rpc-health lists each RPC with status and history count; SOLANA_RPC host is hidden", async () => {
  globalThis.fetch = async (url) =>
    String(url).includes("mainnet-beta") ? new Response('{"error":{"code":403}}', { status: 403 }) : Response.json({ jsonrpc: "2.0", id: 1, result: [{ signature: "x" }] });
  const r = await call({ BALANCES: kv(), SOLANA_RPC: "https://secret.example/key=abc" }, "/rpc-health", undefined, "GET");
  assert.equal(r.json.rpcs[0].host, "env");
  assert.ok(!r.text.includes("secret.example"));
  assert.equal(r.json.rpcs.find((x) => x.host === "api.mainnet-beta.solana.com").status, "rpc 403");
  assert.equal(r.json.rpcs.find((x) => x.host === "solana-rpc.publicnode.com").history, 1);
});

// ---------------- incoming calls: once-only ----------------

function openai({ acceptStatus = () => 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/accept")) return new Response("{}", { status: acceptStatus(calls.filter((c) => c.url.endsWith("/accept")).length) });
    return new Response("{}", { status: 200 });
  };
  return calls;
}

test("live bug …qjb3: second delivery after the first was accepted never charges, refunds or rewrites the inbox", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk", OWNER_USER_ID: OWNER };
  await env.BALANCES.put(OWNER, "1");
  // The first delivery answers; then the second one's accept would fail (OpenAI: call already accepted).
  const calls = openai({ acceptStatus: (n) => (n === 1 ? 200 : 400) });
  const a = await handleIncoming(env, "https://w", "rtc_5akbqjb3", ZADARMA);
  assert.equal(a.body.accepted, true);
  const b = await handleIncoming(env, "https://w", "rtc_5akbqjb3", ZADARMA);
  assert.deepEqual(b.body, { ok: true, duplicate: true });
  assert.equal(calls.filter((c) => c.url.endsWith("/accept")).length, 1, "the duplicate never calls accept");
  assert.equal(await env.BALANCES.get(OWNER), "0.8", "charged exactly once, no refund");
  const inbox = JSON.parse(await env.BALANCES.get("inbox:" + OWNER));
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].status, "pending");
  assert.match(inbox[0].text, /answered/);
});

test("a delivery whose accept fails while another already accepted the call does not refund or mark failed", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk", OWNER_USER_ID: OWNER };
  await env.BALANCES.put(OWNER, "1");
  // Simulate the race: while this delivery waits on OpenAI, another isolate marks the call accepted.
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/accept")) {
      await env.BALANCES.put("call:rtc_race", JSON.stringify({ userId: OWNER, state: "accepted" }));
      return new Response('{"error":"already accepted"}', { status: 409 });
    }
    return new Response("{}", { status: 200 });
  };
  const r = await handleIncoming(env, "https://w", "rtc_race", ZADARMA);
  assert.equal(r.body.duplicate, true);
  assert.equal(r.body.refunded, undefined);
  const inbox = JSON.parse(await env.BALANCES.get("inbox:" + OWNER));
  assert.notEqual(inbox[0].status, "failed");
});

test("a real failed accept still refunds, marks the line failed and lets OpenAI retry", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk", OWNER_USER_ID: OWNER };
  await env.BALANCES.put(OWNER, "1");
  openai({ acceptStatus: () => 500 });
  const r = await handleIncoming(env, "https://w", "rtc_down", ZADARMA);
  assert.equal(r.body.refunded, true);
  assert.equal(await env.BALANCES.get(OWNER), "1");
  assert.equal(JSON.parse(await env.BALANCES.get("inbox:" + OWNER))[0].status, "failed");
  assert.equal(await env.BALANCES.get("call:rtc_down"), null, "marker cleared for the retry");
  openai();
  assert.equal((await handleIncoming(env, "https://w", "rtc_down", ZADARMA)).body.accepted, true);
});

function roomState() {
  const m = new Map();
  let alarm = null;
  return {
    m,
    get alarm() {
      return alarm;
    },
    storage: {
      get: async (k) => (Array.isArray(k) ? new Map(k.map((x) => [x, m.get(x)])) : m.get(k)),
      put: async (k, v) => {
        if (typeof k === "object") for (const [a, b] of Object.entries(k)) m.set(a, b);
        else m.set(k, v);
      },
      delete: async (k) => void m.delete(k),
      setAlarm: async (t) => void (alarm = t),
      deleteAlarm: async () => void (alarm = null),
    },
  };
}

test("CallRoom: two deliveries of one call (166 ms apart or at once) -> one accept, one charge; alarm set", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk", OWNER_USER_ID: OWNER };
  await env.BALANCES.put(OWNER, "1");
  const calls = openai();
  const st = roomState();
  const room = new CallRoom(st, env);
  room.watch = async () => {}; // no sideband socket in tests
  const req = () => new Request("https://call-room/incoming", { method: "POST", body: JSON.stringify({ origin: "https://w", callId: "rtc_room", sipHeaders: ZADARMA }) });
  const [a, b] = await Promise.all([room.fetch(req()), room.fetch(req())]);
  const ja = await a.json();
  const jb = await b.json();
  assert.equal([ja, jb].filter((x) => x.duplicate).length, 1);
  assert.equal([ja, jb].filter((x) => x.accepted).length, 1);
  assert.equal(calls.filter((c) => c.url.endsWith("/accept")).length, 1);
  assert.equal(await env.BALANCES.get(OWNER), "0.8");
  assert.equal(st.m.get("state"), "accepted");
  assert.ok(st.alarm > Date.now() + 15 * 60 * 1000);
});

test("/sip goes through the CALLS room when bound", async () => {
  const seen = [];
  const env = {
    BALANCES: kv(),
    CALLS: {
      idFromName: (n) => "id:" + n,
      get: (id) => ({ fetch: async (u, init) => (seen.push([id, JSON.parse(init.body).callId]), Response.json({ accepted: true, via: "room" })) }),
    },
  };
  const r = await call(env, "/sip", JSON.stringify({ type: "realtime.call.incoming", data: { call_id: "rtc_x", sip_headers: ZADARMA } }));
  assert.equal(r.json.via, "room");
  assert.deepEqual(seen, [["id:rtc_x", "rtc_x"]]);
});

// ---------------- the note ----------------

test("instructions put the note tool first; the tool schema has no company field", async () => {
  const v = voiceFor("uk", true);
  assert.ok(v.includes(NOTE_FIRST));
  assert.ok(v.indexOf(NOTE_FIRST) < v.indexOf("Always speak Ukrainian."));
  assert.ok(!voiceFor("uk", false).includes("save_call_note"));
  assert.ok(!/company/i.test(v.replace(/Never ask for a company/g, "")), "never asks for a company");
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk", OWNER_USER_ID: OWNER };
  await env.BALANCES.put(OWNER, "1");
  openai();
  await handleIncoming(env, "https://w", "rtc_t", ZADARMA);
  const { callToken } = await import("./solarchik-screen.js");
  const list = await call(env, "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, "POST", { "x-solarchik-call": await callToken(env, "rtc_t") });
  assert.equal(list.json.result.tools[0].inputSchema.properties.company, undefined);
  // callback defaults to the caller's number
  const saved = await call(env, "/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "save_call_note", arguments: { caller_name: "Оля", intent: "Передзвонити щодо замовлення" } } }, "POST", { "x-solarchik-call": await callToken(env, "rtc_t") });
  assert.equal(saved.json.result.content[0].text, "Saved. Say goodbye.");
  const line = JSON.parse(await env.BALANCES.get("inbox:" + OWNER))[0];
  assert.equal(line.summary.callback, "+380638500117");
  assert.equal(line.summary.company, undefined);
  assert.equal(line.source, "tool");
});

test("transcriptLine reads caller and secretary words from realtime events", () => {
  assert.deepEqual(transcriptLine({ type: "conversation.item.input_audio_transcription.completed", transcript: "Це Оля" }), { who: "caller", text: "Це Оля" });
  assert.deepEqual(transcriptLine({ type: "response.output_audio_transcript.done", transcript: "Привіт" }), { who: "secretary", text: "Привіт" });
  assert.equal(transcriptLine({ type: "response.done" }), null);
});

test("finishNote: keeps a tool note, writes 'no details' without caller words, else a summary from the transcript", async () => {
  const env = { BALANCES: kv(), OPENAI_API_KEY: "sk" };
  await env.BALANCES.put("inbox:" + OWNER, JSON.stringify([{ callId: "c1", status: "done", text: "tool note" }, { callId: "c2", status: "pending" }, { callId: "c3", status: "pending" }]));
  assert.equal(await finishNote(env, "c1", OWNER, "+380638500117", [{ who: "caller", text: "hi" }]), "kept");
  assert.equal(await finishNote(env, "c2", OWNER, "+380638500117", [{ who: "secretary", text: "Привіт!" }]), "empty");
  let inbox = JSON.parse(await env.BALANCES.get("inbox:" + OWNER));
  assert.equal(inbox.find((x) => x.callId === "c2").text, AUTO_NOTE_EMPTY);
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    assert.match(JSON.parse(init.body).messages[1].content, /Caller: Це Оля, хочу перенести зустріч/);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ caller_name: "Оля", intent: "Хоче перенести зустріч на завтра", urgency: "medium", spam_risk: "low", action: "callback" }) } }] });
  };
  assert.equal(await finishNote(env, "c3", OWNER, "+380638500117", [{ who: "secretary", text: "Привіт" }, { who: "caller", text: "Це Оля, хочу перенести зустріч" }]), "summary");
  inbox = JSON.parse(await env.BALANCES.get("inbox:" + OWNER));
  const c3 = inbox.find((x) => x.callId === "c3");
  assert.equal(c3.status, "done");
  assert.equal(c3.source, "auto");
  assert.match(c3.text, /^Оля: Хоче перенести зустріч на завтра Callback \+380638500117\./);
  assert.equal(inbox.find((x) => x.callId === "c1").text, "tool note", "untouched");
});

// ---------------- Sol ----------------

const CTX = {
  agents: [
    { id: "7xAbc", name: "aloxa #11", running: true, strategyNft: true, risk: "calm", windows: [60] },
    { id: "paper:sku-pred-alpha", name: "Біткоїн-вікна #11", running: false, owned: false },
  ],
  market: [{ id: "m1", name: "Calm Hourly BTC", priceSol: 0.05 }],
  canMintFree: true,
};

test("solAction: ids must exist, risk/windows legal; never another agent", () => {
  const ctx = { agents: CTX.agents.map((a) => ({ ...a, owned: a.owned !== false, windows: a.windows || [] })), market: CTX.market, canMintFree: true };
  assert.deepEqual(solAction({ type: "stop_agent", agent: "7xAbc" }, ctx), { type: "stop_agent", agent: "7xAbc" });
  assert.equal(solAction({ type: "stop_agent", agent: "nope" }, ctx), null);
  assert.deepEqual(solAction({ type: "set_strategy", agent: "7xAbc", risk: "risky", windows: [5, 7, 5], listing: "" }, ctx), { type: "set_strategy", agent: "7xAbc", risk: "risky", windows: [5] });
  assert.equal(solAction({ type: "set_strategy", agent: "7xAbc", risk: "", windows: [] }, ctx), null);
  assert.deepEqual(solAction({ type: "buy_strategy", listing: "m1" }, ctx), { type: "buy_strategy", listing: "m1" });
  assert.equal(solAction({ type: "launch_rocket" }, ctx), null);
});

test("Sol system prompt: can act, never 'only watch', UK grammar rules, context ids", () => {
  const ctx = { agents: [{ id: "7xAbc", name: "aloxa #11", running: true, owned: true, strategyNft: true, risk: "calm", windows: [60] }], market: [], canMintFree: false };
  const s = solSystem("uk", "yard", ctx, "");
  assert.match(s, /You CAN act on the player's agents/);
  assert.match(s, /never say you can only watch/);
  assert.match(s, /грамотною живою українською/);
  assert.match(s, /жарт/);
  assert.match(solCtxLines(ctx), /agent 7xAbc = "aloxa #11" running strategyNft risk=calm windows=60/);
});

function sse(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode("data: " + JSON.stringify(ch) + "\n\n"));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

test("POST /sol/chat: a stop request comes back as a validated action (+ reply), streamed as NDJSON", async () => {
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(
      sse([
        { choices: [{ delta: { content: "Зупиняю aloxa #11 — " } }] },
        { choices: [{ delta: { content: "підтверди на картці." } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "propose_action", arguments: '{"type":"stop_agent","agent":"a1",' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"listing":"","risk":"","windows":[]}' } }] } }] },
      ]),
      { status: 200 },
    );
  };
  const r = await call({ BALANCES: kv(), OPENAI_API_KEY: "sk" }, "/sol/chat", { message: "вимкни агента aloxa #11", language: "uk", stream: true, ...CTX });
  assert.equal(sent.model, "gpt-4.1-mini");
  assert.equal(sent.stream, true);
  assert.equal(sent.tools[0].function.name, "propose_action");
  assert.match(sent.messages[0].content, /agent a1 = "aloxa #11"/);
  assert.match(sent.messages[0].content, /agent a2 = "Біткоїн-вікна #11" stopped owned=false/);
  const lines = r.text.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.filter((l) => l.d).map((l) => l.d), ["Зупиняю aloxa #11 — ", "підтверди на картці."]);
  const done = lines.at(-1);
  assert.equal(done.done, true);
  assert.deepEqual(done.action, { type: "stop_agent", agent: "7xAbc" });
  assert.equal(done.reply, "Зупиняю aloxa #11 — підтверди на картці.");
  assert.equal(done.provider, "openai");
});

test("POST /sol/chat: plain chat (a joke) has no action; tool-only answer gets a short ready line; model fallback", async () => {
  let n = 0;
  globalThis.fetch = async (url, init) => {
    n++;
    const model = JSON.parse(init.body).model;
    if (model === "gpt-4.1-mini") return new Response("{}", { status: 429 });
    return new Response(sse([{ choices: [{ delta: { content: "Чому сонце не ходить до школи? Воно й так найсвітліше!" } }] }]), { status: 200 });
  };
  const r = await call({ BALANCES: kv(), OPENAI_API_KEY: "sk" }, "/sol/chat", { message: "розкажи жарт", language: "uk" });
  assert.equal(r.json.action, null);
  assert.equal(r.json.model, "gpt-4o-mini");
  assert.equal(n, 2);
  globalThis.fetch = async () =>
    new Response(sse([{ choices: [{ delta: { tool_calls: [{ function: { arguments: '{"type":"buy_strategy","agent":"","listing":"l1","risk":"","windows":[]}' } }] } }] }]), { status: 200 });
  const b = await call({ BALANCES: kv(), OPENAI_API_KEY: "sk" }, "/sol/chat", { message: "buy the Calm Hourly BTC", language: "en", ...CTX });
  assert.deepEqual(b.json.action, { type: "buy_strategy", listing: "m1" });
  assert.match(b.json.reply, /card/);
});

test("GET /sol/tts streams OpenAI gpt-4o-mini-tts audio with the engine header; bad input 400", async () => {
  let body = null;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
    body = JSON.parse(init.body);
    return new Response(new Uint8Array(4800), { status: 200 });
  };
  const r = await worker.fetch(new Request("https://w/sol/tts?text=" + encodeURIComponent("Привіт, друже!") + "&lang=uk"), { OPENAI_API_KEY: "sk" }, { waitUntil() {} });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-sol-tts"), "openai:gpt-4o-mini-tts:" + SOL_DEFAULT_VOICE);
  assert.match(r.headers.get("content-type"), /audio\/L16;rate=24000/);
  assert.equal((await r.arrayBuffer()).byteLength, 4800);
  assert.equal(body.voice, "marin");
  assert.equal(body.response_format, "pcm");
  assert.match(body.instructions, /українською/);
  assert.equal((await worker.fetch(new Request("https://w/sol/tts"), { OPENAI_API_KEY: "sk" })).status, 400);
});

test("readChatStream handles split SSE lines; rate limit trips after 40/min per IP", async () => {
  const enc = new TextEncoder();
  const s = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hel'));
      c.enqueue(enc.encode('lo"}}]}\n\ndata: [DONE]\n\n'));
      c.close();
    },
  });
  const got = [];
  const r = await readChatStream(s, (d) => got.push(d));
  assert.equal(r.text, "Hello");
  assert.deepEqual(got, ["Hello"]);
  const now = Date.now();
  for (let i = 0; i < 40; i++) assert.equal(solRateOk("1.2.3.4", now), true);
  assert.equal(solRateOk("1.2.3.4", now), false);
  assert.equal(solRateOk("1.2.3.4", now + 61_000), true);
});

test("solAction maps short refs (a2, l1) back to the app's ids; a cut id like 'paper' matches nothing", () => {
  const ctx = {
    agents: [{ id: "7xAbc", name: "aloxa #11", ref: "a1" }, { id: "paper:sku-pred-alpha", name: "Біткоїн-вікна #11", ref: "a2" }],
    market: [{ id: "Mkt111", name: "Calm Hourly BTC", ref: "l1" }],
  };
  assert.deepEqual(solAction({ type: "start_agent", agent: "a2" }, ctx), { type: "start_agent", agent: "paper:sku-pred-alpha" });
  assert.deepEqual(solAction({ type: "buy_strategy", listing: "l1" }, ctx), { type: "buy_strategy", listing: "Mkt111" });
  assert.deepEqual(solAction({ type: "stop_agent", agent: "aloxa #11" }, ctx), { type: "stop_agent", agent: "7xAbc" });
  assert.equal(solAction({ type: "start_agent", agent: "paper" }, ctx), null);
});
