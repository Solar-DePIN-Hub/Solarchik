/** Rules for the /api/desk/* proxy. Pure so they can be tested without a server. */

export const DESK_UPSTREAM = "https://solarchik-desk.davidbell1603.workers.dev";

/**
 * Only the chat and quote routes go through the public proxy. /api/poly
 * (Polymarket relay with the desk's account) is server-to-server only.
 */
export const DESK_PROXY_ROUTES = new Set(["grok", "titan"]);

export const DESK_PROXY_MAX_BODY = 64 * 1024;
export const DESK_PROXY_PER_MIN = 30;

export function deskRouteOf(pathname: string): string | null {
  const m = /^\/api\/desk\/([a-z]+)\/?$/.exec(pathname);
  if (!m) return null;
  return DESK_PROXY_ROUTES.has(m[1]) ? m[1] : null;
}

/**
 * Same-origin requests pass. A missing Origin (server-to-server, native HTTP
 * clients) passes. Any other origin must be listed in DESK_PROXY_ORIGINS.
 */
export function deskOriginAllowed(origin: string | null, selfOrigin: string, allowList: string | undefined): boolean {
  if (!origin) return true;
  if (origin === selfOrigin) return true;
  const allowed = (allowList ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

/** Fixed one-minute window per key. In-memory, so per instance: a soft brake, not a hard cap. */
export function rateLimiter(perMin: number) {
  const hits = new Map<string, { start: number; n: number }>();
  return (key: string, now: number): boolean => {
    const row = hits.get(key);
    if (!row || now - row.start >= 60_000) {
      if (hits.size > 5000) hits.clear();
      hits.set(key, { start: now, n: 1 });
      return true;
    }
    if (row.n >= perMin) return false;
    row.n += 1;
    return true;
  };
}
