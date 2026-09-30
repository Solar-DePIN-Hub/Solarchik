import { useCallback, useEffect, useState } from "react";
import { runDeskFix, type FixRow } from "@/lib/agents/desk-fix";
import { useAgents } from "@/lib/agents/store";

export function DeskDoctor() {
  const ready = useAgents((s) => s.ready);
  const [rows, setRows] = useState<FixRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (speak: boolean) => {
    setBusy(true);
    try {
      setRows(await runDeskFix(speak));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void run(false);
  }, [ready, run]);

  return (
    <section className="mt-3 rounded-lg border border-border bg-surface p-3" data-testid="desk-doctor">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Перевірка столу</h2>
        <button
          type="button"
          onClick={() => void run(true)}
          disabled={busy || !ready}
          className="h-9 rounded-md border border-border px-3 text-xs font-medium disabled:opacity-50"
        >
          {busy ? "Перевіряю…" : "Перевірити і виправити"}
        </button>
      </div>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {(rows ?? [{ name: "Стіл", ok: false, text: ready ? "Перевіряю…" : "Чекаю гаманець…" }]).map((row) => (
          <li key={row.name} className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-bg px-3 py-2">
            <span className={`mt-1 size-2 shrink-0 rounded-full ${rows ? (row.ok ? "bg-primary" : "bg-accent") : "bg-muted"}`} aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-medium">{row.name}</span>
              <span className="block text-xs text-muted">{row.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
