import type { PlatSkin } from "./skins";
import type { RobotId } from "./robots";

export type { PlatSkin } from "./skins";
export { SKINS, SKIN_IDS } from "./skins";
export type PlatKind = "roof" | "wire";
export type Plat = { x: number; y: number; w: number; kind: PlatKind };
export type Pick = {
  x: number;
  y: number;
  gold: boolean;
  shield: boolean;
  portal?: boolean;
  taken: boolean;
};
export type EnemyKind = "mite" | "drone" | "bush";
export type Enemy = {
  kind: EnemyKind;
  x: number;
  y: number;
  baseY: number;
  dead: boolean;
  near: boolean;
  t: number;
  vx: number;
  boss?: boolean;
};
export type Pop = { x: number; y: number; text: string; life: number };
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  r: number;
  color: string;
  ring?: boolean;
  streak?: boolean;
};
export type DayMod = "calm" | "wind" | "gold" | "drones" | "wire";

export type Phase = "countdown" | "running" | "dead";

export type Ev =
  | "jump"
  | "double"
  | "land"
  | "collect"
  | "gold"
  | "hurt"
  | "near"
  | "combo"
  | "dead"
  | "tick"
  | "stomp"
  | "shield"
  | "slide"
  | "grind"
  | "bonus"
  | "thunder"
  | "boss"
  | "chapter"
  | "clock";

export type Input = {
  jumpPressed: boolean;
  jumpHeld: boolean;
  slidePressed: boolean;
  slideHeld: boolean;
};

export type RunState = {
  seed: number;
  phase: Phase;
  countdown: number;
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  hearts: number;
  shield: number;
  score: number;
  suns: number;
  stomps: number;
  combo: number;
  comboTimer: number;
  maxCombo: number;
  coyote: number;
  jumpBuf: number;
  airJumps: number;
  jumpAge: number;
  cutJump: boolean;
  invuln: number;
  hitstop: number;
  squash: number;
  stretch: number;
  shake: number;
  flash: number;
  runPhase: number;
  plats: Plat[];
  picks: Pick[];
  enemies: Enemy[];
  pops: Pop[];
  particles: Particle[];
  checkpoint: { x: number; y: number };
  death: "" | "FALL" | "HIT";
  hasJumped: boolean;
  distance: number;
  fever: number;
  spawnX: number;
  lastBand: number;
  rngState: number;
  sinceHazard: number;
  slide: number;
  grind: boolean;
  bonus: boolean;
  bonusLeft: number;
  didBonus: boolean;
  bossDone: boolean;
  stormT: number;
  skin: PlatSkin;
  robot: RobotId;
  lightning: number;
  slideHint: boolean;
  chapter: ChapterId;
  announce: string;
  announceLife: number;
  mod: DayMod;
  ghostTape: { x: number; y: number; grounded: boolean }[];
  ghostBucket: number;
  lastHeartSaid: boolean;
  clockSaid: boolean;
  clockOpen: boolean;
};

export const BANDS = [168, 216, 264] as const;
export const HEARTS = 3;

export type ChapterId = "sunrise" | "village" | "storm" | "night" | "serpent";
export type Chapter = { id: ChapterId; label: string; banner: string; meters: number };

export const CHAPTERS: Chapter[] = [
  { id: "sunrise", label: "Sunrise", banner: "SUNRISE ROOFS", meters: 0 },
  { id: "village", label: "Village", banner: "VILLAGE ROOFS", meters: 500 },
  { id: "storm", label: "Storm", banner: "STORM LINE", meters: 1600 },
  { id: "night", label: "Night", banner: "NIGHT FARM", meters: 2000 },
  { id: "serpent", label: "Serpent", banner: "THE SERPENT", meters: 2500 },
];

export function chapterAt(distance: number): Chapter {
  const m = distance / 10;
  let cur = CHAPTERS[0];
  for (const c of CHAPTERS) {
    if (m >= c.meters) cur = c;
  }
  return cur;
}

export function chapterLabel(id: ChapterId) {
  return CHAPTERS.find((c) => c.id === id)?.label ?? CHAPTERS[0].label;
}

export const SHIFTS = [
  "Amber Eaves",
  "Flag Lane",
  "Dusk Chimneys",
  "Sun Farm",
  "Wire Walk",
  "Storm Gutters",
  "Night Panels",
  "Serpent Roost",
  "Gold Veranda",
  "Quiet Coop",
] as const;

export function shiftName(seed: number) {
  return SHIFTS[Math.abs(seed) % SHIFTS.length];
}

const GRAVITY_UP = 1480;
const GRAVITY_DOWN = 2400;
const JUMP_V = -620;
const DOUBLE_V = -680;
const STOMP_V = -640;
const TERMINAL = 1150;
const SPEED0 = 188;
const SPEED_CAP = 355;
const COYOTE = 0.22;
const BUFFER = 0.16;
const FEET = 12;
const FALL_Y = 348;
const PW = 14;
const PH = 62;
const PH_SLIDE = 24;
const SLIDE_TIME = 0.48;

