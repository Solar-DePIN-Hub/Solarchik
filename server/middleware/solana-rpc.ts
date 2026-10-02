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

/** Second public devnet node, tried when the main one keeps answering 429 / 5xx. Same genesis. */
const DEVNET_FALLBACK = "https://solana-devnet.api.onfinality.io/public";
const MAX_RPC_BODY = 64 * 1024;
const RETRY_MS = [300, 900];

/** Upstreams to try in order. Devnet gets the public fallback; mainnet stays on its one node. */
export function rpcUpstreams(cluster: string | null): string[] {
  const main = rpcUrl(cluster);
  return cluster === "mainnet" || main === DEVNET_FALLBACK ? [main] : [main, DEVNET_FALLBACK];
}

/** 429 / 5xx and network errors are worth another try; a JSON-RPC error with 200 is a real answer. */
export function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function forward(
  urls: string[],
  method: string,
  body: string | undefined,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  retries = RETRY_MS.length,
) {
  let last: { status: number; text: string; type: string } = { status: 502, text: '{"jsonrpc":"2.0","error":{"code":-32000,"message":"RPC unreachable"},"id":null}', type: "application/json" };
  for (const url of urls) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const upstream = await fetch(url, { method, headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(12_000) });
        last = { status: upstream.status, text: await upstream.text(), type: upstream.headers.get("content-type") ?? "application/json" };
        if (!retryable(upstream.status)) return last;
      } catch {
        /* network error: retry / next node */
      }
      if (attempt < retries) await sleep(RETRY_MS[attempt] ?? 900);
    }
  }
  return last;
}

export default async function solanaRpcMiddleware(
  event: RpcEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  if (path !== "/solana-rpc" && path !== "/solana-rpc/") return next();
  const method = (event.req.method ?? "POST").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await event.req.text?.();
  if (body && body.length > MAX_RPC_BODY) {
    return new Response('{"jsonrpc":"2.0","error":{"code":-32600,"message":"request too large"},"id":null}', { status: 413, headers: { "content-type": "application/json" } });
  }
  // An airdrop 429 is a daily limit: answer at once so the desk can fall back to the server faucet.
  const airdrop = Boolean(body && body.includes('"requestAirdrop"'));
  const urls = rpcUpstreams(event.url.searchParams.get("cluster"));
  const res = await forward(airdrop ? urls.slice(0, 1) : urls, method, body, airdrop ? async () => {} : undefined, airdrop ? 0 : RETRY_MS.length);
  return new Response(res.text, {
    status: res.status,
    headers: {
      "content-type": res.type,
      "cache-control": "no-store",
    },
  });
}
