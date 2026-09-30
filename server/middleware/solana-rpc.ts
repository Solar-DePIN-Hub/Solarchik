/**
 * Forwards /solana-rpc to QuickNode Devnet so the browser never sees the token.
 * Dev uses the Vite proxy; this runs on the production server.
 */
import { QUICKNODE_HTTP } from "../quicknode.mjs";

interface RpcEvent {
  url: URL;
  req: { method?: string; text?: () => Promise<string>; headers?: Headers };
}

export default async function solanaRpcMiddleware(
  event: RpcEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  if (path !== "/solana-rpc" && path !== "/solana-rpc/") return next();
  const method = (event.req.method ?? "POST").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await event.req.text?.();
  const upstream = await fetch(QUICKNODE_HTTP, {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
