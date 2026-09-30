import { CLASS_META } from "@/lib/agents/classes";
import { useAgents } from "@/lib/agents/store";
import type { ArbQuote } from "@/lib/agents/engine";
import type { AgentKind, AgentNft, AgentRuntime, StrategyBundle } from "@/lib/agents/types";
import { cn } from "@/lib/utils";
import { IconPulse, IconSwap } from "./icons";

const ICONS: Record<AgentKind, typeof IconPulse> = {
  prediction: IconPulse,
  dex: IconSwap,
};

const TITLES: Record<AgentKind, string> = {
  prediction: "Prediction",
  dex: "Арб",
};

export function AgentBay({ runtime, nft }: { runtime: AgentRuntime; nft: AgentNft | null }) {
  const Icon = ICONS[runtime.kind];
  const live = runtime.status === "working";
  const arb = useAgents((s) => (runtime.kind === "dex" ? s.quote?.arb ?? null : null));
  const bookLine = runtime.kind === "dex" ? arbText(arb) : "";

  return (
    <article
      className={cn(
        "rounded-lg border border-border bg-elevated p-4 flex flex-col gap-3 min-h-44 relative",
        live && "ring-1 ring-ok/50",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-muted shrink-0">
            <Icon size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium leading-tight">{TITLES[runtime.kind]}</h3>
            <p className="text-xs text-muted truncate">
              {nft
                ? `${nft.name} · ${CLASS_META[nft.classId].short}${runtime.brain ? ` · ${runtime.brain}` : ""}`
                : "NFT не підключено"}
            </p>
          </div>
        </div>
        <StatusChip status={runtime.status} />
      </header>

      {nft ? (
        <>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="XP" value={String(nft.metrics.xp)} />
            <Stat label="Jobs" value={String(nft.metrics.jobs)} />
            <Stat
              label="PnL"
              value={`${nft.metrics.pnlSol >= 0 ? "+" : ""}${nft.metrics.pnlSol.toFixed(3)}`}
            />
          </dl>
          <p className="text-xs font-mono text-muted leading-snug">{strategyLine(runtime)}</p>
          {runtime.kind === "dex" ? <p className="text-xs text-fg leading-snug">{live && runtime.lastLine ? runtime.lastLine : bookLine}</p> : null}
          {live && runtime.kind !== "dex" && runtime.lastLine ? <p className="text-xs text-fg leading-snug">{runtime.lastLine}</p> : null}
          <p className="text-xs text-muted">{runtime.kind === "dex" ? "DRY_RUN · угоду не відправляю" : "Ончейн · тестовий SOL"}</p>
        </>
      ) : runtime.kind === "dex" ? (
        <p className="mt-auto text-xs text-fg leading-snug">{bookLine}</p>
      ) : (
        <p className="mt-auto text-xs text-muted leading-snug">{runtime.lastLine}</p>
      )}
    </article>
  );
}

function arbText(book: ArbQuote | null): string {
  if (!book || !(book.bid > 0) || !(book.ask > book.bid)) return "Читаю книгу Backpack…";
  if (!(book.sellPx > 0) || !(book.buyPx > 0)) {
    return `Backpack ${book.bid.toFixed(2)}/${book.ask.toFixed(2)}. Ончейн не відповів. DRY_RUN.`;
  }
  const src = book.chain === "titan" ? "Titan" : book.chain === "jupiter" ? "Jupiter" : "ончейн";
  const edgeA = book.sellPx / book.ask - 1;
  const edgeB = book.bid / book.buyPx - 1;
  const bps = Math.max(edgeA, edgeB) * 10_000;
  return `Backpack ${book.bid.toFixed(2)}/${book.ask.toFixed(2)} · ${src} ${book.sellPx.toFixed(2)}/${book.buyPx.toFixed(2)} · край ${bps.toFixed(1)} bps`;
}

function strategyLine(runtime: AgentRuntime): string {
  const config = runtime.config;
  if (!config) return "Стратегію ще не зчитано";
  if (runtime.kind === "prediction") {
    const s = config as StrategyBundle["prediction"];
    if (s.focus === "events") return `Події · Grok від 65% · ставка ${s.maxStakeSol}`;
    const labels = (s.windows ?? [15]).map((w) => (w === 240 ? "4г" : `${w}хв`)).join(" · ");
    return `Біткоїн ${labels} · край ${s.edgeBps} bps · ставка ${s.maxStakeSol}`;
  }
  if (runtime.kind === "dex") {
    const s = config as StrategyBundle["dex"];
    return `Titan × Backpack · SOL/USDC · поріг ${s.slippageBps} bps · DRY_RUN`;
  }
  return "";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-surface px-2 py-1.5">
      <div className="text-muted">{label}</div>
      <div className="font-mono tabular-nums text-fg">{value}</div>
    </div>
  );
}

function StatusChip({ status }: { status: AgentRuntime["status"] }) {
  const map = {
    idle: "очікує",
    blocked: "немає NFT",
    loading: "завантаження",
    working: "в роботі",
    stopped: "стоп",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs uppercase tracking-wide",
        status === "working" && "bg-ok/15 text-ok",
        status === "blocked" && "bg-danger/15 text-danger",
        (status === "idle" || status === "stopped" || status === "loading") &&
          "bg-surface text-muted",
      )}
    >
      {map[status]}
    </span>
  );
}
