import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Plus, Sun } from "lucide-react";
import type { SaveData } from "@/lib/game/save";
import {
  canBuyGear,
  farmCapHours,
  farmWatts,
  farmYieldPerHour,
  formatRate,
  formatWatts,
  gearCount,
  hasHouse,
  hasInv,
  panelCount,
  pendingSuns,
  storeFill,
  type GearId,
} from "@/lib/game/farm";
import type { TFunc } from "@/lib/game/i18n";
import { RobotPortrait } from "./RobotPortrait";

const ART: Record<GearId, string> = {
  house: "/sprites/farm/cottage.png",
  invS: "/sprites/farm/inverter.png",
  p80: "/sprites/farm/panel.png",
  bat: "/sprites/farm/battery.png",
  p330: "/sprites/farm/panel-gold.png",
  trk: "/sprites/farm/tracker.png",
  invH: "/sprites/farm/inverter-hybrid.png",
  glass: "/sprites/farm/greenhouse.png",
};

export function FarmGame({
  save,
  t,
  onBack,
  onHarvest,
  onBuyGear,
}: {
  save: SaveData;
  t: TFunc;
  onBack: () => void;
  onHarvest: () => void;
  onBuyGear: (id: GearId) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(id);
  }, []);

  const farm = save.farm;
  const house = hasHouse(farm);
  const inverter = hasInv(farm);
  const panels = panelCount(farm);
  const pending = pendingSuns(farm, now);
  const watts = farmWatts(farm);
  const rate = farmYieldPerHour(farm);
  const fill = storeFill(farm, now);
  const capH = farmCapHours(farm);
  const p80 = gearCount(farm, "p80");
  const p330 = gearCount(farm, "p330");
  const bats = gearCount(farm, "bat");
  const hybrid = gearCount(farm, "invH") > 0;
  const glass = gearCount(farm, "glass") > 0;
  const tracker = gearCount(farm, "trk") > 0;

  const tip = !house
    ? t("farm.tapHouse")
    : !inverter
      ? t("farm.needInv")
      : panels === 0
        ? t("farm.needPanels")
        : pending > 0
          ? t("farm.tapSun")
          : t("farm.running");

  const harvest = () => {
    if (pending < 1) return;
    onHarvest();
  };

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-farm-grass text-fg">
      <header className="relative z-20 flex items-center justify-between gap-3 px-4 pt-[max(0.6rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          className="grid size-11 place-items-center rounded-md bg-bg/75"
          aria-label={t("farm.back")}
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="text-center">
          <p className="text-xs font-semibold tracking-[0.16em] text-primary">{t("farm.title")}</p>
          <p className="font-display text-sm font-semibold tabular-nums text-fg">
            {formatWatts(watts)} · {formatRate(rate)}
          </p>
        </div>
        <div className="flex h-11 items-center gap-1.5 rounded-md bg-bg/75 px-3 font-display text-base font-semibold tabular-nums">
          <Sun className="size-4 text-primary" />
          {save.suns}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <img
          src="/sprites/farm/backdrop.jpg"
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[50%_62%]"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-bg/30" />

        <div className="relative mx-auto flex max-w-lg flex-col gap-2 px-4 pb-3 pt-2">
          <p className="rounded-lg bg-bg/80 px-3 py-2 text-sm font-semibold text-fg shadow-card backdrop-blur-[2px]">
            {tip}
          </p>

          <div className="grid grid-cols-3 gap-2">
            <Plot
              title={t("gear.house")}
              why={t("gear.house.blurb")}
              built={house}
              art={ART.house}
              cost={40}
              can={canBuyGear(farm, "house", save.suns)}
              onBuild={() => onBuyGear("house")}
              buildLabel={t("farm.build")}
              step="1"
            />
            <div className="flex min-h-[8.5rem] flex-col items-center justify-end rounded-xl bg-bg/70 px-1.5 py-2 shadow-card backdrop-blur-[2px]">
              {house ? (
                <RobotPortrait id={save.robot} pose="yard" className="h-24 w-full farm-bob" />
              ) : (
                <EmptyHint>{t("farm.tapHouse")}</EmptyHint>
              )}
            </div>
            <Plot
              title={hybrid ? t("gear.invH") : t("gear.invS")}
              why={hybrid ? t("gear.invH.blurb") : t("gear.invS.blurb")}
              built={inverter}
              art={hybrid ? ART.invH : ART.invS}
              cost={80}
              can={canBuyGear(farm, "invS", save.suns)}
              onBuild={() => onBuyGear("invS")}
              buildLabel={t("farm.build")}
              locked={!house}
              step="2"
              extra={
                inverter && !hybrid && canBuyGear(farm, "invH", save.suns) ? (
                  <span className="mt-1 rounded-sm bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-fg">
                    {t("farm.upgrade")} · 600
                  </span>
                ) : null
              }
              extraAction={inverter && !hybrid && canBuyGear(farm, "invH", save.suns) ? () => onBuyGear("invH") : undefined}
              extraEnabled={canBuyGear(farm, "invH", save.suns)}
            />
          </div>

          <div className="rounded-xl bg-bg/80 p-2.5 shadow-card backdrop-blur-[2px]">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div>
                <p className="font-display text-sm font-semibold">
                  <span className="mr-1.5 text-primary">3</span>
                  {t("gear.p80")}
                </p>
                <p className="text-xs text-muted">{t("farm.panelsWhy")}</p>
              </div>
              <p className="text-xs font-semibold tabular-nums text-muted">
                {panels}/14 · {formatWatts(watts)}
              </p>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 14 }).map((_, i) => {
                const filled330 = i >= p80 && i < p80 + p330;
                const filled = i < panels;
                const next = i === panels && canBuyGear(farm, i < 8 ? "p80" : "p330", save.suns);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!filled && !next}
                    onClick={() => {
                      if (filled) harvest();
                      else if (p80 < 8 && canBuyGear(farm, "p80", save.suns)) onBuyGear("p80");
                      else if (canBuyGear(farm, "p330", save.suns)) onBuyGear("p330");
                    }}
                    className={
                      "grid aspect-square place-items-center rounded-md " +
                      (filled ? "bg-elevated" : next ? "farm-pulse bg-elevated/80" : "bg-bg/40")
                    }
                    aria-label={t("gear.p80")}
                  >
                    {filled ? (
                      <img
                        src={filled330 ? ART.p330 : ART.p80}
                        alt=""
                        draggable={false}
                        className="h-[86%] w-[86%] object-contain"
                      />
                    ) : next ? (
                      <Plus className="size-4 text-primary" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Plot
              title={t("gear.bat")}
              why={t("gear.bat.blurb")}
              built={bats > 0}
              art={ART.bat}
              cost={200}
              can={canBuyGear(farm, "bat", save.suns)}
              onBuild={() => onBuyGear("bat")}
              buildLabel={t("farm.build")}
              locked={!inverter}
              count={bats > 0 ? `${bats}/2` : undefined}
              step="4"
              extra={
                bats === 1 && canBuyGear(farm, "bat", save.suns) ? (
                  <span className="mt-1 rounded-sm bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-fg">
                    {t("farm.build")} · 200
                  </span>
                ) : null
              }
              extraAction={bats === 1 && canBuyGear(farm, "bat", save.suns) ? () => onBuyGear("bat") : undefined}
              extraEnabled={canBuyGear(farm, "bat", save.suns)}
            />
            <Plot
              title={t("gear.glass")}
              why={t("gear.glass.blurb")}
              built={glass}
              art={ART.glass}
              cost={420}
              can={canBuyGear(farm, "glass", save.suns)}
              onBuild={() => onBuyGear("glass")}
              buildLabel={t("farm.build")}
              locked={panels === 0}
            />
            <Plot
              title={t("gear.trk")}
              why={t("gear.trk.blurb")}
              built={tracker}
              art={ART.trk}
              cost={360}
              can={canBuyGear(farm, "trk", save.suns)}
              onBuild={() => onBuyGear("trk")}
              buildLabel={t("farm.build")}
              locked={panels === 0}
            />
          </div>
        </div>

        {pending > 0 && (
          <button
            type="button"
            onClick={harvest}
            className="absolute right-4 top-3 z-20 flex size-16 items-center justify-center farm-sun-bob"
            aria-label={t("farm.collect", { n: pending })}
          >
            <img src="/sprites/farm/sun.png" alt="" draggable={false} className="h-full w-full object-contain" />
            <span className="absolute -bottom-1 rounded-sm bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-fg">
              {pending}
            </span>
          </button>
        )}
      </div>

      <div className="relative z-20 border-t border-border bg-bg/95 px-4 pb-[max(0.8rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-[var(--motion-fast,250ms)]"
            style={{ width: `${Math.round(fill * 100)}%` }}
          />
        </div>
        <p className="mb-3 text-xs text-muted">{t("farm.store", { h: capH, n: pending })}</p>
        <button
          type="button"
          onClick={harvest}
          disabled={pending < 1}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-display text-base font-semibold text-primary-fg disabled:bg-elevated disabled:text-muted"
        >
          <Sun className="size-4" />
          {pending < 1 ? t("farm.farming") : t("farm.harvest", { n: pending })}
        </button>
      </div>
    </div>
  );
}

function Plot({
  title,
  why,
  built,
  art,
  cost,
  can,
  onBuild,
  buildLabel,
  locked,
  count,
  step,
  extra,
  extraAction,
  extraEnabled,
}: {
  title: string;
  why: string;
  built: boolean;
  art: string;
  cost: number;
  can: boolean;
  onBuild: () => void;
  buildLabel: string;
  locked?: boolean;
  count?: string;
  step?: string;
  extra?: ReactNode;
  extraAction?: () => void;
  extraEnabled?: boolean;
}) {
  const click = () => {
    if (!built && can) onBuild();
    else if (built && extraAction && extraEnabled) extraAction();
  };
  return (
    <button
      type="button"
      disabled={built ? !extraAction || !extraEnabled : !can}
      onClick={click}
      className={
        "relative flex min-h-[8.5rem] flex-col items-center justify-end rounded-xl bg-bg/80 px-1.5 py-2 text-center shadow-card backdrop-blur-[2px] disabled:opacity-100 " +
        ((!built && can) || (built && extraAction && extraEnabled) ? "farm-pulse" : "")
      }
    >
      {step && (
        <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-sm bg-primary font-display text-[11px] font-semibold text-primary-fg">
          {step}
        </span>
      )}
      {built ? (
        <img src={art} alt="" draggable={false} className="mb-1 h-14 w-auto object-contain farm-pop" />
      ) : (
        <span className="mb-1 grid size-12 place-items-center rounded-lg border border-dashed border-primary/70">
          <Plus className="size-5 text-primary" />
        </span>
      )}
      <span className="font-display text-xs font-semibold leading-tight text-fg">{title}</span>
      <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{why}</span>
      <span className="mt-0.5 text-[11px] font-semibold tabular-nums text-primary">
        {built ? (count ?? "") : locked ? "—" : `${buildLabel} · ${cost}`}
      </span>
      {extra}
    </button>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="px-1 text-center text-[11px] font-semibold leading-snug text-fg/90">{children}</p>;
}
