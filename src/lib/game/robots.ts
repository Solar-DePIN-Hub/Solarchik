export const ROBOT_IDS = [
  "stock",
  "sunflower",
  "midnight",
  "emberkit",
  "frostkit",
  "mosskit",
  "copperkit",
  "carbonkit",
  "hetman",
  "prismkit",
] as const;

export type RobotId = (typeof ROBOT_IDS)[number];

export type RobotDef = {
  id: RobotId;
  cost: number;
  hue: number;
  sat: number;
  bright: number;
  body: string;
  visor: string;
  accent: string;
};

export const ROBOTS: RobotDef[] = [
  { id: "stock", cost: 0, hue: 0, sat: 1, bright: 1, body: "#3a86c8", visor: "#7ad8ff", accent: "#ffe34a" },
  { id: "sunflower", cost: 90, hue: 28, sat: 1.35, bright: 1.05, body: "#e0a030", visor: "#fff4a8", accent: "#fff6d0" },
  { id: "midnight", cost: 140, hue: 210, sat: 1.25, bright: 0.92, body: "#1a3a6a", visor: "#7ec8ff", accent: "#c9a6ff" },
  { id: "emberkit", cost: 180, hue: -18, sat: 1.45, bright: 1.02, body: "#8a2a18", visor: "#ff8a3a", accent: "#ffd0a0" },
  { id: "frostkit", cost: 220, hue: 172, sat: 0.95, bright: 1.12, body: "#6ec4d4", visor: "#e8fbff", accent: "#ffffff" },
  { id: "mosskit", cost: 260, hue: 88, sat: 1.3, bright: 0.98, body: "#2f6a32", visor: "#b7e07a", accent: "#e8f7c8" },
  { id: "copperkit", cost: 320, hue: 12, sat: 1.5, bright: 1.0, body: "#b45a2a", visor: "#ffc08a", accent: "#ffe8cc" },
  { id: "carbonkit", cost: 380, hue: 0, sat: 0.12, bright: 0.88, body: "#2a3036", visor: "#c8d2d8", accent: "#f0f4f6" },
  { id: "hetman", cost: 450, hue: 205, sat: 1.15, bright: 1.04, body: "#1557c4", visor: "#ffe34a", accent: "#fff6a8" },
  { id: "prismkit", cost: 600, hue: 268, sat: 1.55, bright: 1.08, body: "#6a1ea8", visor: "#7ef0d4", accent: "#fff4a8" },
];

export function isRobotId(id: string): id is RobotId {
  return (ROBOT_IDS as readonly string[]).includes(id);
}

export function robotOf(id: RobotId | string | undefined): RobotDef {
  return ROBOTS.find((r) => r.id === id) ?? ROBOTS[0];
}

export function robotFilter(id: RobotId | string | undefined): string {
  const r = robotOf(id);
  if (r.id === "stock") return "none";
  return `hue-rotate(${r.hue}deg) saturate(${r.sat}) brightness(${r.bright})`;
}

export function robotPortrait(
  id: RobotId | string | undefined,
  pose: "front" | "yard" | "side" = "front",
): string {
  const r = robotOf(id);
  if (pose === "yard") return `/sprites/robots/${r.id}-yard.png?v=11`;
  if (pose === "side") return `/sprites/robots/${r.id}-side.png?v=11`;
  return `/sprites/robots/${r.id}.png?v=11`;
}
