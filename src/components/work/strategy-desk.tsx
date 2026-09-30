import { useEffect, useState, type ReactNode } from "react";
import { BTC_WINDOWS, CLASS_META, eventsDaysOf, kindsForClass, laneEnabledOn, lanesForStrategy, workLabel, aprLabel } from "@/lib/agents/classes";
import { useAgents } from "@/lib/agents/store";
import { readTitanKey, writeTitanKey } from "@/lib/agents/titan-key";
import type { AgentNft, PredLane, StrategyBundle } from "@/lib/agents/types";
import { Button } from "@/components/ui/button";

const field =
  "h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent";

const LANE_LABEL: Record<PredLane, string> = {
  crypto: "Крипто",
  events: "Події",
  weather: "Погода",
};

export function StrategyDesk({ nft }: { nft: AgentNft }) {
  const saveStrategy = useAgents((s) => s.saveStrategy);
  const notes = useAgents((s) => s.laneNotes);
  const kinds = kindsForClass(nft.classId);
  const [titanKey, setTitanKey] = useState("");
  const [draft, setDraft] = useState<StrategyBundle>(nft.strategy);
  useEffect(() => {
    setTitanKey(readTitanKey());
  }, []);
  const [dirty, setDirty] = useState(false);
  const key = JSON.stringify(nft.strategy);
  const lanes = lanesForStrategy(draft.prediction, nft.classId);

  useEffect(() => {
    if (!dirty) setDraft(nft.strategy);
  }, [key, dirty, nft.strategy]);

  function patch<K extends keyof StrategyBundle>(group: K, next: Partial<StrategyBundle[K]>) {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [group]: { ...prev[group], ...next } }));
  }

  return (
    <form
      className="rounded-xl border border-border bg-elevated p-4 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        saveStrategy(nft.asset, draft);
        setDirty(false);
      }}
    >
      <div>
        <h3 className="text-sm font-medium">Стратегія · {nft.name}</h3>
        <p className="mt-1 text-xs text-muted leading-normal break-words">
          {CLASS_META[nft.classId].title}. Увімкни лише смуги цього NFT. Нових ринків тут немає. Робота {workLabel(nft)}. APR {aprLabel(nft)}.
        </p>
      </div>

      {kinds.includes("prediction") ? (
        <fieldset className="grid gap-3 min-w-0">
          <legend className="text-xs uppercase tracking-wide text-muted mb-1">Смуги</legend>
          {lanes.map((lane) => {
            const on = laneEnabledOn(draft.prediction, lane, nft.classId);
            const last = notes.find((n) => n.lane === lane);
            return (
              <div key={lane} className="rounded-md border border-border bg-bg p-3 min-w-0">
                <button
                  type="button"
                  data-testid={`lane-${lane}`}
                  onClick={() =>
                    patch("prediction", {
                      lanes,
                      laneOn: { ...draft.prediction.laneOn, [lane]: !on },
                    })
                  }
                  className="flex h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <span className="text-sm font-medium text-fg">{LANE_LABEL[lane]}</span>
                  <span className={on ? "text-sm text-fg" : "text-sm text-muted"}>{on ? "увімкнено" : "вимкнено"}</span>
                </button>
                {lane === "crypto" ? (
                  <>
                    <p className="mt-1 text-xs text-muted leading-snug">Вікна, на які ставить крипта. Чат міняє той самий список.</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {BTC_WINDOWS.map((w) => {
                        const on = (draft.prediction.windows ?? [15]).includes(w.min);
                        return (
                          <button
                            key={w.min}
                            type="button"
                            data-testid={`win-${w.min}`}
                            onClick={() => {
                              const cur = draft.prediction.windows ?? [15];
                              const next = on ? cur.filter((n) => n !== w.min) : [...cur, w.min];
                              patch("prediction", { windows: next.length ? next : cur });
                            }}
                            className={
                              on
                                ? "h-11 rounded-md border border-accent bg-surface text-sm text-fg"
                                : "h-11 rounded-md border border-border text-sm text-muted"
                            }
                          >
                            {w.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-muted leading-snug">Коридор ask. Поза ним ордера немає.</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-xs text-muted">
                        від
                        <input
                          className={field}
                          inputMode="decimal"
                          value={draft.prediction.askLo ?? 0.15}
                          onChange={(e) => patch("prediction", { askLo: Number(e.target.value) })}
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-muted">
                        до
                        <input
                          className={field}
                          inputMode="decimal"
                          value={draft.prediction.askHi ?? 0.85}
                          onChange={(e) => patch("prediction", { askHi: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      data-testid="lane-weex"
                      onClick={() => patch("prediction", { weexOn: draft.prediction.weexOn !== true })}
                      className="mt-2 flex h-11 w-full items-center justify-between gap-3 text-left"
                    >
                      <span className="text-sm font-medium text-fg">WEEX BTC</span>
                      <span className={draft.prediction.weexOn ? "text-sm text-fg" : "text-sm text-muted"}>
                        {draft.prediction.weexOn ? "увімкнено" : "вимкнено"}
                      </span>
                    </button>
                    <p className="mt-1 text-xs text-muted leading-snug">
                      Фʼючерс BTCUSDT, плече 2×, один слот. Це не Jupiter і не Polymarket.
                    </p>
                  </>
                ) : null}
                {lane === "events" ? (
                  <div className="mt-2 grid gap-2">
                    <p className="text-xs text-muted leading-snug">Спорт не вмикається. Горизонт резолву:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([1, 2] as const).map((days) => (
                        <button
                          key={days}
                          type="button"
                          data-testid={`events-days-${days}`}
                          onClick={() => patch("prediction", { lanes, eventsDays: days })}
                          className={
                            eventsDaysOf(draft.prediction) === days
                              ? "h-11 rounded-md border border-accent bg-surface text-sm text-fg"
                              : "h-11 rounded-md border border-border text-sm text-muted"
                          }
                        >
                          {days === 1 ? "1 доба" : "2 доби"}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {lane === "weather" ? (
                  <p className="mt-1 text-xs text-muted leading-snug">
                    Лише знятий high зі станції в правилах. Це не вимикається.
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted leading-snug break-words" data-testid={`archive-${lane}`}>
                  {last ? archiveLine(last.at, last.market, last.action, last.pct, last.why, last.orderId, last.status) : "Архів цієї смуги ще порожній."}
                </p>
              </div>
            );
          })}
        </fieldset>
      ) : null}

      {kinds.includes("dex") ? (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="text-xs uppercase tracking-wide text-muted mb-1">Titan × Backpack</legend>
          <Label text="Пара">
            <select className={field} data-testid="strat-pair" value={draft.dex.pair} onChange={(e) => patch("dex", { pair: e.target.value })}>
              {options(draft.dex.pair, ["SOL/USDC", "BTC/USDC"]).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Label>
          <Label text="Інтервал DCA, сек">
            <input className={field} data-testid="strat-interval" inputMode="numeric" value={draft.dex.dcaIntervalSec} onChange={(e) => patch("dex", { dcaIntervalSec: Number(e.target.value) })} />
          </Label>
          <Label text="Сума DCA">
            <input className={field} data-testid="strat-amount" inputMode="decimal" value={draft.dex.dcaAmountSol} onChange={(e) => patch("dex", { dcaAmountSol: Number(e.target.value) })} />
          </Label>
          <Label text="Поріг краю, bps">
            <input className={field} data-testid="strat-slip" inputMode="numeric" value={draft.dex.slippageBps} onChange={(e) => patch("dex", { slippageBps: Number(e.target.value) })} />
          </Label>
          <Label text="Сторона">
            <select className={field} data-testid="strat-side" value={draft.dex.side} onChange={(e) => patch("dex", { side: e.target.value as StrategyBundle["dex"]["side"] })}>
              <option value="both">buy і sell</option>
              <option value="buy">тільки buy</option>
              <option value="sell">тільки sell</option>
            </select>
          </Label>
          <Label text="Ключ Titan">
            <input
              className={field}
              type="password"
              autoComplete="off"
              data-testid="titan-key"
              value={titanKey}
              placeholder="встав, коли прийде"
              onChange={(e) => {
                setTitanKey(e.target.value);
                writeTitanKey(e.target.value);
              }}
            />
          </Label>
          <p className="text-xs text-muted leading-snug sm:col-span-2" data-testid="dex-hint">
            DRY_RUN. Книга Backpack жива. Ончейн — Titan, щойно ключ у полі. Поки ключа немає, цифра з Jupiter і так підписана. Ногу не відправляю.
          </p>
        </fieldset>
      ) : null}

      <Button type="submit" data-testid="strategy-save" disabled={!dirty}>
        Записати стратегію в NFT
      </Button>
    </form>
  );
}

function archiveLine(at: number, market: string, action: string, pct: number | null, why: string, orderId: string | null, status: string | null): string {
  const when = new Date(at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const chance = pct == null ? "" : ` · ${Math.round(pct * 100)}%`;
  const ord = orderId ? ` · ${orderId.slice(0, 10)}…${status ? ` ${status}` : ""}` : "";
  return `${when} · ${market} · ${action}${chance} · ${why}${ord}`;
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {text}
      {children}
    </label>
  );
}

function options(current: string, base: string[]): string[] {
  return base.includes(current) ? base : [current, ...base];
}
