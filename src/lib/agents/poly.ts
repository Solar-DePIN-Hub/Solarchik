import { createServerFn } from "@tanstack/react-start";
import type { PolyBalances, PolyReview, RedeemPlan, RedeemScan } from "./poly.server";

export type { PolyBalances, PolyReview, PolyTicket, GrokTrace, RedeemPlan, RedeemScan } from "./poly.server";

export const readPolyBalances = createServerFn({ method: "POST" })
  .validator((input: { address: string }) => input)
  .handler(async ({ data }): Promise<PolyBalances> => {
    const { readPolyBalances: read } = await import("./poly.server");
    return read(String(data.address ?? ""));
  });

export const reviewPolymarket = createServerFn({ method: "POST" })
  .validator((input: { address: string; daySpent: number; lane: "crypto" | "events" | "weather"; skip?: string[]; horizonH?: number; windows?: number[]; askLo?: number; askHi?: number }) => input)
  .handler(async ({ data }): Promise<PolyReview> => {
    const { reviewPolymarketOnServer } = await import("./poly.server");
    const lane = data.lane === "crypto" ? "crypto" : data.lane === "weather" ? "weather" : "events";
    const skip = Array.isArray(data.skip)
      ? data.skip.filter((t) => typeof t === "string" && /^\d{6,}$/.test(t)).slice(0, 40)
      : [];
    const horizonH = data.horizonH === 24 ? 24 : 48;
    const windows = Array.isArray(data.windows) ? data.windows.map(Number).filter((n) => n === 5 || n === 15 || n === 60 || n === 240) : undefined;
    return reviewPolymarketOnServer(String(data.address ?? ""), Number(data.daySpent) || 0, lane, skip, horizonH, {
      windows,
      askLo: Number(data.askLo),
      askHi: Number(data.askHi),
    });
  });

export const readPolyAllowance = createServerFn({ method: "POST" })
  .validator((input: { owner: string; exchange: string }) => input)
  .handler(async ({ data }): Promise<string | null> => {
    const { readAllowance } = await import("./poly.server");
    const value = await readAllowance(String(data.owner ?? ""), String(data.exchange ?? ""));
    return value == null ? null : value.toString();
  });

export const readOutcomeApproved = createServerFn({ method: "POST" })
  .validator((input: { owner: string; operator: string }) => input)
  .handler(async ({ data }): Promise<boolean | null> => {
    const { readOutcomeApproved: read } = await import("./poly.server");
    return read(String(data.owner ?? ""), String(data.operator ?? ""));
  });

export const reviewRedeem = createServerFn({ method: "POST" })
  .validator((input: { tokenId: string }) => input)
  .handler(async ({ data }): Promise<RedeemPlan> => {
    const { reviewRedeemOnServer } = await import("./poly.server");
    return reviewRedeemOnServer(String(data.tokenId ?? ""));
  });

export const scanRedeem = createServerFn({ method: "POST" })
  .validator((input: { address: string }) => input)
  .handler(async ({ data }): Promise<RedeemScan> => {
    const { scanRedeemOnServer } = await import("./poly.server");
    return scanRedeemOnServer(String(data.address ?? ""));
  });

export const bestBid = createServerFn({ method: "POST" })
  .validator((input: { tokenId: string }) => input)
  .handler(async ({ data }): Promise<string | null> => {
    const { bestBidOnServer } = await import("./poly.server");
    return bestBidOnServer(String(data.tokenId ?? ""));
  });

export const reviewClose = createServerFn({ method: "POST" })
  .validator((input: { address: string; tokenId: string; entry: string; shares: string }) => input)
  .handler(async ({ data }): Promise<PolyReview> => {
    const { reviewCloseOnServer } = await import("./poly.server");
    return reviewCloseOnServer({
      address: String(data.address ?? ""),
      tokenId: String(data.tokenId ?? ""),
      entry: String(data.entry ?? ""),
      shares: String(data.shares ?? ""),
    });
  });

export const holdRest = createServerFn({ method: "POST" })
  .validator((input: { tokenId: string }) => input)
  .handler(async ({ data }): Promise<{ secondsLeft: number | null; flipped: boolean | null }> => {
    const { holdRestOnServer } = await import("./poly.server");
    return holdRestOnServer(String(data.tokenId ?? ""));
  });

export const bestAsk = createServerFn({ method: "POST" })
  .validator((input: { tokenId: string }) => input)
  .handler(async ({ data }): Promise<string | null> => {
    const { bestAskOnServer } = await import("./poly.server");
    return bestAskOnServer(String(data.tokenId ?? ""));
  });

export const forwardClob = createServerFn({ method: "POST" })
  .validator((input: { method: string; path: string; headers: Record<string, string>; body: string }) => input)
  .handler(async ({ data }) => {
    const { forwardClobOnServer } = await import("./poly.server");
    return forwardClobOnServer(data.method, data.path, data.headers ?? {}, data.body ?? "");
  });
