/** Phone builds have no API key. They call the desk host, which holds the key.
 *  The desk gate token is not committed. Set DESK_TOKEN (or VITE_DESK_TOKEN)
 *  where a build needs it. The review APK already carries its own copy, and
 *  the worker secret is unchanged, so that APK keeps working.
 */

export const DESK_ORIGIN = "https://solarchik-desk.davidbell1603.workers.dev";

function deskToken(): string {
  const fromVite = import.meta.env?.VITE_DESK_TOKEN;
  if (typeof fromVite === "string" && fromVite.trim()) return fromVite.trim();
  if (typeof process !== "undefined") {
    const fromEnv = process.env.DESK_TOKEN;
    if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  }
  return "";
}

export function deskHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-desk-token": deskToken(),
  };
}

export async function grokChat(body: unknown, ms: number): Promise<Response> {
  const key = (() => {
    if (import.meta.env.VITE_NATIVE === "1" || typeof process === "undefined") return "";
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
  return fetch(`${DESK_ORIGIN}/api/grok`, {
    method: "POST",
    headers: deskHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
}

export async function deskRelay(method: "GET" | "POST", path: string, body: string): Promise<Response> {
  return fetch(`${DESK_ORIGIN}/api/poly`, {
    method: "POST",
    headers: deskHeaders(),
    body: JSON.stringify({ method, path, body }),
    signal: AbortSignal.timeout(12_000),
  });
}
