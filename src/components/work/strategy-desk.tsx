import { useEffect, useState, type ReactNode } from "react";
import { BTC_WINDOWS, CLASS_META, eventsDaysOf, kindsForClass, laneEnabledOn, lanesForStrategy, workLabel, aprLabel } from "@/lib/agents/classes";
import { useAgents } from "@/lib/agents/store";
import { ARB_TREASURY } from "@/lib/game/pay";
import { readTitanKey, writeTitanKey } from "@/lib/agents/titan-key";
import type { AgentNft, PredLane, StrategyBundle } from "@/lib/agents/types";
import { Button } from "@/components/ui/button";

const field =
  "h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent";

const ARB_PRESETS: { name: string; side: StrategyBundle["dex"]["side"]; slippageBps: number; dcaAmountSol: number; dcaIntervalSec: number }[] = [
  { name: "A · Backpack дешевше", side: "sell", slippageBps: 10, dcaAmountSol: 0.1, dcaIntervalSec: 60 },
  { name: "B · Titan дешевше", side: "buy", slippageBps: 10, dcaAmountSol: 0.1, dcaIntervalSec: 60 },
  { name: "Обидва боки", side: "both", slippageBps: 15, dcaAmountSol: 0.1, dcaIntervalSec: 60 },
];

const LANE_LABEL: Record<PredLane, string> = {
  crypto: "Крипто",
  events: "Події",
  weather: "Погода",
};

