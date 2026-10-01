import { deserializeAssetV1 } from "@metaplex-foundation/mpl-core";
import { lamports, publicKey } from "@metaplex-foundation/umi";

/** Server reads of Metaplex Core agents on devnet. Throws when the RPC cannot answer, so callers fail closed. */

const CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const PUBLIC_DEVNET = "https://api.devnet.solana.com";
/** Key::AssetV1 = 1, base58 of a single 0x01 byte. */
const ASSET_V1_TAG = "2";

export type CoreAgent = { asset: string; owner: string; attrs: Map<string, string> };

function devnetUrl(): string {
  const fromEnv = (process.env.SOLANA_RPC_DEVNET || "").trim();
  return fromEnv || PUBLIC_DEVNET;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(devnetUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "rpc error");
  return body.result as T;
}

function parse(address: string, raw: { lamports: number; owner: string; executable: boolean; data: [string, string] }): CoreAgent | null {
  if (raw.owner !== CORE_PROGRAM) return null;
  try {
    const asset = deserializeAssetV1({
      publicKey: publicKey(address),
      executable: raw.executable,
      owner: publicKey(raw.owner),
      lamports: lamports(raw.lamports),
      rentEpoch: 0n,
      data: Uint8Array.from(Buffer.from(raw.data[0], "base64")),
    });
    const attrs = new Map((asset.attributes?.attributeList ?? []).map((a) => [a.key, a.value] as [string, string]));
    return { asset: address, owner: String(asset.owner), attrs };
  } catch {
    return null;
  }
}

export async function fetchCoreAgent(address: string): Promise<CoreAgent | null> {
  const res = await rpc<{ value: { lamports: number; owner: string; executable: boolean; data: [string, string] } | null }>(
    "getAccountInfo",
    [address, { encoding: "base64", commitment: "confirmed" }],
  );
  if (!res?.value) return null;
  return parse(address, res.value);
}

/** Every Core AssetV1 owned by this wallet on devnet. */
export async function fetchOwnedCoreAgents(owner: string): Promise<CoreAgent[]> {
  const rows = await rpc<Array<{ pubkey: string; account: { lamports: number; owner: string; executable: boolean; data: [string, string] } }>>(
    "getProgramAccounts",
    [
      CORE_PROGRAM,
      {
        encoding: "base64",
        commitment: "confirmed",
        filters: [{ memcmp: { offset: 0, bytes: ASSET_V1_TAG } }, { memcmp: { offset: 1, bytes: owner } }],
      },
    ],
  );
  if (!Array.isArray(rows)) throw new Error("rpc shape");
  const out: CoreAgent[] = [];
  for (const row of rows) {
    const parsed = parse(row.pubkey, row.account);
    if (parsed && parsed.owner === owner) out.push(parsed);
  }
  return out;
}

/** A dex-capable Solarchik agent: class 2, or a combo. Same reading as chain.ts nftFromAsset. */
export function isArbAgent(agent: CoreAgent): boolean {
  const cls = agent.attrs.get("class");
  const role = agent.attrs.get("role");
  return cls === "2" || role === "dex" || role === "combo" || cls === "4";
}

export function isFreeTier(agent: CoreAgent): boolean {
  return agent.attrs.get("tr") === "free";
}
