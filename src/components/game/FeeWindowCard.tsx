import { feeProgress, type SaveData } from "@/lib/game/save";
import type { TFunc } from "@/lib/game/i18n";

function leftLabel(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function FeeWindowCard({ save, t, onActivate }: { save: SaveData; t: TFunc; onActivate: () => void }) {
  const progress = feeProgress(save);
  return (
    <section className="mt-3 rounded-lg border border-border bg-surface px-3 py-3" data-testid="fee-window">
      {progress.kind === "active" ? (
        <p className="text-sm font-medium text-fg">{t("yard.feeActive", { left: leftLabel(progress.leftMs) })}</p>
      ) : null}
      {progress.kind === "ready" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg">{t("yard.feeReady")}</p>
          <button
            type="button"
            onClick={onActivate}
            className="h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-fg"
          >
            {t("yard.feeActivate")}
          </button>
        </div>
      ) : null}
      {progress.kind === "wait" ? (
        <div className="flex flex-col gap-1 text-sm text-muted">
          <p>{t("yard.feeLeft", { n: progress.days48 })}</p>
          <p>{t("yard.feeLeft30", { n: progress.days30 })}</p>
        </div>
      ) : null}
    </section>
  );
}
