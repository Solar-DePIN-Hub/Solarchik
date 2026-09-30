export const SKIN_IDS = [
  "flag",
  "gold",
  "moss",
  "frost",
  "storm",
  "cherry",
  "copper",
  "night",
  "lime",
  "ember",
  "ocean",
  "sand",
  "violet",
  "carbon",
  "rose",
  "mint",
  "sunset",
  "polar",
  "magma",
  "prism",
] as const;

export type PlatSkin = (typeof SKIN_IDS)[number];

export type SkinPal = {
  cell: string;
  deep: string;
  lip: string;
  hi: string;
  band: string;
  grid: string;
};

export const SKIN_PAL: Record<PlatSkin, SkinPal> = {
  flag: { cell: "#1557c4", deep: "#0e3fa0", lip: "#ffe34a", hi: "#fff6a8", band: "#f2c400", grid: "rgba(255,214,40,0.35)" },
  gold: { cell: "#e8b931", deep: "#c49218", lip: "#fff4b0", hi: "#fffdf0", band: "#8a5a12", grid: "rgba(255,255,220,0.45)" },
  moss: { cell: "#2f6a32", deep: "#1d4520", lip: "#b7e07a", hi: "#e8f7c8", band: "#1a3a1c", grid: "rgba(183,224,122,0.4)" },
  frost: { cell: "#6ec4d4", deep: "#2f7a8c", lip: "#e8fbff", hi: "#ffffff", band: "#1d4c58", grid: "rgba(232,251,255,0.45)" },
  storm: { cell: "#1a3a6a", deep: "#0d2448", lip: "#7ec8ff", hi: "#d6f0ff", band: "#143056", grid: "rgba(126,200,255,0.4)" },
  cherry: { cell: "#c43a58", deep: "#8a1e38", lip: "#ffb0c4", hi: "#ffe4ec", band: "#5a1424", grid: "rgba(255,176,196,0.4)" },
  copper: { cell: "#b45a2a", deep: "#7a3414", lip: "#ffc08a", hi: "#ffe8cc", band: "#4a220e", grid: "rgba(255,192,138,0.4)" },
  night: { cell: "#1b1650", deep: "#0e0a32", lip: "#c9a6ff", hi: "#f0e6ff", band: "#2a1f6a", grid: "rgba(180,140,255,0.35)" },
  lime: { cell: "#6aa31a", deep: "#3e6a0c", lip: "#d8ff6a", hi: "#f4ffc8", band: "#2a4408", grid: "rgba(216,255,106,0.4)" },
  ember: { cell: "#8a2a18", deep: "#5a140c", lip: "#ff8a3a", hi: "#ffd0a0", band: "#3a100c", grid: "rgba(255,160,60,0.4)" },
  ocean: { cell: "#0e6e72", deep: "#084448", lip: "#7ef0ea", hi: "#d8fffc", band: "#063438", grid: "rgba(126,240,234,0.4)" },
  sand: { cell: "#d2b07a", deep: "#a07a48", lip: "#fff0cc", hi: "#fffaf0", band: "#6a4e28", grid: "rgba(255,240,204,0.45)" },
  violet: { cell: "#5a2a8a", deep: "#38185c", lip: "#d8b0ff", hi: "#f4e8ff", band: "#241038", grid: "rgba(216,176,255,0.4)" },
  carbon: { cell: "#2a3036", deep: "#14181c", lip: "#c8d2d8", hi: "#f0f4f6", band: "#0c1014", grid: "rgba(200,210,216,0.35)" },
  rose: { cell: "#c46a7a", deep: "#8a3e4c", lip: "#ffd0d8", hi: "#fff0f2", band: "#5a2430", grid: "rgba(255,208,216,0.4)" },
  mint: { cell: "#3eaa88", deep: "#22705a", lip: "#b8ffe4", hi: "#ecfff6", band: "#164838", grid: "rgba(184,255,228,0.4)" },
  sunset: { cell: "#e07038", deep: "#a04018", lip: "#ffd08a", hi: "#fff0d0", band: "#5a220c", grid: "rgba(255,208,138,0.4)" },
  polar: { cell: "#d8e8f4", deep: "#7a98b0", lip: "#ffffff", hi: "#ffffff", band: "#3a5060", grid: "rgba(255,255,255,0.5)" },
  magma: { cell: "#4a120c", deep: "#240808", lip: "#ff6a22", hi: "#ffc080", band: "#1a0604", grid: "rgba(255,106,34,0.45)" },
  prism: { cell: "#2a6ad4", deep: "#6a1ea8", lip: "#7ef0d4", hi: "#fff4a8", band: "#1a1048", grid: "rgba(126,240,212,0.45)" },
};

export type SkinDef = { id: PlatSkin; label: string; cost: number };

export const SKINS: SkinDef[] = [
  { id: "flag", label: "Flag", cost: 0 },
  { id: "gold", label: "Gold", cost: 40 },
  { id: "moss", label: "Moss", cost: 55 },
  { id: "frost", label: "Frost", cost: 70 },
  { id: "storm", label: "Storm", cost: 85 },
  { id: "cherry", label: "Cherry", cost: 100 },
  { id: "copper", label: "Copper", cost: 120 },
  { id: "night", label: "Night", cost: 140 },
  { id: "lime", label: "Lime", cost: 165 },
  { id: "ember", label: "Ember", cost: 190 },
  { id: "ocean", label: "Ocean", cost: 220 },
  { id: "sand", label: "Sand", cost: 250 },
  { id: "violet", label: "Violet", cost: 290 },
  { id: "carbon", label: "Carbon", cost: 330 },
  { id: "rose", label: "Rose", cost: 380 },
  { id: "mint", label: "Mint", cost: 440 },
  { id: "sunset", label: "Sunset", cost: 510 },
  { id: "polar", label: "Polar", cost: 590 },
  { id: "magma", label: "Magma", cost: 680 },
  { id: "prism", label: "Prism", cost: 800 },
];

export function isPlatSkin(id: string): id is PlatSkin {
  return (SKIN_IDS as readonly string[]).includes(id);
}

export function skinCost(id: PlatSkin): number {
  return SKINS.find((s) => s.id === id)?.cost ?? 0;
}

export function skinLabel(id: PlatSkin): string {
  return SKINS.find((s) => s.id === id)?.label ?? id;
}
