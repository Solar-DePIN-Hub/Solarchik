const SESSION_USD = 0.2;

/**
 * Paid credit only. A top-up is a mainnet USDC transfer to PAY_WALLET made from the Solana Pay link the
 * apps build (src/lib/game/pay.ts payUrl): amount, reference key and memo = userId.slice(0, 32).
 * /topup {userId, sig} or {userId, ref} credits exactly the USDC that reached PAY_WALLET, once per
 * signature. Before 2026-10-02 /topup added $5 to any userId with no payment at all.
 */
const PAY_WALLET = "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);
const MIN_USD = 1;
const MAX_USD = 100;
const MAX_AGE_SEC = 30 * 24 * 3600;
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

const VOICE = `You are Solarchik, a short solar-powered secretary.
Greet once. Ask name, company, callback number, and why they called.
Keep spoken answers under 20 words. Warm, a bit cheeky, never rude.
Never give wallets, seeds, passwords, or home address.
If spam or scam, refuse and end the call.
When you have name plus reason plus callback, confirm once and say the owner will see the note, then say goodbye.`;

const NOTE_RULE = "\nBefore goodbye, call the save_call_note tool once with what you learned.";

const SYSTEM = `You are Solarchik, the secretary in the player's cabinet.
Speak short. Warm. Under 40 words.
Ask who is calling and why. Never give wallet, address, codes, family.
Spam: end fast. Real call: name, company, callback, reason, urgency.
When you have enough, last line exactly:
SUMMARY_JSON={"caller_name":"...","company":"...","callback":"...","intent":"...","urgency":"low|medium|high","spam_risk":"low|medium|high","action":"callback|ignore|block","notes":"..."}`;

/** Standard Webhooks tolerance (OpenAI signs webhooks this way): reject timestamps older or newer than 5 min. */
export const WEBHOOK_TOLERANCE_SEC = 300;

const enc = new TextEncoder();

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Constant-time string compare (both sides hashed first, so length does not leak either). */
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(String(a))), crypto.subtle.digest("SHA-256", enc.encode(String(b)))]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

/**
 * Standard Webhooks verification (webhook-id, webhook-timestamp, webhook-signature), as used by OpenAI.
 * secret: "whsec_<base64>" (the prefix is optional). Signed content: `${id}.${timestamp}.${rawBody}`,
 * HMAC-SHA256, base64; the header carries one or more space-separated "v1,<sig>" entries.
 * Returns "" when valid, else a short reason.
 */