type Box = { l: number; r: number; t: number; b: number };

function rng(state: number) {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const next = t ^ (t >>> 14);
  return { next, value: (next >>> 0) / 4294967296 };
}

function rand(s: RunState, a: number, b: number) {
  const r = rng(s.rngState);
  s.rngState = r.next;
  return a + (b - a) * r.value;
}

function chance(s: RunState, p: number) {
  return rand(s, 0, 1) < p;
}

export function speedAt(state: RunState) {
  const heat = state.fever > 0 ? 10 : 0;
  const grind = state.grind ? 18 : 0;
  return Math.min(SPEED_CAP + 16, SPEED0 + state.distance * 0.018 + heat + grind);
}

function speedAtDist(distance: number) {
  return Math.min(SPEED_CAP, SPEED0 + distance * 0.018);
}

function feetOn(px: number, p: Plat) {
  return px >= p.x - FEET && px <= p.x + p.w + FEET;
}

function playerBox(s: RunState): Box {
  const h = s.slide > 0 ? PH_SLIDE : PH;
  return { l: s.x - PW, r: s.x + PW, t: s.y - h, b: s.y - 2 };
}

function enemyBox(e: Enemy): Box {
  if (e.kind === "bush") return { l: e.x - 24, r: e.x + 24, t: e.y - 20, b: e.y };
  if (e.kind === "drone") return { l: e.x - 22, r: e.x + 22, t: e.y - 28, b: e.y + 6 };
  return { l: e.x - 24, r: e.x + 24, t: e.y - 32, b: e.y };
}

function aabb(a: Box, b: Box) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

function emit(
  list: Particle[],
  x: number,
  y: number,
  n: number,
  color: string,
  spread = 90,
  speed = 180,
) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * spread * (Math.PI / 180);
    const sp = speed * (0.4 + Math.random() * 0.8);
    list.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.28 + Math.random() * 0.35,
      r: 2.5 + Math.random() * 3.5,
      color,
    });
  }
}

function emitRing(list: Particle[], x: number, y: number, color: string) {
  list.push({ x, y, vx: 0, vy: -8, life: 0.34, r: 10, color, ring: true });
}

function addPlat(s: RunState, x: number, y: number, w: number, kind: PlatKind = "roof") {
  s.plats.push({ x, y, w, kind });
}

function addEnemy(s: RunState, kind: EnemyKind, x: number, y: number, boss = false) {
  const hover = kind === "drone" ? (boss ? 56 : s.mod === "drones" ? 28 : 46) : 0;
  const base = y - hover;
  s.enemies.push({
    kind,
    x,
    y: base,
    baseY: base,
    dead: false,
    near: false,
    t: rand(s, 0, Math.PI * 2),
    vx: kind === "mite" ? (rand(s, 0, 1) < 0.5 ? -78 : 78) : 0,
    boss,
  });
}

function dropSuns(s: RunState, x: number, y: number, w: number) {
  const rich = s.mod === "gold";
  const ax = x + w * 0.62;
  s.picks.push({
    x: ax,
    y: y - 54,
    gold: rich && chance(s, 0.35),
    shield: false,
    taken: false,
  });
  if (chance(s, rich ? 1 : 0.4)) {
    s.picks.push({
      x: ax + 34,
      y: y - 54,
      gold: rich && chance(s, 0.45),
      shield: false,
      taken: false,
    });
  }
  if (rich && chance(s, 0.5)) {
    s.picks.push({
      x: ax - 36,
      y: y - 62,
      gold: true,
      shield: false,
      taken: false,
    });
  }
}

function timeAt(x: number) {
  const k = 0.018;
  const capX = (SPEED_CAP - SPEED0) / k;
  if (x <= 0) return 0;
  if (x <= capX) return Math.log((SPEED0 + k * x) / SPEED0) / k;
  return Math.log(SPEED_CAP / SPEED0) / k + (x - capX) / SPEED_CAP;
}

function twoRows(x: number) {
  const start = timeAt(1760);
  const t = timeAt(x);
  if (t < start) return false;
  return Math.floor((t - start) / 10) % 2 === 0;
}

function standPlat(s: RunState) {
  let best: Plat | undefined;
  for (const p of s.plats) {
    if (!feetOn(s.x, p) || Math.abs(s.y - p.y) >= 22) continue;
    if (!best || Math.abs(s.y - p.y) < Math.abs(s.y - best.y)) best = p;
  }
  return best;
}

function landPlat(s: RunState, prevY: number) {
  let best: Plat | undefined;
  for (const p of s.plats) {
    if (!feetOn(s.x, p)) continue;
    if (!(prevY <= p.y + 22 && s.y >= p.y - 2)) continue;
    if (!best || p.y < best.y) best = p;
  }
  return best;
}

