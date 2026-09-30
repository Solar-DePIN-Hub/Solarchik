import { SLICE_STOCKS } from "./slice-stocks";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const STOCK_MINTS = new Set<string>(SLICE_STOCKS.map((s) => s.mint));

export type BuiltSwap =
  | { ok: true; tx: string; outUsdc: number; impact: string }
  | { ok: false; error: string };

export async function buildJupiterSwapOnServer(sol: number, user: string): Promise<BuiltSwap> {
  if (!Number.isFinite(sol) || sol <= 0 || sol > 0.005) {
    return { ok: false, error: "Сума живого свопу поза лімітом 0.005 SOL." };
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(user)) {
    return { ok: false, error: "Немає торгового гаманця." };
  }
  const amount = Math.round(sol * 1_000_000_000);
  const quoteUrl =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${USDC}` +
    `&amount=${amount}&slippageBps=50`;
  try {
    const quoteRes = await fetch(quoteUrl, { signal: AbortSignal.timeout(8000) });
    if (!quoteRes.ok) return { ok: false, error: "Jupiter не відповів" };
    const quote = (await quoteRes.json()) as { outAmount?: string; priceImpactPct?: string };
    const out = Number(quote.outAmount);
    if (!Number.isFinite(out)) return { ok: false, error: "Jupiter не відповів" };
    const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: user,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!swapRes.ok) return { ok: false, error: "Jupiter не відповів" };
    const swap = (await swapRes.json()) as { swapTransaction?: string };
    if (!swap.swapTransaction) return { ok: false, error: "Jupiter не відповів" };
    return {
      ok: true,
      tx: swap.swapTransaction,
      outUsdc: out / 1_000_000,
      impact: String(quote.priceImpactPct ?? ""),
    };
  } catch {
    return { ok: false, error: "Jupiter не відповів" };
  }
}

export async function buildStockSwapOnServer(
  sol: number,
  user: string,
  outputMint: string,
): Promise<{ ok: true; tx: string; outAmount: string; name: string } | { ok: false; error: string }> {
  const stock = SLICE_STOCKS.find((s) => s.mint === outputMint);
  if (!stock || !STOCK_MINTS.has(outputMint)) return { ok: false, error: "Цієї акції в Slice немає." };
  if (!Number.isFinite(sol) || sol < 0.001 || sol > 1) return { ok: false, error: "Сума від 0.001 до 1 SOL." };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(user)) return { ok: false, error: "Немає гаманця агента." };
  const amount = Math.round(sol * 1_000_000_000);
  const quoteUrl =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${outputMint}` +
    `&amount=${amount}&slippageBps=75`;
  try {
    const quoteRes = await fetch(quoteUrl, { signal: AbortSignal.timeout(8000) });
    if (!quoteRes.ok) return { ok: false, error: "Jupiter не відповів." };
    const quote = (await quoteRes.json()) as { outAmount?: string; error?: string };
    if (!quote.outAmount) return { ok: false, error: quote.error || "Jupiter не дав ціну." };
    const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: user,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!swapRes.ok) return { ok: false, error: "Jupiter не зібрав своп." };
    const swap = (await swapRes.json()) as { swapTransaction?: string; error?: string };
    if (!swap.swapTransaction) return { ok: false, error: swap.error || "Jupiter не зібрав своп." };
    return { ok: true, tx: swap.swapTransaction, outAmount: quote.outAmount, name: stock.name };
  } catch {
    return { ok: false, error: "Jupiter не відповів." };
  }
}