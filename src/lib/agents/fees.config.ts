/** One price table for strategy NFTs. Devnet SOL. Not the arb desk. */

export const PRO_PRICE_SOL = 0.1;
export const FREE_FEE_RATE = 0.05;
export const ROYALTY_BPS = 500;

const PRO_SKUS = new Set([
  "sku-pred-alpha-pro",
  "sku-pred-events-pro",
  "sku-pred-weather-pro",
  "sku-combo-prime-pro",
  "sku-dex-arb-pro",
]);

/** Base SKUs sold only as Pro: no Free variant exists, and the server refuses a free mint or re-issue. */
export const PAID_ONLY_BASE_SKUS: ReadonlySet<string> = new Set(["sku-combo-prime"]);

export function offerFor(id: string): { tier: "pro" | "free"; priceSol: number } {
  if (PRO_SKUS.has(id)) return { tier: "pro", priceSol: PRO_PRICE_SOL };
  return { tier: "free", priceSol: 0 };
}
