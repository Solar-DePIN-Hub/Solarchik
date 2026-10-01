import { createServerFn } from "@tanstack/react-start";
import { cleanArbSymbol, type ArbMode } from "./arb-rules";
import { readProof } from "./wallet-proof";

export type ArbHouse = {
  bpSol: number | null;
  bpUsdc: number | null;
  chainSol: number | null;
  chainUsdc: number | null;
  houseKey: boolean;
  tokens: Record<string, { bp: number; chain: number }> | null;
  /** Decided on the server: mainnet only with ARB_MAINNET_ENABLED=true and a shared DB. */
  mode: ArbMode;
  modeReason: string;
};

export const readArbHouse = createServerFn({ method: "GET" }).handler(async (): Promise<ArbHouse> => {
  const { currentArbMode } = await import("./arb-guard.server");
  const info = currentArbMode();
  const { readArbHouseOnServer } = await import("./arb-house.server");
  const house = await readArbHouseOnServer();
  return { ...house, mode: info.mode, modeReason: info.reason };
});

/** The browser asks; the server decides. No secret is sent or held by the client. */
export const fireArb = createServerFn({ method: "POST" })
  .validator((input: { dir: "A" | "B"; symbol?: string; asset?: string; proof?: unknown }) => ({
    dir: input?.dir === "B" ? ("B" as const) : ("A" as const),
    symbol: cleanArbSymbol(typeof input?.symbol === "string" ? input.symbol : "SOL"),
    asset: typeof input?.asset === "string" ? input.asset.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 44) : "",
    proof: readProof(input?.proof),
  }))
  .handler(async ({ data }) => {
    const { guardedArbFire } = await import("./arb-guard.server");
    return guardedArbFire({ dir: data.dir, symbol: data.symbol || "SOL", asset: data.asset, proof: data.proof });
  });
