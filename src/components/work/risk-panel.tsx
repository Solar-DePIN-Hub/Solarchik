import { useState } from "react";
import { HARD_DAY_CAP, HARD_DAY_LOSS, HARD_MAX_LOSSES, HARD_MAX_TRADE, readCaps, writeCaps } from "@/lib/agents/user-limits";
import { useAgents } from "@/lib/agents/store";

export function RiskPanel() {
  const stopWork = useAgents((s) => s.stopWork);
  const [caps, setCaps] = useState(() => readCaps());

  function save(next: typeof caps) {
    const stored = writeCaps(next);
    setCaps(stored);
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid="risk-panel">
      <h3 className="text-sm font-medium">Ліміти</h3>
      <p className="mt-1 text-xs text-muted">Можна лише нижче стелі. Вище за стелю не ставиться.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label={`Угода, SOL (стеля ${HARD_MAX_TRADE})`}
          value={caps.maxTradeSol}
          max={HARD_MAX_TRADE}
          step="0.001"
          onChange={(n) => save({ ...caps, maxTradeSol: n })}
        />
        <Field
          label={`Доба, SOL (стеля ${HARD_DAY_CAP})`}
          value={caps.dayCapSol}
          max={HARD_DAY_CAP}
          step="0.01"
          onChange={(n) => save({ ...caps, dayCapSol: n })}
        />
        <Field
          label={`Мінусів підряд (стеля ${HARD_MAX_LOSSES})`}
          value={caps.maxLosses}
          max={HARD_MAX_LOSSES}
          step="1"
          onChange={(n) => save({ ...caps, maxLosses: Math.round(n) })}
        />
        <Field
          label={`Денний мінус, SOL (стеля ${HARD_DAY_LOSS})`}
          value={caps.dayLossSol}
          max={HARD_DAY_LOSS}
          step="0.01"
          onChange={(n) => save({ ...caps, dayLossSol: n })}
        />
      </div>
      <button
        type="button"
        className="mt-3 h-10 rounded-md border border-border px-3 text-sm"
        data-testid="risk-pause"
        onClick={() => {
          const paused = !caps.paused;
          save({ ...caps, paused });
          if (paused) stopWork();
        }}
      >
        {caps.paused ? "Зняти паузу" : "Пауза агента"}
      </button>
    </section>
  );
}

function Field({
  label,
  value,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg"
        type="number"
        min={step}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}
