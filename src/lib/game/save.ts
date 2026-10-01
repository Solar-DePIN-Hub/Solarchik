import { activateWindow, expireWindows, grantStreakRewards, readWindows, windowsCover, type FeeWindow } from "./fee-windows";
import type { DayMod } from "./sim";
import { SKINS, isPlatSkin, type PlatSkin } from "./skins";
import {
  type FarmState,
  type GearId,
  defaultFarm,
  normalizeFarm,
  harvestFarmState,
  canBuyGear,
  buyGearState,
  GEAR,
  hasHouse,
} from "./farm";
import {
  type PetState,
  applyRunToPet,
  appendChat,
  chargePet,
  defaultPet,
  finishPlay,
  hatchTap,
  hasCareShield,
  isPetVibe,
  isPetVoice,
  normalizePet,
  pokePet,
  polishPet,
  setupBuddy,
  tickPet,
  toggleNap,
  type PetVibe,
  type PetVoice,
} from "./pet";
import { type RobotId, ROBOTS, isRobotId } from "./robots";
import { type Locale, detectLocale, isLocale } from "./i18n";
import { cleanE164, readContacts, readInbox, readPlayerId, readReport, type PhoneContact, type SecretaryMessage, type SecretaryReport } from "./secretary";
import { readFwdId } from "./fwd";
import { clampPay, type PayUsd } from "./pay";
import { bindNativePlayer, nativePlayerId, setNativeScreening } from "./buddyNet";

const KEY = "solarchik-clock-in-v8";
const SAVE_VERSION = 8;
const GHOST_KEY = "solarchik-ghost-v1";

export type GhostSample = { x: number; y: number; grounded: boolean };
export type GhostTape = { day: string; meters: number; samples: GhostSample[] };

export type { DayMod };

export type MissionId = "clock" | "suns" | "combo";

export type PayPending = { ref: string; usd: PayUsd; at: number };

export type { FeeWindow } from "./fee-windows";

export type SaveData = {
  version: number;
  streak: number;
  bestScore: number;
  bestDistance: number;
  lastScore: number;
  lastDistance: number;
  lastClockDay: string;
  lastPlayDay: string;
  totalSuns: number;
  suns: number;
  runs: number;
  missions: Record<MissionId, boolean>;
  missionDay: string;
  signedDay: string;
  clockSig: string;
  clockCluster: "" | "mainnet" | "devnet";
  clockKind: "" | "tx" | "message";
  skin: PlatSkin;
  unlockedSkins: PlatSkin[];
  robot: RobotId;
  unlockedRobots: RobotId[];
  bonusRuns: number;
  farm: FarmState;
  pet: PetState;
  locale: Locale;
  playerId: string;
  secretary: SecretaryReport | null;
  secretaryInbox: SecretaryMessage[];
  phonebook: PhoneContact[];
  secretaryOn: boolean;
  secNumber: string;
  redirectOn: boolean;
  fwdCountry: string;
  secLive: boolean;
  secPaySigs: string[];
  playerWallet: string;
  secPending: PayPending[];
  secCredit: number;
  /** UTC days that were actually signed. */
  clockDays: string[];
  /** Signed days toward the next 48h window. Restarts after that reward. */
  seven: number;
  /** Signed days toward 30/60/90. Does not restart when a reward is granted. */
  thirty: number;
  feeWindows: FeeWindow[];
  /** UTC day the Sol report was shown. */
  reportDay: string;
};

const emptyMissions = (): Record<MissionId, boolean> => ({
  clock: false,
  suns: false,
  combo: false,
});