export async function webhookProblem(secret, headers, rawBody, nowSec = Math.floor(Date.now() / 1000)) {
  const id = headers.get("webhook-id") || "";
  const ts = headers.get("webhook-timestamp") || "";
  const sigHeader = headers.get("webhook-signature") || "";
  if (!id || !ts || !sigHeader) return "missing_headers";
  if (!/^\d{1,12}$/.test(ts)) return "bad_timestamp";
  if (Math.abs(nowSec - Number(ts)) > WEBHOOK_TOLERANCE_SEC) return "stale_timestamp";
  let keyBytes;
  try {
    keyBytes = b64ToBytes(String(secret).replace(/^whsec_/, ""));
  } catch {
    return "bad_secret";
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = bytesToB64(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${rawBody}`)));
  for (const part of sigHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version === "v1" && sig && (await sameSecret(sig, mac))) return "";
  }
  return "bad_signature";
}

/**
 * /expect and /voicemail write to the inbox. No app calls them (the Android app and the web desk only read
 * /inbox), so they take the operator token: `Authorization: Bearer <SECRETARY_TOKEN>`. Without the secret
 * set on the worker they stay closed.
 */
export async function operatorOk(env, request) {
  const token = String(env.SECRETARY_TOKEN || "");
  if (!token) return false;
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return Boolean(m) && (await sameSecret(m[1], token));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
  });
}

async function getUsd(env, userId) {
  const raw = await env.BALANCES.get(userId);
  return Number(raw || 0);
}

async function setUsd(env, userId, usd) {
  const next = Math.round(usd * 100) / 100;
  await env.BALANCES.put(userId, String(next));
  return next;
}

function parseSummary(text) {
  const match = String(text || "").match(/SUMMARY_JSON=(\{[\s\S]*\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function secretary(env, text) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.OPENAI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 220,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text + "\n\nOutput SUMMARY_JSON now." },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "openai " + res.status);
  const reply = data.choices?.[0]?.message?.content?.trim() || "";
  return { reply, summary: parseSummary(reply) };
}

/** Mainnet RPCs tried in order. api.mainnet-beta refuses Cloudflare Workers egress (live 2026-10-02), so a
 * public fallback follows; SOLANA_RPC (secret or var) goes first when set. */
const RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];

async function rpc(env, method, params) {
  const urls = [...new Set([env.SOLANA_RPC, ...RPCS].filter(Boolean))];
  let last = "rpc";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && !j.error) return j.result;
      last = "rpc " + (j.error?.code ?? res.status);
    } catch (e) {
      last = "rpc " + (e?.name || "error");
    }
    console.log(JSON.stringify({ event: "rpc_fail", host: new URL(url).host, method, detail: last }));
  }
  throw new Error(last);
}

function keyOf(k) {
  return typeof k === "string" ? k : k && typeof k === "object" ? String(k.pubkey || "") : "";
}

/** Memo strings in a jsonParsed transaction (top-level and inner instructions, plus the memo log line). */
export function memosOf(tx) {
  const out = [];
  const visit = (ix) => {
    if (!ix) return;
    if (ix.program === "spl-memo" || MEMO_PROGRAMS.has(ix.programId)) {
      if (typeof ix.parsed === "string") out.push(ix.parsed);
    }
  };
  for (const ix of tx?.transaction?.message?.instructions || []) visit(ix);
  for (const inner of tx?.meta?.innerInstructions || []) for (const ix of inner.instructions || []) visit(ix);
  for (const line of tx?.meta?.logMessages || []) {
    const m = /^Program log: Memo \(len \d+\): "(.*)"$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** USDC that reached PAY_WALLET in this transaction, in dollars (post - pre over PAY_WALLET-owned USDC accounts). */
export function usdcIn(tx, mint = USDC_MINT, wallet = PAY_WALLET) {
  const sum = (rows) =>
    (rows || []).reduce((s, r) => (r?.mint === mint && r?.owner === wallet ? s + (Number(r.uiTokenAmount?.amount) || 0) : s), 0);
  return (sum(tx?.meta?.postTokenBalances) - sum(tx?.meta?.preTokenBalances)) / 1e6;
}

/** Why this transaction cannot pay for userId, or "" when it can. */
export function payProblem(tx, userId, nowSec, ref = "", mint = USDC_MINT, wallet = PAY_WALLET) {
  if (!tx || !tx.meta) return "not_found";
  if (tx.meta.err) return "failed_tx";
  if (tx.blockTime && nowSec - tx.blockTime > MAX_AGE_SEC) return "too_old";
  if (ref && !(tx.transaction?.message?.accountKeys || []).map(keyOf).includes(ref)) return "wrong_reference";
  const usd = usdcIn(tx, mint, wallet);
  if (!(usd >= MIN_USD - 0.000001)) return "no_usdc_to_treasury";
  if (usd > MAX_USD + 0.000001) return "amount_too_large";
  if (!memosOf(tx).some((m) => m.trim() === userId.slice(0, 32))) return "memo_mismatch";
  return "";
}

async function topup(env, body) {
  const userId = String(body?.userId || "").trim();
  const sig = String(body?.sig || "").trim();
  const ref = String(body?.ref || "").trim();
  if (userId.length < 8 || userId.length > 80 || /\s/.test(userId)) return json({ error: "userId required" }, 400);
  const sigOk = sig.length >= 64 && sig.length <= 90 && B58.test(sig);
  const refOk = ref.length >= 32 && ref.length <= 44 && B58.test(ref);
  if (!sigOk && !refOk) return json({ error: "PAYMENT_REQUIRED", detail: "send sig (USDC transfer signature) or ref (Solana Pay reference)" }, 402);

  let sigs = [sig];
  if (!sigOk) {
    try {
      const rows = await rpc(env, "getSignaturesForAddress", [ref, { limit: 10, commitment: "confirmed" }]);
      sigs = (Array.isArray(rows) ? rows : []).filter((r) => !r.err).map((r) => r.signature);
    } catch (e) {
      return json({ error: "RPC_UNAVAILABLE", detail: String(e?.message || e) }, 503);
    }
    if (!sigs.length) return json({ error: "PAYMENT_NOT_FOUND", detail: "no transaction with this reference yet" }, 402);
  }

  // USDC_MINT override exists only for the local devnet test (wrangler dev); production leaves it unset.
  const mint = env.USDC_MINT || USDC_MINT;
  const now = Math.floor(Date.now() / 1000);
  let last = "not_found";
  for (const s of sigs.slice(0, 10)) {
    if (await env.BALANCES.get("paid:" + s)) {
      last = "already_used";
      continue;
    }
    let tx;
    try {
      tx = await rpc(env, "getTransaction", [s, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    } catch (e) {
      return json({ error: "RPC_UNAVAILABLE", detail: String(e?.message || e) }, 503);
    }
    const problem = payProblem(tx, userId, now, sigOk ? "" : ref, mint);
    if (problem) {
      last = problem;
      continue;
    }
    const added = Math.floor(usdcIn(tx, mint) * 100) / 100;
    // Mark the signature spent before crediting, so a retry can never credit it twice.
    await env.BALANCES.put("paid:" + s, JSON.stringify({ userId, usd: added, at: Date.now() }));
    const usd = await setUsd(env, userId, (await getUsd(env, userId)) + added);
    return json({ userId, usd, added, sig: s });
  }
  if (last === "already_used") return json({ error: "ALREADY_USED" }, 409);
  return json({ error: "PAYMENT_INVALID", detail: last }, 402);
}

// ---- Incoming phone calls (Zadarma number -> OpenAI SIP -> realtime.call.incoming -> /sip) ----

/** The secretary's own line. Calls diverted to it map to the owner/demo account unless KV maps them. */
export const DEFAULT_NUMBER = "+380914810885";

/** "+380 91 481-08-85", "sip:+380914810885@x", "<tel:380914810885>;reason=unconditional" -> "+380914810885". */
export function e164(raw) {
  const t = String(raw || "");
  const m = /(?:sip:|tel:|^|[<\s"])\+?(\d[\d\s().-]{6,20}\d)/.exec(t);
  if (!m) return "";
  const digits = m[1].replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return "";
  return "+" + digits;
}

function header(sipHeaders, name) {
  const want = name.toLowerCase();
  for (const h of Array.isArray(sipHeaders) ? sipHeaders : []) {
    if (String(h?.name || "").toLowerCase() === want) return String(h?.value || "");
  }
  return "";
}

/**
 * Who the call is for and who is calling. A forwarded call carries the player's own number in Diversion
 * (or History-Info); a direct call only has To. The From number is the caller.
 */
export function callParties(sipHeaders) {
  const forwarded = e164(header(sipHeaders, "Diversion")) || e164(header(sipHeaders, "History-Info"));
  const to = e164(header(sipHeaders, "To"));
  return { forwardedFrom: forwarded, to, number: forwarded || to, caller: e164(header(sipHeaders, "From")) || "unknown" };
}

/** KV phone:<number> -> userId (set with POST /phone); the secretary's own number -> OWNER_USER_ID. */
export async function playerFor(env, parties) {
  for (const n of [parties.forwardedFrom, parties.to]) {
    if (!n) continue;
    const mapped = await env.BALANCES.get("phone:" + n);
    if (mapped) return mapped;
  }
  const own = e164(env.SECRETARY_NUMBER) || DEFAULT_NUMBER;
  if ((parties.number === own || parties.to === own) && env.OWNER_USER_ID) return String(env.OWNER_USER_ID);
  return "";
}

async function hmacHex(key, text) {
  const k = await crypto.subtle.importKey("raw", enc.encode(String(key)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function callKey(env) {
  return env.CALL_TOKEN_SECRET || env.OPENAI_WEBHOOK_SECRET || env.OPENAI_API_KEY || "";
}

/** Per-call token for the note tool: `<callId>.<hmac>`; only OpenAI (who got it in the accept body) has it. */
export async function callToken(env, callId) {
  return callId + "." + (await hmacHex(callKey(env), "solarchik-call:" + callId));
}

export async function callFromToken(env, token) {
  const t = String(token || "");
  const dot = t.lastIndexOf(".");
  if (dot < 1 || !callKey(env)) return "";
  const callId = t.slice(0, dot);
  return (await sameSecret(t, await callToken(env, callId))) ? callId : "";
}

async function addInbox(env, userId, item) {
  const raw = await env.BALANCES.get("inbox:" + userId);
  const items = raw ? JSON.parse(raw) : [];
  items.unshift(item);
  await env.BALANCES.put("inbox:" + userId, JSON.stringify(items.slice(0, 20)));
}

async function patchInbox(env, userId, callId, patch) {
  const raw = await env.BALANCES.get("inbox:" + userId);
  const items = raw ? JSON.parse(raw) : [];
  const i = items.findIndex((it) => it && it.callId === callId);
  if (i < 0) items.unshift({ callId, at: Date.now(), ...patch });
  else items[i] = { ...items[i], ...patch };
  await env.BALANCES.put("inbox:" + userId, JSON.stringify(items.slice(0, 20)));
}

const NOTE_TOOL = {
  name: "save_call_note",
  description: "Save the caller's message for the owner. Call it once, after you have the name, reason and callback, before goodbye.",
  inputSchema: {
    type: "object",
    properties: {
      caller_name: { type: "string" },
      company: { type: "string" },
      callback: { type: "string" },
      intent: { type: "string", description: "Why they called, one sentence." },
      urgency: { type: "string", enum: ["low", "medium", "high"] },
      spam_risk: { type: "string", enum: ["low", "medium", "high"] },
      action: { type: "string", enum: ["callback", "ignore", "block"] },
      notes: { type: "string" },
    },
    required: ["intent"],
  },
};

function clip(v, n) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
}

/** The note as the apps show it: one readable line in `text`, the structured summary alongside. */
export function noteText(a) {
  const who = [clip(a.caller_name, 60), clip(a.company, 60)].filter(Boolean).join(", ");
  const parts = [who && `${who}:`, clip(a.intent, 200), a.callback ? `Callback ${clip(a.callback, 40)}.` : "", clip(a.notes, 240)];
  return parts.filter(Boolean).join(" ").slice(0, 600);
}

/** Minimal MCP server (Streamable HTTP, JSON responses) with one tool the realtime session calls. */
async function mcp(env, request) {
  const callId = await callFromToken(env, request.headers.get("x-solarchik-call"));
  if (!callId) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }, 401);
  const msg = await request.json().catch(() => null);
  if (!msg || typeof msg !== "object") return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  const id = msg.id ?? null;
  const ok = (result) => json({ jsonrpc: "2.0", id, result });
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notification
  if (msg.method === "initialize") {
    return ok({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "solarchik-secretary", version: "1" } });
  }
  if (msg.method === "ping") return ok({});
  if (msg.method === "tools/list") return ok({ tools: [NOTE_TOOL] });
  if (msg.method === "tools/call" && msg.params?.name === NOTE_TOOL.name) {
    const raw = await env.BALANCES.get("call:" + callId);
    const call = raw ? JSON.parse(raw) : null;
    if (!call?.userId) return ok({ content: [{ type: "text", text: "No player for this call; nothing saved." }], isError: true });
    const a = msg.params.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {};
    const summary = {
      caller_name: clip(a.caller_name, 60),
      company: clip(a.company, 60),
      callback: clip(a.callback, 40),
      intent: clip(a.intent, 200),
      urgency: clip(a.urgency, 8),
      spam_risk: clip(a.spam_risk, 8),
      action: clip(a.action, 10),
      notes: clip(a.notes, 400),
    };
    await patchInbox(env, call.userId, callId, { caller: call.caller, text: noteText(summary) || "Call note (empty)", summary, status: "done" });
    return ok({ content: [{ type: "text", text: "Saved. Say goodbye." }] });
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}

async function acceptCall(env, callId, body) {
  return fetch("https://api.openai.com/v1/realtime/calls/" + encodeURIComponent(callId) + "/accept", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * realtime.call.incoming: find the player, charge one session from their credit, accept with the note tool.
 * Unmapped numbers are accepted as before (no player to bill or notify) so live calls never break.
 * A mapped player without credit gets a missed-call line in the inbox and the call is rejected (busy).
 */
async function incomingCall(env, origin, callId, sipHeaders) {
  const parties = callParties(sipHeaders);
  const userId = await playerFor(env, parties);
  const base = { type: "realtime", model: "gpt-realtime", instructions: VOICE };
  if (!userId) {
    console.log(JSON.stringify({ event: "sip_unmapped", number: parties.number ? parties.number.slice(0, 6) + "…" : "" }));
    const accept = await acceptCall(env, callId, base);
    return json({ accepted: accept.ok, status: accept.status, player: false });
  }
  const cur = await getUsd(env, userId);
  if (cur < SESSION_USD) {
    await addInbox(env, userId, { callId, caller: parties.caller, text: "Missed call: the secretary has no credit. Top up to let it answer.", at: Date.now(), status: "need_topup" });
    const rej = await fetch("https://api.openai.com/v1/realtime/calls/" + encodeURIComponent(callId) + "/reject", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ status_code: 486 }),
    }).catch(() => null);
    return json({ accepted: false, rejected: Boolean(rej?.ok), error: "NEED_TOPUP" });
  }
  const charged = await setUsd(env, userId, cur - SESSION_USD);
  await env.BALANCES.put("call:" + callId, JSON.stringify({ userId, caller: parties.caller, at: Date.now() }), { expirationTtl: 3600 });
  await addInbox(env, userId, { callId, caller: parties.caller, text: "Call answered by the secretary. Note follows.", at: Date.now(), status: "pending", chargedUsd: SESSION_USD });
  const tool = {
    type: "mcp",
    server_label: "solarchik",
    server_url: origin + "/mcp",
    headers: { "x-solarchik-call": await callToken(env, callId) },
    require_approval: "never",
    allowed_tools: [NOTE_TOOL.name],
  };
  let accept = await acceptCall(env, callId, { ...base, instructions: VOICE + NOTE_RULE, tools: [tool] });
  let withTool = accept.ok;
  if (!accept.ok && accept.status !== 404) {
    // The note tool must never cost the call: answer without it (the inbox keeps the "answered" line).
    accept = await acceptCall(env, callId, base);
    withTool = false;
  }
  if (!accept.ok) {
    await setUsd(env, userId, charged + SESSION_USD);
    await patchInbox(env, userId, callId, { text: "Missed call: the secretary could not pick up (refunded).", status: "failed", chargedUsd: 0 });
    return json({ accepted: false, status: accept.status, refunded: true });
  }
  return json({ accepted: true, status: accept.status, player: true, noteTool: withTool, usd: charged });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json({});
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/sip")) {
      return json({ ok: true, where: "cloudflare", sip: "/sip" });
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/sip" || url.pathname === "/openai-webhook")
    ) {
      const raw = await request.text();
      if (env.OPENAI_WEBHOOK_SECRET) {
        const problem = await webhookProblem(env.OPENAI_WEBHOOK_SECRET, request.headers, raw);
        if (problem) return json({ error: "unauthorized", detail: problem }, 401);
      } else {
        // Not enforced until the secret is set, so live calls keep working (wrangler secret put OPENAI_WEBHOOK_SECRET).
        console.log(JSON.stringify({ event: "sip_unverified", reason: "OPENAI_WEBHOOK_SECRET not set" }));
      }
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const type = body.type || "";
      const callId = body.data?.call_id || body.data?.session_id || "";
      if (
        (type === "realtime.call.incoming" || type === "live.transport.incoming" || type === "live.call.incoming") &&
        callId
      ) {
        return incomingCall(env, url.origin, callId, body.data?.sip_headers);
      }
      return json({ ignored: type || "empty" });
    }

    if (request.method === "POST" && url.pathname === "/mcp") return mcp(env, request);

    if (request.method === "POST" && url.pathname === "/phone") {
      if (!(await operatorOk(env, request))) return json({ error: "unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const number = e164(body.number);
      const userId = String(body.userId || "").trim();
      if (!number) return json({ error: "number must be E.164, e.g. +380914810885" }, 400);
      if (!userId) {
        await env.BALANCES.delete?.("phone:" + number);
        return json({ number, userId: null });
      }
      if (userId.length < 8 || userId.length > 80 || /\s/.test(userId)) return json({ error: "userId required" }, 400);
      await env.BALANCES.put("phone:" + number, userId);
      return json({ number, userId });
    }

    if (request.method === "POST" && url.pathname === "/expect") {
      if (!(await operatorOk(env, request))) return json({ error: "unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const userId = String(body.userId || "").trim();
      if (!userId) return json({ error: "userId required" }, 400);
      await env.BALANCES.put("expect:active", userId, { expirationTtl: 120 });
      return json({ userId, armedSec: 120 });
    }

    if (request.method === "GET" && url.pathname === "/inbox") {
      const userId = url.searchParams.get("userId") || "";
      if (!userId) return json({ error: "userId required" }, 400);
      const raw = await env.BALANCES.get("inbox:" + userId);
      return json({ userId, items: raw ? JSON.parse(raw) : [] });
    }

    if (request.method === "POST" && url.pathname === "/voicemail") {
      if (!(await operatorOk(env, request))) return json({ error: "unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const armed = await env.BALANCES.get("expect:active");
      const userId = String(body.userId || armed || "").trim();
      const text = String(body.text || body.notes || "").trim();
      const caller = String(body.caller || "").trim();
      if (!userId || !text) return json({ error: "need armed user or userId+text" }, 400);
      const item = { caller, text, at: Date.now() };
      const raw = await env.BALANCES.get("inbox:" + userId);
      const items = raw ? JSON.parse(raw) : [];
      items.unshift(item);
      await env.BALANCES.put("inbox:" + userId, JSON.stringify(items.slice(0, 20)));
      return json({ userId, item });
    }

    if (request.method === "GET" && url.pathname === "/balance") {
      const userId = url.searchParams.get("userId") || "";
      if (!userId) return json({ error: "userId required" }, 400);
      return json({ userId, usd: await getUsd(env, userId), sessionUsd: SESSION_USD });
    }

    if (request.method === "POST" && url.pathname === "/topup") {
      const body = await request.json().catch(() => ({}));
      return topup(env, body);
    }

    if (request.method === "POST" && url.pathname === "/screen") {
      const body = await request.json().catch(() => ({}));
      const userId = String(body.userId || "");
      const text = String(body.text || "").trim();
      if (!userId || !text) return json({ error: "userId and text required" }, 400);
      const cur = await getUsd(env, userId);
      if (cur < SESSION_USD) return json({ error: "NEED_TOPUP", usd: cur }, 402);
      const charged = await setUsd(env, userId, cur - SESSION_USD);
      try {
        const out = await secretary(env, text);
        return json({
          userId,
          reply: out.reply,
          summary: out.summary,
          chargedUsd: SESSION_USD,
          usd: charged,
        });
      } catch (e) {
        const usd = await setUsd(env, userId, charged + SESSION_USD);
        return json({ error: "API_FAIL_REFUNDED", usd, detail: String(e) }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },
};
