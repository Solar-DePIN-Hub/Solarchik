import { useAgents } from "@/lib/agents/store";

const WHY: Record<string, string> = {
  pro: "Pro · 0%",
  window: "вікно без комісії",
  loss: "мінус, комісії немає",
  paper: "папір, не відправлено",
  charged: "відправлено",
  unsent: "не відправлено",
};

export function FeeNote() {
  const row = useAgents((s) => s.feeLedger[s.feeLedger.length - 1] ?? null);
  if (!row) return null;
  const sign = row.pnl >= 0 ? "+" : "";
  return (
    <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted" data-testid="fee-note">
      {`PnL ${sign}${row.pnl.toFixed(4)} · комісія ${row.fee.toFixed(4)} · ${WHY[row.reason] ?? row.reason}`}
      {row.sig ? ` · ${row.sig.slice(0, 8)}…` : ""}
    </p>
  );
}
