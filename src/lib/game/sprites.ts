const cache = new Map<string, HTMLCanvasElement | HTMLImageElement>();
const loading = new Map<string, HTMLImageElement>();

export type Gfx = HTMLCanvasElement | HTMLImageElement;

function isMagenta(r: number, g: number, b: number, a: number) {
  if (a < 10) return true;
  if (r >= 140 && g <= 95 && b >= 70 && r - g >= 70 && b - g >= 35) return true;
  if (r >= 170 && g <= 90 && b >= 150) return true;
  return false;
}

function keyAndCrop(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) {
    const fallback = document.createElement("canvas");
    fallback.width = w;
    fallback.height = h;
    fallback.getContext("2d")?.drawImage(img, 0, 0);
    return fallback;
  }
  sctx.drawImage(img, 0, 0);
  const id = sctx.getImageData(0, 0, w, h);
  const d = id.data;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isMagenta(d[i], d[i + 1], d[i + 2], d[i + 3])) {
        d[i + 3] = 0;
      } else if (d[i + 3] > 12) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  sctx.putImageData(id, 0, 0);
  if (maxX < minX) return src;
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d")?.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

function load(src: string): Gfx | null {
  if (typeof window === "undefined") return null;
  const hit = cache.get(src);
  if (hit) return hit;
  let img = loading.get(src);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    const finish = () => {
      if (!img || cache.has(src)) return;
      if (!img.naturalWidth) return;
      cache.set(src, img);
    };
    img.onload = finish;
    img.src = `${src}?v=12`;
    if (img.complete) finish();
    loading.set(src, img);
  }
  return cache.get(src) ?? null;
}

export const SPR = {
  idle: () => load("/sprites/hero-side.png"),
  front: () => load("/sprites/hero-yard.png"),
  run: () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => load(`/sprites/hero-run-${i}.png`)),
  jump: () => [1, 2, 3, 4].map((i) => load(`/sprites/hero-jump-${i}.png`)),
  mite: () => load("/sprites/foe-mite.png"),
  drone: () => load("/sprites/foe-drone.png"),
  robotSide: (id: string) => load(`/sprites/robots/${id}-side.png`),
  robotRun: (id: string) => [1, 2, 3, 4].map((i) => load(`/sprites/robots/${id}-run-${i}.png`)),
};

function gfxSize(img: Gfx) {
  const asImg = img as HTMLImageElement;
  if (asImg.naturalWidth) return { w: asImg.naturalWidth, h: asImg.naturalHeight };
  const asCanvas = img as HTMLCanvasElement;
  return { w: asCanvas.width, h: asCanvas.height };
}

export function ready(img: Gfx | null | undefined) {
  if (!img) return false;
  const { w, h } = gfxSize(img);
  return w > 0 && h > 0;
}

export function blit(
  ctx: CanvasRenderingContext2D,
  img: Gfx | null | undefined,
  feetX: number,
  feetY: number,
  hgt: number,
  opts?: { squash?: number; stretch?: number; flip?: boolean; alpha?: number; rot?: number; filter?: string },
) {
  if (!ready(img) || !img) return false;
  const squash = opts?.squash ?? 0;
  const stretch = opts?.stretch ?? 0;
  const sy = 1 - squash * 0.16 + stretch * 0.1;
  const sx = (1 + squash * 0.16 - stretch * 0.08) * (opts?.flip ? -1 : 1);
  const { w, h } = gfxSize(img);
  const aspect = w / h;
  const dw = hgt * aspect;
  ctx.save();
  ctx.globalAlpha = opts?.alpha ?? 1;
  if (opts?.filter && opts.filter !== "none") ctx.filter = opts.filter;
  ctx.translate(feetX, feetY);
  ctx.scale(sx, sy);
  if (opts?.rot) {
    ctx.translate(0, -hgt * 0.46);
    ctx.rotate(opts.rot);
    ctx.translate(0, hgt * 0.46);
  }
  ctx.drawImage(img, -dw / 2, -hgt, dw, hgt);
  ctx.restore();
  return true;
}

export function heroFrame(grounded: boolean, vy: number, runPhase: number, squash: number) {
  if (!grounded) {
    const jump = SPR.jump();
    if (squash > 0.4 && vy >= 0) return jump[0];
    if (vy < -220) return jump[1];
    if (vy < 80) return jump[2];
    return jump[3];
  }
  const run = SPR.run();
  if (run.length === 0) return SPR.idle();
  const i = ((Math.floor(runPhase) % run.length) + run.length) % run.length;
  return run[i] ?? SPR.idle();
}