function pickPiece(s: RunState, x: number): "pair" | "wire" | "mite" | "drone" | "calm" {
  if (x < 980) return "calm";
  const roll = rand(s, 0, 1);
  const drones = s.mod === "drones" || x > 5200;
  if (s.mod === "wire" && roll < 0.38) return "wire";
  if (s.mod === "drones" && drones && roll < 0.34) return "drone";
  if (roll < 0.28) return "mite";
  if (roll < 0.62) return "pair";
  if (roll < 0.74 && drones) return "drone";
  if (s.mod === "wire" && roll < 0.86) return "wire";
  return "calm";
}

function spawnChunk(s: RunState, fromX: number, count: number) {
  if (s.bonus) return;
  let x = fromX;
  let band = s.lastBand;

  for (let i = 0; i < count; i++) {
    const dist = Math.max(s.x, x);
    const diff = Math.min(1, Math.max(0, (dist - 3800) / 9000));
    const minGap = 92;
    const maxGap = 114;
    let gap = minGap + rand(s, 0, maxGap - minGap);
    gap = Math.max(minGap, Math.min(maxGap, gap));

    const w = Math.max(210, Math.min(320, 270 - diff * 24 + rand(s, -16, 18)));
    const lift = twoRows(x) && Math.floor(x / 1400) % 2 === 1;
    const y = lift ? BANDS[0] : BANDS[1];
    const piece = pickPiece(s, x);
    if (piece === "pair") {
      const a = Math.max(200, Math.floor(w * 0.9));
      const b = Math.max(190, Math.floor(w * 0.86));
      const g = gap;
      addPlat(s, x, y, a);
      dropSuns(s, x, y, a);
      addPlat(s, x + a + g, y, b);
      dropSuns(s, x + a + g, y, b);
      x += a + g + b + Math.max(40, gap * 0.6);
      s.sinceHazard += 1;
    } else if (piece === "wire") {
      addPlat(s, x, y, w);
      dropSuns(s, x, y, w);
      const ww = Math.max(88, Math.min(130, w * 0.28));
      const lead = Math.max(44, Math.min(70, gap));
      addPlat(s, x + w + lead, y, ww, "wire");
      x += w + lead + ww + 40;
      s.sinceHazard = 0;
    } else if (piece === "mite") {
      addPlat(s, x, y, w);
      dropSuns(s, x, y, w);
      addEnemy(s, "mite", x + w * 0.55, y);
      x += w + gap;
      s.sinceHazard = 0;
    } else if (piece === "drone") {
      addPlat(s, x, y, w);
      addEnemy(s, "drone", x + w * 0.62, y);
      s.picks.push({
        x: x + w * 0.42,
        y: y - 58,
        gold: s.mod === "gold" || chance(s, 0.2),
        shield: false,
        taken: false,
      });
      x += w + gap;
      s.sinceHazard = 0;
    } else {
      addPlat(s, x, y, w);
      dropSuns(s, x, y, w);
      if (x > 4200 && chance(s, s.mod === "gold" ? 0.12 : 0.05)) {
        s.picks.push({ x: x + w * 0.5, y: y - 58, gold: false, shield: true, taken: false });
      }
      x += w + gap;
      s.sinceHazard += 1;
    }
  }
  s.lastBand = band;
  s.spawnX = x;
}

function spawnBoss(s: RunState) {
  const x = Math.max(s.spawnX, s.x + 420);
  addPlat(s, x, BANDS[1], 1100);
  for (let i = 0; i < 7; i++) {
    addEnemy(s, "drone", x + 160 + i * 95, BANDS[1], true);
  }
  s.spawnX = x + 1100 + 160;
  s.lastBand = 1;
  s.pops.push({ x: x + 200, y: BANDS[1] - 110, text: "SERPENT", life: 1.4 });
  s.bossDone = true;
}

function fillBonusSuns(s: RunState) {
  let maxX = s.x + 70;
  for (const p of s.picks) {
    if (!p.taken && !p.portal) maxX = Math.max(maxX, p.x);
  }
  let guard = 0;
  while (maxX < s.x + 1800 && guard < 52) {
    guard += 1;
    maxX += 34 + rand(s, 0, 16);
    const wave = Math.sin(maxX * 0.014) * 72;
    const y = Math.max(102, Math.min(278, 186 + wave));
    s.picks.push({
      x: maxX,
      y,
      gold: chance(s, 0.38),
      shield: false,
      taken: false,
    });
    if (chance(s, 0.5)) {
      s.picks.push({
        x: maxX + 10,
        y: Math.max(102, Math.min(278, 230 - wave * 0.7)),
        gold: chance(s, 0.22),
        shield: false,
        taken: false,
      });
    }
  }
}

