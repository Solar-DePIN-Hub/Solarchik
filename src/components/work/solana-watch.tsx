import { useCallback, useEffect, useState } from "react";
import { readMainnetSlot } from "@/lib/agents/mainnet";
import { probeDevnet, type SolProbe } from "@/lib/agents/netwatch";

async function probeMainnet(): Promise<SolProbe> {
  const t = performance.now();
  try {
    const slot = await readMainnetSlot();
    const ms = Math.round(performance.now() - t);
    if (typeof slot !== "number") return { ok: false, slot: null, ms, error: "немає слота" };
    return { ok: true, slot, ms, error: null };
  } catch (e) {
    return {
      ok: false,
      slot: null,
      ms: Math.round(performance.now() - t),
      error: e instanceof Error ? e.message : "немає зв'язку",
    };
  }
}

function Line({ name, probe }: { name: string; probe: SolProbe | null }) {
  const tone = probe == null ? "bg-muted" : probe.ok ? "bg-primary" : "bg-accent";
  let text = "читаю мережу…";
  if (probe?.ok) text = `слот ${probe.slot} · ${probe.ms} мс · жива`;
  else if (probe) text = probe.error || "немає зв'язку";
  return (
    <div className="min-w-0 rounded-md border border-border bg-bg px-3 py-2">
      <p className="flex items-center gap-2 text-xs font-medium">
        <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-hidden />
        {name}
      </p>
      <p className="mt-1 truncate text-xs text-muted tabular-nums">{text}</p>
    </div>
  );
}

export function SolanaWatch() {
  const [dev, setDev] = useState<SolProbe | null>(null);
  const [main, setMain] = useState<SolProbe | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    const [nextDev, nextMain] = await Promise.all([probeDevnet(), probeMainnet()]);
    setDev(nextDev);
    setMain(nextMain);
    setBusy(false);
  }, []);

  useEffect(() => {
    void run();
    const id = window.setInterval(() => void run(), 20000);
    return () => window.clearInterval(id);
  }, [run]);

  return (
    <section className="rounded-lg border border-border bg-surface p-3" data-testid="solana-watch">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Мережа Solana</h2>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="h-9 rounded-md border border-border px-3 text-xs font-medium disabled:opacity-50"
        >
          Оновити
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Line name="Devnet" probe={dev} />
        <Line name="Mainnet" probe={main} />
      </div>
    </section>
  );
}
