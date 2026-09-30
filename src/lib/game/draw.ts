import { type PlatSkin, type RunState, speedAt } from "./sim";
import { SKIN_PAL } from "./skins";
import { robotFilter, robotOf, type RobotId } from "./robots";
import { SPR, blit, heroFrame, ready } from "./sprites";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function hillPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: number,
  amp: number,
  cam: number,
  freq: number,
  seed: number,
) {
  ctx.beginPath();
  ctx.moveTo(-20, h + 20);
  ctx.lineTo(-20, base);
  for (let x = -20; x <= w + 24; x += 18) {
    const y =
      base +
      Math.sin((x + cam) * freq + seed) * amp +
      Math.sin((x + cam) * freq * 2.3 + seed * 1.7) * amp * 0.35;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w + 24, h + 20);
  ctx.closePath();
}

function paintSun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  const glow = ctx.createRadialGradient(x, y, r * 0.25, x, y, r * 2.4);
  glow.addColorStop(0, "rgba(255, 220, 150, 0.85)");
  glow.addColorStop(0.35, "rgba(255, 186, 110, 0.28)");
  glow.addColorStop(1, "rgba(255, 170, 90, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = "#ffe6b0";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const a = -0.9 + i * 0.28 + Math.sin(t * 0.12 + i) * 0.02;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
    ctx.lineTo(Math.cos(a) * r * 2.6, Math.sin(a) * r * 2.6);
    ctx.stroke();
  }
  ctx.restore();

  const core = ctx.createRadialGradient(x - r * 0.18, y - r * 0.18, r * 0.1, x, y, r);
  core.addColorStop(0, "#fff6d8");
  core.addColorStop(0.5, "#ffd27a");
  core.addColorStop(1, "#f0a24a");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function puffCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, a: number) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "#fff4e6";
  ctx.beginPath();
  ctx.ellipse(x, y, 38 * s, 16 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 22 * s, y + 4 * s, 22 * s, 12 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 24 * s, y + 3 * s, 20 * s, 11 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function solarArray(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  t: number,
  far = false,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.globalAlpha = far ? 0.55 : 0.92;
  ctx.fillStyle = "rgba(28, 22, 16, 0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 34, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = far ? "#4a5c52" : "#6b4a32";
  ctx.fillRect(-2, -6, 4, 16);
  ctx.fillStyle = far ? "#2a4a88" : "#1557c4";
  ctx.beginPath();
  ctx.moveTo(-30, -4);
  ctx.lineTo(28, -18);
  ctx.lineTo(28, -10);
  ctx.lineTo(-30, 4);
  ctx.closePath();
  ctx.fill();
  if (!far) {
    ctx.strokeStyle = "rgba(255, 214, 40, 0.4)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-26 + i * 12, -2 - i * 0.8);
      ctx.lineTo(-26 + i * 12 + 4, -14 - i * 0.8);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255, 230, 80, ${0.2 + 0.18 * Math.sin(t * 1.6 + x)})`;
    ctx.fillRect(-12, -14, 10, 3);
  }
  ctx.restore();
}

function cottage(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, lit: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(28, 20, 14, 0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 8, 36, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cbb59a";
  ctx.fillRect(-28, -28, 56, 36);
  ctx.fillStyle = "#1557c4";
  ctx.beginPath();
  ctx.moveTo(-34, -26);
  ctx.lineTo(0, -52);
  ctx.lineTo(34, -26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f2c400";
  ctx.beginPath();
  ctx.moveTo(-30, -26);
  ctx.lineTo(0, -48);
  ctx.lineTo(30, -26);
  ctx.lineTo(24, -26);
  ctx.lineTo(0, -40);
  ctx.lineTo(-24, -26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = lit ? "#ffd27a" : "#6a5a48";
  ctx.fillRect(-16, -12, 10, 10);
  ctx.fillRect(6, -10, 9, 9);
  ctx.fillStyle = "#7a5340";
  ctx.fillRect(-4, -4, 9, 12);
  ctx.restore();
}

function pole(ctx: CanvasRenderingContext2D, x: number, y: number, hgt: number) {
  ctx.fillStyle = "#4a372c";
  ctx.fillRect(x - 2, y - hgt, 4, hgt);
  ctx.fillStyle = "#3a2a22";
  ctx.fillRect(x - 10, y - hgt, 20, 3);
}

const SKIN = SKIN_PAL;

function drawWire(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  t: number,
  live: boolean,
) {
  ctx.save();
  ctx.strokeStyle = live ? "#9ad8ff" : "#5a6a78";
  ctx.lineWidth = live ? 4 : 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + w * 0.5, y + 16, x + w, y);
  ctx.stroke();
  if (live) {
    ctx.strokeStyle = `rgba(255, 227, 74, ${0.45 + 0.25 * Math.sin(t * 14)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffe34a";
    for (let i = 0; i < 4; i++) {
      const u = (t * 2.4 + i * 0.22) % 1;
      const px = x + w * u;
      const py = y + Math.sin(u * Math.PI) * 16;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = "#3a2a22";
  ctx.fillRect(x - 3, y - 18, 5, 22);
  ctx.fillRect(x + w - 2, y - 18, 5, 22);
  ctx.restore();
}

function drawPlat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  thick: number,
  t: number,
  glow = 0,
  skin: PlatSkin = "flag",
  kind: "roof" | "wire" = "roof",
  live = false,
) {
  if (kind === "wire") {
    drawWire(ctx, x, y, w, t, live);
    return;
  }
  const pal = SKIN[skin] ?? SKIN.flag;
  const wallH = Math.min(46, Math.max(26, thick * 2.1));
  ctx.save();
  ctx.fillStyle = "rgba(10, 22, 48, 0.28)";
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + thick + wallH + 4, Math.max(18, w * 0.42), 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f3e6d0";
  ctx.fillRect(x + 6, y + 6, w - 12, wallH);
  ctx.fillStyle = "#e2d0b4";
  ctx.fillRect(x + 6, y + wallH, w - 12, 7);
  if (w > 88) {
    const wy = y + 14;
    ctx.fillStyle = "#1d4e8f";
    ctx.fillRect(x + w * 0.62, wy, 18, 14);
    ctx.fillStyle = "rgba(255, 226, 150, 0.9)";
    ctx.fillRect(x + w * 0.62 + 2, wy + 2, 6, 5);
  }
  if (w > 150) {
    ctx.fillStyle = "#6a3824";
    ctx.fillRect(x + 18, y + wallH - 16, 14, 22);
  }

  ctx.fillStyle = pal.deep;
  roundRect(ctx, x, y + 1, w, thick + 7, 6);
  ctx.fill();
  ctx.fillStyle = pal.band;
  roundRect(ctx, x + 2, y + 2, w - 4, thick * 0.78, 5);
  ctx.fill();
  ctx.fillStyle = pal.cell;
  roundRect(ctx, x + 8, y + 6, w - 16, Math.max(8, thick * 0.42), 3);
  ctx.fill();

  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  const cols = Math.max(3, Math.floor(w / 18));
  for (let i = 1; i < cols; i++) {
    const gx = x + 8 + (i * (w - 16)) / cols;
    ctx.beginPath();
    ctx.moveTo(gx, y + 7);
    ctx.lineTo(gx, y + 6 + Math.max(8, thick * 0.42));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 6 + thick * 0.22);
  ctx.lineTo(x + w - 8, y + 6 + thick * 0.22);
  ctx.stroke();

  const glint = 0.18 + 0.16 * (0.5 + 0.5 * Math.sin(t * 2.1 + x * 0.015)) + glow * 0.2;
  ctx.fillStyle = pal.hi;
  ctx.globalAlpha = Math.min(0.65, glint);
  ctx.fillRect(x + 12, y + 8, Math.min(36, w * 0.22), 3);
  ctx.globalAlpha = 1;

  ctx.fillStyle = pal.lip;
  roundRect(ctx, x - 2, y - 5, w + 4, 10, 4);
  ctx.fill();
  ctx.fillStyle = pal.hi;
  ctx.fillRect(x + 8, y - 4, w - 16, 3);
  if (glow > 0) {
    ctx.fillStyle = pal.lip;
    ctx.globalAlpha = 0.14 * glow;
    roundRect(ctx, x - 6, y - 10, w + 12, thick + wallH + 8, 10);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawPortal(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const bob = Math.sin(t * 3.2 + x * 0.02) * 3;
  ctx.save();
  ctx.translate(x, y + bob);
  const pulse = 0.72 + 0.28 * Math.sin(t * 5);
  const halo = ctx.createRadialGradient(0, 0, 6, 0, 0, 78);
  halo.addColorStop(0, `rgba(255, 227, 74, ${0.62 * pulse})`);
  halo.addColorStop(0.42, `rgba(21, 87, 196, ${0.4 * pulse})`);
  halo.addColorStop(1, "rgba(21, 87, 196, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffe34a";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 58, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#1557c4";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#fff6c4";
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f0a24a";
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#143a8c";
  ctx.font = "700 13px Nunito, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("FLY", 0, -70);
  ctx.restore();
}

function drawPickup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  gold: boolean,
  shield: boolean,
  t: number,
  portal = false,
) {
  if (portal) {
    drawPortal(ctx, x, y, t);
    return;
  }
  const bob = Math.sin(t * 3.4 + x * 0.02) * 5;
  ctx.save();
  ctx.translate(x, y + bob);
  if (shield) {
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
    g.addColorStop(0, "rgba(160, 220, 255, 0.9)");
    g.addColorStop(1, "rgba(160, 220, 255, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8fd0ef";
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(11, -3);
    ctx.lineTo(7, 12);
    ctx.lineTo(-7, 12);
    ctx.lineTo(-11, -3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(-3, -3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const r = gold ? 18 : 15;
  const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 1.8);
  halo.addColorStop(0, "rgba(255, 210, 90, 0.85)");
  halo.addColorStop(1, "rgba(255, 180, 60, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(Math.sin(t * 1.6 + x) * 0.15);
  const core = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 1, 0, 0, r);
  core.addColorStop(0, "#fff6c4");
  core.addColorStop(0.55, gold ? "#ffc44a" : "#f0a24a");
  core.addColorStop(1, "#d47a28");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  const sway = Math.sin(t * 2.1) * 0.04;
  ctx.rotate(sway);
  ctx.fillStyle = "rgba(20, 16, 10, 0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 2, 28, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2f5a32";
  ctx.beginPath();
  ctx.ellipse(-14, -16, 16, 14, -0.2, 0, Math.PI * 2);
  ctx.ellipse(14, -16, 16, 14, 0.2, 0, Math.PI * 2);
  ctx.ellipse(0, -28, 18, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3f7340";
  ctx.beginPath();
  ctx.ellipse(-6, -22, 10, 8, 0, 0, Math.PI * 2);
  ctx.ellipse(8, -20, 9, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  const blink = Math.floor(t * 2) % 8 === 0;
  if (!blink) {
    ctx.fillStyle = "#f2d27a";
    ctx.beginPath();
    ctx.ellipse(-8, -30, 3.2, 3.6, 0, 0, Math.PI * 2);
    ctx.ellipse(8, -30, 3.2, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1410";
    ctx.beginPath();
    ctx.arc(-8, -30, 1.4, 0, Math.PI * 2);
    ctx.arc(8, -30, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function rgb(r: number, g: number, b: number) {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function mix3(a: number[], b: number[], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 0 day → 1 dusk → 2 night, then back to day. Cycle ~2800 m. */
function moodAt(distance: number) {
  const m = distance / 10;
  const cycle = 2800;
  const t = ((m % cycle) + cycle) % cycle;
  if (t < 1600) return 0;
  if (t < 1900) return (t - 1600) / 300;
  if (t < 2200) return 1 + (t - 1900) / 300;
  if (t < 2500) return 2;
  return 2 - ((t - 2500) / 300) * 2;
}

function paintStars(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, a: number) {
  if (a < 0.04) return;
  ctx.fillStyle = `rgba(255, 244, 210, ${a})`;
  for (let i = 0; i < 42; i++) {
    const px = hash(i + 3) * w;
    const py = hash(i + 17) * h * 0.55;
    const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * (0.7 + hash(i) * 1.4) + i));
    ctx.globalAlpha = a * tw;
    ctx.beginPath();
    ctx.arc(px, py, 0.7 + hash(i + 4) * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintAurora(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, a: number) {
  if (a < 0.05) return;
  ctx.save();
  ctx.globalAlpha = a * 0.45;
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    const col = k === 0 ? "rgba(40, 120, 255, 0.55)" : "rgba(255, 210, 40, 0.4)";
    ctx.strokeStyle = col;
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 16) {
      const y = h * (0.16 + k * 0.08) + Math.sin(x * 0.008 + t * 0.35 + k) * 22;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function paintSky(ctx: CanvasRenderingContext2D, w: number, h: number, mood = 0) {
  const dusk = Math.min(1, mood);
  const night = Math.max(0, mood - 1);
  const top = mix3([111, 164, 196], mix3([55, 62, 130], [8, 14, 38], night), dusk);
  const mid = mix3([240, 199, 160], mix3([220, 110, 90], [28, 42, 92], night), dusk);
  const bot = mix3([217, 180, 138], mix3([120, 70, 80], [18, 28, 52], night), dusk);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgb(top[0], top[1], top[2]));
  g.addColorStop(0.42, rgb(mid[0], mid[1], mid[2]));
  g.addColorStop(1, rgb(bot[0], bot[1], bot[2]));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function paintGardenSky(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#1a5fb8");
  g.addColorStop(0.32, "#4aa7e8");
  g.addColorStop(0.58, "#9fd6ff");
  g.addColorStop(0.82, "#ffe08a");
  g.addColorStop(1, "#f7c45a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  paintSun(ctx, w * 0.78, h * 0.14, Math.min(h * 0.14, 86), t);
  ctx.fillStyle = "rgba(255, 227, 74, 0.28)";
  for (let i = 0; i < 16; i++) {
    const px = ((hash(i + 4) * w + t * (22 + hash(i) * 30)) % (w + 50)) - 20;
    const py = hash(i + 11) * h * 0.7;
    ctx.beginPath();
    ctx.arc(px, py, 5 + hash(i) * 11, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintRain(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(190, 214, 255, 0.28)";
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 46; i++) {
    const px = ((hash(i) * w + t * 420) % (w + 40)) - 20;
    const py = ((hash(i + 8) * h + t * 760) % (h + 30)) - 10;
    ctx.moveTo(px, py);
    ctx.lineTo(px + 7, py + 18);
  }
  ctx.stroke();
  ctx.restore();
}

function paintBolt(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, a: number) {
  if (a < 0.04) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = "#e8f2ff";
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let x = w * (0.2 + hash(seed) * 0.6);
  let y = 0;
  ctx.moveTo(x, y);
  while (y < h * 0.72) {
    x += (hash(seed + y) - 0.5) * 38;
    y += 18 + hash(seed + y + 3) * 22;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 227, 74, 0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function paintMotes(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, reduced: boolean) {
  if (reduced) return;
  ctx.fillStyle = "rgba(255, 236, 200, 0.35)";
  for (let i = 0; i < 12; i++) {
    const px = ((hash(i + 2) * w + t * (8 + hash(i) * 18)) % (w + 40)) - 20;
    const py = hash(i + 9) * h * 0.7 + Math.sin(t * 0.6 + i) * 10;
    ctx.beginPath();
    ctx.arc(px, py, 1.1 + hash(i + 3) * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const v = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.2, w * 0.5, h * 0.5, h * 0.85);
  v.addColorStop(0, "rgba(20, 12, 8, 0)");
  v.addColorStop(1, "rgba(20, 12, 8, 0.28)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

export function drawHero(
  ctx: CanvasRenderingContext2D,
  feetX: number,
  feetY: number,
  size: number,
  phase: number,
  grounded: boolean,
  squash: number,
  stretch: number,
  blink: boolean,
  air: boolean,
  vy = 0,
  rot = 0,
  alpha = 1,
  robot: RobotId = "stock",
) {
  if (robot !== "stock") {
    const run = SPR.robotRun(robot);
    const live = run.filter((img) => ready(img));
    if (live.length >= 2) {
      let frame = live[0];
      if (air || !grounded) {
        frame = live[Math.min(3, live.length - 1)] ?? live[0];
      } else {
        const n = live.length;
        const i = ((Math.floor(phase) % n) + n) % n;
        frame = live[i] ?? live[0];
      }
      blit(ctx, frame, feetX, feetY, size, { squash, stretch, rot, alpha });
      return;
    }
    const kit = SPR.robotSide(robot);
    if (kit && ready(kit)) {
      const bob = grounded ? Math.abs(Math.sin(phase * 0.9)) * 0.28 : 0.08;
      const lean = grounded ? Math.sin(phase * 0.9) * 0.16 : rot;
      blit(ctx, kit, feetX, feetY, size, { squash: squash + bob, stretch, rot: lean, alpha });
      return;
    }
  }
  const frame = air || !grounded ? heroFrame(false, vy, phase, squash) : heroFrame(true, 0, phase, squash);
  const filter = robotFilter(robot);
  const opts = { squash, stretch, rot, alpha, filter };
  if (blit(ctx, frame, feetX, feetY, size, opts)) {
    paintVisor(ctx, feetX, feetY, size, robot, squash, stretch);
    return;
  }
  if (blit(ctx, SPR.idle(), feetX, feetY, size, opts)) {
    paintVisor(ctx, feetX, feetY, size, robot, squash, stretch);
    return;
  }
  void blink;
}

function paintVisor(
  ctx: CanvasRenderingContext2D,
  feetX: number,
  feetY: number,
  size: number,
  robot: RobotId,
  squash: number,
  stretch: number,
) {
  if (robot === "stock") return;
  const def = robotOf(robot);
  const sy = 1 - squash * 0.16 + stretch * 0.1;
  const headY = feetY - size * 0.72 * sy;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = def.visor;
  roundRect(ctx, feetX - size * 0.16, headY - size * 0.04, size * 0.32, size * 0.07, 3);
  ctx.fill();
  ctx.restore();
}

export function drawYardHero(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  t: number,
) {
  const w = ctx.canvas.clientWidth || 160;
  const h = ctx.canvas.clientHeight || 210;
  paintSky(ctx, w, h);
  paintSun(ctx, w * 0.82, h * 0.18, Math.min(w, h) * 0.12, t);
  hillPath(ctx, w, h, h * 0.72, h * 0.04, 40, 0.03, 1.2);
  ctx.fillStyle = "#6f9458";
  ctx.fill();
  hillPath(ctx, w, h, h * 0.82, h * 0.03, 10, 0.04, 2.1);
  ctx.fillStyle = "#567a44";
  ctx.fill();
  const bob = Math.sin(t * 2.2) * 5;
  ctx.fillStyle = "rgba(26, 18, 12, 0.28)";
  ctx.beginPath();
  ctx.ellipse(x, y + 2, size * 0.28, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!blit(ctx, SPR.front(), x, y + bob, size)) {
    blit(ctx, SPR.idle(), x, y + bob, size);
  }
}

function heroGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  charged: boolean,
) {
  const g = ctx.createRadialGradient(x, y - size * 0.42, 6, x, y - size * 0.4, size * (charged ? 0.7 : 0.48));
  if (charged) {
    g.addColorStop(0, "rgba(120, 190, 255, 0.45)");
    g.addColorStop(0.45, "rgba(255, 210, 60, 0.22)");
    g.addColorStop(1, "rgba(255, 170, 80, 0)");
  } else {
    g.addColorStop(0, "rgba(255, 200, 120, 0.22)");
    g.addColorStop(1, "rgba(255, 170, 80, 0)");
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - size * 0.42, size * (charged ? 0.7 : 0.48), 0, Math.PI * 2);
  ctx.fill();
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: RunState,
  clock: number,
) {
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const trauma = reduced ? 0 : s.shake * s.shake;
  const ox = Math.sin(clock * 41.2) * 14 * trauma;
  const oy = Math.cos(clock * 33.7) * 10 * trauma;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const mood = s.bonus ? 0 : moodAt(s.distance);
  const dusk = Math.min(1, mood);
  const night = Math.max(0, mood - 1);
  const storming = !s.bonus && s.distance > 16000;
  if (s.bonus) paintGardenSky(ctx, w, h, clock);
  else paintSky(ctx, w, h, mood);
  if (storming) {
    ctx.fillStyle = `rgba(8, 16, 40, ${0.2 + 0.08 * Math.sin(s.stormT * 1.4)})`;
    ctx.fillRect(0, 0, w, h);
  }
  paintStars(ctx, w, h, clock, s.bonus ? 0 : night * 0.9);
  paintAurora(ctx, w, h, clock, s.bonus ? 0 : Math.max(0, night - 0.15));

  ctx.save();
  ctx.translate(ox, oy);

  const heroH = Math.min(h * 0.22, 138);
  const hillTop = h * 0.87;
  const playTop = h * 0.52;
  const playBot = hillTop - 14;
  const sy = (wy: number) => playTop + ((wy - 140) / 150) * (playBot - playTop);

  const look = speedAt(s) * 0.18;
  const camX = s.x - w * 0.27 + look;
  const spd = speedAt(s);

  if (!s.bonus) {
  const sunY = h * (0.1 + dusk * 0.16 + night * 0.22);
  ctx.globalAlpha = Math.max(0, 1 - night * 1.1);
  paintSun(ctx, w * 0.88, sunY, Math.min(h * 0.07, 52), clock);
  ctx.globalAlpha = 1;
  if (night > 0.35) {
    ctx.fillStyle = `rgba(230, 236, 255, ${Math.min(0.85, night * 0.7)})`;
    ctx.beginPath();
    ctx.arc(w * 0.14, h * 0.12, 11, 0, Math.PI * 2);
    ctx.fill();
  }

  puffCloud(ctx, ((-camX * 0.08) % (w + 260)) + 40, h * 0.12, 1.15, 0.55 - night * 0.35);
  puffCloud(ctx, ((-camX * 0.12 + 420) % (w + 300)) + 20, h * 0.2, 0.75, 0.4 - night * 0.25);
  puffCloud(ctx, ((-camX * 0.07 + 880) % (w + 240)) + 10, h * 0.1, 1.0, 0.48 - night * 0.3);

  hillPath(ctx, w, h, h * 0.42, h * 0.03, camX * 0.1, 0.005, 0.4);
  ctx.fillStyle = rgb(...mix3([155, 184, 178], [40, 55, 90], Math.max(dusk, night)));
  ctx.fill();

  hillPath(ctx, w, h, h * 0.72, h * 0.038, camX * 0.28, 0.008, 1.1);
  ctx.fillStyle = rgb(...mix3([111, 148, 88], [32, 58, 70], Math.max(dusk * 0.7, night)));
  ctx.fill();

  hillPath(ctx, w, h, h * 0.86, h * 0.028, camX * 0.48, 0.011, 2.2);
  ctx.fillStyle = rgb(...mix3([86, 122, 68], [24, 48, 52], Math.max(dusk * 0.6, night)));
  ctx.fill();

  const housePar = camX * 0.4;
  const scenery = [SPR.cottage, SPR.greenhouse, SPR.cottage, SPR.tracker];
  for (let i = 0; i < scenery.length; i++) {
    const px = ((i * 360 - housePar) % (w + 260) + w + 260) % (w + 260) - 40;
    const img = scenery[i]();
    const hgt = i % 2 === 0 ? 92 : 78;
    if (!blit(ctx, img, px, hillTop + 8, hgt)) cottage(ctx, px, hillTop + 18, 0.42, i % 2 === 0);
  }

  const polePar = camX * 0.5;
  const poles: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const px = ((i * 220 - polePar + 40) % (w + 200) + w + 200) % (w + 200) - 30;
    const py = hillTop + 18 + Math.sin(i) * 4;
    poles.push({ x: px, y: py });
    pole(ctx, px, py, 34);
  }
  poles.sort((a, b) => a.x - b.x);
  ctx.strokeStyle = "rgba(42, 30, 22, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i];
    const b = poles[i + 1];
    if (b.x - a.x > 280) continue;
    ctx.moveTo(a.x, a.y - 34);
    ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 44, b.x, b.y - 34);
  }
  ctx.stroke();

  const nearPar = camX * 0.62;
  const panel = SPR.panel();
  for (let i = 0; i < 5; i++) {
    const px = ((i * 250 - nearPar + 90) % (w + 160) + w + 160) % (w + 160) - 30;
    if (!blit(ctx, panel, px, hillTop + 6, 62)) solarArray(ctx, px, hillTop + 18, 0.7, clock);
  }
  } else {
    puffCloud(ctx, ((-camX * 0.16) % (w + 260)) + 40, h * 0.18, 1.35, 0.7);
    puffCloud(ctx, ((-camX * 0.22 + 420) % (w + 300)) + 20, h * 0.32, 1.05, 0.55);
    puffCloud(ctx, ((-camX * 0.12 + 880) % (w + 240)) + 10, h * 0.12, 1.2, 0.62);
    puffCloud(ctx, ((-camX * 0.19 + 180) % (w + 280)) + 30, h * 0.46, 0.9, 0.4);
  }

  paintMotes(ctx, w, h, clock, reduced);
  if (storming && !reduced) paintRain(ctx, w, h, clock);

  const thick = Math.max(16, h * 0.028);
  if (!s.bonus) {
  for (const p of s.plats) {
    const x = p.x - camX;
    if (x + p.w < -40 || x > w + 40) continue;
    const live = s.grind && s.grounded && s.x >= p.x - 12 && s.x <= p.x + p.w + 12 && p.kind === "wire";
    drawPlat(ctx, x, sy(p.y), p.w, thick, clock, s.fever + night * 0.45, s.bonus ? "gold" : s.skin, p.kind, live);
  }
  }

  const bosses = s.enemies.filter((e) => e.boss && !e.dead).sort((a, b) => a.x - b.x);
  if (bosses.length > 1) {
    ctx.save();
    ctx.strokeStyle = "rgba(80, 180, 255, 0.55)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    bosses.forEach((e, i) => {
      const px = e.x - camX;
      const py = sy(e.y) - 18;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 227, 74, 0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  for (const e of s.enemies) {
    if (e.dead) continue;
    const x = e.x - camX;
    if (x < -50 || x > w + 50) continue;
    const ey = sy(e.y);
    if (e.kind === "bush") {
      drawBush(ctx, x, ey, clock + e.t);
    } else if (e.kind === "mite") {
      if (!blit(ctx, SPR.mite(), x, ey + 2, 64)) {
        ctx.fillStyle = "#8a4a28";
        ctx.beginPath();
        ctx.ellipse(x, ey - 18, 20, 16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.kind === "drone") {
      const size = e.boss ? 74 : 62;
      if (!blit(ctx, SPR.drone(), x, ey, size)) {
        ctx.fillStyle = e.boss ? "#2a88c8" : "#3d6a6a";
        ctx.beginPath();
        ctx.ellipse(x, ey - 20, e.boss ? 26 : 22, 16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (e.boss) {
        ctx.fillStyle = "rgba(255, 227, 74, 0.35)";
        ctx.beginPath();
        ctx.arc(x, ey - 18, 16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  for (const pick of s.picks) {
    if (pick.taken) continue;
    const x = pick.x - camX;
    if (x < -30 || x > w + 30) continue;
    drawPickup(ctx, x, sy(pick.y), pick.gold, pick.shield, clock, pick.portal);
  }

  for (const p of s.particles) {
    const a = Math.max(0, p.life / 0.5);
    ctx.globalAlpha = a;
    if (p.ring) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(p.x - camX, sy(p.y), p.r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - camX, sy(p.y), p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  if (!reduced && spd > 230) {
    const dens = Math.min(0.22, (spd - 230) / 850);
    const n = spd > 320 ? 9 : 6;
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const yy = h * 0.28 + i * h * 0.07;
      const len = 26 + (i % 3) * 22 + (spd - 220) * 0.08;
      const sx = ((clock * spd * 0.55 + i * 90) % (w + 80)) - 40;
      ctx.strokeStyle = i % 2 === 0 ? `rgba(255, 220, 40, ${dens})` : `rgba(80, 150, 255, ${dens})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(sx, yy);
      ctx.lineTo(sx + len, yy);
      ctx.stroke();
    }
  }

  const blink = s.invuln > 0 && Math.floor(clock * 16) % 2 === 0;
  if (!blink || s.phase === "countdown") {
    const hx = s.x - camX;
    const hy = sy(s.y) + 2;
    const sliding = s.slide > 0 && s.grounded;
    const rot = s.bonus ? Math.max(-0.5, Math.min(0.55, s.vy / 860)) : 0;
    const charged = s.fever > 0 || s.combo >= 4 || s.grind;
    const squash = sliding ? Math.max(s.squash, 0.92) : s.squash;
    const stretch = sliding ? 0 : s.stretch;
    ctx.fillStyle = "rgba(22, 14, 10, 0.28)";
    ctx.beginPath();
    ctx.ellipse(hx, hy + 3, heroH * 0.22, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    heroGlow(ctx, hx, hy, heroH, charged);
    drawHero(ctx, hx, hy, heroH * (sliding ? 0.78 : 1), s.runPhase, s.grounded, squash, stretch, false, !s.grounded, s.vy, rot, 1, s.robot);
  }

  ctx.fillStyle = "#3a2416";
  ctx.font = `700 ${Math.max(16, h * 0.028)}px Nunito, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const pop of s.pops) {
    const py = sy(pop.y);
    if (py < 78 || py > h - 24) continue;
    ctx.globalAlpha = Math.min(1, pop.life * 2);
    ctx.fillStyle = "#143a8c";
    ctx.fillText(pop.text, pop.x - camX + 1, py + 1);
    ctx.fillStyle = "#ffe34a";
    ctx.fillText(pop.text, pop.x - camX, py);
  }
  ctx.globalAlpha = 1;

  const intro = s.plats.find((p) => p.kind === "roof" && p.x < 40);
  const lip = intro ? intro.x + intro.w : 1020;
  if (!s.bonus && s.phase === "running" && s.grounded && s.x > lip - 380 && s.x < lip - 18) {
    const gx = lip - 28 - camX;
    if (gx > 48 && gx < w - 36) {
      const pulse = 0.72 + Math.sin(clock * 5) * 0.18;
      ctx.globalAlpha = pulse;
      roundRect(ctx, gx - 42, sy(intro?.y ?? 216) - 126, 84, 34, 16);
      ctx.fillStyle = "rgba(26, 20, 16, 0.72)";
      ctx.fill();
      ctx.fillStyle = "#f6ead8";
      ctx.font = `600 ${Math.max(18, h * 0.03)}px Fredoka, sans-serif`;
      ctx.fillText("TAP", gx, sy(intro?.y ?? 216) - 109);
    }
    ctx.globalAlpha = 1;
  }

  if (s.fever > 0) {
    ctx.fillStyle = `rgba(255, 210, 40, ${0.07 * s.fever})`;
    ctx.fillRect(-ox, -oy, w, h);
    ctx.fillStyle = `rgba(30, 90, 220, ${0.05 * s.fever})`;
    ctx.fillRect(-ox, -oy, w, h);
  }

  ctx.restore();
  if (s.lightning > 0 && !s.bonus) {
    ctx.fillStyle = `rgba(230, 240, 255, ${s.lightning * 0.42})`;
    ctx.fillRect(0, 0, w, h);
    paintBolt(ctx, w, h, s.distance | 0, s.lightning);
  }
  if (s.flash > 0) {
    ctx.fillStyle = `rgba(255, 72, 48, ${s.flash * 0.32})`;
    ctx.fillRect(0, 0, w, h);
  }
  paintVignette(ctx, w, h);
  void ready;
}