function enterBonus(s: RunState, events: Ev[]) {
  s.bonus = true;
  s.didBonus = true;
  s.bonusLeft = 18;
  s.fever = 2.4;
  s.shield = 1;
  s.slide = 0;
  s.grind = false;
  s.grounded = false;
  s.plats = s.plats.filter((p) => p.x + p.w < s.x - 20);
  s.picks = [];
  s.enemies = s.enemies.filter((e) => e.x < s.x - 40);
  s.y = BANDS[0] + 8;
  s.vy = -280;
  s.airJumps = 1;
  events.push("bonus");
  s.announce = "SKY FLIGHT";
  s.announceLife = 2.6;
  s.pops.push({ x: s.x, y: s.y - 90, text: "FLY!", life: 1.3 });
  fillBonusSuns(s);
  s.spawnX = s.x;
}

function exitBonus(s: RunState) {
  s.bonus = false;
  s.bonusLeft = 0;
  s.shield = 1;
  s.fever = 1.15;
  s.invuln = 1.4;
  s.slide = 0;
  s.grind = false;
  s.pops.push({ x: s.x, y: s.y - 88, text: "BACK TO ROOFS", life: 1.1 });
  const landX = s.x - 180;
  const landW = 1100;
  s.plats = s.plats.filter((p) => p.x + p.w < landX);
  addPlat(s, landX, BANDS[1], landW);
  s.y = BANDS[1];
  s.vy = 0;
  s.grounded = true;
  s.lastBand = 1;
  s.checkpoint = { x: s.x, y: BANDS[1] };
  s.spawnX = landX + landW;
  s.picks = s.picks.filter((p) => p.x < s.x - 20);
  spawnChunk(s, s.spawnX, 16);
}

export function createRun(seed: number, opts?: { skin?: PlatSkin; robot?: RobotId; offerBonus?: boolean; careBoost?: boolean; mod?: DayMod }): RunState {
  const s: RunState = {
    seed,
    phase: "countdown",
    countdown: 1.2,
    x: 120,
    y: BANDS[1],
    vy: 0,
    grounded: true,
    hearts: HEARTS,
    shield: opts?.careBoost ? 1 : 0,
    score: 0,
    suns: 0,
    stomps: 0,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    coyote: COYOTE,
    jumpBuf: 0,
    airJumps: 1,
    jumpAge: 0,
    cutJump: false,
    invuln: 0,
    hitstop: 0,
    squash: 0,
    stretch: 0,
    shake: 0,
    flash: 0,
    runPhase: 0,
    plats: [],
    picks: [],
    enemies: [],
    pops: [],
    particles: [],
    checkpoint: { x: 120, y: BANDS[1] },
    death: "",
    hasJumped: false,
    distance: 0,
    fever: 0,
    spawnX: 0,
    lastBand: 1,
    rngState: seed || 1,
    sinceHazard: 3,
    slide: 0,
    grind: false,
    bonus: false,
    bonusLeft: 0,
    didBonus: false,
    bossDone: false,
    stormT: 0,
    skin: opts?.skin ?? "flag",
    robot: opts?.robot ?? "stock",
    lightning: 0,
    slideHint: false,
    chapter: "sunrise",
    announce: "",
    announceLife: 0,
    mod: opts?.mod ?? "calm",
    ghostTape: [],
    ghostBucket: -1,
    lastHeartSaid: false,
    clockSaid: false,
    clockOpen: false,
  };

  addPlat(s, 0, BANDS[1], 420);
  addEnemy(s, "mite", 300, BANDS[1]);
  const lead = s.enemies[s.enemies.length - 1];
  if (lead) lead.vx = -36;
  addPlat(s, 534, BANDS[1], 250);
  addPlat(s, 890, BANDS[0], 230);
  addPlat(s, 1234, BANDS[1], 260);
  s.picks.push(
    { x: 210, y: BANDS[1] - 54, gold: false, shield: false, taken: false },
    { x: 244, y: BANDS[1] - 54, gold: false, shield: false, taken: false },
    { x: 640, y: BANDS[1] - 54, gold: s.mod === "gold", shield: false, taken: false },
    { x: 990, y: BANDS[0] - 54, gold: false, shield: false, taken: false },
    { x: 1024, y: BANDS[0] - 54, gold: false, shield: false, taken: false },
  );
  if (opts?.offerBonus) {
    s.picks.push({
      x: 640,
      y: BANDS[1] - 48,
      gold: false,
      shield: false,
      portal: true,
      taken: false,
    });
    s.pops.push({ x: 640, y: BANDS[1] - 130, text: "FLY GATE", life: 3.2 });
  }
  s.lastBand = 1;
  s.spawnX = 1600;
  spawnChunk(s, s.spawnX, 16);
  return s;
}

