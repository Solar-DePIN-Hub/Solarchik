export type SpotMarket = {
  base: string;
  market: string;
  mint: string;
  decimals: number;
  minQty: number;
  step: number;
  tick: number;
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

let cache: { at: number; rows: SpotMarket[] } | null = null;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function stepDp(step: number): number {
  if (!(step > 0) || step >= 1) return 0;
  return Math.min(8, Math.round(-Math.log10(step)));
}

export function floorToStep(qty: number, step: number): number {
  if (!(qty > 0)) return 0;
  if (!(step > 0)) return qty;
  const units = Math.floor(qty / step + 1e-8);
  return Number((units * step).toFixed(stepDp(step)));
}

export async function loadSpots(): Promise<SpotMarket[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.rows;
  const headers = { accept: "application/json", "user-agent": "Solarchik/1.0" };
  const [marketsRes, assetsRes] = await Promise.all([
    fetch("https://api.backpack.exchange/api/v1/markets", { headers, signal: AbortSignal.timeout(12000) }),
    fetch("https://api.backpack.exchange/api/v1/assets", { headers, signal: AbortSignal.timeout(20000) }),
  ]);
  if (!marketsRes.ok || !assetsRes.ok) return cache?.rows ?? [];
  const markets = (await marketsRes.json()) as {
    symbol?: string;
    baseSymbol?: string;
    quoteSymbol?: string;
    marketType?: string;
    orderBookState?: string;
    visible?: boolean;
    filters?: { price?: { tickSize?: string }; quantity?: { minQuantity?: string; stepSize?: string } };
  }[];
  const assets = (await assetsRes.json()) as {
    symbol?: string;
    tokens?: { blockchain?: string; contractAddress?: string; depositEnabled?: boolean; withdrawEnabled?: boolean; nativeDecimals?: number }[];
  }[];
  const mintOf = new Map<string, { mint: string; decimals: number }>();
  for (const asset of assets) {
    const symbol = asset.symbol ?? "";
    if (!symbol) continue;
    if (symbol === "SOL") {
      mintOf.set("SOL", { mint: SOL_MINT, decimals: 9 });
      continue;
    }
    for (const token of asset.tokens ?? []) {
      const mint = token.contractAddress ?? "";
      if (token.blockchain !== "Solana" || !token.depositEnabled || !token.withdrawEnabled || mint.length < 32) continue;
      mintOf.set(symbol, { mint, decimals: token.nativeDecimals ?? 0 });
      break;
    }
  }
  const rows: SpotMarket[] = [];
  for (const market of markets) {
    if (market.marketType !== "SPOT" || market.quoteSymbol !== "USDC" || market.orderBookState !== "Open" || market.visible === false) continue;
    const base = market.baseSymbol ?? "";
    const known = mintOf.get(base);
    if (!base || !market.symbol || !known || !(known.decimals > 0)) continue;
    const minQty = num(market.filters?.quantity?.minQuantity);
    const step = num(market.filters?.quantity?.stepSize) || minQty;
    const tick = num(market.filters?.price?.tickSize) || 0.01;
    if (!(minQty > 0) || !(step > 0)) continue;
    rows.push({ base, market: market.symbol, mint: known.mint, decimals: known.decimals, minQty, step, tick });
  }
  rows.sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0));
  if (rows.length) cache = { at: Date.now(), rows };
  return rows;
}

export async function findSpot(base: string): Promise<SpotMarket | null> {
  const want = base.trim().toUpperCase();
  const rows = await loadSpots();
  return rows.find((row) => row.base.toUpperCase() === want) ?? null;
}

export async function bookTop(market: string): Promise<{ bid: number; ask: number } | null> {
  const res = await fetch(`https://api.backpack.exchange/api/v1/depth?symbol=${encodeURIComponent(market)}`, {
    headers: { accept: "application/json", "user-agent": "Solarchik/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { bids?: [string, string][]; asks?: [string, string][] };
  const bid = Number(body.bids?.at(-1)?.[0]);
  const ask = Number(body.asks?.[0]?.[0]);
  if (!(bid > 0) || !(ask > bid)) return null;
  return { bid, ask };
}

export { SOL_MINT, USDC_MINT };
