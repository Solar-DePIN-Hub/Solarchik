import { hasHouse, panelCount, type FarmState } from "./farm";
import { type RobotId } from "./robots";

export const CHARGE_COST = 8;
export const POLISH_COST = 5;
export const PLAY_SECS = 8;
export const PET_COOLDOWN = 7000;
export const HATCH_TAPS = 3;
export const CARE_SHIELD = 65;
export const CHAT_CAP = 32;
export const CHAT_DAY_CAP = 20;
export const CHAT_COOLDOWN = 400;
export const CHAT_MAX_LEN = 320;
export const NAME_MAX = 16;

export type PetStageId = "battery" | "sprout" | "kit" | "runner" | "ace" | "legend";
export type PetVibe = "sunny" | "dry" | "hype" | "gentle";
export type PetVoice = "eve" | "ara" | "rex" | "leo";
export type PetEmotion =
  | "happy"
  | "excited"
  | "calm"
  | "hungry"
  | "sleepy"
  | "lonely"
  | "grumpy"
  | "proud"
  | "curious";
export type ChatRole = "user" | "buddy";
export type ChatTurn = { role: ChatRole; text: string; at: number };

export const VIBES: PetVibe[] = ["sunny", "dry", "hype", "gentle"];
export const VOICES: PetVoice[] = ["eve", "ara", "rex", "leo"];

export function isPetVibe(id: string): id is PetVibe {
  return (VIBES as readonly string[]).includes(id);
}

export function isPetVoice(id: string): id is PetVoice {
  return (VOICES as readonly string[]).includes(id);
}

export type PetState = {
  hatched: boolean;
  taps: number;
  bornAt: number;
  lastTick: number;
  charge: number;
  mood: number;
  rest: number;
  shine: number;
  xp: number;
  sleeping: boolean;
  lastCareDay: string;
  careStreak: number;
  lastPetAt: number;
  setupDone: boolean;
  name: string;
  vibe: PetVibe;
  voice: PetVoice | "";
  careDays: number;
  chat: ChatTurn[];
  lastChatAt: number;
  chatDay: string;
  chatCount: number;
  lastGrowAt: number;
};

const STAGES: { id: PetStageId; days: number }[] = [
  { id: "battery", days: 0 },
  { id: "sprout", days: 2 },
  { id: "kit", days: 4 },
  { id: "runner", days: 8 },
  { id: "ace", days: 15 },
  { id: "legend", days: 25 },
];

function clamp(n: number, a = 0, b = 100) {
  return Math.max(a, Math.min(b, n));
}

export function cleanName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length < 2) return "";
  return s.slice(0, NAME_MAX);
}

export function cleanChat(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
}

