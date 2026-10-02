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

const SYSTEM = `You are Solarchik, the secretary in the player's cabinet.
Speak short. Warm. Under 40 words.
Ask who is calling and why. Never give wallet, address, codes, family.
Spam: end fast. Real call: name, company, callback, reason, urgency.
When you have enough, last line exactly:
SUMMARY_JSON={"caller_name":"...","company":"...","callback":"...","intent":"...","urgency":"low|medium|high","spam_risk":"low|medium|high","action":"callback|ignore|block","notes":"..."}`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
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
      const body = await request.json().catch(() => ({}));
      const type = body.type || "";
      const callId = body.data?.call_id || body.data?.session_id || "";
      if (
        (type === "realtime.call.incoming" || type === "live.transport.incoming" || type === "live.call.incoming") &&
        callId
      ) {
        const accept = await fetch(
          "https://api.openai.com/v1/realtime/calls/" + encodeURIComponent(callId) + "/accept",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + env.OPENAI_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "realtime",
              model: "gpt-realtime",
              instructions: VOICE,
            }),
          }
        );
        return json({
          accepted: accept.ok,
          status: accept.status,
          detail: await accept.text().then((t) => t.slice(0, 300)),
        });
      }
      return json({ ignored: type || "empty" });
    }

    if (request.method === "POST" && url.pathname === "/expect") {
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