function doJump(s: RunState, events: Ev[], doubleJump: boolean) {
  s.vy = doubleJump ? DOUBLE_V : s.mod === "wind" ? JUMP_V * 0.94 : JUMP_V;
  s.grounded = false;
  s.coyote = 0;
  s.jumpBuf = 0;
  s.jumpAge = 0;
  s.cutJump = false;
  s.stretch = 1;
  s.squash = 0;
  s.slide = 0;
  s.grind = false;
  s.hasJumped = true;
  if (doubleJump) {
    s.airJumps = 0;
    events.push("double");
    emit(s.particles, s.x, s.y - 20, 12, "#5aa8ff", 240, 200);
    emit(s.particles, s.x, s.y - 24, 8, "#ffd24a", 200, 160);
  } else {
    s.airJumps = 1;
    events.push("jump");
    emit(s.particles, s.x, s.y, 6, "#e8d9b0", 80, 90);
  }
}

function startSlide(s: RunState, events: Ev[]) {
  if (s.bonus) return;
  if (s.slide > 0.12) return;
  if (!s.grounded) return;
  s.slide = SLIDE_TIME;
  s.squash = 1;
  s.jumpBuf = 0;
  s.grind = false;
  events.push("slide");
  emit(s.particles, s.x, s.y, 8, "#c9d8ff", 70, 70);
}

function loseHeart(s: RunState, events: Ev[], why: "FALL" | "HIT") {
  if (s.invuln > 0 || s.phase !== "running") return;
  if (s.shield > 0 && why === "HIT") {
    s.shield = 0;
    s.invuln = 0.95;
    s.shake = 0.4;
    s.flash = 0.28;
    events.push("shield");
    emit(s.particles, s.x, s.y - 30, 16, "#7ec8ff", 240, 200);
    s.pops.push({ x: s.x, y: s.y - 80, text: "SHIELD", life: 0.55 });
    return;
  }
  s.hearts -= 1;
  s.death = why;
  s.shake = Math.min(1, s.shake + (why === "HIT" ? 1 : 0.55));
  s.flash = why === "HIT" ? 0.72 : 0.22;
  s.hitstop = why === "HIT" ? 0.05 : 0.03;
  events.push("hurt");
  emit(s.particles, s.x, s.y - 30, 18, why === "HIT" ? "#e0564a" : "#e8b931", 260, 220);
  if (why === "HIT") {
    s.grounded = false;
    s.vy = -360;
    s.x -= 26;
    s.grind = false;
  }
  if (s.hearts <= 0) {
    s.phase = "dead";
    s.grounded = false;
    events.push("dead");
    return;
  }
  s.combo = 0;
  s.comboTimer = 0;
  s.airJumps = 1;
  s.coyote = COYOTE;
  s.invuln = 1.45;
  s.slide = 0;
  if (why === "FALL") {
    s.x = s.checkpoint.x + 22;
    s.y = s.checkpoint.y;
    s.vy = 0;
    s.grounded = true;
    s.grind = false;
  }
}

function stomp(s: RunState, e: Enemy, events: Ev[]) {
  e.dead = true;
  s.vy = STOMP_V;
  s.grounded = false;
  s.airJumps = 1;
  s.squash = 0.7;
  s.hitstop = 0.055;
  s.shake = Math.min(1, s.shake + 0.38);
  s.stomps += 1;
  s.combo += 1;
  s.maxCombo = Math.max(s.maxCombo, s.combo);
  s.comboTimer = 1.9;
  const gain = 32 + s.combo * 6;
  s.score += gain;
  s.pops.push({
    x: e.x,
    y: e.y - 44,
    text: s.combo > 1 ? `${s.combo}x` : "STOMP",
    life: 0.65,
  });
  events.push("stomp");
  if (s.combo === 4 || s.combo === 8 || s.combo === 12) {
    events.push("combo");
    s.fever = 1.4;
  }
  emit(s.particles, e.x, e.y - 10, 16, e.kind === "drone" ? "#6ec8c4" : "#c47a3a", 230, 220);
  emitRing(s.particles, e.x, e.y - 8, "#ffe27a");
}

