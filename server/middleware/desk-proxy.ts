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

function deny(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default async function deskProxyMiddleware(
  event: DeskEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (!event.url.pathname.startsWith("/api/desk/")) return next();
  const route = deskRouteOf(event.url.pathname);
  if (!route) return deny(404, "route");
  if ((event.req.method ?? "GET").toUpperCase() !== "POST") return deny(405, "method");
  const headers = event.req.headers;
  const origin = headers?.get("origin") ?? null;
  if (!deskOriginAllowed(origin, event.url.origin, process.env.DESK_PROXY_ORIGINS)) return deny(403, "origin");
  const token = (process.env.DESK_TOKEN || "").trim();
  if (!token) return deny(503, "desk not configured");
  const ip = (headers?.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (!allow(ip, Date.now())) return deny(429, "slow down");
  const body = (await event.req.text?.()) ?? "";
  if (body.length > DESK_PROXY_MAX_BODY) return deny(413, "too large");
  const upstream = await fetch(`${DESK_UPSTREAM}/api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-desk-token": token },
    body,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!upstream) return deny(502, "desk down");
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
