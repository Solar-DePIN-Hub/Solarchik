export const GEAR_IDS = ["house", "invS", "p80", "bat", "p330", "trk", "invH", "glass"] as const;
export type GearId = (typeof GEAR_IDS)[number];
export type GearKind = "home" | "panel" | "inverter" | "battery" | "tracker" | "greenhouse";

export type Gear = {
  id: GearId;
  kind: GearKind;
  cost: number;
  max: number;
  watts: number;
  yieldMult: number;
  extraCapH: number;
  /** All of these must be owned. "inv" means string or hybrid inverter. */
  requires: Array<GearId | "inv">;
};

export const GEAR: Gear[] = [
  { id: "house", kind: "home", cost: 40, max: 1, watts: 0, yieldMult: 1, extraCapH: 0, requires: [] },
  { id: "invS", kind: "inverter", cost: 80, max: 1, watts: 0, yieldMult: 1.15, extraCapH: 0, requires: ["house"] },
  { id: "p80", kind: "panel", cost: 50, max: 8, watts: 80, yieldMult: 1, extraCapH: 0, requires: ["house", "inv"] },
  { id: "bat", kind: "battery", cost: 200, max: 2, watts: 0, yieldMult: 1, extraCapH: 4, requires: ["house", "inv"] },
  { id: "p330", kind: "panel", cost: 180, max: 6, watts: 330, yieldMult: 1, extraCapH: 0, requires: ["p80"] },
  { id: "trk", kind: "tracker", cost: 360, max: 1, watts: 0, yieldMult: 1.22, extraCapH: 0, requires: ["p80"] },
  { id: "invH", kind: "inverter", cost: 600, max: 1, watts: 0, yieldMult: 1.35, extraCapH: 0, requires: ["invS"] },
  { id: "glass", kind: "greenhouse", cost: 420, max: 1, watts: 0, yieldMult: 1.18, extraCapH: 0, requires: ["p80"] },
];

export type FarmState = {
  gear: Record<GearId, number>;
  lastHarvest: number;
};

export function emptyGear(): Record<GearId, number> {
  return { house: 0, invS: 0, p80: 0, bat: 0, p330: 0, trk: 0, invH: 0, glass: 0 };
}

export function defaultFarm(now = Date.now()): FarmState {
  return { gear: emptyGear(), lastHarvest: now };
}

export function gearCount(farm: FarmState, id: GearId): number {
  return farm.gear[id] ?? 0;
}

export function hasHouse(farm: FarmState): boolean {
  return gearCount(farm, "house") > 0;
}

export function hasInv(farm: FarmState): boolean {
  return gearCount(farm, "invS") > 0 || gearCount(farm, "invH") > 0;
}

export function meetsReq(farm: FarmState, req: Array<GearId | "inv">): boolean {
  return req.every((r) => (r === "inv" ? hasInv(farm) : gearCount(farm, r) > 0));
}

export function normalizeFarm(raw: Partial<FarmState> | undefined, now = Date.now()): FarmState {
  const gear = emptyGear();
  if (raw?.gear) {
    for (const id of GEAR_IDS) {
      const n = Number(raw.gear[id] ?? 0);
      const max = GEAR.find((g) => g.id === id)?.max ?? 0;
      gear[id] = Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
    }
  }
  const produced = gear.p80 + gear.p330 + gear.invS + gear.invH + gear.bat + gear.trk + gear.glass;
  if (produced > 0 && gear.house === 0) gear.house = 1;
  const last = Number(raw?.lastHarvest);
  return { gear, lastHarvest: Number.isFinite(last) && last > 0 ? last : now };
}

export function farmWatts(farm: FarmState): number {
  if (!hasHouse(farm)) return 0;
  const base = gearCount(farm, "p80") * 80 + gearCount(farm, "p330") * 330;
  if (base <= 0) return 0;
  const inv = gearCount(farm, "invH") > 0 ? 1.35 : gearCount(farm, "invS") > 0 ? 1.15 : 1;
  const trk = gearCount(farm, "trk") > 0 ? 1.22 : 1;
  const glass = gearCount(farm, "glass") > 0 ? 1.18 : 1;
  return Math.round(base * inv * trk * glass);
}

export function farmCapHours(farm: FarmState): number {
  return 8 + gearCount(farm, "bat") * 4;
}

/** 50 W continuous ≈ 1 sun per hour. */
export function farmYieldPerHour(farm: FarmState): number {
  return farmWatts(farm) / 50;
}

export function pendingExact(farm: FarmState, now = Date.now()): number {
  if (farmYieldPerHour(farm) <= 0) return 0;
  const hours = Math.max(0, (now - farm.lastHarvest) / 3_600_000);
  const capped = Math.min(hours, farmCapHours(farm));
  return capped * farmYieldPerHour(farm);
}

export function pendingSuns(farm: FarmState, now = Date.now()): number {
  return Math.floor(pendingExact(farm, now));
}

export function storeFill(farm: FarmState, now = Date.now()): number {
  const hours = Math.max(0, (now - farm.lastHarvest) / 3_600_000);
  const cap = farmCapHours(farm);
  return cap <= 0 ? 0 : Math.min(1, hours / cap);
}

export function harvestFarmState(farm: FarmState, now = Date.now()): { farm: FarmState; suns: number } {
  const suns = pendingSuns(farm, now);
  if (suns <= 0) return { farm, suns: 0 };
  return { farm: { ...farm, lastHarvest: now }, suns };
}

export function lockedBy(farm: FarmState, id: GearId): Array<GearId | "inv"> {
  const def = GEAR.find((g) => g.id === id);
  if (!def) return [];
  return def.requires.filter((r) => (r === "inv" ? !hasInv(farm) : gearCount(farm, r) <= 0));
}

export function canBuyGear(farm: FarmState, id: GearId, suns: number): boolean {
  const def = GEAR.find((g) => g.id === id);
  if (!def) return false;
  if (gearCount(farm, id) >= def.max) return false;
  if (!meetsReq(farm, def.requires)) return false;
  return suns >= def.cost;
}

export function buyGearState(farm: FarmState, id: GearId): FarmState | null {
  const def = GEAR.find((g) => g.id === id);
  if (!def) return null;
  const n = gearCount(farm, id);
  if (n >= def.max) return null;
  if (!meetsReq(farm, def.requires)) return null;
  return { ...farm, gear: { ...farm.gear, [id]: n + 1 } };
}

export function panelCount(farm: FarmState): number {
  return gearCount(farm, "p80") + gearCount(farm, "p330");
}

export function formatWatts(w: number): string {
  if (w >= 1000) return `${(w / 1000).toFixed(w >= 10000 ? 0 : 1)} kW`;
  return `${w} W`;
}

export function formatRate(perHour: number): string {
  if (perHour <= 0) return "0/h";
  if (perHour >= 10) return `${perHour.toFixed(0)}/h`;
  return `${perHour.toFixed(1)}/h`;
}