export function StrategyDesk({ nft }: { nft: AgentNft }) {
  const saveStrategy = useAgents((s) => s.saveStrategy);
  const fundArbDesk = useAgents((s) => s.fundArbDesk);
  const claimArbDeposit = useAgents((s) => s.claimArbDeposit);
  const [depositSig, setDepositSig] = useState("");
  const chainBusy = useAgents((s) => s.chainBusy);
  const liveTrading = useAgents((s) => s.liveTrading);
  const credit = useAgents((s) => s.arbCredit[nft.asset] ?? 0);
  const mintCollection = useAgents((s) => s.mintCollection);
  const reissueAgent = useAgents((s) => s.reissueAgent);
  const [proSig, setProSig] = useState("");
  const legacy = Boolean(mintCollection) && nft.coreCollection !== mintCollection && nft.asset.length >= 32;
  const notes = useAgents((s) => s.laneNotes);
  const kinds = kindsForClass(nft.classId);
  const [titanKey, setTitanKey] = useState("");
  const [draft, setDraft] = useState<StrategyBundle>(nft.strategy);
  const [arbTopup, setArbTopup] = useState("0.005");
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

      {legacy ? (
        <div className="rounded-md border border-border bg-bg p-3 grid gap-2 min-w-0" data-testid="reissue">
          <p className="text-xs text-muted leading-normal break-words">
            Цей NFT старий: він не з колекції сервера, тому арбітраж його не приймає. Перенос створить копію з тими самими
            стратегією і статистикою, а старий спалить. Без підпису оплати буде Free (один на гаманець). Для Pro встав підпис
            оплати 0.1 SOL.
          </p>
          <label className="grid gap-1 text-xs text-muted">
            Підпис оплати Pro (необов'язково)
            <input className={field} value={proSig} onChange={(e) => setProSig(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <Button type="button" variant="ghost" disabled={chainBusy} onClick={() => void reissueAgent(nft.asset, proSig)}>
            Перенести в колекцію сервера
          </Button>
        </div>
      ) : null}

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
          <div className="sm:col-span-2 flex flex-col gap-2">
            <p className="text-xs text-muted">Готові варіанти. Натисни, перевір числа і запиши.</p>
            <div className="flex flex-wrap gap-2">
              {ARB_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="h-11 rounded-md border border-border px-3 text-sm text-fg"
                  onClick={() =>
                    patch("dex", {
                      pair: "SOL/USDC",
                      side: preset.side,
                      slippageBps: preset.slippageBps,
                      dcaAmountSol: preset.dcaAmountSol,
                      dcaIntervalSec: preset.dcaIntervalSec,
                    })
                  }
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
          <Label text="Пара">
            <select className={field} data-testid="strat-pair" value={draft.dex.pair} onChange={(e) => patch("dex", { pair: e.target.value })}>
              {options(draft.dex.pair, ["SOL/USDC"]).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Label>
          <Label text="Пауза, сек">
            <input className={field} data-testid="strat-interval" inputMode="numeric" value={draft.dex.dcaIntervalSec} onChange={(e) => patch("dex", { dcaIntervalSec: Number(e.target.value) })} />
          </Label>
          <Label text="Розмір, SOL">
            <input className={field} data-testid="strat-amount" inputMode="decimal" value={draft.dex.dcaAmountSol} onChange={(e) => patch("dex", { dcaAmountSol: Number(e.target.value) })} />
          </Label>
          <Label text="Поріг чистого краю, bps">
            <input className={field} data-testid="strat-slip" inputMode="numeric" value={draft.dex.slippageBps} onChange={(e) => patch("dex", { slippageBps: Number(e.target.value) })} />
          </Label>
          <Label text="Варіант">
            <select className={field} data-testid="strat-side" value={draft.dex.side} onChange={(e) => patch("dex", { side: e.target.value as StrategyBundle["dex"]["side"] })}>
              <option value="sell">A · купити на Backpack</option>
              <option value="buy">B · купити через Titan</option>
              <option value="both">Обидва боки</option>
            </select>
          </Label>
          <Label text="Ключ Titan">
            <input
              className={field}
              type="password"
              autoComplete="off"
              data-testid="titan-key"
              value={titanKey}
              placeholder="вже на столі, можна замінити"
              onChange={(e) => {
                setTitanKey(e.target.value);
                writeTitanKey(e.target.value);
              }}
            />
          </Label>
          <p className="text-xs text-muted leading-snug sm:col-span-2" data-testid="dex-hint">
            Бот читає ці числа: варіант, поріг, розмір, паузу. Котирування Titan на цей розмір. Чистий край уже без 0,10% Backpack і 5 bps запасу. Ордер не йде, поки каса Backpack порожня.
          </p>
          {liveTrading ? (
          <div className="sm:col-span-2 rounded-md border border-border bg-bg p-3 flex flex-col gap-2">
            <p className="text-xs text-muted leading-snug">Каса арбу. Не секретар.</p>
            <button
              type="button"
              className="h-11 rounded-md border border-border px-3 font-mono text-xs text-fg text-left break-all"
              data-testid="arb-treasury"
              onClick={() => void navigator.clipboard?.writeText(ARB_TREASURY).catch(() => undefined)}
            >
              {ARB_TREASURY}
            </button>
            <p className="text-xs text-fg">Кредит {credit.toFixed(4)} SOL</p>
            <div className="flex flex-wrap gap-2">
              <input
                className={field}
                data-testid="arb-topup"
                inputMode="decimal"
                value={arbTopup}
                onChange={(e) => setArbTopup(e.target.value)}
                aria-label="Сума на касу арбу"
              />
              <Button
                type="button"
                data-testid="arb-fund"
                disabled={chainBusy}
                onClick={() => void fundArbDesk(nft.asset, Number(arbTopup.replace(",", ".")))}
              >
                На касу арбу
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                className={field}
                data-testid="arb-claim-sig"
                value={depositSig}
                onChange={(e) => setDepositSig(e.target.value)}
                placeholder="Підпис старого поповнення"
                aria-label="Підпис старого поповнення"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="ghost"
                data-testid="arb-claim"
                disabled={chainBusy || depositSig.trim().length < 64}
                onClick={() =>
                  void claimArbDeposit(nft.asset, depositSig).then((ok) => {
                    if (ok) setDepositSig("");
                  })
                }
              >
                Зарахувати переказ
              </Button>
            </div>
          </div>
          ) : (
            <p className="sm:col-span-2 text-xs text-muted leading-snug" data-testid="arb-live-off">
              Каса арбу на mainnet вимкнена в цій збірці: арб рахує реальні спреди Backpack/Titan, а угоди лише симулює.
            </p>
          )}
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
