import { useState, type ReactNode } from "react";
import { Download, Flame, Globe, Play, Store, Sun, Trophy, Wallet, Bot, Volume2, VolumeX } from "lucide-react";
import {
  dayMod,
  daySeed,
  todayKey,
  untilMidnightLabel,
  weekStamps,
  type SaveData,
} from "@/lib/game/save";
import { CHAPTERS, shiftName } from "@/lib/game/sim";
import { WEEK_LABELS, type Locale, type TFunc } from "@/lib/game/i18n";
import type { MsgKey } from "@/lib/game/i18n";
import { LOCALE_META } from "@/lib/game/i18n";
import { LangModal } from "./LangModal";
import { FeeWindowCard } from "./FeeWindowCard";
import { DailyReport } from "./DailyReport";
import { isMuted, setMuted, startMusic, stopMusic, unlockAudio } from "@/lib/game/audio";
import { isNativeApp } from "@/lib/game/buddyNet";
import { DayCard } from "./DayCard";

export function Yard({
  save,
  t,
  onRun,
  onSign,
  onFarm,
  onShop,
  onLocale,
  onActivateFee,
  feeNote = "",
  onReportSeen,
  reportReady,
  signBusy = false,
  signError = "",
}: {
  save: SaveData;
  t: TFunc;
  onRun: () => void;
  onSign: () => void;
  onFarm: () => void;
  onShop: () => void;
  onLocale: (id: Locale) => void;
  onActivateFee: () => void;
  feeNote?: string;
  onReportSeen: (day: string) => void;
  reportReady: boolean;
  signBusy?: boolean;
  signError?: string;
}) {
  const today = todayKey();
  const clocked = save.lastClockDay === today;
  const signed = save.signedDay === today;
  const shift = shiftName(daySeed(today));
  const mod = dayMod(today);
  const modLabel = t(`yard.mod.${mod}` as MsgKey);
  const week = weekStamps(save);
  const labels = WEEK_LABELS[save.locale] ?? WEEK_LABELS.en;
  const left = untilMidnightLabel();
  const missions = [
    { id: "clock" as const, label: t("mission.clock"), done: save.missions.clock },
    { id: "suns" as const, label: t("mission.suns"), done: save.missions.suns },
    { id: "combo" as const, label: t("mission.combo"), done: save.missions.combo },
  ];
  const doneCount = missions.filter((m) => m.done).length;
  const urgency = signed
    ? t("banter.signed")
    : clocked
      ? save.streak > 0
        ? `${t("banter.signNow")} ${t("urgency.burns", { n: save.streak, left })}`
        : t("yard.opened")
      : save.streak > 0
        ? `${modLabel}. ${t("urgency.burns", { n: save.streak, left })}`
        : t("urgency.open", { shift, mod: modLabel });

  const [langOpen, setLangOpen] = useState(false);
  const [muted, setMutedUi] = useState(isMuted);
  const pending = !save.pet.setupDone;
  const currentLang = LOCALE_META.find((l) => l.id === save.locale)?.native ?? "English";
  const meterUnit = save.locale === "uk" ? "м" : "m";
  const streakUnit = save.locale === "uk" ? "д" : save.locale === "de" ? "T" : save.locale === "ja" ? "日" : "d";
  const native = isNativeApp();

  return (
    <div className="yard-grid relative overflow-hidden bg-bg text-fg">
      <div className="yard-grid-art">
        <img
          src="/yard-bg.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[30%_42%] lg:object-[34%_center]"
        />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg to-transparent lg:hidden" />
        <div aria-hidden className="absolute inset-y-0 right-0 hidden w-16 bg-gradient-to-l from-bg to-transparent lg:block" />
      </div>

      <div className="yard-grid-desk relative flex flex-col px-4 pb-6 pt-[max(0.5rem,env(safe-area-inset-top))] lg:px-5 lg:py-4 [&>*]:shrink-0">
          <DailyReport save={save} ready={reportReady} t={t} onSeen={onReportSeen} />
          <header className="mb-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div className="min-w-48 flex-1">
              <p className="text-sm font-semibold tracking-widest text-primary">{t("yard.kicker")}</p>
              <h1 className="font-display text-4xl font-semibold tracking-tight text-fg">Solarchik</h1>
              <p className="mt-1 max-w-[34ch] text-sm text-muted">{urgency}</p>
            </div>
            <div className="mb-1 flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  unlockAudio();
                  const next = !isMuted();
                  setMuted(next);
                  setMutedUi(next);
                  if (next) stopMusic();
                  else startMusic();
                }}
                className="grid size-11 place-items-center rounded-md bg-elevated text-fg"
                aria-label={muted ? t("run.unmute") : t("run.mute")}
              >
                {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </button>
              <button
                type="button"
                onClick={() => setLangOpen(true)}
                className="flex h-11 max-w-[9.5rem] items-center gap-1.5 rounded-md bg-elevated px-3 text-sm font-semibold text-fg"
                aria-haspopup="dialog"
                aria-expanded={langOpen}
              >
                <Globe className="size-4 shrink-0 text-primary" />
                <span className="truncate">{currentLang}</span>
              </button>
              {!native && (
              <a
                href="/Solarchik-CLOCK-IN-0.19.51.apk"
                download="Solarchik-CLOCK-IN-0.19.51.apk"
                className="flex h-11 items-center gap-1.5 rounded-md bg-elevated px-3 text-sm font-semibold text-fg"
              >
                <Download className="size-4" />
                APK
              </a>
              )}
            </div>
          </header>

          <section className="rounded-xl bg-surface p-3 shadow-card">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold tracking-wide text-primary">{t("yard.week")}</p>
              <p className="font-display text-sm font-semibold text-fg">{shift}</p>
              <p className="text-xs font-semibold text-muted">{modLabel}</p>
            </div>
            <ol className="grid grid-cols-7 gap-1.5">
              {week.map((d) => (
                <li key={d.key}>
                  <div
                    className={
                      "grid h-11 place-items-center rounded-md text-sm font-semibold " +
                      (d.done
                        ? "bg-primary text-primary-fg"
                        : d.isToday
                          ? "bg-elevated text-primary ring-1 ring-primary"
                          : "bg-bg text-muted")
                    }
                  >
                    {labels[d.i] ?? ""}
                  </div>
                </li>
              ))}
            </ol>
            {(save.runs + 1) % 15 === 0 && (
              <p className="mt-2 text-xs font-semibold tracking-wide text-primary">{t("yard.gate")}</p>
            )}
          </section>

          <FeeWindowCard save={save} t={t} onActivate={onActivateFee} note={feeNote} />

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat icon={<Flame className="size-4" />} label={t("yard.streak")} value={`${save.streak}${streakUnit}`} />
            <Stat icon={<Sun className="size-4" />} label={t("yard.suns")} value={String(save.suns)} />
            <Stat icon={<Trophy className="size-4" />} label={t("yard.best")} value={String(save.bestScore)} />
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {clocked && !signed ? (
              <button
                type="button"
                onClick={onSign}
                disabled={signBusy}
                className="flex h-14 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-display text-lg font-semibold text-primary-fg disabled:opacity-60"
              >
                <Wallet className="size-5" />
                {signBusy ? t("yard.signing") : t("yard.sign")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRun}
              className={
                clocked && !signed
                  ? "flex h-12 items-center justify-center gap-2 rounded-md bg-elevated px-3 text-sm font-semibold text-fg"
                  : "flex h-14 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-display text-lg font-semibold text-primary-fg transition-transform duration-[var(--motion-quick,150ms)] active:scale-[0.98]"
              }
            >
              <Play className={clocked && !signed ? "size-4" : "size-5"} />
              {clocked || signed ? t("yard.playAgain") : t("yard.play")}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onFarm}
                className="flex h-12 items-center justify-center gap-2 rounded-md bg-elevated px-3 text-sm font-semibold text-fg"
              >
                <Bot className="size-4 text-primary" />
                {save.pet.setupDone && save.pet.name ? save.pet.name : t("yard.farm")}
                {pending && (
                  <span className="rounded-sm bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-fg">
                    {t("pet.need")}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={onShop}
                className="flex h-12 items-center justify-center gap-2 rounded-md bg-elevated px-3 text-sm font-semibold text-fg"
              >
                <Store className="size-4 text-primary" />
                {t("yard.shop")}
              </button>
            </div>
            {clocked && !signed ? null : (
            <button
              type="button"
              onClick={onSign}
              disabled={signed || !clocked || signBusy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-semibold text-muted disabled:opacity-50"
            >
              <Wallet className="size-4" />
              {signBusy ? t("yard.signing") : signed ? t("yard.signed") : t("yard.need1200")}
            </button>
            )}
            {signError ? (
              <p className="text-center text-xs text-accent">
                {signError === "need-apk" ? t("yard.needApk") : signError === "wallet" ? t("yard.walletOff") : signError}
              </p>
            ) : (
              <p className="text-center text-xs text-muted">{t("yard.sms")}</p>
            )}
            {signed && save.clockKind === "tx" && save.clockSig ? (
              <a
                className="truncate text-center text-xs text-muted underline"
                href={
                  save.clockCluster === "devnet"
                    ? `https://explorer.solana.com/tx/${save.clockSig}?cluster=devnet`
                    : `https://explorer.solana.com/tx/${save.clockSig}`
                }
                target="_blank"
                rel="noreferrer"
              >
                {save.clockSig.slice(0, 4)}…{save.clockSig.slice(-4)} · {save.clockCluster}
              </a>
            ) : null}
            {signed && save.clockKind === "message" && save.clockSig ? (
              <p className="truncate text-center text-xs text-muted">
                {save.clockSig.slice(0, 4)}…{save.clockSig.slice(-4)} · {save.clockCluster} · {t("yard.sigWord")}
              </p>
            ) : null}
            {signed ? <DayCard save={save} t={t} shift={shift} modLabel={modLabel} /> : null}
          </div>

          <section className="mt-4 rounded-lg bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">{t("yard.roofs")}</h2>
              <span className="text-xs font-semibold tabular-nums text-muted">
                {CHAPTERS.filter((c) => save.bestDistance >= c.meters).length}/{CHAPTERS.length}
              </span>
            </div>
            <ol className="grid grid-cols-5 gap-1.5">
              {CHAPTERS.map((c) => {
                const reached = save.bestDistance >= c.meters;
                const farthest = CHAPTERS.filter((x) => save.bestDistance >= x.meters).at(-1)?.id === c.id;
                return (
                  <li key={c.id} className="min-w-0">
                    <div
                      className={
                        "rounded-md px-1 py-2 text-center " +
                        (farthest ? "bg-primary text-primary-fg" : reached ? "bg-elevated text-fg" : "bg-bg text-muted")
                      }
                    >
                      <span className="block font-display text-[11px] font-semibold leading-tight">
                        {t(`ch.${c.id}` as MsgKey)}
                      </span>
                      <span className={"mt-0.5 block text-[10px] tabular-nums " + (farthest ? "text-primary-fg/80" : "text-muted")}>
                        {c.meters}{meterUnit}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="mt-3 rounded-lg bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">{t("yard.heat")}</h2>
              <span className="text-xs font-semibold tabular-nums text-muted">{doneCount}/3</span>
            </div>
            <ul className="flex flex-wrap gap-2">
              {missions.map((m) => (
                <li
                  key={m.id}
                  className={
                    "rounded-md px-2.5 py-1.5 text-xs font-semibold " + (m.done ? "bg-ok text-bg" : "bg-elevated text-fg")
                  }
                >
                  {m.done ? t("mission.done") : ""}
                  {m.label}
                </li>
              ))}
            </ul>
          </section>

          {!native && (
          <a
            href="/Solarchik-CLOCK-IN-0.19.51.apk"
            download="Solarchik-CLOCK-IN-0.19.51.apk"
            className="mt-3 flex h-12 items-center justify-center gap-2 rounded-md bg-elevated px-5 text-sm font-semibold text-fg"
          >
            <Download className="size-4" />
            {t("yard.apk")}
          </a>
          )}
        </div>

      <LangModal
        open={langOpen}
        locale={save.locale}
        t={t}
        onPick={onLocale}
        onClose={() => setLangOpen(false)}
      />
    </div>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-3 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-muted">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="font-display text-xl font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}
