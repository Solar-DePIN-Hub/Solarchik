import { createServerFn } from "@tanstack/react-start";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type JupiterQuote =
  | { ok: true; inSol: number; outUsdc: number; impact: string }
  | { ok: false; error: string };

export const quoteJupiter = createServerFn({ method: "POST" })
  .validator((input: { sol: number }) => input)
  .handler(async ({ data }): Promise<JupiterQuote> => {
    const sol = Number(data.sol);
    if (!Number.isFinite(sol) || sol <= 0 || sol > 1) {
      return { ok: false, error: "Jupiter не відповів" };
    }
    const amount = Math.round(sol * 1_000_000_000);
    const url =
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${USDC}` +
      `&amount=${amount}&slippageBps=50`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ok: false, error: "Jupiter не відповів" };
      const body = (await res.json()) as { outAmount?: string; priceImpactPct?: string };
      const out = Number(body.outAmount);
      if (!Number.isFinite(out)) return { ok: false, error: "Jupiter не відповів" };
      return {
        ok: true,
        inSol: sol,
        outUsdc: out / 1_000_000,
        impact: String(body.priceImpactPct ?? ""),
      };
    } catch {
      return { ok: false, error: "Jupiter не відповів" };
    }
  });

export const buildJupiterSwap = createServerFn({ method: "POST" })
  .validator((input: { sol: number; user: string }) => input)
  .handler(async ({ data }) => {
    const { buildJupiterSwapOnServer } = await import("./jupiter.server");
    return buildJupiterSwapOnServer(Number(data.sol), data.user);
  });

export const buildStockSwap = createServerFn({ method: "POST" })
  .validator((input: { sol: number; user: string; mint: string }) => input)
  .handler(async ({ data }) => {
    const { buildStockSwapOnServer } = await import("./jupiter.server");
    return buildStockSwapOnServer(Number(data.sol), String(data.user ?? ""), String(data.mint ?? ""));
  });