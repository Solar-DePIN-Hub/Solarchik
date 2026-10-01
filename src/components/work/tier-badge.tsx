import type { NftTier } from "@/lib/agents/types";

export function TierBadge({ tier }: { tier?: NftTier }) {
  const free = tier === "free";
  return (
    <span className={free ? "rounded-sm bg-elevated px-1.5 py-0.5 text-[11px] text-muted" : "rounded-sm bg-primary/15 px-1.5 py-0.5 text-[11px] text-primary"}>
      {free ? "Free · 5% of profit" : "Pro · 0% fee"}
    </span>
  );
}