export const SKIN_UNLOCK = SKINS.map((s) => ({
  id: s.id,
  how: s.cost === 0 ? "Starter" : `${s.cost} suns`,
  cost: s.cost,
}));

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  streak: 0,
  bestScore: 0,
  bestDistance: 0,
  lastScore: 0,
  lastDistance: 0,
  lastClockDay: "",
  lastPlayDay: "",
  totalSuns: 0,
  suns: 120,
  runs: 0,
  missions: emptyMissions(),
  missionDay: "",
  signedDay: "",
  clockSig: "",
  clockCluster: "",
  clockKind: "",
  skin: "flag",
  unlockedSkins: ["flag"],
  robot: "stock",
  unlockedRobots: ["stock"],
  bonusRuns: 0,
  farm: defaultFarm(),
  pet: defaultPet(),
  locale: detectLocale(),
  playerId: "",
  secretary: null,
  secretaryInbox: [],
  phonebook: [],
  secretaryOn: false,
  secNumber: "380914810885",
  redirectOn: false,
  fwdCountry: "",
  secLive: false,
  secPaySigs: [],
  playerWallet: "",
  secPending: [],
  secCredit: 0,
  clockDays: [],
  seven: 0,
  thirty: 0,
  feeWindows: [],
  reportDay: "",
});

export function todayKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daySeed(key = todayKey()): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DAY_MODS: DayMod[] = ["calm", "wind", "gold", "drones", "wire"];

export function dayMod(day = todayKey()): DayMod {
  return DAY_MODS[Math.abs(daySeed(day)) % DAY_MODS.length] ?? "calm";
}

function yesterdayKey(d = new Date()): string {
  return todayKey(new Date(d.getTime() - 86_400_000));
}

function legacyUnlocks(save: SaveData): PlatSkin[] {
  const extra: PlatSkin[] = [];
  if (save.totalSuns >= 40) extra.push("gold");
  if (save.bestDistance >= 800) extra.push("storm");
  if (save.bestDistance >= 2000) extra.push("night");
  if (save.runs >= 8) extra.push("ember");
  return extra;
}

export function skinUnlocked(save: SaveData, id: PlatSkin): boolean {
  if (id === "flag") return true;
  return save.unlockedSkins.includes(id);
}

export function robotUnlocked(save: SaveData, id: RobotId): boolean {
  if (id === "stock") return true;
  return save.unlockedRobots.includes(id);
}

function syncUnlocks(save: SaveData): SaveData {
  const next = new Set<PlatSkin>(["flag", ...save.unlockedSkins.filter(isPlatSkin)]);
  for (const id of legacyUnlocks(save)) next.add(id);
  const unlockedSkins = SKINS.map((s) => s.id).filter((id) => next.has(id));
  const skin = unlockedSkins.includes(save.skin) ? save.skin : "flag";
  const bots = new Set<RobotId>(["stock", ...save.unlockedRobots.filter(isRobotId)]);
  const unlockedRobots = ROBOTS.map((r) => r.id).filter((id) => bots.has(id));
  const robot = unlockedRobots.includes(save.robot) ? save.robot : "stock";
  return { ...save, unlockedSkins, skin, unlockedRobots, robot };
}

