/**
 * Backend-shaped gate. In production this is an RPC + program check:
 * getAssetsByOwner (Metaplex Core) → filter collection + class attribute.
 * Private keys never enter this function.
 */
import { CLASS_META, kindsForClass } from "./classes";
import type { AgentKind, AgentNft, NftClassId, Track, WorkGate } from "./types";

export function nftsOwnedBy(nfts: AgentNft[], owner: string): AgentNft[] {
  return nfts.filter((n) => n.owner === owner);
}

export function coveringAssets(
  nfts: AgentNft[],
  owner: string,
  kind: AgentKind,
  track: Track,
): AgentNft[] {
  return nftsOwnedBy(nfts, owner).filter(
    (n) => n.track === track && kindsForClass(n.classId).includes(kind),
  );
}

export function verifyWork(nfts: AgentNft[], owner: string, track: Track): WorkGate {
  const owned = nftsOwnedBy(nfts, owner).filter((n) => n.track === track);
  const pred = owned.filter((n) => n.classId !== 2);
  const dex = owned.filter((n) => kindsForClass(n.classId).includes("dex"));
  if (pred.length === 0 && dex.length === 0) {
    return {
      ok: false,
      reason: "Немає агента. Купіть готового в Store.",
    };
  }
  const agents: AgentKind[] = [];
  if (pred.length) agents.push("prediction");
  if (dex.length) agents.push("dex");
  return { ok: true, agents, assets: [...pred, ...dex] };
}

export function pickBestAsset(
  nfts: AgentNft[],
  owner: string,
  kind: AgentKind,
  track: Track,
): AgentNft | null {
  const covering = coveringAssets(nfts, owner, kind, track);
  if (covering.length === 0) return null;
  return (
    covering.slice().sort((a, b) => {
      const comboBoost = (n: AgentNft) => (n.classId === 3 ? 40 : 0);
      return b.metrics.xp + comboBoost(b) - (a.metrics.xp + comboBoost(a));
    })[0] ?? null
  );
}

export function classLabel(id: NftClassId): string {
  return `Клас ${id} · ${CLASS_META[id].title}`;
}

export function defaultTrack(): Track {
  return "live";
}
