import { DESK_UPSTREAM } from "./desk-proxy-rules";

/**
 * The desk worker holds the shared API keys. Its x-desk-token lives only in the
 * DESK_TOKEN server env var. Server code adds it directly. Browser/native code
 * never sees it and goes through this app's /api/desk/* proxy instead.
 */

export const DESK_ORIGIN = DESK_UPSTREAM;

function onServer(): boolean {
  return import.meta.env.VITE_NATIVE !== "1" && typeof window === "undefined" && typeof process !== "undefined";
}

function serverDeskToken(): string {
  if (!onServer()) return "";
  const value = process.env.DESK_TOKEN;
  return typeof value === "string" ? value.trim() : "";
}

/** Base for the proxy when running in a browser or a native web bundle. */
function proxyBase(): string {
  const configured = (import.meta.env.VITE_DESK_PROXY_ORIGIN as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)) return window.location.origin;
  return "";
}

/** POST to a desk route. Server: direct with the env token. Client: via the proxy, no token. */
export async function deskFetch(
  route: "grok" | "titan" | "poly",
  body: string,
  ms: number,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  if (onServer()) {
    const token = serverDeskToken();
    if (!token) return new Response('{"ok":false,"error":"DESK_TOKEN not set"}', { status: 503 });
    return fetch(`${DESK_ORIGIN}/api/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders, "x-desk-token": token },
      body,
      signal: AbortSignal.timeout(ms),
    });
  }
  if (route === "poly") return new Response('{"ok":false,"error":"server only"}', { status: 403 });
  const base = proxyBase();
  if (!base) return new Response('{"ok":false,"error":"desk proxy not configured"}', { status: 503 });
  return fetch(`${base}/api/desk/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(ms),
  });
}

export async function grokChat(body: unknown, ms: number): Promise<Response> {
  const key = (() => {
    if (!onServer()) return "";
    const value = process.env.XAI_API_KEY;
    return typeof value === "string" ? value.trim() : "";
  })();
  if (key) {
    return fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  }
  return deskFetch("grok", JSON.stringify(body), ms);
}

export async function deskRelay(method: "GET" | "POST", path: string, body: string): Promise<Response> {
  return deskFetch("poly", JSON.stringify({ method, path, body }), 12_000);
}
