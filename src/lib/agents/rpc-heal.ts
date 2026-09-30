/** Devnet endpoint the desk actually uses. Switches to the public node when the proxy is dead. */

const PUBLIC_DEVNET = "https://api.devnet.solana.com";

let override: string | null = null;

export function publicDevnet(): string {
  return PUBLIC_DEVNET;
}

export function deskRpcUrl(): string {
  if (import.meta.env.VITE_NATIVE === "1") return PUBLIC_DEVNET;
  if (typeof window === "undefined") return PUBLIC_DEVNET;
  if (window.location.hostname === "appassets.androidplatform.net") return PUBLIC_DEVNET;
  return `${window.location.origin}/solana-rpc`;
}

export function rpcUrl(): string {
  return override ?? deskRpcUrl();
}

export function setRpcOverride(url: string | null) {
  override = url;
}

export type SlotProbe = {
  ok: boolean;
  slot: number | null;
  ms: number | null;
  error: string | null;
};

async function probeSlot(url: string): Promise<SlotProbe> {
  const t = performance.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSlot",
        params: [{ commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const ms = Math.round(performance.now() - t);
    const body = (await res.json()) as { result?: number; error?: { message?: string } };
    if (!res.ok || body.error || typeof body.result !== "number") {
      return { ok: false, slot: null, ms, error: body.error?.message || "RPC відмовив" };
    }
    return { ok: true, slot: body.result, ms, error: null };
  } catch (e) {
    return {
      ok: false,
      slot: null,
      ms: Math.round(performance.now() - t),
      error: e instanceof Error ? e.message : "немає зв'язку",
    };
  }
}

/** Try the desk node. If it fails, pin the public Devnet so later reads use it. */
export async function healDevnet(): Promise<{ probe: SlotProbe; switched: boolean }> {
  const desk = deskRpcUrl();
  const first = await probeSlot(desk);
  if (first.ok) {
    setRpcOverride(null);
    return { probe: first, switched: false };
  }
  if (desk === PUBLIC_DEVNET) return { probe: first, switched: false };
  const second = await probeSlot(PUBLIC_DEVNET);
  if (second.ok) {
    setRpcOverride(PUBLIC_DEVNET);
    return { probe: second, switched: true };
  }
  setRpcOverride(null);
  return { probe: second, switched: false };
}
