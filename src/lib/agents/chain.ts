import "../../polyfill";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  lamports,
  publicKey,
  signTransaction,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import {
  addPlugin,
  collectionAddress,
  create,
  createCollection,
  deserializeAssetV1,
  deserializeCollectionV1,
  transfer,
  updatePlugin,
} from "@metaplex-foundation/mpl-core";
import { COLLECTION_NAME, type AgentNft, type NftClassId, type StrategyBundle, type Track } from "./types";
import { WORK_GOAL_SEC, listEligible, workedSecOf } from "./classes";
import { ROYALTY_BPS } from "./fees.config";
import { publicDevnet, rpcUrl } from "./rpc-heal";

/** Fee receiver from the school wallet. Test SOL only. */
export const TREASURY = "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic";
const CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const COL_KEY = "solarchik.core-collection.v1";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function memoIx(payer: PublicKey, text: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from(text.slice(0, 180), "utf8"),
  });
}
export { rpcUrl } from "./rpc-heal";

let conn: Connection | null = null;

export function getConn(): Connection {
  const url = rpcUrl();
  if (!conn || conn.rpcEndpoint !== url) {
    const local = url.includes("/solana-rpc") || url.startsWith("http://127.0.0.1");
    if (!local) {
      conn = new Connection(url, "confirmed");
    } else {
      const ws =
        typeof window !== "undefined"
          ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/solana-rpc`
          : "ws://127.0.0.1:8900";
      conn = new Connection(url, { commitment: "confirmed", wsEndpoint: ws });
    }
  }
  return conn;
}

function umiFor(payer: Keypair): Umi {
  const umi = createUmi(getConn());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(payer.secretKey)));
  return umi;
}

type RawAccount = {
  owner: string;
  lamports: number;
  executable: boolean;
  data: Uint8Array;
};

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "RPC error");
  return body.result as T;
}

async function accountData(address: string): Promise<RawAccount | null> {
  const res = await rpcCall<{
    value: { lamports: number; owner: string; executable: boolean; data: [string, string] } | null;
  }>("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
  if (!res.value) return null;
  return {
    owner: res.value.owner,
    lamports: res.value.lamports,
    executable: res.value.executable,
    data: Uint8Array.from(Buffer.from(res.value.data[0], "base64")),
  };
}

function asRpcAccount(address: string, raw: RawAccount) {
  return {
    publicKey: publicKey(address),
    executable: raw.executable,
    owner: publicKey(raw.owner),
    lamports: lamports(raw.lamports),
    rentEpoch: 0n,
    data: raw.data,
  };
}

export async function confirmSig(signature: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 45_000) {
    const status = await rpcCall<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>(
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    );
    const row = status.value[0];
    if (row?.err) throw new Error("Транзакція відхилена");
    if (row?.confirmationStatus === "confirmed" || row?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Транзакція не підтвердилась");
}

export async function balanceLamports(owner: PublicKey): Promise<number> {
  const value = await rpcCall<{ value: number }>("getBalance", [owner.toBase58(), { commitment: "confirmed" }]);
  return value.value;
}

const PUBLIC_FAUCET = publicDevnet();

async function requestAirdrop(url: string, owner: string, lamports: number): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "requestAirdrop",
      params: [owner, lamports],
    }),
  });
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!body.result) throw new Error(body.error?.message || "кран відмовив");
  return body.result;
}

export async function airdropDevnet(owner: PublicKey, sol = 1): Promise<string> {
  const lamports = Math.round(sol * LAMPORTS_PER_SOL);
  if (lamports < 1) throw new Error("Сума поповнення нульова");
  const addr = owner.toBase58();
  const once = async (amount: number) => {
    let last = "кран відмовив";
    for (const url of [rpcUrl(), PUBLIC_FAUCET]) {
      try {
        const sig = await requestAirdrop(url, addr, amount);
        await confirmSig(sig);
        return sig;
      } catch (e) {
        last = e instanceof Error ? e.message : last;
      }
    }
    throw new Error(last);
  };
  try {
    return await once(lamports);
  } catch (e) {
    if (sol <= 1) {
      const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
      const last = e instanceof Error ? e.message : "кран відмовив";
      throw new Error(`Кран Devnet не видав SOL на ${short}. ${last}`);
    }
    let sig = "";
    let left = lamports;
    const chunks = Math.min(20, Math.ceil(sol));
    for (let i = 0; i < chunks && left > 0; i++) {
      const piece = Math.min(LAMPORTS_PER_SOL, left);
      try {
        sig = await once(piece);
        left -= piece;
      } catch (err) {
        if (sig) return sig;
        const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
        const last = err instanceof Error ? err.message : "кран відмовив";
        throw new Error(`Кран Devnet не видав SOL на ${short}. ${last}`);
      }
    }
    if (!sig) {
      const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
      const last = e instanceof Error ? e.message : "кран відмовив";
      throw new Error(`Кран Devnet не видав SOL на ${short}. ${last}`);
    }
    return sig;
  }
}

export async function fundIfNeeded(payer: Keypair): Promise<number> {
  let bal = await balanceLamports(payer.publicKey);
  if (bal >= 0.4 * LAMPORTS_PER_SOL) return bal;
  try {
    await airdropDevnet(payer.publicKey, 1);
    bal = await balanceLamports(payer.publicKey);
  } catch {
    /* faucet dry; caller decides what to show */
  }
  if (bal >= 0.02 * LAMPORTS_PER_SOL) return bal;
  const owner = payer.publicKey.toBase58();
  const short = `${owner.slice(0, 4)}…${owner.slice(-4)}`;
  throw new Error(
    bal <= 0
      ? `На Devnet у ${short} 0 SOL. Натисни «Поповнити» або капни кран на faucet.solana.com.`
      : `На Devnet у ${short} замало SOL. Натисни «Поповнити» ще раз.`,
  );
}

async function sendSigned(payer: Keypair, tx: Transaction, extra: Keypair[] = []): Promise<string> {
  const latest = await rpcCall<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  tx.recentBlockhash = latest.value.blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer, ...extra);
  const sig = await rpcCall<string>("sendTransaction", [
    Buffer.from(tx.serialize()).toString("base64"),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  await confirmSig(sig);
  return sig;
}

/** Build, sign and send a Core transaction over HTTP. No websocket confirm. */
async function sendUmi(umi: Umi, builder: TransactionBuilder): Promise<string> {
  const latest = await rpcCall<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const ready = builder.setBlockhash(latest.value.blockhash);
  const tx = await signTransaction(ready.build(umi), ready.getSigners(umi));
  const bytes = umi.transactions.serialize(tx);
  const sig = await rpcCall<string>("sendTransaction", [
    Buffer.from(bytes).toString("base64"),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  await confirmSig(sig);
  return sig;
}

export async function payAccount(payer: Keypair, to: PublicKey, solAmount: number, memo?: string): Promise<string> {
  const amount = Math.round(solAmount * LAMPORTS_PER_SOL);
  const tx = new Transaction();
  if (memo) tx.add(memoIx(payer.publicKey, memo));
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: to,
      lamports: amount,
    }),
  );
  return sendSigned(payer, tx);
}

export async function payTreasury(payer: Keypair, solAmount: number): Promise<string> {
  return payAccount(payer, new PublicKey(TREASURY), solAmount);
}

async function rememberCollection(addr: string): Promise<string> {
  if (typeof localStorage !== "undefined") localStorage.setItem(COL_KEY, addr);
  return addr;
}

async function findOwnedCollection(payer: PublicKey): Promise<string | null> {
  const sigs = await rpcCall<Array<{ signature: string; err: unknown }>>("getSignaturesForAddress", [
    payer.toBase58(),
    { limit: 25 },
  ]);
  const seen = new Set<string>();
  for (const row of sigs) {
    if (row.err) continue;
    const tx = await rpcCall<{
      transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }> } };
    } | null>("getTransaction", [row.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    const keys = tx?.transaction?.message?.accountKeys ?? [];
    for (const key of keys) {
      const addr = typeof key === "string" ? key : key.pubkey;
      if (!addr || addr === payer.toBase58() || seen.has(addr)) continue;
      seen.add(addr);
      const raw = await accountData(addr);
      if (!raw || raw.owner !== CORE_PROGRAM) continue;
      try {
        const col = deserializeCollectionV1(asRpcAccount(addr, raw));
        if (String(col.updateAuthority) === payer.toBase58()) return addr;
      } catch {
        /* asset, not a collection */
      }
    }
  }
  return null;
}

async function ensureCollection(payer: Keypair): Promise<string> {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem(COL_KEY) : null;
  if (saved && (await accountData(saved))) return saved;
  const recovered = await findOwnedCollection(payer.publicKey);
  if (recovered) return rememberCollection(recovered);
  const umi = umiFor(payer);
  const collection = generateSigner(umi);
  await sendUmi(
    umi,
    createCollection(umi, {
      collection,
      name: "Solarchik Agents",
      uri: "urn:solarchik:collection",
    }),
  );
  return rememberCollection(collection.publicKey.toString());
}

function attrList(nft: Pick<AgentNft, "classId" | "track" | "trainedDays" | "graduated" | "strategy" | "metrics" | "tier">) {
  const p = nft.strategy.prediction;
  const d = nft.strategy.dex;
  const role = nft.classId === 3 ? "combo" : nft.classId === 2 ? "dex" : "pred";
  const lanes = p.lanes ?? [];
  const on = (lane: "crypto" | "events" | "weather") => (p.laneOn?.[lane] === false ? "" : lane === "crypto" ? "c" : lane === "events" ? "e" : "w");
  const lo = lanes.map((lane) => on(lane)).join("");
  const pf = p.focus === "events" ? "evt" : p.focus === "weather" ? "wx" : lanes.length > 1 ? "mix" : "btc";
  const rows: Array<[string, string]> = [
    ["class", String(nft.classId)],
    ["tr", nft.tier === "free" ? "free" : "pro"],
    ["role", role],
    ["track", nft.track],
    ["days", String(Math.round(nft.trainedDays))],
    ["grad", workedSecOf(nft) >= WORK_GOAL_SEC ? "1" : "0"],
    ["wh", String(Math.floor(workedSecOf(nft) / 3600))],
    ["ws", String(workedSecOf(nft) % 3600)],
    ["apr", nft.metrics.aprPct == null || !Number.isFinite(nft.metrics.aprPct) ? "" : String(nft.metrics.aprPct)],
    ["xp", String(Math.round(nft.metrics.xp))],
    ["jobs", String(Math.round(nft.metrics.jobs))],
    ["wins", String(Math.round(nft.metrics.wins))],
    ["losses", String(Math.round(nft.metrics.losses))],
    ["pnl", nft.metrics.pnlSol.toFixed(5)],
    ["pm", p.focus === "events" ? "події" : p.focus === "weather" ? "погода" : "Bitcoin"],
    ["pv", "poly"],
    ["pf", pf],
    ["ln", lanes.map((lane) => (lane === "crypto" ? "c" : lane === "events" ? "e" : "w")).join("")],
    ["lo", lo],
    ["ed", p.eventsDays === 1 ? "1" : "2"],
    ["wo", p.weexOn ? "1" : "0"],
    ["pwin", String((p.windows ?? [15])[0] ?? 15)],
    ["pw", (p.windows ?? [15]).join(".")],
    ["ab", `${p.askLo ?? 0.15}-${p.askHi ?? 0.85}`],
    ["pe", p.edgeBps.toFixed(1)],
    ["ps", String(p.maxStakeSol)],
    ["dp", d.pair],
    ["di", String(Math.round(d.dcaIntervalSec))],
    ["da", String(d.dcaAmountSol)],
    ["dsl", d.slippageBps.toFixed(0)],
    ["dd", d.side],
  ];
  return rows.map(([key, value]) => ({ key, value: value.slice(0, 32) }));
}

function num(map: Map<string, string>, key: string, fallback: number): number {
  const n = Number(map.get(key));
  return Number.isFinite(n) ? n : fallback;
}

export function nftFromAsset(
  name: string,
  owner: string,
  asset: string,
  coreCollection: string,
  list: Array<{ key: string; value: string }>,
): AgentNft | null {
  const map = new Map(list.map((a) => [a.key, a.value]));
  let classId = num(map, "class", 1);
  const wasCombo = classId === 4;
  if (wasCombo) classId = 3;
  const role = map.get("role");
  // Old class 3 was the social bot. New combos write role=combo. Old combos were class 4.
  if (classId === 3 && role !== "combo" && !wasCombo) return null;
  const track = "live" as Track;
  const side = map.get("dd");
  const pf = map.get("pf");
  const focus = pf === "evt" ? "events" : pf === "wx" ? "weather" : "btc";
  const ln = map.get("ln") ?? "";
  const lanes = (["c", "e", "w"] as const)
    .filter((ch) => ln.includes(ch))
    .map((ch) => (ch === "c" ? "crypto" : ch === "e" ? "events" : "weather") as "crypto" | "events" | "weather");
  const resolved =
    lanes.length > 0 ? lanes : classId === 3 ? (["crypto", "events", "weather"] as const) : focus === "events" ? (["events"] as const) : focus === "weather" ? (["weather"] as const) : (["crypto"] as const);
  const lo = map.get("lo");
  const laneOn = {
    crypto: lo == null ? true : lo.includes("c"),
    events: lo == null ? true : lo.includes("e"),
    weather: lo == null ? true : lo.includes("w"),
  };
  const workedSec = Math.max(0, Math.floor(num(map, "wh", 0))) * 3600 + Math.min(3599, Math.max(0, Math.floor(num(map, "ws", 0))));
  const aprRaw = map.get("apr");
  const aprNum = aprRaw != null && aprRaw !== "" ? Number(aprRaw) : NaN;
  const winRaw = (map.get("pw") ?? "15").split(/[.\s,]/).map(Number).filter((n) => n === 5 || n === 15 || n === 60 || n === 240);
  const windows = winRaw.length ? [...new Set(winRaw)].sort((a, b) => a - b) : [15];
  const band = (map.get("ab") ?? "").match(/^(\d*\.?\d+)-(\d*\.?\d+)$/);
  const strategy: StrategyBundle = {
    prediction: {
      venue: "polymarket",
      focus: resolved.length === 1 && resolved[0] === "events" ? "events" : resolved.length === 1 && resolved[0] === "weather" ? "weather" : "btc",
      market: resolved.length === 1 && resolved[0] === "events" ? "події" : resolved.length === 1 && resolved[0] === "weather" ? "погода" : "Bitcoin",
      windows,
      windowMin: windows[0] ?? 15,
      askLo: band ? Number(band[1]) : 0.15,
      askHi: band ? Number(band[2]) : 0.85,
      edgeBps: num(map, "pe", 18),
      maxStakeSol: num(map, "ps", 0.02),
      lanes: [...resolved],
      laneOn,
      eventsDays: map.get("ed") === "1" ? 1 : 2,
      weexOn: map.get("wo") === "1",
    },
    dex: {
      pair: map.get("dp") || "SOL/USDC",
      dcaIntervalSec: num(map, "di", 900),
      dcaAmountSol: num(map, "da", 0.02),
      slippageBps: num(map, "dsl", 40),
      side: side === "buy" || side === "sell" || side === "both" ? side : "both",
    },
  };
  const safeClass: NftClassId = classId === 2 || classId === 3 ? classId : 1;
  return {
    asset,
    collection: COLLECTION_NAME,
    coreCollection,
    classId: safeClass,
    name,
    owner,
    mintedAt: Date.now(),
    updatedAt: Date.now(),
    track,
    trainedDays: num(map, "days", track === "live" ? 90 : 0),
    graduated: workedSec >= WORK_GOAL_SEC,
    tier: map.get("tr") === "free" ? "free" : "pro",
    strategy,
    metrics: {
      xp: num(map, "xp", 0),
      jobs: num(map, "jobs", 0),
      wins: num(map, "wins", 0),
      losses: num(map, "losses", 0),
      pnlSol: num(map, "pnl", 0),
      lastJobAt: Date.now(),
      workedSec,
      aprPct: Number.isFinite(aprNum) ? aprNum : null,
    },
  };
}

async function loadAsset(asset: string) {
  const raw = await accountData(asset);
  if (!raw || raw.owner !== CORE_PROGRAM) throw new Error("Core asset не знайдено");
  return deserializeAssetV1(asRpcAccount(asset, raw));
}

export async function fetchAgent(asset: string): Promise<AgentNft | null> {
  try {
    const fetched = await loadAsset(asset);
    const col = collectionAddress(fetched);
    if (!col) return null;
    const list = fetched.attributes?.attributeList ?? [];
    return nftFromAsset(fetched.name, String(fetched.owner), asset, String(col), list);
  } catch {
    return null;
  }
}

/** Core agents already minted to this owner. Empty if the RPC is quiet. Does not invent one. */
export async function fetchOwnedAgents(owner: string): Promise<AgentNft[]> {
  const sigs = await rpcCall<Array<{ signature: string; err: unknown }>>("getSignaturesForAddress", [
    owner,
    { limit: 12 },
  ]);
  const rows = sigs.filter((row) => !row.err).slice(0, 12);
  const seen = new Set<string>();
  const found: AgentNft[] = [];
  let cursor = 0;
  const run = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const tx = await rpcCall<{
        transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }> } };
      } | null>("getTransaction", [row.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
      const keys = tx?.transaction?.message?.accountKeys ?? [];
      for (const key of keys) {
        const addr = typeof key === "string" ? key : key.pubkey;
        if (!addr || addr === owner || seen.has(addr)) continue;
        seen.add(addr);
        const raw = await accountData(addr);
        if (!raw || raw.owner !== CORE_PROGRAM) continue;
        try {
          const asset = deserializeAssetV1(asRpcAccount(addr, raw));
          if (String(asset.owner) !== owner) continue;
          const col = collectionAddress(asset);
          if (!col) continue;
          const nft = nftFromAsset(asset.name, owner, addr, String(col), asset.attributes?.attributeList ?? []);
          if (nft) found.push(nft);
        } catch {
          /* collection or unrelated core account */
        }
      }
    }
  };
  const workers = Math.min(4, rows.length);
  if (workers > 0) await Promise.all(Array.from({ length: workers }, () => run()));
  return found;
}

export async function mintCore(
  payer: Keypair,
  draft: Pick<AgentNft, "name" | "classId" | "track" | "trainedDays" | "graduated" | "strategy" | "metrics" | "tier">,
): Promise<{ asset: string; signature: string; coreCollection: string }> {
  const coreCollection = await ensureCollection(payer);
  const umi = umiFor(payer);
  const asset = generateSigner(umi);
  const signature = await sendUmi(
    umi,
    create(umi, {
      asset,
      collection: { publicKey: publicKey(coreCollection) },
      name: draft.name.slice(0, 32),
      uri: "urn:solarchik:agent",
      plugins: [
        { type: "Attributes", attributeList: attrList(draft) },
        {
          type: "Royalties",
          basisPoints: ROYALTY_BPS,
          creators: [{ address: publicKey(TREASURY), percentage: 100 }],
          ruleSet: { type: "None" },
        },
        { type: "FreezeDelegate", frozen: true },
      ],
    }),
  );
  return { asset: asset.publicKey.toString(), signature, coreCollection };
}

export async function writeCore(payer: Keypair, nft: AgentNft): Promise<string> {
  if (!nft.coreCollection) throw new Error("У NFT немає адреси колекції Core");
  const umi = umiFor(payer);
  const fetched = await loadAsset(nft.asset);
  const col = collectionAddress(fetched) ?? publicKey(nft.coreCollection);
  const asset = publicKey(nft.asset);
  const attrs = updatePlugin(umi, {
    asset,
    collection: col,
    plugin: { type: "Attributes", attributeList: attrList(nft) },
  });
  const ready = workedSecOf(nft) >= WORK_GOAL_SEC;
  const frozen = fetched.freezeDelegate?.frozen === true;
  const hasFreeze = Boolean(fetched.freezeDelegate);
  let builder = attrs;
  if (!ready && !hasFreeze) {
    builder = attrs.add(
      addPlugin(umi, {
        asset,
        collection: col,
        plugin: { type: "FreezeDelegate", frozen: true },
      }),
    );
  } else if (ready && frozen) {
    builder = attrs.add(
      updatePlugin(umi, {
        asset,
        collection: col,
        plugin: { type: "FreezeDelegate", frozen: false },
      }),
    );
  }
  try {
    return await sendUmi(umi, builder);
  } catch (e) {
    if (builder === attrs) throw e;
    return sendUmi(umi, attrs);
  }
}

export async function transferCore(from: Keypair, nft: AgentNft, to: PublicKey): Promise<string> {
  const gate = listEligible(nft);
  if (!gate.ok) throw new Error(gate.reason);
  const umi = umiFor(from);
  const fetched = await loadAsset(nft.asset);
  const col = collectionAddress(fetched);
  if (!col) throw new Error("Core asset без колекції");
  if (fetched.freezeDelegate?.frozen) {
    await sendUmi(
      umi,
      updatePlugin(umi, {
        asset: publicKey(nft.asset),
        collection: col,
        plugin: { type: "FreezeDelegate", frozen: false },
      }),
    );
  }
  const fresh = await loadAsset(nft.asset);
  return sendUmi(
    umi,
    transfer(umi, {
      asset: fresh,
      collection: { publicKey: col },
      newOwner: publicKey(to.toBase58()),
    }),
  );
}

/**
 * RIG commit on Solana.
 * lock: stake leaves the wallet and sits on the market desk.
 * settle loss: the stake stays there.
 * settle win / withdraw: the desk pays stake + profit back.
 * This is a Devnet SOL transfer, not a Polymarket CLOB order.
 */
export async function commitPrediction(args: {
  user: Keypair;
  market: Keypair;
  track: Track;
  stake: number;
  pnl: number;
  win: boolean;
  memo: string;
  phase: "lock" | "settle";
}): Promise<string | null> {
  if (args.phase === "settle" && !args.win) return null;
  if (args.phase === "lock") {
    await fundIfNeeded(args.market);
    const bal = (await balanceLamports(args.user.publicKey)) / LAMPORTS_PER_SOL;
    const stake = Math.min(args.stake, Math.max(0, bal - 0.08));
    if (stake < 0.001) throw new Error("Мало тестового SOL для ставки RIG");
    return payAccount(args.user, args.market.publicKey, stake, args.memo);
  }
  const back = Number((args.stake + Math.max(args.pnl, 0)).toFixed(4));
  await fundIfNeeded(args.market);
  const marketBal = (await balanceLamports(args.market.publicKey)) / LAMPORTS_PER_SOL;
  if (marketBal < back + 0.02) {
    throw new Error("На ринку каси замало, щоб повернути ставку. Спробуй ще раз.");
  }
  return payAccount(args.market, args.user.publicKey, back, "RIG payout");
}
