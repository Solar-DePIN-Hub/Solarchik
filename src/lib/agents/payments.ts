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


/** Server-priced position open (web prediction desk). */
export const openPositionFn = createServerFn({ method: "POST" })
  .validator((input: { proof?: unknown; fillId?: string; asset?: string; book?: string; side?: string; stakeLamports?: number }) => input ?? {})
  .handler(async ({ data }) => {
    const [{ openPositionOnServer }, { readProof }, rules] = await Promise.all([
      import("./positions.server"),
      import("./wallet-proof"),
      import("./position-rules"),
    ]);
    return openPositionOnServer({
      proof: readProof(data.proof),
      fillId: rules.cleanFillId(data.fillId),
      asset: clean58(data.asset, 44),
      book: rules.readBook(data.book),
      side: rules.readSide(data.side),
      stakeLamports: typeof data.stakeLamports === "number" && Number.isFinite(data.stakeLamports) ? Math.round(data.stakeLamports) : 0,
    });
  });

/** Server-priced position close: returns the server's PnL and owed fee. */
export const closePositionFn = createServerFn({ method: "POST" })
  .validator((input: { proof?: unknown; fillId?: string }) => input ?? {})
  .handler(async ({ data }) => {
    const [{ closePositionOnServer }, { readProof }, { cleanFillId }] = await Promise.all([
      import("./positions.server"),
      import("./wallet-proof"),
      import("./position-rules"),
    ]);
    return closePositionOnServer({ proof: readProof(data.proof), fillId: cleanFillId(data.fillId) });
  });

/** Verified clock-in day for fee-free window entitlement. */
export const recordClockFn = createServerFn({ method: "POST" })
  .validator((input: { proof?: unknown; clockAddress?: string; clockSig?: string; kind?: string; cluster?: string; memo?: string }) => input ?? {})
  .handler(async ({ data }) => {
    const [{ recordClockOnServer }, { readProof }] = await Promise.all([import("./positions.server"), import("./wallet-proof")]);
    return recordClockOnServer({
      proof: readProof(data.proof),
      clockAddress: clean58(data.clockAddress, 44),
      clockSig: clean58(data.clockSig, 100),
      kind: data.kind === "message" ? "message" : "tx",
      cluster: data.cluster === "mainnet" ? "mainnet" : "devnet",
      memo: typeof data.memo === "string" ? data.memo.slice(0, 120) : "",
    });
  });

/** Start the next fee-free window at server time. */
export const startFeeWindowFn = createServerFn({ method: "POST" })
  .validator((input: { proof?: unknown }) => input ?? {})
  .handler(async ({ data }) => {
    const [{ startFeeWindowOnServer }, { readProof }] = await Promise.all([import("./positions.server"), import("./wallet-proof")]);
    return startFeeWindowOnServer({ proof: readProof(data.proof) });
  });

/** Owed vs paid fees for a room wallet (server record). */
export const feeBalanceFn = createServerFn({ method: "POST" })
  .validator((input: { wallet?: string }) => ({ wallet: clean58(input?.wallet, 44) }))
  .handler(async ({ data }) => {
    const { feeBalanceOnServer } = await import("./positions.server");
    return feeBalanceOnServer(data.wallet);
  });
