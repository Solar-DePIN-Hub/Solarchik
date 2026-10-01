import { useEffect, useRef, useState } from "react";
import { loadState } from "@/lib/agents/persist";
import type { FeeRow } from "@/lib/agents/fee-ledger";
import { liveAsk, liveSpeak } from "@/lib/game/buddyNet";
import { isVoiceOn, playVoiceB64, speakLocal } from "@/lib/game/audio";
import type { TFunc } from "@/lib/game/i18n";
import { feeProgress, todayKey, type SaveData } from "@/lib/game/save";
import { emotionOf, stageOf } from "@/lib/game/pet";

function yesterdayKey(now = Date.now()): string {
  return new Date(now - 86_400_000).toISOString().slice(0, 10);
}

function dayOf(ms: number): string {
  if (!(ms > 0)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function nums(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

function onlyKnownNumbers(reply: string, source: string): boolean {
  const allow = new Set(nums(source));
  return nums(reply).every((n) => allow.has(n));
}

function sol(n: number): string {
  const rounded = Math.round(n * 1e5) / 1e5;
  return `${rounded >= 0 ? "" : ""}${rounded}`;
}

export function buildReport(save: SaveData, ledger: FeeRow[], names: string[], t: TFunc) {
  const day = yesterdayKey();
  const rows = ledger.filter((r) => dayOf(r.closedAt) === day);
  const pnl = rows.reduce((s, r) => s + r.pnl, 0);
  const charged = rows.filter((r) => r.charged).reduce((s, r) => s + r.fee, 0);
  const waived = rows.filter((r) => !r.charged && r.reason === "window").reduce((s, r) => s + r.fee, 0);
  const progress = feeProgress(save);
  const windowLine =
    progress.kind === "active"
      ? t("yard.feeActive", { left: `${Math.floor(progress.leftMs / 3600000)}h` })
      : progress.kind === "ready"
        ? t("yard.feeReady")
        : t("yard.feeLeft", { n: progress.days48 });
  const plan = names.length ? names.slice(0, 3).join(", ") : t("yard.reportEmpty");
  const lines = rows.length
    ? [
        t("yard.reportPnl", { n: sol(pnl) }),
        t("yard.reportFees", { charged: sol(charged), waived: sol(waived) }),
        t("yard.reportStreak", { n: save.streak }),
        windowLine,
        t("yard.reportPlan", { text: plan }),
      ]
    : [t("yard.reportEmpty"), t("yard.reportStreak", { n: save.streak }), windowLine, t("yard.reportPlan", { text: plan })];
  return { lines, script: lines.join(" ") };
}

export function DailyReport({
  save,
  ready,
  t,
  onSeen,
}: {
  save: SaveData;
  ready: boolean;
  t: TFunc;
  onSeen: (day: string) => void;
}) {
  const [lines, setLines] = useState<string[] | null>(null);
  const started = useRef(false);
  const today = todayKey();

  useEffect(() => {
    if (!ready || save.reportDay === today || lines || started.current) return;
    started.current = true;
    const state = loadState();
    const names = state.nfts.map((n) => n.name).filter(Boolean);
    const report = buildReport(save, state.feeLedger, names, t);
    setLines(report.lines);
    onSeen(today);
    const script = report.script;
    void (async () => {
      let spoken = script;
      try {
        const asked = await liveAsk({
          name: save.pet.name || "Sol",
          vibe: save.pet.vibe,
          stage: stageOf(save.pet),
          emotion: emotionOf(save.pet),
          locale: save.locale,
          charge: save.pet.charge,
          mood: save.pet.mood,
          rest: save.pet.rest,
          shine: save.pet.shine,
          careDays: save.pet.careDays,
          history: [],
          message: script,
          scene: "yard",
          context: script,
        });
        if (asked.ok && asked.text && onlyKnownNumbers(asked.text, script)) spoken = asked.text;
      } catch {
        spoken = script;
      }
      if (!isVoiceOn()) return;
      const clip = await liveSpeak(spoken, save.pet.voice, save.locale);
      if (clip.ok) {
        const played = await playVoiceB64(clip.audio, clip.mime);
        if (played) return;
      }
      speakLocal(spoken, save.locale);
    })();
  }, [ready, save, today, lines, onSeen, t]);

  if (!lines) return null;
  return (
    <section className="mb-3 rounded-lg border border-border bg-surface px-3 py-3" data-testid="daily-report">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">{t("yard.reportTitle")}</h2>
        <button type="button" className="text-xs text-muted" onClick={() => setLines(null)}>
          {t("yard.reportClose")}
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-1 text-sm text-fg">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </section>
  );
}