export function step(prev: RunState, dtRaw: number, input: Input): { state: RunState; events: Ev[] } {
  const s: RunState = prev;
  const events: Ev[] = [];
  const dt = Math.min(dtRaw, 0.05);

  s.squash = Math.max(0, s.squash - dt * 5.5);
  s.stretch = Math.max(0, s.stretch - dt * 4.2);
  s.shake = Math.max(0, s.shake - dt * 2.4);
  s.flash = Math.max(0, s.flash - dt * 3.2);
  s.lightning = Math.max(0, s.lightning - dt * 2.8);
  s.invuln = Math.max(0, s.invuln - dt);
  s.fever = Math.max(0, s.fever - dt);
  s.comboTimer = Math.max(0, s.comboTimer - dt);
  s.slide = Math.max(0, s.slide - dt);
  s.announceLife = Math.max(0, s.announceLife - dt);
  if (s.comboTimer <= 0 && s.combo > 0) s.combo = 0;

  s.pops = s.pops.filter((p) => {
    p.life -= dt;
    p.y -= 42 * dt;
    return p.life > 0;
  });
  s.particles = s.particles.filter((p) => {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.ring) p.r += 70 * dt;
    else p.vy += 520 * dt;
    return p.life > 0;
  });
  if (s.particles.length > 160) s.particles = s.particles.slice(-160);

  for (const e of s.enemies) {
    if (e.dead) continue;
    e.t += dt;
    if (e.kind === "drone") {
      const amp = e.boss ? 14 : 10;
      e.y = e.baseY + Math.sin(e.t * (e.boss ? 2.2 : 3.2) + e.x * 0.01) * amp;
    } else if (e.kind === "mite") {
      const plat = s.plats.find((p) => p.kind !== "wire" && e.x >= p.x - 6 && e.x <= p.x + p.w + 6);
      if (plat) {
        e.y = plat.y;
        e.baseY = plat.y;
        if (!e.vx) e.vx = e.t > Math.PI ? -78 : 78;
        e.x += e.vx * dt;
        if (e.x < plat.x + 24) {
          e.x = plat.x + 24;
          e.vx = Math.abs(e.vx);
        } else if (e.x > plat.x + plat.w - 24) {
          e.x = plat.x + plat.w - 24;
          e.vx = -Math.abs(e.vx);
        }
      }
    }
  }

  if (s.phase === "dead") {
    if (!s.grounded) {
      s.vy = Math.min(TERMINAL, s.vy + GRAVITY_DOWN * dt);
      s.y += s.vy * dt;
    }
    return { state: s, events };
  }

  if (s.phase === "countdown") {
    s.countdown -= dt;
    if (input.jumpPressed) s.jumpBuf = BUFFER;
    if (input.slidePressed) startSlide(s, events);
    if (s.countdown <= 0) {
      s.phase = "running";
      s.countdown = 0;
      events.push("tick");
    }
    return { state: s, events };
  }

  if (s.clockOpen && s.phase === "running") {
    return { state: s, events };
  }

  if (s.hitstop > 0) {
    s.hitstop -= dt;
    if (input.jumpPressed) s.jumpBuf = BUFFER;
    return { state: s, events };
  }

  if (s.bonus) {
    s.bonusLeft -= dt;
    if (s.bonusLeft <= 0) exitBonus(s);
  }

  const storming = !s.bonus && s.distance > 16000;
  if (storming) {
    s.stormT += dt;
    if (s.stormT > 3.6) {
      s.stormT = 0;
      s.lightning = 0.55;
      events.push("thunder");
    }
  }

  const spd = speedAt(s);
  s.x += spd * dt;
  if (s.mod === "wind") s.x += 18 * dt;
  s.distance = s.x;
  s.runPhase += dt * (s.grounded ? 6.4 + spd * 0.006 : 3);
  if (s.phase === "running") {
    const bucket = (s.x | 0) / 48 | 0;
    if (bucket !== s.ghostBucket) {
      s.ghostBucket = bucket;
      s.ghostTape.push({ x: s.x, y: s.y, grounded: s.grounded });
      if (s.ghostTape.length > 480) s.ghostTape.splice(0, s.ghostTape.length - 480);
    }
  }

  if (!s.bonus) {
    const ch = chapterAt(s.distance);
    if (ch.id !== s.chapter) {
      s.chapter = ch.id;
      s.announce = ch.banner;
      s.announceLife = 1.7;
      events.push("chapter");
      s.pops.push({ x: s.x, y: s.y - 100, text: ch.banner, life: 1.15 });
    }
    if (!s.clockSaid && s.distance / 10 >= 1200) {
      s.clockSaid = true;
      s.clockOpen = true;
      s.shake = 1;
      s.hitstop = Math.max(s.hitstop, 0.08);
      s.vy = 0;
      s.announce = "";
      s.announceLife = 0;
      s.pops.push({ x: s.x, y: s.y - 88, text: "1200", life: 0.7 });
      events.push("clock");
    }
  }

  if (s.mod === "wind" && s.grounded && s.phase === "running" && Math.random() < 0.55) {
    s.particles.push({
      x: s.x - 12,
      y: s.y - 6,
      vx: -90 - Math.random() * 40,
      vy: -16 - Math.random() * 24,
      life: 0.28,
      r: 1.6 + Math.random() * 1.6,
      color: "#efe2c4",
    });
  }

  if ((s.fever > 0 || s.grind) && s.grounded) {
    s.particles.push({
      x: s.x - 10,
      y: s.y - 8,
      vx: -20,
      vy: -30 - Math.random() * 40,
      life: 0.18,
      r: 2 + Math.random() * 2,
      color: s.grind ? "#9ad0ff" : Math.random() < 0.5 ? "#ffe34a" : "#3d7cff",
    });
  }

  if (!s.bonus && !s.bossDone && s.x > 25000) {
    spawnBoss(s);
    events.push("boss");
  }

  if (!s.slideHint && !s.bonus) {
    const drone = s.enemies.find((e) => !e.dead && e.kind === "drone" && e.x > s.x && e.x < s.x + 300);
    if (drone) {
      s.slideHint = true;
      s.pops.push({ x: drone.x, y: drone.y - 36, text: "SLIDE", life: 1.35 });
    }
  }

  if (s.spawnX < s.x + 2800) spawnChunk(s, s.spawnX, 8);
  if (!s.bonus && s.phase === "running") {
    const roofAhead = s.plats.some((p) => p.x + p.w > s.x + 240);
    if (!roofAhead) {
      const x0 = s.x - 60;
      addPlat(s, x0, BANDS[1], 520);
      s.lastBand = 1;
      s.spawnX = x0 + 520;
      spawnChunk(s, s.spawnX, 12);
    }
  }

  if (s.bonus) {
    s.slide = 0;
    s.grind = false;
    s.grounded = false;
    s.fever = Math.max(s.fever, 1.35);
    if (input.jumpPressed) {
      s.vy = -520;
      s.stretch = 1;
      s.jumpAge = 0;
      events.push("jump");
      emit(s.particles, s.x - 8, s.y - 8, 8, "#ffe34a", 110, 90);
    }
    s.jumpAge += dt;
    s.vy = Math.min(720, s.vy + 1380 * dt);
    s.y += s.vy * dt;
    if (s.y < 88) {
      s.y = 88;
      s.vy = Math.max(0, s.vy);
    }
    if (s.y > 292) {
      s.y = 292;
      s.vy = Math.min(0, s.vy);
    }
    emit(s.particles, s.x - 16, s.y - 22, 2, Math.random() < 0.5 ? "#ffe34a" : "#7ec8ff", 70, 40);
    fillBonusSuns(s);
  } else {
  if (input.slideHeld && s.grounded) {
    if (s.slide <= 0) startSlide(s, events);
    else s.slide = Math.max(s.slide, 0.2);
  } else if (input.slidePressed) {
    startSlide(s, events);
  }

  if (input.jumpPressed) s.jumpBuf = BUFFER;
  else s.jumpBuf = Math.max(0, s.jumpBuf - dt);

  s.coyote = s.grounded ? COYOTE : Math.max(0, s.coyote - dt);
  if (s.grounded) s.airJumps = 1;

  if (s.slide > 0 && s.jumpBuf > 0 && s.coyote > 0) {
    s.jumpBuf = 0;
  }

  if (s.jumpBuf > 0 && s.coyote > 0 && s.slide <= 0) {
    doJump(s, events, false);
  } else if (s.jumpBuf > 0 && !s.grounded && s.airJumps > 0) {
    doJump(s, events, true);
  }

  const prevY = s.y;
  if (s.grounded) {
    s.vy = 0;
    const stand = standPlat(s);
    if (stand) {
      s.y = stand.y;
      s.checkpoint = { x: stand.x + Math.min(40, stand.w * 0.2), y: stand.y };
      s.grind = stand.kind === "wire";
    } else {
      s.grounded = false;
      s.grind = false;
    }
  }

  if (s.grind && s.grounded) {
    s.score += dt * 55;
  }

  if (!s.grounded) {
    s.jumpAge += dt;
    let g = s.vy < 0 ? GRAVITY_UP : GRAVITY_DOWN;
    if (s.mod === "wind" && s.vy < 0) g *= 1.22;
    if (s.vy < 0 && !input.jumpHeld && !s.cutJump && s.jumpAge > 0.28) {
      s.vy *= 0.55;
      s.cutJump = true;
    }
    if (Math.abs(s.vy) < 46) g *= 0.62;
    s.vy = Math.min(TERMINAL, s.vy + g * dt);
    s.y += s.vy * dt;
  }

  let stomped = false;
  if (!s.bonus && s.invuln <= 0 && s.slide <= 0) {
    const pb = playerBox(s);
    for (const e of s.enemies) {
      if (e.dead) continue;
      const eb = enemyBox(e);
      if (e.kind === "bush") continue;
      const fromAbove = prevY - 2 <= eb.t + 10;
      if (s.vy > 55 && fromAbove && aabb(pb, eb)) {
        stomp(s, e, events);
        stomped = true;
        break;
      }
    }
  }

  if (!s.grounded && !stomped && s.vy > 18) {
    const land = landPlat(s, prevY);
    if (land) {
      s.y = land.y;
      s.vy = 0;
      s.grounded = true;
      s.coyote = COYOTE;
      s.airJumps = 1;
      s.squash = 1;
      s.stretch = 0;
      s.grind = land.kind === "wire";
      s.checkpoint = { x: land.x + Math.min(40, land.w * 0.2), y: land.y };
      events.push(land.kind === "wire" ? "grind" : "land");
      emit(s.particles, s.x, s.y, 8, land.kind === "wire" ? "#7ec8ff" : "#cbb07a", 80, 90);
      emitRing(s.particles, s.x, s.y, land.kind === "wire" ? "#7ec8ff" : "rgba(243,226,196,0.9)");
      if (land.kind === "wire") {
        s.score += 40;
        s.pops.push({ x: s.x, y: s.y - 70, text: "GRIND", life: 0.6 });
      } else if (s.x - land.x < 28) {
        s.score += 16;
        s.pops.push({ x: s.x, y: s.y - 70, text: "NICE", life: 0.55 });
      }
    }
  }
  }

  if (s.fever > 0) {
    for (const pick of s.picks) {
      if (pick.taken) continue;
      const dx = s.x - pick.x;
      const dy = s.y - 40 - pick.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 130 * 130 && d2 > 4) {
        const d = Math.sqrt(d2);
        pick.x += (dx / d) * dt * 280;
        pick.y += (dy / d) * dt * 280;
      }
    }
  }

  for (const pick of s.picks) {
    if (pick.taken) continue;
    if (pick.portal && !s.bonus) {
      if (Math.abs(pick.x - s.x) < 52) {
        pick.taken = true;
        enterBonus(s, events);
      }
      continue;
    }
    const dx = pick.x - s.x;
    const dy = pick.y - (s.y - 48);
    const hit = s.bonus ? 70 : 56;
    if (dx * dx + dy * dy < hit * hit) {
      pick.taken = true;
      if (pick.shield) {
        s.shield = 1;
        events.push("shield");
        s.pops.push({ x: pick.x, y: pick.y - 10, text: "SHIELD", life: 0.7 });
        emit(s.particles, pick.x, pick.y, 14, "#7ec8ff", 200, 170);
      } else {
        s.suns += 1;
        s.combo += 1;
        s.maxCombo = Math.max(s.maxCombo, s.combo);
        s.comboTimer = 1.85;
        const mult = 1 + Math.min(8, s.combo) * 0.35;
        const gain = Math.round((pick.gold ? 40 : 16) * mult);
        s.score += gain;
        s.pops.push({
          x: s.x,
          y: s.y - 72,
          text: pick.gold ? "+SUN" : "+1",
          life: 0.55,
        });
        events.push(pick.gold ? "gold" : "collect");
        if (s.combo === 4 || s.combo === 8 || s.combo === 12) {
          events.push("combo");
          s.fever = 1.4;
          s.pops.push({ x: s.x, y: s.y - 96, text: `${s.combo}x HEAT`, life: 0.85 });
        }
        emit(s.particles, pick.x, pick.y, pick.gold ? 16 : 9, pick.gold ? "#ffd24a" : "#ffb703", 200, 160);
      }
      s.hitstop = Math.max(s.hitstop, 0.02);
    }
  }

  if (s.invuln <= 0 && s.phase === "running") {
    const pb = playerBox(s);
    for (const e of s.enemies) {
      if (e.dead) continue;
      const eb = enemyBox(e);
      if (aabb(pb, eb)) {
        loseHeart(s, events, "HIT");
        break;
      }
      if (
        (e.kind === "mite" || e.kind === "drone") &&
        !e.near &&
        Math.abs(e.x - s.x) <= 18 &&
        Math.abs(e.y - s.y) < 90
      ) {
        e.near = true;
        s.hitstop = Math.max(s.hitstop, 0.034);
        s.shake = Math.min(1, s.shake + 0.28);
        s.score += 8;
        s.particles.push({
          x: s.x - 6,
          y: s.y - 28,
          vx: -70,
          vy: 0,
          life: 0.18,
          r: 2,
          color: "#fffdf8",
          streak: true,
        });
        s.pops.push({ x: s.x, y: s.y - 78, text: "CLOSE", life: 0.4 });
        events.push("near");
      }
      const ducked = s.slide > 0 && e.kind === "drone" && Math.abs(e.x - s.x) < 28 && pb.t > eb.b - 4;
      if (ducked && !e.near) {
        e.near = true;
        events.push("near");
        s.score += 22;
        s.pops.push({ x: e.x, y: e.y - 36, text: "UNDER", life: 0.5 });
      }
      if (!s.grounded && s.vy >= 0 && pb.b < eb.t && pb.r > eb.l && pb.l < eb.r && !e.near) {
        e.near = true;
        events.push("near");
        s.score += e.kind === "bush" ? 18 : 12;
        s.pops.push({ x: e.x, y: e.y - 36, text: "CLEAN", life: 0.5 });
        emit(s.particles, e.x, e.y - 20, 6, "#d6f5a3", 140, 100);
      }
    }
  }

  if (!s.bonus && !s.grounded && s.y > FALL_Y) {
    loseHeart(s, events, "FALL");
  }

  s.score += dt * (2.2 + s.combo * 0.6 + speedAt(s) * 0.01);

  const cull = Math.min(s.x, s.checkpoint.x) - 700;
  s.plats = s.plats.filter((p) => p.x + p.w > cull);
  s.picks = s.picks.filter((p) => p.x > cull && !p.taken);
  s.enemies = s.enemies.filter((e) => e.x > cull && !e.dead);

  return { state: s, events };
}
