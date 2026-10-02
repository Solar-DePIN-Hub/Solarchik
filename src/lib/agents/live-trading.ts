/**
 * LIVE (real-money) trading gate. Pure: shared by the server, the browser and the tests.
 *
 * Off by default. Turning it on (server env LIVE_TRADING_ENABLED=true) enables:
 * Polymarket CLOB buy orders from the room's Polygon key (manual and auto mode), the Polymarket
 * deposit relayer and the Solana -> pUSD bridge deposit, mainnet SOL top-ups of the arb desk and
 * mainnet arb fills on Backpack against the house treasury (that one also needs ARB_MAINNET_ENABLED=true).
 *
 * DO NOT enable it without geo-blocking (Polymarket and leveraged / prediction markets are restricted
 * in many jurisdictions) and a legal review. Hackathon submissions run with it OFF: agents read real
 * Polymarket markets / prices and real Backpack spreads, but trade in paper / devnet mode only, and the
 * results are still written to the Strategy NFTs.
 *
 * Exits stay open while it is off (sell / cancel / redeem an existing position, withdraw your own funds),
 * so nobody is locked into a position opened by an older build.
 */

export const LIVE_OFF_REASON = "Живі угоди вимкнено в цій збірці: агенти торгують лише в пісочниці (paper / devnet). Нічого не відправлено.";

/** Exactly "true" (any case, trimmed) turns it on. Anything else, or unset, is off. */
export function liveTradingFrom(flag: string | undefined | null): boolean {
  return (flag ?? "").trim().toLowerCase() === "true";
}

/** Mainnet arb needs both flags. Returns the ARB_MAINNET_ENABLED value to use, or undefined (= simulation). */
export function arbMainnetFlag(liveFlag: string | undefined | null, arbFlag: string | undefined | null): string | undefined {
  return liveTradingFrom(liveFlag) ? (arbFlag ?? undefined) : undefined;
}

// Browser-side copy of the server flag. Starts OFF and only the server status can turn it on.
let allowed = false;

export function setLiveTradingAllowed(on: boolean): void {
  allowed = on === true;
}

export function liveTradingAllowed(): boolean {
  return allowed;
}
