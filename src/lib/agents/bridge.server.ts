import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { MAINNET_HTTP } from "../../../server/quicknode.mjs";
import { readMainnetBalanceOnServer, readMainnetUsdcOnServer } from "./mainnet.server";

const BRIDGE = "https://bridge.polymarket.com";
const UA = "Mozilla/5.0";
const SOLANA_CHAIN = "1151111081099710";
const POLYGON_CHAIN = "137";
const PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NATIVE_SOL = "11111111111111111111111111111111";
const CAP_USD = 6;
const FEE_SOL = 0.01;

type AssetRow = {
  chainName?: string;
  minCheckoutUsd?: unknown;
  token?: { symbol?: string; address?: string; decimals?: number };
};

export type BridgePlan = {
  ok: true;
  svm: string;
  polygon: string;
  minUsd: number | null;
  asset: "USDC" | "SOL" | null;
  amount: number | null;
  estInputUsd: number | null;
  tx: string | null;
  canConfirm: boolean;
  why: string | null;
};

function headers(): Record<string, string> {
  const out: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": UA,
  };
  const code =
    import.meta.env.VITE_NATIVE === "1" || typeof process === "undefined"
      ? ""
      : (process.env.POLYMARKET_BUILDER_CODE?.trim() ?? "");
  if (/^0x[a-fA-F0-9]{64}$/.test(code)) out["x-builder-code"] = code;
  return out;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function depositSvm(polygon: string): Promise<string | null> {
  const res = await fetch(`${BRIDGE}/deposit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ address: polygon }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { address?: { svm?: unknown } };
  const svm = typeof body.address?.svm === "string" ? body.address.svm : "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(svm)) return null;
  try {
    new PublicKey(svm);
  } catch {
    return null;
  }
  return svm;
}

async function mins(): Promise<{ usdc: number | null; sol: number | null; usdcRow: boolean; solRow: boolean }> {
  const res = await fetch(`${BRIDGE}/supported-assets`, {
    headers: headers(),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return { usdc: null, sol: null, usdcRow: false, solRow: false };
  const body = (await res.json()) as { supportedAssets?: AssetRow[] };
  const rows = (body.supportedAssets ?? []).filter((row) => row.chainName === "Solana");
  const usdc = rows.find((row) => row.token?.address === USDC);
  const sol = rows.find((row) => row.token?.address === NATIVE_SOL);
  return {
    usdc: usdc ? num(usdc.minCheckoutUsd) : null,
    sol: sol ? num(sol.minCheckoutUsd) : null,
    usdcRow: Boolean(usdc),
    solRow: Boolean(sol),
  };
}

async function quoteUsd(
  token: string,
  base: string,
  polygon: string,
): Promise<number | null> {
  const res = await fetch(`${BRIDGE}/quote`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      fromAmountBaseUnit: base,
      fromChainId: SOLANA_CHAIN,
      fromTokenAddress: token,
      recipientAddress: polygon,
      toChainId: POLYGON_CHAIN,
      toTokenAddress: PUSD,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { estInputUsd?: unknown };
  return num(body.estInputUsd);
}

async function blockhash(): Promise<string | null> {
  try {
    const conn = new Connection(MAINNET_HTTP, "confirmed");
    const latest = await conn.getLatestBlockhash("confirmed");
    return latest.blockhash || null;
  } catch {
    return null;
  }
}

function pack(tx: Transaction): string {
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(raw).toString("base64");
}

export async function prepareBridgeOnServer(polygon: string, room: string): Promise<BridgePlan | { ok: false; error: string }> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(polygon)) return { ok: false, error: "немає адреси моста" };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(room)) return { ok: false, error: "немає адреси моста" };
  let svm: string | null = null;
  try {
    svm = await depositSvm(polygon);
  } catch {
    svm = null;
  }
  if (!svm) return { ok: false, error: "немає адреси моста" };

  const empty = (why: string, minUsd: number | null): BridgePlan => ({
    ok: true,
    svm,
    polygon,
    minUsd,
    asset: null,
    amount: null,
    estInputUsd: null,
    tx: null,
    canConfirm: false,
    why,
  });

  let listed: { usdc: number | null; sol: number | null; usdcRow: boolean; solRow: boolean };
  try {
    listed = await mins();
  } catch {
    return empty("невідомий мінімум", null);
  }

  const usdcBal = await readMainnetUsdcOnServer(room);
  const solBal = await readMainnetBalanceOnServer(room);
  const from = new PublicKey(room);
  const to = new PublicKey(svm);
  const hash = await blockhash();

  const usdcReady = usdcBal != null && listed.usdc != null && usdcBal + 1e-9 >= listed.usdc;
  if (usdcBal == null && listed.usdc != null) return empty("немає цифри", listed.usdc);
  if (listed.usdcRow && listed.usdc == null && listed.sol == null) return empty("невідомий мінімум", null);

  if (usdcReady && usdcBal != null && listed.usdc != null) {
    const amount = Math.floor(Math.min(CAP_USD, usdcBal) * 1e6) / 1e6;
    const base = BigInt(Math.round(amount * 1e6));
    const est = await quoteUsd(USDC, base.toString(), polygon);
    if (est == null) return empty("немає котирування", listed.usdc);
    if (est > CAP_USD + 0.05) return empty("Стеля 6 USDC. Депозиту немає.", listed.usdc);
    if (!hash || solBal == null || solBal < FEE_SOL) {
      return {
        ok: true,
        svm,
        polygon,
        minUsd: listed.usdc,
        asset: "USDC",
        amount,
        estInputUsd: est,
        tx: null,
        canConfirm: false,
        why: solBal != null && solBal < FEE_SOL ? "Немає SOL на комісію. Депозиту немає." : "немає котирування",
      };
    }
    const mint = new PublicKey(USDC);
    const ata = getAssociatedTokenAddressSync(mint, to, true);
    const tx = new Transaction();
    tx.feePayer = from;
    tx.recentBlockhash = hash;
    tx.add(createAssociatedTokenAccountIdempotentInstruction(from, ata, to, mint));
    tx.add(
      createTransferCheckedInstruction(
        getAssociatedTokenAddressSync(mint, from),
        mint,
        ata,
        from,
        base,
        6,
      ),
    );
    return {
      ok: true,
      svm,
      polygon,
      minUsd: listed.usdc,
      asset: "USDC",
      amount,
      estInputUsd: est,
      tx: pack(tx),
      canConfirm: true,
      why: null,
    };
  }

  if (solBal == null || !listed.solRow) return empty(listed.solRow ? "немає цифри" : "невідомий мінімум", listed.sol);
  if (listed.sol == null) return empty("невідомий мінімум", null);
  const probe = await quoteUsd(NATIVE_SOL, "10000000", polygon);
  if (probe == null || probe <= 0) return empty("немає котирування", listed.sol);
  const usdPerSol = probe / 0.01;
  const spendable = solBal - FEE_SOL;
  if (!(spendable > 0) || !(usdPerSol > 0)) {
    return empty("Немає SOL на комісію. Депозиту немає.", listed.sol);
  }
  const capSol = CAP_USD / usdPerSol;
  let amount = Math.floor(Math.min(capSol, spendable) * 1e6) / 1e6;
  if (!(amount > 0)) return empty("Сума менша за мінімум. Депозиту немає.", listed.sol);
  const lamports = Math.floor(amount * 1e9);
  const est = await quoteUsd(NATIVE_SOL, String(lamports), polygon);
  if (est == null) return empty("немає котирування", listed.sol);
  if (est + 1e-9 < listed.sol) {
    return {
      ok: true,
      svm,
      polygon,
      minUsd: listed.sol,
      asset: "SOL",
      amount,
      estInputUsd: est,
      tx: null,
      canConfirm: false,
      why: "Сума менша за мінімум. Депозиту немає.",
    };
  }
  if (est > CAP_USD + 0.05) return empty("Стеля 6 USDC. Депозиту немає.", listed.sol);
  if (!hash) return empty("немає котирування", listed.sol);
  const tx = new Transaction();
  tx.feePayer = from;
  tx.recentBlockhash = hash;
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  return {
    ok: true,
    svm,
    polygon,
    minUsd: listed.sol,
    asset: "SOL",
    amount,
    estInputUsd: est,
    tx: pack(tx),
    canConfirm: true,
    why: null,
  };
}

export async function readBridgeStatusOnServer(svm: string): Promise<string | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(svm)) return null;
  try {
    const res = await fetch(`${BRIDGE}/status/${svm}`, {
      headers: headers(),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { transactions?: { status?: unknown }[] };
    const status = body.transactions?.[0]?.status;
    return typeof status === "string" && status ? status : null;
  } catch {
    return null;
  }
}