function migrate(raw: SaveData): SaveData {
  const base = defaultSave();
  const totalSuns = Number(raw.totalSuns ?? 0) || 0;
  const sunsRaw = (raw as SaveData & { suns?: number }).suns;
  const suns = Number.isFinite(Number(sunsRaw)) ? Math.max(0, Math.floor(Number(sunsRaw))) : totalSuns;
  const farm = normalizeFarm(raw.farm);
  const pet = normalizePet((raw as SaveData).pet, farm);
  if ((Number(raw.version) || 0) < 8) {
    pet.careDays = 0;
    pet.lastGrowAt = 0;
  }
  const locale = isLocale(String(raw.locale)) ? (raw.locale as Locale) : detectLocale();
  const robot = isRobotId(String(raw.robot)) ? (raw.robot as RobotId) : "stock";
  const unlockedRobots: RobotId[] = Array.isArray(raw.unlockedRobots)
    ? raw.unlockedRobots.filter(isRobotId)
    : ["stock"];
  return syncUnlocks({
    ...base,
    ...raw,
    version: SAVE_VERSION,
    totalSuns,
    suns,
    farm,
    pet,
    locale,
    robot,
    unlockedRobots,
    playerId: readPlayerId((raw as SaveData).playerId),
    secretary: readReport((raw as SaveData).secretary),
    secretaryInbox: readInbox((raw as SaveData).secretaryInbox, readReport((raw as SaveData).secretary)),
    phonebook: readContacts((raw as SaveData).phonebook),
    secretaryOn: Boolean((raw as SaveData).secretaryOn),
    secNumber: cleanE164(String((raw as SaveData).secNumber || "")) || "380914810885",
    redirectOn: Boolean((raw as SaveData).redirectOn),
    fwdCountry: readFwdId((raw as SaveData).fwdCountry, locale),
    secLive: Boolean((raw as SaveData).secLive),
    secPaySigs: Array.isArray((raw as SaveData).secPaySigs)
      ? (raw as SaveData).secPaySigs.map((x) => String(x)).filter(Boolean).slice(0, 40)
      : [],
    playerWallet: String((raw as SaveData).playerWallet || "").replace(/\s/g, "").slice(0, 48),
    clockSig: String((raw as SaveData).clockSig || "").replace(/\s/g, "").slice(0, 100),
    clockCluster: (raw as SaveData).clockCluster === "mainnet" || (raw as SaveData).clockCluster === "devnet" ? (raw as SaveData).clockCluster : "",
    clockKind: (raw as SaveData).clockKind === "tx" || (raw as SaveData).clockKind === "message" ? (raw as SaveData).clockKind : "",
    secPending: readPending((raw as SaveData).secPending),
    secCredit: Math.max(0, Number((raw as SaveData).secCredit) || 0),
    clockDays: readClockDays((raw as SaveData).clockDays, String((raw as SaveData).signedDay || ""), Number(raw.streak) || 0),
    seven: readCounter((raw as SaveData).seven, (Number(raw.streak) || 0) % 7),
    thirty: readCounter((raw as SaveData).thirty, Number(raw.streak) || 0),
    feeWindows: readWindows((raw as SaveData).feeWindows),
    reportDay: /^\d{4}-\d{2}-\d{2}$/.test(String((raw as SaveData).reportDay || "")) ? String((raw as SaveData).reportDay) : "",
    missions: { ...emptyMissions(), ...(raw.missions ?? {}) },
    unlockedSkins: raw.unlockedSkins?.length ? raw.unlockedSkins.filter(isPlatSkin) : ["flag"],
    skin: isPlatSkin(String(raw.skin)) ? (raw.skin as PlatSkin) : "flag",
    bonusRuns: raw.bonusRuns ?? 0,
  });
}

export function loadSave(): SaveData {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw =
      localStorage.getItem(KEY) ??
      localStorage.getItem("solarchik-clock-in-v7") ??
      localStorage.getItem("solarchik-clock-in-v6") ??
      localStorage.getItem("solarchik-clock-in-v5") ??
      localStorage.getItem("solarchik-clock-in-v4") ??
      localStorage.getItem("solarchik-clock-in-v3") ??
      localStorage.getItem("solarchik-clock-in-v2") ??
      localStorage.getItem("solarchik-clock-in-v1");
    if (!raw) return bindNativeId(defaultSave());
    const parsed = JSON.parse(raw) as SaveData;
    const save = migrate(parsed);
    const today = todayKey();
    if (save.missionDay !== today) {
      save.missions = emptyMissions();
      save.missionDay = today;
    }
    if (!save.signedDay || (save.signedDay !== today && save.signedDay !== yesterdayKey())) {
      save.streak = 0;
      save.seven = 0;
      save.thirty = 0;
    }
    if (save.runs === 0 && save.totalSuns === 0 && save.suns === 0 && !hasHouse(save.farm) && !save.pet.hatched) {
      save.suns = 120;
    }
    save.pet = tickPet(save.pet);
    if (!save.playerId) save.playerId = readPlayerId("");
    return bindNativeId(save);
  } catch {
    return bindNativeId(defaultSave());
  }
}

function bindNativeId(save: SaveData): SaveData {
  try {
    if (save.playerId) bindNativePlayer(save.playerId);
    else {
      const id = nativePlayerId();
      if (id) save.playerId = id;
      else save.playerId = readPlayerId("");
    }
    setNativeScreening(save.secretaryOn);
  } catch {
    if (!save.playerId) save.playerId = readPlayerId("");
  }
  return save;
}

