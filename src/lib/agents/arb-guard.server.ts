import { arbMainnetFlag } from "./live-trading.ts";
import { ARB_FIRE_SOL, ARB_LIMITS, arbModeFor, type ArbModeInfo, type ArbStore } from "./arb-rules";
import { verifyProof } from "./wallet-proof.server";
import type { WalletProof } from "./wallet-proof";
import type { GuardSql } from "./guard-ledger.server";

/**
 * Server-side arb authorization. The browser never holds a secret: it sends a
 * room-key proof, and the server checks the signature, that the wallet owns a
 * dex agent on devnet, then books the fire against shared caps in Postgres.
 * Mainnet needs ARB_MAINNET_ENABLED=true AND DATABASE_URL. Otherwise it is a
 * simulation, or closed when there is no shared store. No file writes.
 */

export function arbStore(): ArbStore {
  const url = (process.env.DATABASE_URL || "").trim();
  if (url) return "shared";
  // In-memory PGLite is per process. Fine for `vite dev`, never for a deploy.
  if (import.meta.env.DEV) return "dev";
  return "none";
}

export function currentArbMode(): ArbModeInfo {
  // Mainnet arb also needs LIVE_TRADING_ENABLED=true (see live-trading.ts: geo-blocking + legal review first).
  return arbModeFor(arbMainnetFlag(process.env.LIVE_TRADING_ENABLED, process.env.ARB_MAINNET_ENABLED), arbStore());
}

async function guardSql(): Promise<GuardSql> {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

export type ArbFireResult =
  | { ok: true; mode: "mainnet" | "sim"; simulated: boolean; size: number; qty: number; base: string; bp: string; titan: string; creditSol?: number }
  | { ok: false; mode: "mainnet" | "sim" | "closed"; broken: boolean; reason: string };

export async function guardedArbFire(input: {
  dir: "A" | "B";
  symbol: string;
  asset: string;
  proof: WalletProof | null;
}): Promise<ArbFireResult> {
  const info = currentArbMode();
  if (info.mode === "closed") return { ok: false, mode: "closed", broken: false, reason: info.reason };
  const mode = info.mode;
  const refuse = (reason: string): ArbFireResult => ({ ok: false, mode, broken: false, reason });
  if (!input.proof) return refuse("Немає підпису гаманця.");
  if (input.asset.length < 32) return refuse("Немає NFT агента.");
  const extra = `${input.dir}:${input.symbol}:${input.asset}`;
  const signed = verifyProof(input.proof, "arb", extra);
  if (!signed.ok) return refuse(signed.reason);
  const wallet = input.proof.wallet;

  let sql: GuardSql;
  try {
    sql = await guardSql();
  } catch {
    return { ok: false, mode: "closed", broken: false, reason: "Каса закрита: база не відповіла." };
  }
  const { arbCreditLamports, spendProofOnce, reserveArb, settleArb } = await import("./guard-ledger.server");
  const now = Date.now();
  try {
    if (!(await spendProofOnce(sql, wallet, "arb", input.proof.ts, now))) return refuse("Цей підпис уже використано.");
  } catch {
    return { ok: false, mode: "closed", broken: false, reason: "Каса закрита: база не відповіла." };
  }

  try {
    const { fetchCoreAgent, inServerCollection, isArbAgent } = await import("./core-owned.server");
    const { serverCollectionAddress } = await import("./mint-authority.server");
    const agent = await fetchCoreAgent(input.asset);
    if (!agent || agent.owner !== wallet) return refuse("Цей NFT не в твоєму гаманці.");
    if (!inServerCollection(agent, serverCollectionAddress())) {
      return refuse("Цей NFT не з колекції сервера. Перенеси його кнопкою «Перенести в колекцію сервера».");
    }
    if (!isArbAgent(agent)) return refuse("Арбітраж лише для агента класу 2 або комбо.");
  } catch {
    return refuse("Не вдалося перевірити NFT ончейн. Спробуй пізніше.");
  }

  if (mode === "mainnet") {
    // Mainnet spends verified arb credit only (deposits read on-chain by the server).
    // The 30 s global spacing serializes fires, so this read cannot be double-spent.
    try {
      const left = await arbCreditLamports(sql, input.asset);
      if (left < Math.round(ARB_FIRE_SOL * 1e9)) return refuse(`Кредит арбу ${(left / 1e9).toFixed(4)} SOL. Треба від ${ARB_FIRE_SOL}.`);
    } catch {
      return { ok: false, mode: "closed", broken: false, reason: "Каса закрита: база не відповіла." };
    }
  }

  let booked;
  try {
    booked = await reserveArb(sql, {
      mode,
      wallet,
      asset: input.asset,
      symbol: input.symbol,
      dir: input.dir,
      sol: ARB_FIRE_SOL,
      limits: ARB_LIMITS[mode],
      now,
    });
  } catch {
    return { ok: false, mode: "closed", broken: false, reason: "Каса закрита: база не відповіла." };
  }
  if (!booked.ok) return refuse(booked.reason);

  const house = await import("./arb-house.server");
  let result: Awaited<ReturnType<typeof house.fireArbOnServer>>;
  try {
    result = mode === "mainnet" ? await house.fireArbOnServer(input.dir, input.symbol) : await house.simulateArbOnServer(input.dir, input.symbol);
  } catch (error) {
    // Unknown outcome. Keep the booking so the cap stays conservative.
    await settleArb(sql, booked.reservation, "broken", error instanceof Error ? error.message : "throw", Date.now());
    return { ok: false, mode, broken: true, reason: "Зламано, чекає зведення." };
  }
  if (result.ok) {
    await settleArb(sql, booked.reservation, "ok", `${result.bp} ${result.titan}`, Date.now());
    let creditSol: number | undefined;
    if (mode === "mainnet") {
      try {
        creditSol = (await arbCreditLamports(sql, input.asset)) / 1e9;
      } catch {
        creditSol = undefined;
      }
    }
    return { ...result, mode, simulated: mode !== "mainnet", ...(creditSol == null ? {} : { creditSol }) };
  }
  await settleArb(sql, booked.reservation, result.broken ? "broken" : "failed", result.reason, Date.now());
  return { ...result, mode };
}
