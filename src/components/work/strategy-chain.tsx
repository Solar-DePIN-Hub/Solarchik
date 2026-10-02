import { useCallback, useEffect, useState } from "react";
import { useAgents } from "@/lib/agents/store";
import type { AgentNft } from "@/lib/agents/types";
import {
  SALE_LOCK_HOURS,
  SPEC_LANES,
  SPEC_RISKS,
  SPEC_WINDOWS,
  coreExplorerUrl,
  explorerUrl,
  lockLabel,
  saleLockLeftMs,
  specFromStrategy,
  validateSpec,
  verifyPerf,
  type PerfCheck,
  type StrategySpec,
} from "@/lib/agents/strategy-spec";
import type { StrategyInfo } from "@/lib/agents/strategy.server";
import type { MarketItem } from "@/lib/agents/strategy-client";
import { Button } from "@/components/ui/button";

const field =
  "h-10 w-full rounded-md border border-border bg-surface px-2 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent";
const short = (s: string) => (s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
const sol = (lamports: number) => (lamports / 1e9).toFixed(4);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
const when = (ms: number) => new Date(ms).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });
const LANE_UA: Record<string, string> = { crypto: "Крипто", events: "Події", weather: "Погода" };
const RISK_UA: Record<string, string> = { calm: "спокійний", balanced: "збалансований", risky: "ризиковий" };

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 text-accent break-all">
      {children}
    </a>
  );
}

function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

function specSummary(s: StrategySpec): string {
  const lanes = s.lanes.map((l) => LANE_UA[l] ?? l).join("+");
  return `${lanes} · вікна ${s.windows.join("/")} хв · ${RISK_UA[s.risk] ?? s.risk} · ставка ≤ ${s.stakeSol} SOL · коридор ${s.askLo}–${s.askHi} · стоп ${s.stopPct}% · тейк ${s.takePct}%${s.rules ? ` · правила: ${s.rules}` : ""}`;
}

export function Sparkline({ points }: { points: { t: number; cumSol: number }[] }) {
  if (points.length < 2) return <p className="text-xs text-muted">Графік PnL з’явиться після 2 закритих угод.</p>;
  const w = 220;
  const h = 48;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.cumSol).concat(0);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => ((x - x0) / Math.max(1, x1 - x0)) * w;
  const sy = (y: number) => h - ((y - y0) / Math.max(1e-9, y1 - y0)) * h;
  const last = points[points.length - 1].cumSol;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full max-w-[220px]" role="img" aria-label="PnL">
      <line x1={0} x2={w} y1={sy(0)} y2={sy(0)} stroke="currentColor" strokeOpacity={0.2} />
      <polyline fill="none" strokeWidth={2} stroke={last >= 0 ? "#16a34a" : "#dc2626"} points={points.map((p) => `${sx(p.t)},${sy(p.cumSol)}`).join(" ")} />
    </svg>
  );
}