export function writeSave(save: SaveData) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode / quota */
  }
}

export function applyRun(
  save: SaveData,
  result: {
    score: number;
    suns: number;
    maxCombo: number;
    distance: number;
    didBonus?: boolean;
  },
): SaveData {
  const today = todayKey();
  const dist = Math.round(result.distance);
  const gained = Math.max(0, Math.floor(result.suns));
  const keep = save.lastClockDay === today && dist < 1200;
  const next: SaveData = {
    ...save,
    lastScore: keep ? Math.max(save.lastScore, result.score) : result.score,
    lastDistance: keep ? Math.max(save.lastDistance, dist) : dist,
    bestScore: Math.max(save.bestScore, result.score),
    bestDistance: Math.max(save.bestDistance ?? 0, dist),
    totalSuns: save.totalSuns + gained,
    suns: save.suns + gained,
    runs: save.runs + 1,
    lastPlayDay: today,
    missionDay: today,
    missions: { ...save.missions },
    bonusRuns: save.bonusRuns + (result.didBonus ? 1 : 0),
    pet: applyRunToPet(save.pet, dist, Date.now(), today),
  };
  if (dist >= 2000) next.missions.clock = true;
  if (result.suns >= 25) next.missions.suns = true;
  if (result.maxCombo >= 8) next.missions.combo = true;
  if (dist >= 1200 && next.lastClockDay !== today) {
    next.lastClockDay = today;
  }
  return syncUnlocks(next);
}

export function setSkin(save: SaveData, skin: PlatSkin): SaveData {
  if (!skinUnlocked(save, skin)) return save;
  return { ...save, skin };
}

export function buySkin(save: SaveData, id: PlatSkin): SaveData {
  if (skinUnlocked(save, id)) return setSkin(save, id);
  const cost = SKINS.find((s) => s.id === id)?.cost ?? 0;
  if (save.suns < cost) return save;
  return {
    ...save,
    suns: save.suns - cost,
    unlockedSkins: [...save.unlockedSkins, id],
    skin: id,
  };
}

export function pickSkin(save: SaveData, id: PlatSkin): SaveData {
  if (skinUnlocked(save, id)) return setSkin(save, id);
  return buySkin(save, id);
}

export function setRobot(save: SaveData, id: RobotId): SaveData {
  if (!robotUnlocked(save, id)) return save;
  return { ...save, robot: id };
}

export function buyRobot(save: SaveData, id: RobotId): SaveData {
  if (robotUnlocked(save, id)) return setRobot(save, id);
  const cost = ROBOTS.find((r) => r.id === id)?.cost ?? 0;
  if (save.suns < cost) return save;
  return {
    ...save,
    suns: save.suns - cost,
    unlockedRobots: [...save.unlockedRobots, id],
    robot: id,
  };
}

export function pickRobot(save: SaveData, id: RobotId): SaveData {
  if (robotUnlocked(save, id)) return setRobot(save, id);
  return buyRobot(save, id);
}

export function harvestFarm(save: SaveData, now = Date.now()): SaveData {
  const { farm, suns } = harvestFarmState(save.farm, now);
  if (suns <= 0) return save;
  return { ...save, farm, suns: save.suns + suns, totalSuns: save.totalSuns + suns };
}

export function buyGear(save: SaveData, id: GearId): SaveData {
  const def = GEAR.find((g) => g.id === id);
  if (!def) return save;
  if (!canBuyGear(save.farm, id, save.suns)) return save;
  const farm = buyGearState(save.farm, id);
  if (!farm) return save;
  return { ...save, farm, suns: save.suns - def.cost };
}

export function tickSavePet(save: SaveData, now = Date.now()): SaveData {
  const pet = tickPet(save.pet, now);
  if (pet === save.pet) return save;
  return { ...save, pet };
}

export function petDoHatch(save: SaveData, now = Date.now()): SaveData {
  const { pet } = hatchTap(tickPet(save.pet, now), now);
  return { ...save, pet };
}

