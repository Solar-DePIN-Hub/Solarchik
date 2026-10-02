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

/**
 * One phone number as E.164. plus=true when the source had a leading "+". Ukrainian local numbers
 * (0XXXXXXXXX) become +380XXXXXXXXX; 380XXXXXXXXX without "+" gets it; 00-prefixed international loses 00.
 */
export function normNumber(raw, plus = false) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!plus && d.startsWith("00")) d = d.slice(2);
  if (!plus && /^0\d{9}$/.test(d)) return "+38" + d;
  if (d.length < 8 || d.length > 15 || d.startsWith("0")) return "";
  return "+" + d;
}

/**
 * Every phone number in one SIP header value, in order: user parts of sip:/sips:/tel: URIs
 * ("<sip:380914810885;user=phone@x>", "tel:+380-91-481-08-85", URL-encoded %2B), a quoted all-digit display
 * name, or a value that is only a number ("+380 91 481-08-85", "0914810885"). Dots are not number separators,
 * so Call-IDs, IPs and timestamps with dots are never read as numbers.
 */
export function numbersIn(value) {
  const v = String(value || "").replace(/%2B/gi, "+");
  const out = [];
  const add = (n) => n && !out.includes(n) && out.push(n);
  for (const m of v.matchAll(/(?:sips?|tel):(\+?)([\d()\- ]{6,24})(?=[@;>,?\s"]|$)/gi)) add(normNumber(m[2], m[1] === "+"));
  for (const m of v.matchAll(/"\s*(\+?)(\d[\d\s()-]{6,22}\d)\s*"/g)) add(normNumber(m[2], m[1] === "+"));
  const whole = /^\s*<?\s*(\+?)(\d[\d\s()-]{6,22}\d)\s*>?\s*$/.exec(v);
  if (whole) add(normNumber(whole[2], whole[1] === "+"));
  return out;
}

/** "+380 91 481-08-85", "sip:+380914810885@x", "<tel:380914810885>;reason=unconditional", "0914810885" -> "+380914810885". */
export function e164(raw) {
  return numbersIn(raw)[0] || "";
}

function header(sipHeaders, name) {
  const want = name.toLowerCase();
  for (const h of Array.isArray(sipHeaders) ? sipHeaders : []) {
    if (String(h?.name || "").toLowerCase() === want) return String(h?.value || "");
  }
  return "";
}

/** The secretary's own line (SECRETARY_NUMBER, else DEFAULT_NUMBER). */
export function ownLine(env) {
  return e164(env?.SECRETARY_NUMBER) || DEFAULT_NUMBER;
}

/** Headers that may carry the number the call was meant for (player's number or the secretary line), in priority order. */
const CALLED_HEADERS = ["Diversion", "History-Info", "P-Called-Party-ID", "Request-URI", "X-Original-To", "Original-To", "X-Called-Party-ID"];
/** X-* header names that hint at the called side / at the caller (the latter are never read as the called number). */
const X_CALLED = /num|did|dnis|called|(^|-)to($|-)|dest|ext|line|phone|target|orig|redirect|forward|divert|request|uri/i;
const X_CALLER = /from|caller|calling|cli|ani|source|src|remote|asserted|pai|rpid/i;

/**
 * Who the call is for and who is calling. A forwarded call carries the player's own number in Diversion /
 * History-Info / P-Called-Party-ID (or a Zadarma X-header); a direct call may only have To. From (then
 * P-Asserted-Identity, Remote-Party-ID) is the caller. OpenAI's To is usually the proj_…@sip.api.openai.com URI
 * (no number). When no called number is found at all, the call is for the secretary's own line: this OpenAI
 * project receives SIP only from that line (assumed: true).
 */
export function callParties(sipHeaders, env = {}) {
  const list = Array.isArray(sipHeaders) ? sipHeaders : [];
  const caller =
    e164(header(list, "From")) || e164(header(list, "P-Asserted-Identity")) || e164(header(list, "Remote-Party-ID")) || "unknown";
  const candidates = [];
  const add = (n, via) => {
    if (n && n !== caller && !candidates.some((c) => c.number === n)) candidates.push({ number: n, via });
  };
  for (const name of CALLED_HEADERS) for (const n of numbersIn(header(list, name))) add(n, name);
  for (const h of list) {
    const name = String(h?.name || "");
    if (!/^x-/i.test(name) || X_CALLER.test(name) || CALLED_HEADERS.some((c) => c.toLowerCase() === name.toLowerCase())) continue;
    const value = String(h?.value || "");
    if (X_CALLED.test(name) || /(?:sips?|tel):/i.test(value)) for (const n of numbersIn(value)) add(n, name);
  }
  const to = e164(header(list, "To"));
  if (to) add(to, "To");
  const forwarded = candidates.find((c) => c.via !== "To");
  if (!candidates.length) {
    const own = ownLine(env);
    return { forwardedFrom: "", to: "", number: own, caller, candidates: [], via: "", assumed: true };
  }
  return {
    forwardedFrom: forwarded?.number || "",
    to: to && to !== caller ? to : "",
    number: candidates[0].number,
    caller,
    candidates: candidates.map((c) => c.number),
    via: candidates[0].via,
    assumed: false,
  };
}

/** KV phone:<number> -> userId (set with POST /phone); the secretary's own number -> OWNER_USER_ID. */
export async function playerFor(env, parties) {
  const nums = parties.candidates?.length ? parties.candidates : [parties.forwardedFrom, parties.to].filter(Boolean);
  for (const n of nums) {
    const mapped = await env.BALANCES.get("phone:" + n);
    if (mapped) return mapped;
  }
  if (isOwnLine(env, parties) && env.OWNER_USER_ID) return String(env.OWNER_USER_ID);
  return "";
}

export function isOwnLine(env, parties) {
  const own = ownLine(env);
  return parties.number === own || parties.to === own || (parties.candidates || []).includes(own);
}

/**
 * Privacy-safe copy of a SIP header value for logs: quoted display names dropped, IPv4 addresses replaced,
 * every run of 5+ digits reduced to its last 4 ("+380914810885" -> "+…0885"), length capped.
 */
export function maskValue(value) {
  return String(value ?? "")
    .slice(0, 400)
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "ip")
    .replace(/(\+?)(\d[\d\s()-]{3,}\d)/g, (m, plus, body) => {
      const d = body.replace(/\D/g, "");
      return d.length >= 5 ? plus + "…" + d.slice(-4) : m;
    })
    .slice(0, 160);
}

export function maskHeaders(sipHeaders) {
  return (Array.isArray(sipHeaders) ? sipHeaders : []).slice(0, 40).map((h) => ({ n: String(h?.name || "").slice(0, 60), v: maskValue(h?.value) }));
}

const last4 = (n) => (n && n !== "unknown" ? "…" + String(n).slice(-4) : String(n || ""));

// ---- Secretary language (per player): KV secretary_lang:<userId> = auto | uk | en (default auto) ----

export const LANGS = ["auto", "uk", "en"];
export const LANG_RULE = {
  uk: "Always speak Ukrainian.",
  en: "Always speak English.",
  auto: "Greet in Ukrainian, then reply in the language the caller speaks.",
};

export async function langOf(env, userId) {
  if (!userId) return "auto";
  const v = await env.BALANCES.get("secretary_lang:" + userId);
  return LANGS.includes(v) ? v : "auto";
}

export function voiceFor(lang, withNote) {
  return VOICE + "\n" + (LANG_RULE[lang] || LANG_RULE.auto) + (withNote ? NOTE_RULE : "");
}

function validUserId(userId) {
  return typeof userId === "string" && userId.length >= 8 && userId.length <= 80 && !/\s/.test(userId);
}

// ---- Starter (trial) credit and the demo line budget ----

/** Sessions of starter credit per user id (env TRIAL_SESSIONS, default 3 -> $0.60). 0 turns the trial off. */
export const TRIAL_SESSIONS = 3;
/** Trial-funded sessions per UTC day across everyone (env TRIAL_DAILY_CAP). */
export const TRIAL_DAILY_CAP = 30;
/** Trial-funded calls per caller number per UTC day (env TRIAL_CALLER_CAP). Hidden numbers share one bucket. */
export const TRIAL_CALLER_CAP = 3;
const COUNTER_TTL = 2 * 86400;

function capOf(v, d) {
  if (v === undefined || v === null || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d;
}

const cents = (x) => Math.round(x * 100) / 100;

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

async function sha16(text) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(text))));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Starter credit of a user id. It is granted once per id: until the first trial-funded session it is
 * virtual (nothing written, so reading /balance costs no KV writes), shown to ids that have never had a paid
 * balance key; the first trial session writes trial_granted:<id> and trial:<id>. Ids that already have a
 * paid balance key before claiming it do not get it.
 */
export async function trialOf(env, userId) {
  const sessions = capOf(env.TRIAL_SESSIONS, TRIAL_SESSIONS);
  if (!validUserId(userId) || sessions === 0) return { usd: 0, granted: false };
  if (await env.BALANCES.get("trial_granted:" + userId)) {
    return { usd: Number((await env.BALANCES.get("trial:" + userId)) || 0), granted: true };
  }
  if ((await env.BALANCES.get(userId)) !== null) return { usd: 0, granted: false };
  return { usd: cents(sessions * SESSION_USD), granted: false };
}

/**
 * Takes one slot of the shared trial/demo budget: the global daily cap and, for phone calls, the per-caller
 * cap. Returns "" when taken, else TRIAL_DAILY_CAP / TRIAL_CALLER_CAP. KV counters are best effort (not atomic).
 */
export async function takeTrialSlot(env, caller = null, now = Date.now()) {
  const day = dayKey(now);
  const gKey = "trial_day:" + day;
  const used = Number((await env.BALANCES.get(gKey)) || 0);
  if (used >= capOf(env.TRIAL_DAILY_CAP, TRIAL_DAILY_CAP)) return "TRIAL_DAILY_CAP";
  let cKey = "";
  let cUsed = 0;
  if (caller !== null) {
    cKey = "trial_caller:" + day + ":" + (await sha16(caller || "unknown"));
    cUsed = Number((await env.BALANCES.get(cKey)) || 0);
    if (cUsed >= capOf(env.TRIAL_CALLER_CAP, TRIAL_CALLER_CAP)) return "TRIAL_CALLER_CAP";
  }
  await env.BALANCES.put(gKey, String(used + 1), { expirationTtl: COUNTER_TTL });
  if (cKey) await env.BALANCES.put(cKey, String(cUsed + 1), { expirationTtl: COUNTER_TTL });
  return "";
}

/**
 * One session for userId: starter credit first (within the caps), then paid credit.
 * -> { ok, source: "trial" | "paid", usd (total left), refund() } or { ok: false, reason, usd }.
 * caller = the caller number for phone calls (per-caller cap), null for /screen.
 */
export async function chargeSession(env, userId, caller = null) {
  const paid = await getUsd(env, userId);
  const t = await trialOf(env, userId);
  let reason = "";
  if (t.usd >= SESSION_USD - 1e-9) {
    reason = await takeTrialSlot(env, caller);
    if (!reason) {
      if (!t.granted) await env.BALANCES.put("trial_granted:" + userId, String(Date.now()));
      const left = cents(t.usd - SESSION_USD);
      await env.BALANCES.put("trial:" + userId, String(left));
      return {
        ok: true,
        source: "trial",
        usd: cents(paid + left),
        trialUsd: left,
        refund: async () => {
          const cur = Number((await env.BALANCES.get("trial:" + userId)) || 0);
          await env.BALANCES.put("trial:" + userId, String(cents(cur + SESSION_USD)));
        },
      };
    }
  }
  if (paid >= SESSION_USD - 1e-9) {
    const next = await setUsd(env, userId, paid - SESSION_USD);
    return {
      ok: true,
      source: "paid",
      usd: cents(next + t.usd),
      trialUsd: t.usd,
      refund: async () => void (await setUsd(env, userId, (await getUsd(env, userId)) + SESSION_USD)),
    };
  }
  return { ok: false, reason: reason || "NEED_TOPUP", usd: cents(paid + t.usd) };
}

const MISSED = {
  NEED_TOPUP: "Missed call: the secretary has no credit. Top up to let it answer.",
  TRIAL_DAILY_CAP: "Missed call: today's free trial calls are used up for everyone. Top up to let the secretary answer.",
  TRIAL_CALLER_CAP: "Missed call: this caller used up today's free trial calls. Top up to let the secretary answer.",
};

// ---- Webhook dedup: the same realtime.call.incoming may be delivered more than once ----

export const DEDUP_TTL_SEC = 600;
const SEEN = new Map();

/** Tests only: forget the in-isolate dedup memory. */
export function resetDedupMemory() {
  SEEN.clear();
}

/**
 * true for the first delivery of these keys (dedup:wh:<webhook-id>, dedup:call:<call_id>), false for a repeat.
 * The in-isolate map is checked and set before any await, so two deliveries racing into the same isolate are
 * caught; KV (TTL 10 min) catches later repeats across isolates. KV is eventually consistent, so two
 * deliveries landing in different data centres within ~a second can still both pass (strict dedup would need
 * a Durable Object).
 */
export async function firstDelivery(env, keys, now = Date.now()) {
  for (const [k, exp] of SEEN) if (exp < now) SEEN.delete(k);
  const ks = keys.filter(Boolean);
  if (ks.some((k) => SEEN.has(k))) return false;
  for (const k of ks) SEEN.set(k, now + DEDUP_TTL_SEC * 1000);
  for (const k of ks) if (await env.BALANCES.get(k)) return false;
  await Promise.all(ks.map((k) => env.BALANCES.put(k, String(now), { expirationTtl: DEDUP_TTL_SEC })));
  return true;
}

/** After a failed accept: let OpenAI's retry try again. */
async function forgetDelivery(env, keys) {
  for (const k of keys.filter(Boolean)) {
    SEEN.delete(k);
    await env.BALANCES.delete?.(k);
  }
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
 * realtime.call.incoming: find the player, charge one session (starter credit within the caps, else paid),
 * accept with the note tool and the player's language. The secretary's own line falls back to the shared
 * demo budget when its owner cannot pay, so a judge can simply dial it. Unmapped calls (no OWNER_USER_ID, no
 * KV phone map) are answered from the demo budget too, without billing or a note. When the budget/credit is
 * gone: a missed-call line in the inbox (if there is a player) and reject 486.
 */
async function incomingCall(env, origin, callId, sipHeaders, dedupKeys = [], dataKeys = []) {
  const parties = callParties(sipHeaders, env);
  console.log(
    JSON.stringify({
      event: "sip_headers",
      callId: String(callId).slice(-8),
      headers: maskHeaders(sipHeaders),
      number: last4(parties.number),
      via: parties.via || (parties.assumed ? "assumed_own_line" : ""),
      caller: last4(parties.caller),
      dataKeys: dataKeys.slice(0, 20),
    }),
  );
  const userId = await playerFor(env, parties);
  const own = isOwnLine(env, parties);
  const lang = await langOf(env, userId);
  const base = { type: "realtime", model: "gpt-realtime", instructions: voiceFor(lang, false) };
  const reject = () =>
    fetch("https://api.openai.com/v1/realtime/calls/" + encodeURIComponent(callId) + "/reject", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ status_code: 486 }),
    }).catch(() => null);

  if (!userId) {
    const reason = await takeTrialSlot(env, parties.caller);
    console.log(
      JSON.stringify({
        event: "sip_unmapped",
        number: last4(parties.number),
        assumed: parties.assumed,
        ownLine: own,
        why: own ? "OWNER_USER_ID not set" : "no phone:<number> mapping",
        budget: reason || "demo",
      }),
    );
    if (reason) {
      const rej = await reject();
      return json({ accepted: false, rejected: Boolean(rej?.ok), error: "NEED_TOPUP", reason, player: false });
    }
    const accept = await acceptCall(env, callId, base);
    if (!accept.ok) await forgetDelivery(env, dedupKeys);
    return json({ accepted: accept.ok, status: accept.status, player: false, trial: true, source: "demo", lang });
  }

  let charge = await chargeSession(env, userId, parties.caller);
  if (!charge.ok && own) {
    // The demo line: its owner pays when they can; otherwise the shared demo budget answers.
    const reason = await takeTrialSlot(env, parties.caller);
    charge = reason ? { ...charge, reason } : { ok: true, source: "demo", usd: charge.usd, refund: async () => {} };
  }
  if (!charge.ok) {
    await addInbox(env, userId, { callId, caller: parties.caller, text: MISSED[charge.reason] || MISSED.NEED_TOPUP, at: Date.now(), status: "need_topup", reason: charge.reason });
    const rej = await reject();
    return json({ accepted: false, rejected: Boolean(rej?.ok), error: "NEED_TOPUP", reason: charge.reason });
  }
  const trial = charge.source !== "paid";
  const chargedUsd = charge.source === "demo" ? 0 : SESSION_USD;
  await env.BALANCES.put("call:" + callId, JSON.stringify({ userId, caller: parties.caller, at: Date.now() }), { expirationTtl: 3600 });
  await addInbox(env, userId, { callId, caller: parties.caller, text: "Call answered by the secretary. Note follows.", at: Date.now(), status: "pending", chargedUsd, trial, source: charge.source });
  const tool = {
    type: "mcp",
    server_label: "solarchik",
    server_url: origin + "/mcp",
    headers: { "x-solarchik-call": await callToken(env, callId) },
    require_approval: "never",
    allowed_tools: [NOTE_TOOL.name],
  };
  let accept = await acceptCall(env, callId, { ...base, instructions: voiceFor(lang, true), tools: [tool] });
  let withTool = accept.ok;
  if (!accept.ok && accept.status !== 404) {
    // The note tool must never cost the call: answer without it (the inbox keeps the "answered" line).
    accept = await acceptCall(env, callId, base);
    withTool = false;
  }
  if (!accept.ok) {
    await charge.refund();
    await patchInbox(env, userId, callId, { text: "Missed call: the secretary could not pick up (refunded).", status: "failed", chargedUsd: 0 });
    await forgetDelivery(env, dedupKeys);
    return json({ accepted: false, status: accept.status, refunded: true });
  }
  return json({ accepted: true, status: accept.status, player: true, noteTool: withTool, usd: charge.usd, trial, source: charge.source, lang });
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
        const keys = ["dedup:call:" + callId];
        const whId = request.headers.get("webhook-id");
        if (whId) keys.unshift("dedup:wh:" + whId.slice(0, 120));
        if (!(await firstDelivery(env, keys))) {
          console.log(JSON.stringify({ event: "sip_duplicate", callId: String(callId).slice(-8) }));
          return json({ ok: true, duplicate: true });
        }
        return incomingCall(env, url.origin, callId, body.data?.sip_headers, keys, Object.keys(body.data || {}));
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
      const paidUsd = await getUsd(env, userId);
      const t = await trialOf(env, userId);
      return json({ userId, usd: cents(paidUsd + t.usd), paidUsd, trialUsd: t.usd, trial: t.usd > 0, sessionUsd: SESSION_USD });
    }

    if (url.pathname === "/secretary-lang" && (request.method === "GET" || request.method === "POST")) {
      // Same access model as /inbox and /balance: the caller holds the player's random userId.
      const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
      const userId = String((request.method === "POST" ? body.userId : url.searchParams.get("userId")) || "").trim();
      if (!validUserId(userId)) return json({ error: "userId required" }, 400);
      if (request.method === "GET") return json({ userId, lang: await langOf(env, userId), options: LANGS });
      const lang = String(body.lang || "").trim().toLowerCase();
      if (!LANGS.includes(lang)) return json({ error: "lang must be one of auto, uk, en", options: LANGS }, 400);
      await env.BALANCES.put("secretary_lang:" + userId, lang);
      return json({ userId, lang, options: LANGS });
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
      const charge = await chargeSession(env, userId, null);
      if (!charge.ok) {
        return json({ error: "NEED_TOPUP", reason: charge.reason, usd: charge.usd, ...(charge.reason !== "NEED_TOPUP" && { detail: MISSED[charge.reason] }) }, 402);
      }
      try {
        const out = await secretary(env, text);
        return json({
          userId,
          reply: out.reply,
          summary: out.summary,
          chargedUsd: SESSION_USD,
          usd: charge.usd,
          trial: charge.source === "trial",
        });
      } catch (e) {
        await charge.refund();
        return json({ error: "API_FAIL_REFUNDED", usd: cents(charge.usd + SESSION_USD), detail: String(e) }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },
};
