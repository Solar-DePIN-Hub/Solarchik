import { TRAIN_GOAL_DAYS } from "./classes";
import { offerFor } from "./fees.config";
import type { AgentNft, LiveSku, PredLane, PredictionFocus } from "./types";

const VAULT = "MarketVault111111111111111111111111111";

function liveNft(partial: Omit<AgentNft, "track" | "trainedDays" | "graduated" | "collection" | "owner">): AgentNft {
  return {
    ...partial,
    collection: "SolarchikAgents",
    owner: VAULT,
    track: "live",
    trainedDays: TRAIN_GOAL_DAYS,
    graduated: true,
  };
}

const EMPTY_METRICS = { xp: 0, jobs: 0, wins: 0, losses: 0, pnlSol: 0, lastJobAt: null as number | null, workedSec: 0, aprPct: null as number | null };

const DEX = { pair: "SOL/USDC", dcaIntervalSec: 900, dcaAmountSol: 0.005, slippageBps: 50, side: "both" as const };

function pred(focus: PredictionFocus, market: string, lanes: PredLane[], edgeBps: number) {
  const laneOn = { crypto: false, events: false, weather: false };
  for (const lane of lanes) laneOn[lane] = true;
  return {
    venue: "polymarket" as const,
    focus,
    market,
    windows: [15],
    windowMin: 15,
    edgeBps,
    maxStakeSol: 0.02,
    lanes,
    laneOn,
    eventsDays: 2 as const,
  };
}

/** Path 1: ready-to-run agents. Free is one per wallet. Pro is paid and fee-free. */
export function liveCatalog(): LiveSku[] {
  const now = Date.now();
  const base: LiveSku[] = [
    {
      id: "sku-pred-alpha",
      priceSol: 0,
      blurb: "Біткоїн Up/Down лише 15 хв. Grok ставить від 65%.",
      nft: liveNft({
        asset: "PredAlphaTpl000000000000000000000001",
        classId: 1,
        name: "Bitcoin Windows #11",
        mintedAt: now,
        updatedAt: now,
        strategy: { prediction: pred("btc", "Bitcoin", ["crypto"], 32), dex: DEX },
        metrics: EMPTY_METRICS,
      }),
    },
    {
      id: "sku-pred-events",
      priceSol: 0,
      blurb: "Події не про біткоїн і не спорт. Горизонт до 2 діб. Grok від 65%.",
      nft: liveNft({
        asset: "PredEventsTpl00000000000000000000003",
        classId: 1,
        name: "Events Scout #04",
        mintedAt: now,
        updatedAt: now,
        strategy: { prediction: pred("events", "події", ["events"], 18), dex: DEX },
        metrics: EMPTY_METRICS,
      }),
    },
    {
      id: "sku-pred-weather",
      priceSol: 0,
      blurb: "Денний high лише зі станції в правилах. Немає знятого high — ордера немає.",
      nft: liveNft({
        asset: "PredWeatherTpl0000000000000000000004",
        classId: 1,
        name: "Weather Station",
        mintedAt: now,
        updatedAt: now,
        strategy: { prediction: pred("weather", "погода", ["weather"], 18), dex: DEX },
        metrics: EMPTY_METRICS,
      }),
    },
    {
      id: "sku-combo-prime",
      priceSol: 0,
      blurb: "Три смуги в одному NFT: крипто 15 хв, події, погода. Без DEX.",
      nft: liveNft({
        asset: "PredComboTpl000000000000000000000005",
        classId: 3,
        name: "Combo Prime",
        mintedAt: now,
        updatedAt: now,
        strategy: {
          prediction: pred("btc", "Bitcoin", ["crypto", "events", "weather"], 18),
          dex: DEX,
        },
        metrics: EMPTY_METRICS,
      }),
    },
    {
      id: "sku-dex-arb",
      priceSol: 0,
      blurb: "Titan × Backpack. Усі Solana-пари проти USDC. Стріляє лише коли є край і каса.",
      nft: liveNft({
        asset: "DexArbTpl00000000000000000000000006",
        classId: 2,
        name: "Titan × Backpack",
        mintedAt: now,
        updatedAt: now,
        strategy: { prediction: pred("btc", "Bitcoin", ["crypto"], 18), dex: DEX },
        metrics: EMPTY_METRICS,
      }),
    },
  ];
  return withTiers(base);
}

function withTiers(rows: LiveSku[]): LiveSku[] {
  const free = rows.map((sku) => {
    const offer = offerFor(sku.id);
    return { ...sku, priceSol: offer.priceSol, nft: { ...sku.nft, tier: offer.tier } };
  });
  const pro = rows.map((sku) => {
    const id = `${sku.id}-pro`;
    const offer = offerFor(id);
    return {
      ...sku,
      id,
      priceSol: offer.priceSol,
      nft: {
        ...sku.nft,
        tier: offer.tier,
        name: `${sku.nft.name} Pro`.slice(0, 32),
        asset: `${sku.nft.asset}p`,
      },
    };
  });
  return [...free, ...pro];
}