export function petDoSetup(
  save: SaveData,
  name: string,
  vibe: PetVibe,
  voice: PetVoice | "" = "",
  now = Date.now(),
): SaveData {
  if (!isPetVibe(vibe)) return save;
  const nextVoice = isPetVoice(voice) ? voice : "";
  return { ...save, pet: setupBuddy(tickPet(save.pet, now), name, vibe, nextVoice, now) };
}

export function petDoCharge(save: SaveData, now = Date.now()): SaveData {
  const day = todayKey();
  const { pet, suns, ok } = chargePet(tickPet(save.pet, now), save.suns, now, day);
  if (!ok) return { ...save, pet };
  return { ...save, pet, suns };
}

export function petDoPolish(save: SaveData, now = Date.now()): SaveData {
  const day = todayKey();
  const { pet, suns, ok } = polishPet(tickPet(save.pet, now), save.suns, now, day);
  if (!ok) return { ...save, pet };
  return { ...save, pet, suns };
}

export function petDoNap(save: SaveData, now = Date.now()): SaveData {
  return { ...save, pet: toggleNap(save.pet, now) };
}

export function petDoPoke(save: SaveData, now = Date.now()): SaveData {
  const { pet, ok } = pokePet(tickPet(save.pet, now), now, todayKey());
  if (!ok) return { ...save, pet };
  return { ...save, pet };
}

export function petDoPlay(save: SaveData, caught: number, now = Date.now()): SaveData {
  return { ...save, pet: finishPlay(tickPet(save.pet, now), caught, now, todayKey()) };
}

export function petDoChat(save: SaveData, userText: string, buddyText: string, now = Date.now()): SaveData {
  return { ...save, pet: appendChat(tickPet(save.pet, now), userText, buddyText, now, todayKey()) };
}

