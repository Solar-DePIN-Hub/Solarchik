import { X } from "lucide-react";
import { LOCALE_META, type Locale, type TFunc } from "@/lib/game/i18n";

export function LangModal({
  open,
  locale,
  t,
  onPick,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  t: TFunc;
  onPick: (id: Locale) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-bg/60 px-4 pb-8 pt-8 backdrop-blur-[3px] sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("lang.title")}
        className="w-full max-w-sm rounded-xl bg-bg p-5 text-fg shadow-card"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold tracking-[0.16em] text-primary">{t("lang.title")}</p>
            <p className="mt-1 text-sm text-muted">{t("lang.hint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-md bg-elevated"
            aria-label={t("lang.close")}
          >
            <X className="size-5" />
          </button>
        </div>
        <ul className="mt-4 flex flex-col gap-1.5">
          {LOCALE_META.map((loc) => {
            const on = locale === loc.id;
            return (
              <li key={loc.id}>
                <button
                  type="button"
                  onClick={() => onPick(loc.id)}
                  className={
                    "flex h-12 w-full items-center justify-between rounded-lg px-4 text-left text-base font-semibold transition-[background-color,color,transform] duration-[var(--motion-fast,250ms)] ease-[var(--ease-smooth-out,cubic-bezier(0.22,1,0.36,1))] active:scale-[0.98] " +
                    (on ? "bg-primary text-primary-fg" : "bg-elevated text-fg")
                  }
                >
                  <span>{loc.native}</span>
                  <span className={"text-xs font-semibold uppercase tracking-wide " + (on ? "text-primary-fg/80" : "text-muted")}>
                    {loc.id}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-lg bg-elevated font-display text-base font-semibold"
        >
          {t("lang.close")}
        </button>
      </div>
    </div>
  );
}