export function cleanSpeech(raw: string): string {
  return raw
    .replace(/[*_#`>~]+/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function cleanChatList(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { role?: unknown; text?: unknown; at?: unknown };
    const role = rec.role === "user" || rec.role === "buddy" ? rec.role : null;
    const text = typeof rec.text === "string" ? cleanChat(rec.text) : "";
    const at = Number(rec.at);
    if (!role || !text) continue;
    out.push({ role, text, at: Number.isFinite(at) ? at : 0 });
    if (out.length >= CHAT_CAP) break;
  }
  return out;
}

export function defaultPet(now = Date.now()): PetState {
  return {
    hatched: false,
    taps: 0,
    bornAt: now,
    lastTick: now,
    charge: 78,
    mood: 72,
    rest: 80,
    shine: 86,
    xp: 0,
    sleeping: false,
    lastCareDay: "",
    careStreak: 0,
    lastPetAt: 0,
    setupDone: false,
    name: "",
    vibe: "sunny",
    voice: "",
    careDays: 0,
    chat: [],
    lastChatAt: 0,
    chatDay: "",
    chatCount: 0,
    lastGrowAt: 0,
  };
}

function deriveCareDays(raw: Partial<PetState>): number {
  if (Number.isFinite(Number(raw.careDays))) return Math.max(0, Math.floor(Number(raw.careDays)));
  return 0;
}

export function normalizePet(raw: Partial<PetState> | undefined, farm?: FarmState, now = Date.now()): PetState {
  const base = defaultPet(now);
  if (!raw || typeof raw !== "object") {
    if (farm && hasHouse(farm)) {
      return {
        ...base,
        hatched: true,
        bornAt: now,
        xp: 50 + panelCount(farm) * 8,
        charge: 80,
        mood: 80,
        rest: 80,
        shine: 80,
        careDays: 0,
      };
    }
    return base;
  }
  const num = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const hatched = Boolean(raw.hatched) || Boolean(raw.setupDone);
  const name = cleanName(typeof raw.name === "string" ? raw.name : "");
  const vibe = isPetVibe(String(raw.vibe)) ? (raw.vibe as PetVibe) : "sunny";
  const voice = isPetVoice(String(raw.voice)) ? (raw.voice as PetVoice) : "";
  const setupDone = Boolean(raw.setupDone) && Boolean(name);
  return {
    hatched,
    taps: Math.max(0, Math.min(HATCH_TAPS, Math.floor(num(raw.taps, 0)))),
    bornAt: num(raw.bornAt, now),
    lastTick: num(raw.lastTick, now),
    charge: clamp(num(raw.charge, base.charge)),
    mood: clamp(num(raw.mood, base.mood)),
    rest: clamp(num(raw.rest, base.rest)),
    shine: clamp(num(raw.shine, base.shine)),
    xp: Math.max(0, Math.floor(num(raw.xp, 0))),
    sleeping: Boolean(raw.sleeping),
    lastCareDay: typeof raw.lastCareDay === "string" ? raw.lastCareDay : "",
    careStreak: Math.max(0, Math.floor(num(raw.careStreak, 0))),
    lastPetAt: num(raw.lastPetAt, 0),
    setupDone,
    name,
    vibe,
    voice,
    careDays: deriveCareDays(raw),
    chat: cleanChatList(raw.chat),
    lastChatAt: num(raw.lastChatAt, 0),
    chatDay: typeof raw.chatDay === "string" ? raw.chatDay : "",
    chatCount: Math.max(0, Math.floor(num(raw.chatCount, 0))),
    lastGrowAt: num(raw.lastGrowAt, 0),
  };
}

export function tickPet(pet: PetState, now = Date.now()): PetState {
  const dt = Math.max(0, now - pet.lastTick);
  if (dt < 800) return pet;
  const hours = Math.min(36, dt / 3_600_000);
  if (hours <= 0) return { ...pet, lastTick: now };
  if (!pet.hatched) {
    return { ...pet, lastTick: now };
  }
  let charge = pet.charge;
  let mood = pet.mood;
  let rest = pet.rest;
  let shine = pet.shine;
  let sleeping = pet.sleeping;
  if (sleeping) {
    const live = dt < 20_000;
    rest = clamp(rest + (live ? (dt / 1000) * 0.85 : hours * 14));
    charge = clamp(charge - (live ? (dt / 1000) * 0.08 : hours * 2.2));
    mood = clamp(mood - hours * 1.4);
    shine = clamp(shine - hours * 1.6);
    if (rest >= 99) sleeping = false;
  } else {
    charge = clamp(charge - hours * 5.2);
    mood = clamp(mood - hours * 4.4);
    rest = clamp(rest - hours * 3.1);
    shine = clamp(shine - hours * 3.8);
  }
  if (charge < 12) mood = clamp(mood - hours * 2);
  if (now - pet.lastChatAt > 8 * 3_600_000) mood = clamp(mood - hours * 0.6);
  return { ...pet, charge, mood, rest, shine, sleeping, lastTick: now };
}

function stampDay(pet: PetState, day: string, now = Date.now()): PetState {
  if (!day || pet.lastCareDay === day) return pet;
  const before = stageOf(pet);
  const next: PetState = {
    ...pet,
    lastCareDay: day,
    careStreak: pet.lastCareDay ? pet.careStreak + 1 : 1,
    careDays: pet.careDays + 1,
  };
  if (stageOf(next) !== before) next.lastGrowAt = now;
  return next;
}

export function stageOf(pet: PetState): PetStageId {
  if (!pet.hatched) return "battery";
  let id: PetStageId = "battery";
  for (const s of STAGES) {
    if (pet.careDays >= s.days) id = s.id;
  }
  return id;
}

export function nextStage(pet: PetState): { id: PetStageId; days: number } | null {
  const stage = stageOf(pet);
  const i = STAGES.findIndex((s) => s.id === stage);
  return STAGES[i + 1] ?? null;
}

export function stageProgress(pet: PetState): { now: number; next: number; t: number } {
  const stage = stageOf(pet);
  const i = STAGES.findIndex((s) => s.id === stage);
  const now = STAGES[Math.max(0, i)]?.days ?? 0;
  const nxt = STAGES[i + 1]?.days ?? now;
  if (nxt <= now) return { now, next: nxt, t: 1 };
  return { now, next: nxt, t: (pet.careDays - now) / (nxt - now) };
}

export function petAgeDays(pet: PetState, now = Date.now()): number {
  if (!pet.hatched) return 0;
  return Math.max(1, Math.floor((now - pet.bornAt) / 86_400_000) + 1);
}

export function careScore(pet: PetState): number {
  if (!pet.hatched) return 0;
  return Math.round((pet.charge + pet.mood + pet.rest + pet.shine) / 4);
}

export function needsCare(pet: PetState): boolean {
  return !pet.setupDone;
}

export function hasCareShield(pet: PetState): boolean {
  return pet.setupDone && pet.hatched && !pet.sleeping && careScore(pet) >= CARE_SHIELD && pet.charge >= 40;
}

export type PetSpeech =
  | "egg"
  | "hungry"
  | "tired"
  | "dirty"
  | "sad"
  | "happy"
  | "sleep"
  | "charge"
  | "play"
  | "polish"
  | "pet"
  | "hatch"
  | "lowSuns"
  | "tooTired"
  | "tooHungry"
  | "level"
  | "excited"
  | "calm"
  | "lonely"
  | "grumpy"
  | "proud"
  | "curious";

export function emotionOf(pet: PetState, now = Date.now()): PetEmotion {
  if (!pet.setupDone || !pet.hatched) return "curious";
  if (pet.sleeping || pet.rest < 22) return "sleepy";
  if (pet.charge < 28) return "hungry";
  if (pet.shine < 28) return "grumpy";
  if (pet.mood < 30) return "lonely";
  if (pet.lastGrowAt && now - pet.lastGrowAt < 22_000) return "proud";
  if (now - pet.lastPetAt < 10_000) return "excited";
  if (now - pet.lastChatAt < 80_000) return "curious";
  if (careScore(pet) >= 82 && pet.mood >= 70) return "happy";
  if (pet.mood >= 55 && pet.rest >= 48) return "calm";
  return "curious";
}

export function moodSpeech(pet: PetState, now = Date.now()): PetSpeech {
  if (!pet.setupDone) return "egg";
  if (!pet.hatched) return "egg";
  if (pet.sleeping) return "sleep";
  const e = emotionOf(pet, now);
  if (e === "hungry") return "hungry";
  if (e === "sleepy") return "tired";
  if (e === "grumpy") return "grumpy";
  if (e === "lonely") return "lonely";
  if (e === "excited") return "excited";
  if (e === "proud") return "proud";
  if (e === "calm") return "calm";
  if (e === "curious") return "curious";
  return "happy";
}

export function setupBuddy(
  pet: PetState,
  name: string,
  vibe: PetVibe,
  voice: PetVoice | "" = "",
  now = Date.now(),
): PetState {
  const n = cleanName(name);
  if (!n || !isPetVibe(vibe)) return pet;
  const ticked = tickPet(pet, now);
  const nextVoice = isPetVoice(voice) ? voice : ticked.voice;
  if (ticked.setupDone && ticked.name) {
    return { ...ticked, vibe, voice: nextVoice };
  }
  return {
    ...ticked,
    name: n,
    vibe,
    voice: nextVoice,
    setupDone: true,
    hatched: true,
    taps: HATCH_TAPS,
    bornAt: now,
    lastTick: now,
    charge: 86,
    mood: 90,
    rest: 82,
    shine: 88,
    sleeping: false,
    careDays: 0,
    lastGrowAt: 0,
  };
}

export function hatchTap(pet: PetState, now = Date.now()): { pet: PetState; hatched: boolean } {
  if (pet.hatched) return { pet, hatched: false };
  return { pet: setupBuddy(pet, pet.name || "Solarchik", pet.vibe, pet.voice, now), hatched: true };
}

export function pokePet(pet: PetState, now = Date.now(), day = ""): { pet: PetState; ok: boolean } {
  const ticked = tickPet(pet, now);
  if (!ticked.setupDone || !ticked.hatched || ticked.sleeping) return { pet: ticked, ok: false };
  if (now - ticked.lastPetAt < PET_COOLDOWN) return { pet: ticked, ok: false };
  return {
    pet: stampDay(
      {
        ...ticked,
        mood: clamp(ticked.mood + 7),
        lastPetAt: now,
        xp: ticked.xp + 1,
      },
      day,
      now,
    ),
    ok: true,
  };
}

export function chargePet(
  pet: PetState,
  suns: number,
  now = Date.now(),
  day = "",
): { pet: PetState; suns: number; ok: boolean } {
  const ticked = tickPet(pet, now);
  if (!ticked.setupDone || !ticked.hatched) return { pet: ticked, suns, ok: false };
  if (suns < CHARGE_COST) return { pet: ticked, suns, ok: false };
  if (ticked.charge >= 97) return { pet: ticked, suns, ok: false };
  return {
    pet: stampDay(
      {
        ...ticked,
        charge: clamp(ticked.charge + 30),
        mood: clamp(ticked.mood + 8),
        sleeping: false,
        xp: ticked.xp + 6,
        lastTick: now,
      },
      day,
      now,
    ),
    suns: suns - CHARGE_COST,
    ok: true,
  };
}

export function polishPet(
  pet: PetState,
  suns: number,
  now = Date.now(),
  day = "",
): { pet: PetState; suns: number; ok: boolean } {
  const ticked = tickPet(pet, now);
  if (!ticked.setupDone || !ticked.hatched) return { pet: ticked, suns, ok: false };
  if (suns < POLISH_COST) return { pet: ticked, suns, ok: false };
  if (ticked.shine >= 96) return { pet: ticked, suns, ok: false };
  return {
    pet: stampDay(
      {
        ...ticked,
        shine: clamp(ticked.shine + 36),
        mood: clamp(ticked.mood + 6),
        sleeping: false,
        xp: ticked.xp + 5,
        lastTick: now,
      },
      day,
      now,
    ),
    suns: suns - POLISH_COST,
    ok: true,
  };
}

export function toggleNap(pet: PetState, now = Date.now()): PetState {
  const ticked = tickPet(pet, now);
  if (!ticked.setupDone || !ticked.hatched) return ticked;
  if (ticked.sleeping) return { ...ticked, sleeping: false, lastTick: now };
  if (ticked.rest >= 92) return ticked;
  return { ...ticked, sleeping: true, lastTick: now };
}

export function canPlay(pet: PetState): boolean {
  return pet.setupDone && pet.hatched && !pet.sleeping && pet.charge >= 18 && pet.rest >= 16;
}

export function finishPlay(
  pet: PetState,
  caught: number,
  now = Date.now(),
  day = "",
): PetState {
  const ticked = tickPet(pet, now);
  if (!ticked.setupDone || !ticked.hatched) return ticked;
  const n = Math.max(0, Math.min(12, Math.floor(caught)));
  return stampDay(
    {
      ...ticked,
      mood: clamp(ticked.mood + 10 + n * 6),
      charge: clamp(ticked.charge - 8),
      rest: clamp(ticked.rest - 6),
      shine: clamp(ticked.shine - 3),
      xp: ticked.xp + 4 + n * 3,
      sleeping: false,
      lastTick: now,
    },
    day,
    now,
  );
}

export function applyRunToPet(pet: PetState, distance: number, now = Date.now(), day = ""): PetState {
  const ticked = tickPet(pet, now);
  if (!ticked.setupDone || !ticked.hatched) return ticked;
  const d = Math.max(0, distance);
  return stampDay(
    {
      ...ticked,
      mood: clamp(ticked.mood + 12),
      charge: clamp(ticked.charge - 9),
      rest: clamp(ticked.rest - 10),
      shine: clamp(ticked.shine - 5),
      xp: ticked.xp + Math.min(48, 8 + Math.round(d / 60)),
      sleeping: false,
      lastTick: now,
    },
    day,
    now,
  );
}

export type ChatGate = "ok" | "setup" | "sleep" | "busy" | "wait";

export function canChat(pet: PetState, now = Date.now(), _day = ""): ChatGate {
  if (!pet.setupDone || !pet.hatched) return "setup";
  if (now - pet.lastChatAt < CHAT_COOLDOWN) return "wait";
  return "ok";
}

export function appendChat(
  pet: PetState,
  userText: string,
  buddyText: string,
  now = Date.now(),
  day = "",
): PetState {
  const ticked = tickPet(pet, now);
  if (!ticked.setupDone || !ticked.hatched) return ticked;
  const user = cleanChat(userText);
  const buddy = cleanChat(buddyText);
  if (!user || !buddy) return ticked;
  const chat = [...ticked.chat, { role: "user" as const, text: user, at: now }, { role: "buddy" as const, text: buddy, at: now }].slice(
    -CHAT_CAP,
  );
  const chatCount = ticked.chatDay === day ? ticked.chatCount + 1 : 1;
  return stampDay(
    {
      ...ticked,
      chat,
      lastChatAt: now,
      chatDay: day,
      chatCount,
      mood: clamp(ticked.mood + 6),
      xp: ticked.xp + 2,
      lastTick: now,
      sleeping: false,
    },
    day,
    now,
  );
}

export function petSprite(_stage: PetStageId, _robot: RobotId | string | undefined): string {
  return "/sprites/pet/buddy-idle-1.png?v=2";
}

export function stageScale(stage: PetStageId): number {
  if (stage === "battery") return 0.72;
  if (stage === "sprout") return 0.82;
  if (stage === "kit") return 0.9;
  if (stage === "ace") return 1.08;
  if (stage === "legend") return 1.16;
  return 1;
}

export function hashName(name: string): number {
  let h = 2166136261;
  const s = name || "solarchik";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
