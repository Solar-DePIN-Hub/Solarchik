import { useEffect, useMemo, useState } from "react";
import { CLASS_META, DEFAULT_BEHAVIOR, aprLabel, kindsForClass, riskCopy, workLabel } from "@/lib/agents/classes";
import { strategyNeedMin } from "@/lib/agents/engine";
import { useAgents } from "@/lib/agents/store";
import type { AgentFill, AgentKind, AgentNft, RiskMode } from "@/lib/agents/types";
import { cn, formatSol } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StrategyDesk } from "./strategy-desk";
import { IconPulse, IconSwap } from "./icons";

const SIDE: Record<AgentFill["side"], string> = {
  yes: "Так",
  no: "Ні",
  long: "Лонг",
  short: "Шорт",
  buy: "Купівля",
  sell: "Продаж",
};

type RangeId = "7" | "30" | "90" | "all";

const RANGES: { id: RangeId; label: string }[] = [
  { id: "7", label: "7д" },
  { id: "30", label: "30д" },
  { id: "90", label: "90д" },
  { id: "all", label: "Усе" },
];

export function AgentConsole({ owned }: { owned: AgentNft[] }) {
  const focusAsset = useAgents((s) => s.focusAsset);
  const setFocus = useAgents((s) => s.setFocus);
  const fills = useAgents((s) => s.fills);
  const agents = useAgents((s) => s.agents);
  const working = useAgents((s) => s.working);
  const runAsset = useAgents((s) => s.runAsset);
  const pauseAsset = useAgents((s) => s.pauseAsset);
  const withdrawLocked = useAgents((s) => s.withdrawLocked);
  const coachAsset = useAgents((s) => s.coachAsset);
  const aiBusy = useAgents((s) => s.aiBusy);
  const chainBusy = useAgents((s) => s.chainBusy);
  const sol = useAgents((s) => s.sol);
  const solKnown = useAgents((s) => s.solKnown);
  const setTab = useAgents((s) => s.setTab);
  const [pane, setPane] = useState<"overview" | "profile">("overview");
  const [range, setRange] = useState<RangeId>("7");
  const [guidance, setGuidance] = useState("");
  const [chat, setChat] = useState<{ id: string; who: "you" | "agent"; text: string }[]>([]);
  const pushChat = (who: "you" | "agent", text: string) => {
    setChat((rows) => [...rows, { id: `${who}-${Date.now()}`, who, text }].slice(-12));
  };

  const selected = owned.find((n) => n.asset === focusAsset) ?? owned[0];
  if (!selected) return null;

  const mine = fills.filter((f) => f.asset === selected.asset);
  const driving = (["prediction", "dex"] as AgentKind[]).filter(
    (k) => agents[k].sourceAsset === selected.asset && agents[k].status === "working",
  );
  const live = driving.length > 0;
  const runtime = driving[0] ? agents[driving[0]] : null;
  const risk: RiskMode = selected.brief?.risk ?? "balanced";
  const behavior = selected.brief?.behavior || DEFAULT_BEHAVIOR;
  const copy = riskCopy(risk);
  const locked = selected.openBook?.stake ?? 0;
  const available = solKnown ? sol : 0;
  const used = mine.reduce((sum, f) => sum + f.amount, 0);
  const profit = mine.reduce((sum, f) => sum + (f.status === "settled" ? f.pnl : 0), 0);
  const resolved = selected.metrics.wins + selected.metrics.losses;
  const accuracy = resolved > 0 ? (selected.metrics.wins / resolved) * 100 : null;
  const roi = used > 0 ? (profit / used) * 100 : 0;
  const preds = mine.filter((f) => f.kind === "prediction").length;
  const need = Math.max(...kindsForClass(selected.classId).map((k) => strategyNeedMin(k, selected.strategy)));
  const clock = runtime?.clockMin ?? 0;
  const streak = winStreak(mine);

  const banner = selected.openBook
    ? "Ставка в ринку. Агент чекає кінець вікна, щоб закрити її."
    : live
      ? profit > 0
        ? "Агент закрив вікно в плюс і стоїть до наступного."
        : "Агент у черзі до наступного вікна."
      : working
        ? "Цей токен зараз не веде зміну."
        : "Агент на паузі.";

  return (
    <section data-testid="agent-desk" className="grid min-w-0 items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Мої агенти</h2>
          <span className="text-xs text-muted">{live ? "працює" : "пауза"}</span>
        </div>
        <div className="flex min-w-0 gap-2 overflow-x-auto lg:flex-col">
          {owned.map((n) => {
            const on = (["prediction", "dex"] as AgentKind[]).some(
              (k) => agents[k].sourceAsset === n.asset && agents[k].status === "working",
            );
            const active = n.asset === selected.asset;
            return (
              <button
                key={n.asset}
                type="button"
                onClick={() => setFocus(n.asset)}
                className={cn(
                  "flex h-11 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm lg:w-full",
                  active ? "bg-elevated text-fg" : "text-muted",
                )}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", on ? "bg-ok" : "bg-border")} />
                <span className="truncate">{n.name}</span>
              </button>
            );
          })}
        </div>
        <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setTab("store")}>
          Додати агента
        </Button>
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex justify-center">
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-elevated p-1">
            {(
              [
                ["overview", "Огляд"],
                ["profile", "Профіль"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPane(id)}
                className={cn(
                  "h-10 rounded-sm px-4 text-sm font-medium",
                  pane === id ? "bg-surface text-fg" : "text-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-border bg-elevated text-accent">
              {selected.classId === 2 ? <IconSwap size={22} /> : <IconPulse size={22} />}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium">{selected.name}</h3>
              <p className="text-xs text-muted">{CLASS_META[selected.classId].title}</p>
            </div>
            {live ? (
              <Button variant="ghost" size="sm" onClick={() => pauseAsset(selected.asset)}>
                Пауза
              </Button>
            ) : (
              <Button size="sm" onClick={() => runAsset(selected.asset)}>
                Запустити
              </Button>
            )}
          </div>
          <p className="mt-3 rounded-md border border-border bg-elevated px-3 py-2 text-sm leading-snug text-ok">
            {banner}
          </p>
        </div>

        {pane === "overview" ? (
          <>
            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-sm font-medium">Перформанс</h3>
              <div className="mt-3 grid min-w-0 grid-cols-2 gap-4">
                <Stat label="Усього в угодах" value={`${formatSol(used)} SOL`} />
                <Stat label="Профіт" value={`${profit >= 0 ? "+" : ""}${formatSol(profit)} SOL`} />
                <Stat label="У ринках" value={`${formatSol(locked)} SOL`} />
                <Stat label="Вільно" value={solKnown ? `${formatSol(available)} SOL` : "…"} />
                <Stat label="Прогнозів" value={String(preds)} />
                <Stat label="Точність" value={accuracy == null ? "ще нема" : `${accuracy.toLocaleString("uk-UA", { maximumFractionDigits: 0 })}%`} />
                <Stat label="Робота" value={workLabel(selected)} />
                <Stat label="APR" value={aprLabel(selected)} />
              </div>
              <p className="mt-3 text-xs text-muted">
                ROI {roi.toLocaleString("uk-UA", { maximumFractionDigits: 1 })}% · вікно {Math.floor(clock)}/{Math.round(need)} хв
              </p>
              <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-elevated px-3 py-3">
                <p className="text-sm leading-snug text-muted">{behavior}</p>
                <button
                  type="button"
                  className="h-11 shrink-0 rounded-md border border-border bg-surface px-3 text-sm text-fg"
                  onClick={() => document.getElementById("agent-goal")?.focus()}
                >
                  Оновити
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Епоха</h3>
                <span className="text-xs text-muted">серія {streak}</span>
              </div>
              <p className="mt-2 font-mono text-2xl tabular-nums">
                <EpochClock from={runtime?.epochStartedAt ?? null} running={live} />
              </p>
              <p className="mt-1 text-xs text-muted">Час поточного вікна. Ставка сидить у ринку, доки вікно не закриється.</p>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Профіт</h3>
                <div className="flex gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRange(r.id)}
                      className={cn(
                        "h-10 rounded-sm px-2 text-xs",
                        range === r.id ? "bg-elevated text-fg" : "text-muted",
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted">Кожен відрізок починається з нуля і показує рух PnL закритих угод.</p>
              <ProfitChart fills={mine} range={range} />
            </div>

            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-sm font-medium">Історія угод</h3>
              {mine.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Ще тихо. Запусти агента — сюди ляжуть ринки, сторона і сума.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {[...mine].reverse().slice(0, 12).map((f) => (
                    <li key={f.id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3">
                      <p className="text-sm leading-snug">{f.market}</p>
                      <p className="text-sm text-muted">{SIDE[f.side]}</p>
                      <p className="font-mono text-xs tabular-nums text-fg">
                        {f.status === "open" ? "У ринку" : f.status === "withdrawn" ? "Виведено" : "Закрито"}{" "}
                        {formatSol(f.amount)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-sm font-medium">Стратегія</h3>
              <p className="mt-2 font-medium">{copy.title}</p>
              <p className="mt-1 text-sm leading-normal text-muted">{copy.body}</p>
            </div>

            <form
              className="rounded-xl border border-border bg-surface p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const text = guidance.trim();
                if (!text || aiBusy) return;
                pushChat("you", text);
                setGuidance("");
                void coachAsset(selected.asset, text)
                  .then((res) => {
                    pushChat("agent", res.ok ? res.reply : res.error);
                  })
                  .catch(() => pushChat("agent", "Агент не відповів. Спробуй ще раз."));
              }}
            >
              <h3 className="text-sm font-medium">Чат</h3>
              <p className="mt-1 text-xs text-muted leading-normal">
                Напиши звичайною мовою. Агент міняє смуги, ризик, вікна крипти (5 хв, 15 хв, 1 год, 4 год) і коридор ask. Ставить, якщо прямо попросиш.
              </p>
              {chat.length > 0 ? (
                <ul className="mt-3 grid gap-2">
                  {chat.map((row) => (
                    <li key={row.id} className={row.who === "you" ? "text-sm text-fg" : "text-sm text-muted"}>
                      <span className="text-xs uppercase tracking-wide">{row.who === "you" ? "Ти" : "Агент"}</span>
                      <p className="mt-0.5 leading-snug">{row.text}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex gap-2">
                <input
                  id="agent-goal"
                  data-testid="agent-goal"
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                  placeholder="Напиши агенту"
                  maxLength={400}
                  className="h-12 min-w-0 flex-1 rounded-md border border-border bg-elevated px-3 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent"
                />
                <Button type="submit" disabled={aiBusy || !guidance.trim()} data-testid="agent-goal-send">
                  {aiBusy ? "…" : "Надіслати"}
                </Button>
              </div>
            </form>

            <div id="withdraw-locked" className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-sm font-medium">Кошти в ринках</h3>
              <p className="mt-1 text-sm text-muted">
                {locked > 0
                  ? `Заблоковано ${formatSol(locked)} SOL до кінця вікна.`
                  : "Зараз у відкритих ринках порожньо."}
              </p>
              <Button
                variant="ghost"
                className="mt-3 w-full"
                disabled={locked <= 0 || chainBusy}
                onClick={() => void withdrawLocked(selected.asset)}
              >
                Вивести з ринку
              </Button>
            </div>
          </>
        ) : (
          <StrategyDesk nft={selected} />
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg tabular-nums leading-tight break-words">{value}</div>
    </div>
  );
}

function winStreak(fills: AgentFill[]): number {
  let n = 0;
  for (const f of [...fills].reverse()) {
    if (f.status === "open") continue;
    if (f.status !== "settled" || f.pnl <= 0) break;
    n += 1;
  }
  return n;
}

function EpochClock({ from, running }: { from: number | null; running: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !from) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, from]);
  const elapsed = from && running ? Math.max(0, Math.floor((now - from) / 1000)) : 0;
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <>
      {h}:{pad(m)}:{pad(s)}
    </>
  );
}

type Point = { label: string; pnl: number };

function buildSeries(fills: AgentFill[], range: RangeId): Point[] {
  const now = Date.now();
  const days = range === "7" ? 7 : range === "30" ? 30 : range === "90" ? 90 : 0;
  const settled = fills
    .filter((f) => f.status === "settled")
    .sort((a, b) => a.at - b.at);
  const start =
    days === 0
      ? startOfDay(settled[0]?.at ?? now - 6 * 86400000)
      : startOfDay(now - (days - 1) * 86400000);
  const end = startOfDay(now);
  const points: Point[] = [];
  let cursor = 0;
  let cum = 0;
  for (let t = start; t <= end; t += 86400000) {
    const next = t + 86400000;
    while (cursor < settled.length && settled[cursor].at < next) {
      if (settled[cursor].at >= start) cum += settled[cursor].pnl;
      cursor += 1;
    }
    points.push({
      label: new Date(t).toLocaleDateString("uk-UA", { day: "numeric", month: "short" }),
      pnl: Number(cum.toFixed(4)),
    });
  }
  return points;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function ProfitChart({ fills, range }: { fills: AgentFill[]; range: RangeId }) {
  const points = useMemo(() => buildSeries(fills, range), [fills, range]);
  const [charts, setCharts] = useState<typeof import("recharts") | null>(null);
  useEffect(() => {
    let live = true;
    void import("recharts")
      .then((mod) => {
        if (live) setCharts(mod);
      })
      .catch(() => {
        /* chart chunk offline: keep the placeholder */
      });
    return () => {
      live = false;
    };
  }, []);
  if (!charts) return <div className="mt-3 h-48 rounded-md bg-elevated" />;
  const { ResponsiveContainer, LineChart, Line, XAxis, YAxis } = charts;
  const step = points.length > 10 ? Math.ceil(points.length / 6) : 0;
  return (
    <div className="mt-3 h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" interval={step} tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            width={48}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatSol(v)}
          />
          <Line type="monotone" dataKey="pnl" stroke="var(--color-accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
