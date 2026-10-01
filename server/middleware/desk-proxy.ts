/**
 * /api/desk/<route> -> Cloudflare desk worker. The x-desk-token comes from the
 * DESK_TOKEN env var on the server and never reaches the browser bundle.
 * No DESK_TOKEN -> 503 (fail closed). Only allow-listed routes, POST, 64 KB.
 */
import {
  DESK_PROXY_MAX_BODY,
  DESK_PROXY_PER_MIN,
  DESK_UPSTREAM,
  deskOriginAllowed,
  deskRouteOf,
  rateLimiter,
} from "../../src/lib/agents/desk-proxy-rules.ts";

interface DeskEvent {
  url: URL;
  req: { method?: string; text?: () => Promise<string>; headers?: Headers };
}

const allow = rateLimiter(DESK_PROXY_PER_MIN);

function deny(status: number, error: string, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...cors },
  });
}

/** CORS echo for listed cross-origin callers (native WebView origins in DESK_PROXY_ORIGINS). */
function corsFor(origin: string | null, selfOrigin: string): Record<string, string> {
  if (!origin || origin === selfOrigin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

export default async function deskProxyMiddleware(
  event: DeskEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (!event.url.pathname.startsWith("/api/desk/")) return next();
  const route = deskRouteOf(event.url.pathname);
  if (!route) return deny(404, "route");
  const headers = event.req.headers;
  const origin = headers?.get("origin") ?? null;
  if (!deskOriginAllowed(origin, event.url.origin, process.env.DESK_PROXY_ORIGINS)) return deny(403, "origin");
  const cors = corsFor(origin, event.url.origin);
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (method !== "POST") return deny(405, "method", cors);
  const token = (process.env.DESK_TOKEN || "").trim();
  if (!token) return deny(503, "desk not configured", cors);
  const ip = (headers?.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (!allow(ip, Date.now())) return deny(429, "slow down", cors);
  const body = (await event.req.text?.()) ?? "";
  if (body.length > DESK_PROXY_MAX_BODY) return deny(413, "too large", cors);
  const upstream = await fetch(`${DESK_UPSTREAM}/api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-desk-token": token },
    body,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!upstream) return deny(502, "desk down", cors);
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      ...cors,
    },
  });
}
