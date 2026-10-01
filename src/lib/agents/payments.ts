import { createServerFn } from "@tanstack/react-start";

const clean58 = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, max) : "");

/** Server-side arb credit for one NFT (verified deposits minus mainnet fires). */
export const readArbCreditFn = createServerFn({ method: "POST" })
  .validator((input: { asset?: string }) => ({ asset: clean58(input?.asset, 44) }))
  .handler(async ({ data }) => {
    const { readArbCreditOnServer } = await import("./payments.server");
    return readArbCreditOnServer(data.asset);
  });

/** Credit a mainnet deposit after the server reads it on-chain. */
export const claimArbCreditFn = createServerFn({ method: "POST" })
  .validator((input: { wallet?: string; asset?: string; sig?: string }) => ({
    wallet: clean58(input?.wallet, 44),
    asset: clean58(input?.asset, 44),
    sig: clean58(input?.sig, 100),
  }))
  .handler(async ({ data }) => {
    const { claimArbCreditOnServer } = await import("./payments.server");
    return claimArbCreditOnServer(data);
  });

/** Record a Free-tier fee transfer after the server reads it on devnet. */
export const recordFeeFn = createServerFn({ method: "POST" })
  .validator((input: { wallet?: string; rowId?: string; sig?: string; lamports?: number }) => ({
    wallet: clean58(input?.wallet, 44),
    rowId: typeof input?.rowId === "string" ? input.rowId.slice(0, 64) : "",
    sig: clean58(input?.sig, 100),
    lamports: typeof input?.lamports === "number" && Number.isFinite(input.lamports) ? Math.round(input.lamports) : 0,
  }))
  .handler(async ({ data }) => {
    const { recordFeeOnServer } = await import("./payments.server");
    return recordFeeOnServer(data);
  });
