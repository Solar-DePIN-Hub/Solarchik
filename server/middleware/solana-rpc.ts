/**
 * Forwards /solana-rpc. Devnet by default (the desk). ?cluster=mainnet uses mainnet.
 * URLs come from SOLANA_RPC_DEVNET / SOLANA_RPC_MAINNET. Public nodes if unset.
 * Never put a token in source.
 */
interface RpcEvent {
  url: URL;
  req: { method?: string; text?: () => Promise<string>; headers?: Headers };
}

const PUBLIC_MAINNET = "https://api.mainnet-beta.solana.com";
const PUBLIC_DEVNET = "https://api.devnet.solana.com";

function rpcUrl(cluster: string | null): string {
  if (cluster === "mainnet") {
    const fromEnv = (process.env.SOLANA_RPC_MAINNET || "").trim();
    return fromEnv || PUBLIC_MAINNET;
  }
  const fromEnv = (process.env.SOLANA_RPC_DEVNET || "").trim();
  return fromEnv || PUBLIC_DEVNET;
}

export default async function solanaRpcMiddleware(
  event: RpcEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  if (path !== "/solana-rpc" && path !== "/solana-rpc/") return next();
  const method = (event.req.method ?? "POST").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await event.req.text?.();
  const upstream = await fetch(rpcUrl(event.url.searchParams.get("cluster")), {
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
