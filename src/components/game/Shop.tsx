import { ArrowLeft, Sun } from "lucide-react";
import { robotUnlocked, type SaveData } from "@/lib/game/save";
import { ROBOTS, type RobotId } from "@/lib/game/robots";
import type { TFunc } from "@/lib/game/i18n";
import { RobotPortrait } from "./RobotPortrait";

export function Shop({
  save,
  t,
  onBack,
  onRobot,
}: {
  save: SaveData;
  t: TFunc;
  onBack: () => void;
  onRobot: (id: RobotId) => void;
}) {
  return (
    <div className="relative h-dvh w-full overflow-y-auto bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-5 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <header className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="grid size-11 place-items-center rounded-md bg-elevated"
            aria-label={t("shop.back")}
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="text-center">
            <p className="text-xs font-semibold tracking-[0.16em] text-primary">{t("shop.title")}</p>
            <h1 className="font-display text-2xl font-semibold">{t("shop.robots")}</h1>
          </div>
          <div className="flex h-11 items-center gap-1.5 rounded-md bg-surface px-3 font-display text-base font-semibold tabular-nums">
            <Sun className="size-4 text-primary" />
            {save.suns}
          </div>
        </header>

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ROBOTS.map((r) => {
            const open = robotUnlocked(save, r.id);
            const on = save.robot === r.id;
            const afford = save.suns >= r.cost;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={!open && !afford}
                  onClick={() => onRobot(r.id)}
                  className={
                    "flex w-full flex-col rounded-lg p-2 text-left disabled:opacity-40 " +
                    (on ? "bg-primary text-primary-fg" : "bg-surface text-fg")
                  }
                >
                  <RobotPortrait
                    id={r.id}
                    className={"mx-auto h-40 w-full rounded-md " + (on ? "bg-primary-fg/10" : "bg-bg")}
                  />
                  <span className="mt-2 font-display text-sm font-semibold leading-tight">
                    {t(`robot.${r.id}` as import("@/lib/game/i18n").MsgKey)}
                  </span>
                  <span className={"mt-0.5 text-xs tabular-nums " + (on ? "text-primary-fg/80" : "text-muted")}>
                    {open ? (on ? t("shop.on") : t("shop.ready")) : `${t("shop.buy")} · ${r.cost}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