/** Everything a judge needs to check one Strategy NFT: Explorer links, attributes, the records behind APR and a recompute. */
export function StrategyProof({ info }: { info: StrategyInfo }) {
  const now = useNow();
  const [check, setCheck] = useState<PerfCheck | null>(null);
  const [open, setOpen] = useState(false);
  const c = info.chain;
  const p = info.perf;
  const left = c ? saleLockLeftMs(c.unlockSec, now) : 0;
  const trades = info.records.map((r) => ({ openedMs: r.openedMs, closedMs: r.closedMs, stakeLamports: r.stakeLamports, pnlLamports: r.pnlLamports }));
  return (
    <div className="rounded-md border border-border bg-bg p-3 grid gap-2 text-xs min-w-0" data-testid="strategy-proof">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Ext href={explorerUrl("address", info.asset)}>Explorer (devnet): NFT {short(info.asset)}</Ext>
        <Ext href={coreExplorerUrl(info.asset)}>Атрибути Core (devnet)</Ext>
        <Ext href={explorerUrl("address", info.owner)}>Власник {short(info.owner)}</Ext>
      </div>
      {c ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">Стратегія</dt>
          <dd className="break-words">v{c.version} · {specSummary(c.spec)}</dd>
          <dt className="text-muted">Хеш (sh)</dt>
          <dd className="font-mono break-all">
            {c.hash} {c.hashOk ? "✓ збігається з параметрами" : "✗ НЕ збігається"}
          </dd>
          <dt className="text-muted">Змінено</dt>
          <dd>{when(c.changedSec * 1000)}</dd>
          <dt className="text-muted">Продаж з</dt>
          <dd>
            {when(c.unlockSec * 1000)} · {left > 0 ? `замок ${lockLabel(left)}` : "відкрито"} · {info.frozen ? "заморожено сервером на ланцюгу" : "не заморожено"}
          </dd>
          <dt className="text-muted">APR</dt>
          <dd>
            7д {pct(p?.apr7)} · 30д {pct(p?.apr30)} · від зміни {pct(p?.aprSince)}
          </dd>
          <dt className="text-muted">Результат</dt>
          <dd>
            угод {p?.trades ?? 0} · виграш {pct(p?.winRatePct)} · PnL {p ? p.realizedSol.toFixed(5) : "0"} SOL
          </dd>
          <dt className="text-muted">Записано</dt>
          <dd>
            {p?.writtenSec ? when(p.writtenSec * 1000) : "ще ні"}
            {info.perfWrite ? (
              <>
                {" · "}
                <Ext href={explorerUrl("tx", info.perfWrite.sig)}>tx результатів {short(info.perfWrite.sig)}</Ext>
              </>
            ) : null}
          </dd>
        </dl>
      ) : (
        <p className="text-muted">У цьому NFT ще немає стратегії на ланцюгу (або атрибути пише не сервер).</p>
      )}
      {info.versions.some((v) => v.sig) ? (
        <p className="break-words">
          Зміни стратегії:{" "}
          {info.versions
            .filter((v) => v.sig)
            .map((v) => (
              <span key={v.version} className="mr-2">
                <Ext href={explorerUrl("tx", v.sig as string)}>v{v.version}</Ext>
              </span>
            ))}
        </p>
      ) : null}
      {info.sales.length ? (
        <p className="break-words">
          Продажі:{" "}
          {info.sales.map((s) => (
            <span key={s.sig} className="mr-2">
              <Ext href={explorerUrl("tx", s.sig)}>{sol(s.priceLamports)} SOL</Ext>
            </span>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="verify-apr"
          disabled={!c || !p}
          onClick={() => c && p && setCheck(verifyPerf(trades, c.changedSec, p))}
        >
          Перевірити APR
        </Button>
        <button type="button" className="underline text-muted" onClick={() => setOpen((v) => !v)}>
          {open ? "Сховати угоди" : `Угоди за APR (${info.records.length})`}
        </button>
      </div>
      {check ? (
        <div className={check.ok ? "rounded border border-green-600/40 p-2" : "rounded border border-red-600/50 p-2"} data-testid="verify-result">
          {check.ok ? "✓ Збігається: " : "✗ Не збігається: "}
          перераховано в браузері з {check.recomputed.trades} угод на момент запису ({when(check.asOfMs)}): APR {pct(check.recomputed.aprSince)}, 7д {pct(check.recomputed.apr7)}, 30д{" "}
          {pct(check.recomputed.apr30)}, PnL {check.recomputed.realizedSol.toFixed(5)} SOL.
          {check.mismatches.length ? ` Розбіжності: ${check.mismatches.join("; ")}.` : ""}
          {check.newer ? ` Ще ${check.newer} нових угод чекають наступного запису.` : ""}
          <span className="block text-muted mt-1">Формула: PnL / найбільша ставка × 365 / днів × 100; вікно від max(зараз − 7/30д, зміни), щонайменше 1 день; лише угоди, відкриті після зміни.</span>
        </div>
      ) : null}
      {open ? (
        <div className="grid gap-1">
          <p className="rounded bg-amber-500/10 border border-amber-500/40 p-2" data-testid="simulated-label">
            Симуляція: ці угоди агент робить у браузері, SOL на ставку не рухається. Сервер сам читає ціну Polymarket на вході й виході та час. Справжні транзакції тут: запис
            стратегії й результатів у NFT, комісії Free та продажі.
          </p>
          <ul className="grid gap-1 max-h-60 overflow-y-auto">
            {info.records.map((r) => (
              <li key={r.id} className="font-mono break-all">
                {when(r.closedMs)} · {r.book} · {r.side} · {sol(r.stakeLamports)} SOL · {r.entryPx.toFixed(3)}→{r.exitPx?.toFixed(3) ?? "?"} · PnL {sol(r.pnlLamports)} · id {short(r.id)}
                {r.feeSigs.map((s) => (
                  <span key={s}>
                    {" · "}
                    <Ext href={explorerUrl("tx", s)}>комісія {short(s)}</Ext>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function useStrategyInfo(asset: string) {
  const [info, setInfo] = useState<StrategyInfo | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const { readStrategyInfo } = await import("@/lib/agents/strategy-client");
    const r = await readStrategyInfo(asset).catch((e) => ({ ok: false as const, reason: e instanceof Error ? e.message : "помилка" }));
    if (r.ok) {
      setInfo(r);
      setErr("");
    } else setErr(r.reason);
  }, [asset]);
  useEffect(() => {
    void load();
  }, [load]);
  return { info, err, reload: load };
}

/** Strategy NFT editor: the strategy lives in Core Attributes, written by the server after validation; a change locks sale for 240 h. */
export function ChainStrategyPanel({ nft }: { nft: AgentNft }) {
  const { info, err, reload } = useStrategyInfo(nft.asset);
  const refreshAsset = useAgents((s) => s.refreshAsset);
  const now = useNow();
  const base = info?.chain?.spec ?? nft.chainSpec?.spec ?? specFromStrategy({ ...nft.strategy.prediction, risk: nft.strategy.prediction.risk ?? nft.brief?.risk });
  const [draft, setDraft] = useState<StrategySpec>(base);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [price, setPrice] = useState("0.05");
  const baseKey = JSON.stringify(base);
  useEffect(() => {
    if (!dirty) setDraft(JSON.parse(baseKey));
  }, [baseKey, dirty]);
  const checked = validateSpec(draft);
  const patch = (p: Partial<StrategySpec>) => {
    setDirty(true);
    setDraft((d) => ({ ...d, ...p }));
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const left = info?.chain ? saleLockLeftMs(info.chain.unlockSec, now) : 0;
  const listed = info?.listing && (info.listing.status === "active" || info.listing.status === "pending");
  async function run(label: string, fn: () => Promise<{ ok: boolean; reason?: string; sig?: string }>) {
    setBusy(label);
    setMsg("");
    try {
      const r = await fn();
      setMsg(r.ok ? `${label}: готово${r.sig ? ` · ${r.sig.slice(0, 8)}…` : ""}` : (r.reason ?? "Не вийшло."));
      if (r.ok) setDirty(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Не вийшло.");
    } finally {
      setBusy("");
      await reload();
      await refreshAsset(nft.asset);
    }
  }
  const num = (v: string) => Number(v.replace(",", "."));
  return (
    <section className="rounded-xl border border-border bg-elevated p-4 grid gap-3 min-w-0" data-testid="chain-strategy">
      <div>
        <h3 className="text-sm font-medium">Strategy NFT · стратегія на ланцюгу (devnet)</h3>
        <p className="mt-1 text-xs text-muted leading-normal">
          Параметри й хеш живуть в атрибутах Core цього NFT. Сервер перевіряє правила й підписує запис; угоди поза стратегією сервер не приймає. Кожна зміна
          ставить замок продажу на {SALE_LOCK_HOURS} год (FreezeDelegate на ланцюгу).
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <fieldset className="grid gap-1">
          <legend className="text-muted">Смуги</legend>
          <div className="flex gap-3">
            {SPEC_LANES.map((l) => (
              <label key={l} className="flex items-center gap-1">
                <input type="checkbox" checked={draft.lanes.includes(l)} onChange={() => patch({ lanes: toggle(draft.lanes, l) })} />
                {LANE_UA[l]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-1">
          <legend className="text-muted">Вікна, хв</legend>
          <div className="flex gap-3">
            {SPEC_WINDOWS.map((w) => (
              <label key={w} className="flex items-center gap-1">
                <input type="checkbox" checked={draft.windows.includes(w)} onChange={() => patch({ windows: toggle(draft.windows, w).sort((a, b) => a - b) })} />
                {w}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-1">
          <span className="text-muted">Ризик</span>
          <select className={field} value={draft.risk} onChange={(e) => patch({ risk: e.target.value as StrategySpec["risk"] })}>
            {SPEC_RISKS.map((r) => (
              <option key={r} value={r}>
                {RISK_UA[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted">Ставка, SOL (0.005–0.02)</span>
          <input className={field} inputMode="decimal" value={draft.stakeSol} onChange={(e) => patch({ stakeSol: num(e.target.value) })} />
        </label>
        <label className="grid gap-1">
          <span className="text-muted">Коридор ціни від</span>
          <input className={field} inputMode="decimal" value={draft.askLo} onChange={(e) => patch({ askLo: num(e.target.value) })} />
        </label>
        <label className="grid gap-1">
          <span className="text-muted">Коридор ціни до</span>
          <input className={field} inputMode="decimal" value={draft.askHi} onChange={(e) => patch({ askHi: num(e.target.value) })} />
        </label>
        <label className="grid gap-1">
          <span className="text-muted">Перевага, bps (0–500)</span>
          <input className={field} inputMode="numeric" value={draft.edgeBps} onChange={(e) => patch({ edgeBps: num(e.target.value) })} />
        </label>
        <label className="grid gap-1">
          <span className="text-muted">Стоп-лосс, % (1–100)</span>
          <input className={field} inputMode="numeric" value={draft.stopPct} onChange={(e) => patch({ stopPct: num(e.target.value) })} />
        </label>
        <label className="grid gap-1">
          <span className="text-muted">Тейк-профіт, % (1–500)</span>
          <input className={field} inputMode="numeric" value={draft.takePct} onChange={(e) => patch({ takePct: num(e.target.value) })} />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-muted">Правила (до 6, через «;»): allow|deny [yes|no] if price|hour|window|lane|stake &lt; &gt; = значення</span>
          <textarea
            className="min-h-16 w-full rounded-md border border-border bg-surface p-2 text-sm font-mono"
            maxLength={160}
            value={draft.rules}
            placeholder="deny if hour < 6; allow yes if price < 0.6"
            onChange={(e) => patch({ rules: e.target.value })}
          />
        </label>
      </div>
      {!checked.ok ? (
        <ul className="text-xs text-red-600 list-disc pl-4" data-testid="spec-errors">
          {checked.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!checked.ok || !!busy || !!listed} data-testid="save-chain-strategy" onClick={() => void run("Стратегію записано", async () => {
          const { saveChainStrategy } = await import("@/lib/agents/strategy-client");
          return saveChainStrategy(nft.asset, draft);
        })}>
          {busy === "Стратегію записано" ? "Пишу…" : "Записати в NFT"}
        </Button>
        {listed ? (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("Знято з продажу", async () => {
            const { unlistOnChain } = await import("@/lib/agents/strategy-client");
            return unlistOnChain(nft.asset);
          })}>
            Зняти з продажу
          </Button>
        ) : (
          <>
            <input className={`${field} w-24`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Ціна, SOL" />
            <Button size="sm" variant="ghost" disabled={!!busy || !info?.chain || left > 0} data-testid="list-chain" onClick={() => void run("Виставлено", async () => {
              const { listOnChain } = await import("@/lib/agents/strategy-client");
              return listOnChain(nft.asset, num(price));
            })}>
              {left > 0 ? `Продаж через ${lockLabel(left)}` : "Виставити, SOL"}
            </Button>
          </>
        )}
      </div>
      {msg ? <p className="text-xs break-words" data-testid="chain-msg">{msg}</p> : null}
      {err ? <p className="text-xs text-muted break-words">{err}</p> : null}
      {info ? <StrategyProof info={info} /> : null}
    </section>
  );
}

/** Marketplace for Strategy NFTs: devnet SOL, server escrow (freeze + transfer delegate), 5% royalty, atomic buy. */
export function StrategyMarket() {
  const wallet = useAgents((s) => s.wallet);
  const refreshAsset = useAgents((s) => s.refreshAsset);
  const [items, setItems] = useState<MarketItem[] | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [openAsset, setOpenAsset] = useState("");
  const load = useCallback(async () => {
    const { readMarket } = await import("@/lib/agents/strategy-client");
    setItems(await readMarket().catch(() => []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (items == null) return <p className="text-sm text-muted">Читаю ринок…</p>;
  return (
    <div className="grid gap-3" data-testid="strategy-market">
      <p className="text-xs text-muted leading-normal">
        Ринок Strategy NFT на devnet. Ціна в devnet SOL; 95% продавцю, 5% роялті в скарбницю — одна атомарна транзакція. NFT на час лістингу заморожений сервером, тож
        продавець не може його вивести. Кожну картку можна перевірити в Explorer і кнопкою «Перевірити APR».
      </p>
      {msg ? <p className="text-xs break-words">{msg}</p> : null}
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">Лістингів немає. Свій NFT можна виставити через {SALE_LOCK_HOURS} год після останньої зміни стратегії.</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((it) => {
            const mine = wallet?.pubkey === it.owner;
            return (
              <li key={it.asset} className="rounded-xl border border-border bg-surface p-4 grid gap-2 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium">{it.name}</h3>
                    <p className="text-xs text-muted break-words">{it.chain ? specSummary(it.chain.spec) : "—"}</p>
                  </div>
                  <div className="font-mono tabular-nums text-sm">{sol(it.priceLamports)} SOL</div>
                </div>
                <p className="text-xs">
                  APR від зміни {pct(it.perf?.aprSince)} · 7д {pct(it.perf?.apr7)} · угод {it.perf?.trades ?? 0} · PnL {it.perf ? it.perf.realizedSol.toFixed(5) : "0"} SOL ·{" "}
                  <span className="text-amber-700">угоди симульовані</span>
                </p>
                <Sparkline points={it.history} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={mine || !!busy}
                    data-testid={`buy-chain-${it.asset}`}
                    onClick={() =>
                      void (async () => {
                        setBusy(it.asset);
                        setMsg("");
                        const { buyOnChain } = await import("@/lib/agents/strategy-client");
                        const r = await buyOnChain(it.asset, it.priceLamports).catch((e) => ({ ok: false as const, reason: e instanceof Error ? e.message : "помилка" }));
                        setMsg(r.ok ? `Куплено · ${r.sig.slice(0, 8)}…` : r.reason);
                        setBusy("");
                        if (r.ok) await refreshAsset(it.asset);
                        await load();
                      })()
                    }
                  >
                    {mine ? "Твій лістинг" : busy === it.asset ? "Купую…" : "Купити"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpenAsset(openAsset === it.asset ? "" : it.asset)}>
                    {openAsset === it.asset ? "Сховати перевірку" : "Перевірити"}
                  </Button>
                </div>
                {openAsset === it.asset ? <StrategyProof info={it} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Judge onboarding: devnet only, one tap for test SOL (public airdrop, then the server's rate-limited faucet). */
export function JudgeStart() {
  const wallet = useAgents((s) => s.wallet);
  const balance = useAgents((s) => s.sol);
  const solKnown = useAgents((s) => s.solKnown);
  const deposit = useAgents((s) => s.deposit);
  const chainBusy = useAgents((s) => s.chainBusy);
  const notice = useAgents((s) => s.notice);
  return (
    <section className="rounded-xl border border-accent/40 bg-surface p-4 grid gap-2 text-sm" data-testid="judge-start">
      <h3 className="font-medium">Для суддів · лише devnet</h3>
      <p className="text-xs text-muted leading-normal">
        Справжніх грошей тут немає. Гаманець кімнати створюється в браузері автоматично. Одна кнопка дає тестові SOL: спершу публічний кран devnet, а якщо він на ліміті —
        кран сервера (раз на добу на гаманець).
      </p>
      {wallet ? (
        <p className="text-xs break-all">
          Гаманець: <Ext href={explorerUrl("address", wallet.pubkey)}>{wallet.pubkey}</Ext> · {solKnown ? `${balance.toFixed(4)} SOL` : "читаю…"}
        </p>
      ) : null}
      <Button size="sm" disabled={chainBusy} data-testid="judge-faucet" onClick={() => void deposit(1)}>
        Отримати devnet SOL
      </Button>
      {notice ? <p className="text-xs break-words">{notice}</p> : null}
      <ol className="text-xs text-muted list-decimal pl-4 grid gap-0.5">
        <li>Магазин → «Агенти»: візьми Free агента (мінт на devnet).</li>
        <li>Праця → «Strategy NFT»: зміни стратегію й запиши в NFT (замок продажу {SALE_LOCK_HOURS} год стартує знову).</li>
        <li>Магазин → «Ринок»: купи виставлений Strategy NFT; свій можна виставити після замка.</li>
        <li>На кожній картці: посилання Explorer і «Перевірити APR».</li>
      </ol>
    </section>
  );
}
