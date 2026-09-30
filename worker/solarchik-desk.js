/**
 * Cloudflare Worker: solarchik-desk
 * Paste as the whole script. Secrets stay in the Worker, never in the APK:
 *   XAI_API_KEY
 *   DESK_TOKEN
 *   POLYMARKET_BUILDER_API_KEY
 *   POLYMARKET_BUILDER_SECRET
 *   POLYMARKET_BUILDER_PASSPHRASE
 *
 * POST /api/grok  -> api.x.ai
 * POST /api/poly  -> relayer-v2.polymarket.com  { method, path, body }
 */
const RELAYER = "https://relayer-v2.polymarket.com";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-desk-token",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
};

function denied(status, error) {
  return new Response(JSON.stringify({ error }), { status, headers: CORS });
}

function allowed(path) {
  return path === "/submit" || path.startsWith("/transaction") || path.startsWith("/v1/account/");
}

function b64urlToBytes(secret) {
  const normalized = String(secret).replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const bin = atob(normalized + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_");
}

async function sign(env, method, path, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    b64urlToBytes(env.POLYMARKET_BUILDER_SECRET || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}${method}${path}${body}`));
  return {
    POLY_BUILDER_API_KEY: env.POLYMARKET_BUILDER_API_KEY || "",
    POLY_BUILDER_TIMESTAMP: timestamp,
    POLY_BUILDER_PASSPHRASE: env.POLYMARKET_BUILDER_PASSPHRASE || "",
    POLY_BUILDER_SIGNATURE: bytesToB64(new Uint8Array(mac)),
  };
}

async function grok(request, env) {
  if (!env.XAI_API_KEY) return denied(503, "unconfigured");
  const body = await request.text();
  if (body.length > 80_000) return denied(413, "big");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.XAI_API_KEY}` },
    body,
  });
  return new Response(await res.text(), { status: res.status, headers: CORS });
}

async function poly(request, env) {
  if (!env.POLYMARKET_BUILDER_API_KEY || !env.POLYMARKET_BUILDER_SECRET) return denied(503, "unconfigured");
  let payload;
  try {
    payload = await request.json();
  } catch {
    return denied(400, "bad");
  }
  const method = payload.method === "GET" ? "GET" : payload.method === "POST" ? "POST" : "";
  const path = typeof payload.path === "string" ? payload.path : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  if (!method || !allowed(path) || body.length > 80_000) return denied(400, "bad");
  const res = await fetch(RELAYER + path, {
    method,
    headers: {
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...(await sign(env, method, path, body)),
    },
    body: method === "POST" ? body : undefined,
  });
  return new Response(await res.text(), { status: res.status, headers: CORS });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response('{"ok":true,"desk":"solarchik"}', { headers: CORS });
    }
    if (request.method !== "POST") return denied(405, "method");
    if (request.headers.get("x-desk-token") !== env.DESK_TOKEN) return denied(401, "no");
    if (url.pathname === "/api/grok") return grok(request, env);
    if (url.pathname === "/api/poly") return poly(request, env);
    return denied(404, "no");
  },
};