export function petDoSecretary(
  save: SaveData,
  userText: string,
  buddyText: string,
  report: SecretaryReport,
  now = Date.now(),
): SaveData {
  const msg = {
    id: `sec-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: report.at || now,
    user: userText,
    reply: buddyText,
    summary: report.summary,
    chargedUsd: report.chargedUsd,
    usd: report.usd,
    archived: false,
    read: false,
  };
  return {
    ...save,
    pet: appendChat(tickPet(save.pet, now), userText, buddyText, now, todayKey()),
    secretary: report,
    secCredit: Math.max(0, Math.round((save.secCredit - (report.chargedUsd || 0.2)) * 100) / 100),
    secretaryInbox: [msg, ...save.secretaryInbox].slice(0, 40),
  };
}

export function petReadSecretary(save: SaveData, id: string): SaveData {
  return {
    ...save,
    secretaryInbox: save.secretaryInbox.map((m) => (m.id === id ? { ...m, read: true } : m)),
  };
}

export function petArchiveSecretary(save: SaveData, id: string): SaveData {
  return {
    ...save,
    secretaryInbox: save.secretaryInbox.map((m) => (m.id === id ? { ...m, archived: true, read: true } : m)),
  };
}

export function addPhoneContact(save: SaveData, name: string): SaveData {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (clean.length < 2) return save;
  if (save.phonebook.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return save;
  if (save.phonebook.length >= 200) return save;
  return {
    ...save,
    phonebook: [...save.phonebook, { id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: clean }],
  };
}

export function dropPhoneContact(save: SaveData, id: string): SaveData {
  return { ...save, phonebook: save.phonebook.filter((c) => c.id !== id) };
}

export function mergePhonebook(save: SaveData, names: string[]): SaveData {
  const seen = new Set(save.phonebook.map((c) => c.name.toLowerCase()));
  const extra: PhoneContact[] = [];
  for (const raw of names) {
    const clean = raw.replace(/\s+/g, " ").trim().slice(0, 40);
    if (clean.length < 2) continue;
    if (!/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(clean)) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({ id: `c-${Date.now().toString(36)}-${extra.length}-${Math.random().toString(36).slice(2, 5)}`, name: clean });
    if (save.phonebook.length + extra.length >= 200) break;
  }
  if (!extra.length) return save;
  return { ...save, phonebook: [...save.phonebook, ...extra] };
}

export function setSecretaryOn(save: SaveData, on: boolean): SaveData {
  if (save.secretaryOn === on) return save;
  return { ...save, secretaryOn: on };
}

export function setSecNumber(save: SaveData, raw: string): SaveData {
  return { ...save, secNumber: cleanE164(raw) || raw.replace(/\s+/g, "").slice(0, 20) };
}

export function setRedirectOn(save: SaveData, on: boolean): SaveData {
  if (save.redirectOn === on) return save;
  return { ...save, redirectOn: on };
}

export function setFwdCountry(save: SaveData, id: string): SaveData {
  const next = readFwdId(id, save.locale);
  if (save.fwdCountry === next) return save;
  return { ...save, fwdCountry: next };
}

export function queueSecretaryPay(save: SaveData, ref: string, usd: PayUsd): SaveData {
  const row = { ref, usd: clampPay(usd), at: Date.now() };
  if (!row.usd) return save;
  return { ...save, secPending: [row, ...save.secPending.filter((p) => p.ref !== ref)].slice(0, 8) };
}

export function setPlayerWallet(save: SaveData, address: string): SaveData {
  const wallet = address.replace(/\s/g, "").slice(0, 48);
  if (!wallet || wallet === save.playerWallet) return save;
  return { ...save, playerWallet: wallet };
}

export function markSecretaryPaid(save: SaveData, sig: string, from = "", ref = "", usd = 0): SaveData {
  const wallet = from && from.length >= 32 ? from : save.playerWallet;
  const add = clampPay(usd);
  const pendingUsd = ref ? save.secPending.find((p) => p.ref === ref)?.usd || 0 : 0;
  const credit = add || clampPay(pendingUsd);
  return {
    ...save,
    secLive: true,
    secPaySigs: save.secPaySigs.includes(sig) ? save.secPaySigs : [sig, ...save.secPaySigs].slice(0, 40),
    playerWallet: wallet || save.playerWallet,
    secPending: ref ? save.secPending.filter((p) => p.ref !== ref) : save.secPending,
    secCredit: Math.round((save.secCredit + credit) * 100) / 100,
  };
}

export function petShieldOn(save: SaveData): boolean {
  return hasCareShield(tickPet(save.pet));
}

export function setLocale(save: SaveData, locale: Locale): SaveData {
  if (!isLocale(locale) || locale === save.locale) return save;
  return { ...save, locale };
}

export function stampSign(save: SaveData): SaveData {
  return { ...save, signedDay: todayKey() };
}

export function stampClock(
  save: SaveData,
  proof: { address: string; signature: string; cluster: "mainnet" | "devnet"; kind: "tx" | "message" },
): SaveData {
  const today = todayKey();
  if (save.signedDay === today) return save;
  const now = Date.now();
  const continued = save.signedDay === yesterdayKey();
  const thirty = continued ? save.thirty + 1 : 1;
  const granted = grantStreakRewards(save.feeWindows, { seven: continued ? save.seven + 1 : 1, thirty }, now);
  const seven = granted.seven;
  const feeWindows = granted.rows;
  const address = proof.address.replace(/\s/g, "").slice(0, 48);
  const clockDays = (continued ? save.clockDays : []).filter((d) => d !== today);
  clockDays.push(today);
  return {
    ...save,
    streak: continued ? save.streak + 1 : 1,
    signedDay: today,
    seven,
    thirty,
    feeWindows,
    clockDays: clockDays.slice(-120),
    playerWallet: address.length >= 32 ? address : save.playerWallet,
    clockSig: proof.signature.replace(/\s/g, "").slice(0, 100),
    clockCluster: proof.cluster,
    clockKind: proof.kind,
  };
}

/** Fee-free if openedAt is inside any window the player activated, active or spent. */
export function feeWindowCovers(save: SaveData, openedAt: number): boolean {
  return windowsCover(save.feeWindows, openedAt);
}

export function activateFeeWindow(save: SaveData, now = Date.now()): SaveData {
  return { ...save, feeWindows: activateWindow(save.feeWindows, now) };
}

export function feeProgress(save: SaveData, now = Date.now()):
  | { kind: "active"; leftMs: number }
  | { kind: "ready" }
  | { kind: "wait"; days48: number; days30: number } {
  const rows = expireWindows(save.feeWindows, now);
  const active = rows.find((w) => w.status === "active" && w.endsAt > now);
  if (active) return { kind: "active", leftMs: active.endsAt - now };
  if (rows.some((w) => w.status === "available")) return { kind: "ready" };
  const next30 = (Math.floor(save.thirty / 30) + 1) * 30;
  return { kind: "wait", days48: Math.max(0, 7 - save.seven), days30: Math.max(0, next30 - save.thirty) };
}

function readCounter(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : fallback;
  return Math.max(0, Math.min(4000, n));
}

function readClockDays(raw: unknown, signedDay: string, streak: number): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const key = String(row || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && !out.includes(key)) out.push(key);
      if (out.length >= 120) break;
    }
  }
  if (out.length || streak <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(signedDay)) return out;
  const seeded: string[] = [];
  let cursor = signedDay;
  for (let i = 0; i < Math.min(streak, 120); i++) {
    seeded.unshift(cursor);
    const prev = new Date(`${cursor}T00:00:00Z`).getTime() - 86_400_000;
    cursor = todayKey(new Date(prev));
  }
  return seeded;
}

function readPending(raw: unknown): PayPending[] {
  if (!Array.isArray(raw)) return [];
  const out: PayPending[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const ref = String(o.ref || "");
    const usd = clampPay(o.usd as string | number);
    if (ref.length < 32 || !usd) continue;
    out.push({ ref, usd, at: Number(o.at) || 0 });
    if (out.length >= 8) break;
  }
  return out;
}

function parseKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function clockedOn(save: SaveData, key: string): boolean {
  if (!save.signedDay || save.streak <= 0) return false;
  const last = parseKey(save.signedDay);
  const target = parseKey(key);
  if (!last || !target) return save.signedDay === key;
  const diff = Math.round((last.getTime() - target.getTime()) / 86400000);
  return diff >= 0 && diff < save.streak;
}

export function weekStamps(save: SaveData, now = new Date()) {
  const utcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const mondayOffset = (new Date(utcDay).getUTCDay() + 6) % 7;
  const today = todayKey(now);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = new Date(utcDay);
    d.setUTCDate(d.getUTCDate() - mondayOffset + i);
    const key = todayKey(d);
    return { key, i, done: clockedOn(save, key), isToday: key === today };
  });
}

export function untilMidnightLabel(now = new Date()): string {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const ms = Math.max(0, end - now.getTime());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

let ghostMem: GhostTape | null | undefined;

function thinSamples(samples: GhostSample[], limit = 80): GhostSample[] {
  if (samples.length <= limit) return samples;
  const out: GhostSample[] = [];
  const step = (samples.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i++) {
    const p = samples[Math.round(i * step)];
    if (p) out.push(p);
  }
  return out;
}

export function readGhost(): GhostTape | null {
  if (ghostMem !== undefined) return ghostMem;
  ghostMem = null;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GHOST_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<GhostTape>;
    if (!o || typeof o.day !== "string" || !Array.isArray(o.samples)) return null;
    const samples = o.samples
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .slice(0, 80)
      .map((p) => ({ x: Number(p.x), y: Number(p.y), grounded: !!p.grounded }));
    if (samples.length < 2) return null;
    ghostMem = { day: o.day, meters: Number(o.meters) || 0, samples };
    return ghostMem;
  } catch {
    return null;
  }
}

export function writeGhost(day: string, meters: number, samples: GhostSample[]) {
  if (typeof window === "undefined") return;
  if (meters < 400 || samples.length < 2) return;
  const prev = readGhost();
  if (prev && prev.day === day && meters < prev.meters) return;
  const tape: GhostTape = { day, meters, samples: thinSamples(samples) };
  ghostMem = tape;
  try {
    localStorage.setItem(GHOST_KEY, JSON.stringify(tape));
  } catch {
    /* quota */
  }
}
