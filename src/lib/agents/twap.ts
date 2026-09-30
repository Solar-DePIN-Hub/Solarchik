import { createServerFn } from "@tanstack/react-start";

export type TwapWindow = {
  symbol: "btc/usd";
  windowS: 30 | 60;
  known: boolean;
  /** Exact decimal from E18. Null when unknown or older than 15s. */
  price: string | null;
  ageSec: number | null;
  stale: boolean;
};

export type TwapSnapshot = {
  w30: TwapWindow;
  w60: TwapWindow;
};

export const readChainlinkTwap = createServerFn({ method: "POST" })
  .validator((input: { waitMs?: number } | undefined) => input ?? {})
  .handler(async ({ data }): Promise<TwapSnapshot> => {
    const { readTwapSnapshot } = await import("./twap.server");
    const wait = Math.min(2500, Math.max(0, Number(data?.waitMs) || 0));
    return readTwapSnapshot(wait);
  });
