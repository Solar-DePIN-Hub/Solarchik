import { ACT_TEXT, solOf, tx, SALE_LOCK_H, type ActLang, type ActPlan } from "@/lib/game/sol-act-plan";

/**
 * Sol's confirmation card (web). Shows exactly what will change, the price in SOL and the 240 h
 * sale lock; only the Confirm button runs anything. Blocked plans show why and offer only Cancel.
 */
export function SolActCard({ plan, lang, busy, onConfirm, onCancel }: { plan: ActPlan; lang: ActLang; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const L = ACT_TEXT[lang];
  const price =
    plan.priceLamports == null ? L.local
    : plan.action.type === "set_strategy" ? L.priceStrategy
    : plan.priceLamports === 0 ? L.priceFree
    : tx(lang, "price", { sol: solOf(plan.priceLamports) });
  return (
    <div data-testid="sol-act-card" className="pointer-events-auto mx-auto mb-2 w-full max-w-lg rounded-2xl border border-primary/50 bg-bg/90 p-3 text-sm shadow-lg backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{L.card}</p>
      <p className="mt-1 font-display font-semibold leading-snug" data-testid="sol-act-title">{plan.title}</p>
      {plan.templateName ? <p className="mt-1 text-xs text-muted">{tx(lang, "template", { name: plan.templateName })}</p> : null}
      {plan.changes.length ? (
        <ul className="mt-2 grid gap-0.5 text-xs" data-testid="sol-act-changes">
          {plan.changes.map((c) => (
            <li key={c.key} className="flex flex-wrap gap-x-1">
              <span className="text-muted">{c.label}:</span>
              <span className="line-through opacity-70">{c.from}</span>
              <span>→</span>
              <span className="font-semibold">{c.to}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {plan.blocked ? (
        <p className="mt-2 text-xs font-semibold text-danger" data-testid="sol-act-blocked">{plan.blockedText}</p>
      ) : (
        <>
          <p className="mt-2 text-xs font-semibold" data-testid="sol-act-price">{price}</p>
          {plan.locksSale ? <p className="mt-1 text-xs text-amber-500" data-testid="sol-act-lock">{tx(lang, "lock", { h: SALE_LOCK_H })}</p> : null}
          {plan.onChain ? <p className="mt-1 text-xs text-muted">{L.wallet}</p> : null}
        </>
      )}
      <div className="mt-3 flex gap-2">
        {!plan.blocked && (
          <button
            type="button"
            data-testid="sol-act-confirm"
            disabled={busy}
            onClick={onConfirm}
            className="h-10 flex-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-50"
          >
            {busy ? L.working : L.confirm}
          </button>
        )}
        <button
          type="button"
          data-testid="sol-act-cancel"
          disabled={busy}
          onClick={onCancel}
          className="h-10 flex-1 rounded-full border border-border bg-elevated px-4 text-sm font-semibold text-fg disabled:opacity-50"
        >
          {L.cancel}
        </button>
      </div>
    </div>
  );
}
