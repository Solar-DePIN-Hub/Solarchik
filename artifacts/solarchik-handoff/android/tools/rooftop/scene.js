// Solarchik rooftop home — scene renderer (mockup). Canvas 2D, 1920x1200 design space.
'use strict';
const QP = new URLSearchParams(location.search);
const W = +(QP.get('w') || 1920), H = 1200;
// Plate export modes for the native app (tools/rooftop/plates.mjs):
//  plate=1   static layers only (no Sol sprite, no ticker/record text, no beacon glows, no vignette)
//  solonly=1 only Sol (graded + rim light + face glow) on a transparent canvas
//  et/eb     extra sky above / extra floor below (portrait phones), in frame units
const PLATE = QP.get('plate') === '1', SOLONLY = QP.get('solonly') === '1';
const EXT_T = +(QP.get('et') || 0), EXT_B = +(QP.get('eb') || 0), HT = EXT_T + H + EXT_B, HF = H + EXT_B;
const OX = (W - 1920) / 2, XL = -OX - 20, XW = W + 40;   // world is designed in a 1920-wide frame, centred; wider screens extend the sides
const VPX = 960, HOR = 560;          // vanishing point / horizon
const PAR_Y = 800, FLOOR_Y = 846;     // our parapet top, floor back edge

const SCENES = {
  day: {
    sky: ['#2a66be', '#5f9fe2', '#a9d0f2', '#e9f0ee'], skyStops: [0, .32, .5, .62],
    sun: { x: 640, y: 150, r: 46, col: '#fffbe6', glow: '#fff1b8', a: 1 },
    far: '#b4c8db', mid: '#8ea8c4', near: '#6f89a8', fog: '#dce8f1', rim: '#fff4dc',
    lit: 0, neon: 0, cloud: '#ffffff', cloudShade: '#c9d8e8', stars: 0,
    skyTop: '#1a4c9c', grade: null, door: .18, lamp: 0, festoon: 0,
    shadow: 'rgba(28,30,44,0.34)', shDir: [0.46, 0.13],
    floor: ['#8d857c', '#6c645d', '#4e4843'], neighborTint: ['#dce8f1', .18],
  },
  sunset: {
    sky: ['#232a58', '#6b4a74', '#e0866a', '#f7b98a'], skyStops: [0, .3, .5, .6],
    sun: { x: 1205, y: 498, r: 54, col: '#fff0c8', glow: '#ffb070', a: 1 },
    far: '#a57886', mid: '#6f4c66', near: '#4a3550', fog: '#e8987e', rim: '#ffb48a',
    lit: .42, neon: .18, cloud: '#ffb391', cloudShade: '#8a5576', stars: .12,
    skyTop: '#151a40', grade: { mul: '#ffc6a4', tint: '#ff8a4a', ta: .10 }, door: .55, lamp: .8, festoon: .85,
    shadow: 'rgba(40,18,30,0.42)', shDir: [-0.16, 0.30],
    floor: ['#8a6e66', '#62494a', '#3a2a30'], neighborTint: ['#e0907c', .32],
  },
  night: {
    sky: ['#070b1c', '#101a36', '#26325c', '#3a4470'], skyStops: [0, .3, .5, .62],
    sun: { x: 1330, y: 150, r: 30, col: '#e6ecff', glow: '#b8c8ff', a: .55, moon: true },
    far: '#1f2a4c', mid: '#161e3a', near: '#0e1428', fog: '#2c3866', rim: '#78d2ff',
    lit: 1, neon: .9, cloud: '#2c3a5e', cloudShade: '#141c34', stars: .55,
    skyTop: '#03060f', grade: { mul: '#5b6896', tint: '#1a2a5a', ta: .18 }, door: 1, lamp: 1, festoon: 1,
    shadow: 'rgba(5,6,14,0.45)', shDir: [-0.28, 0.10],
    floor: ['#3a3f55', '#262a3c', '#15182a'], neighborTint: ['#0c1430', .62],
  },
};

// ---------- utils ----------
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rr(x, cx, cy, w, h, r) { x.beginPath(); x.roundRect(cx, cy, w, h, r); }
function lg(x, x0, y0, x1, y1, stops) { const g = x.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function rg(x, cx, cy, r0, r1, stops, cx1, cy1) { const g = x.createRadialGradient(cx1 ?? cx, cy1 ?? cy, r0, cx, cy, r1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function glow(x, cx, cy, r, col, a) { if (a <= 0) return; x.fillStyle = rg(x, cx, cy, 0, r, [[0, hexA(col, a)], [.35, hexA(col, a * .45)], [1, hexA(col, 0)]]); x.fillRect(cx - r, cy - r, r * 2, r * 2); }
function tint(img, col, w, h, grad) { const c = mk(w, h), x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, w, h); if (grad) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = grad(x); x.fillRect(0, 0, w, h); } return c; }
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function path2d(d, s, x0, y0) { return { d, s, x0, y0 }; }
function icon(x, d, cx, cy, size, col) { x.save(); x.translate(cx - size / 2, cy - size / 2); x.scale(size / 24, size / 24); x.fillStyle = col; x.fill(new Path2D(d)); x.restore(); }

const ART = {};
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(src); i.src = src; }); }
async function loadArt() {
  const L = {
    hero: 'assets/web/hero-yard.png', heroSide: 'assets/web/hero-idle.png',
    far: 'assets/city_far.webp', mid: 'assets/city_mid.webp', near: 'assets/city_near.webp',
    farLit: 'assets/city_far_lit.webp', midLit: 'assets/city_mid_lit.webp', nearLit: 'assets/city_near_lit.webp',
    farNeon: 'assets/city_far_neon.webp', midNeon: 'assets/city_mid_neon.webp', nearNeon: 'assets/city_near_neon.webp',
    facA: 'assets/facade_a.webp', facB: 'assets/facade_b.webp', facC: 'assets/facade_c.webp',
    facALit: 'assets/facade_a_lit.webp', facBLit: 'assets/facade_b_lit.webp', facCLit: 'assets/facade_c_lit.webp',
    atlas: 'assets/city.webp',
  };
  await Promise.all(Object.entries(L).map(async ([k, v]) => ART[k] = await loadImg(v)));
  ART.atlasMap = await (await fetch('assets/city.json')).json();
  // noise tile
  const n = mk(256, 256), nx = n.getContext('2d'), id = nx.createImageData(256, 256), r = rng(7);
  for (let i = 0; i < id.data.length; i += 4) { const v = r() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  nx.putImageData(id, 0, 0); ART.noise = n;
}
function sprite(name) { const [sx, sy, sw, sh, w, h] = ART.atlasMap[name]; return { sx, sy, sw, sh, w, h }; }
function drawSprite(x, name, dx, dy, scale = 1) { const s = sprite(name); x.drawImage(ART.atlas, s.sx, s.sy, s.sw, s.sh, dx, dy, s.w * scale, s.h * scale); return s; }

// ---------- background cache (sky + city), built per scene ----------
const cache = {};
function buildBackground(key) {
  if (cache[key]) return cache[key];
  const P = SCENES[key];
  // render 10% oversized so the parallax zoom never shows edges
  const c = mk(W, HT), x = c.getContext('2d');
  // sky (stops stay at the same frame heights; the extension above fades to a deeper top colour)
  const skyStops = P.sky.map((col, i) => [(EXT_T + P.skyStops[i] * H) / HT, col]);
  if (EXT_T) skyStops.unshift([0, P.skyTop]);
  x.fillStyle = lg(x, 0, 0, 0, HT, skyStops);
  x.fillRect(0, 0, W, HT);
  x.translate(0, EXT_T);
  const R = rng(key.length * 31 + 5);
  // stars
  if (P.stars) for (let i = 0; i < 260 + (EXT_T ? 420 : 0); i++) { const sx = R() * W, sy = R() * (520 + EXT_T) - EXT_T, a = P.stars * (.25 + R() * .75) * Math.min(1, 1 - sy / 600); x.fillStyle = `rgba(255,246,225,${a})`; x.beginPath(); x.arc(sx, sy, .6 + R() * 1.4, 0, 7); x.fill(); }
  // sun / moon
  const S = { ...P.sun, x: P.sun.x + OX };
  if (S.moon) {
    if (0) glow(x, S.x, S.y, 260, S.glow, .22); glow(x, S.x, S.y, 90, S.glow, .35);
    if (0) { x.fillStyle = S.col; x.beginPath(); x.arc(S.x, S.y, S.r, 0, 7); x.fill(); }
    if (0) x.fillStyle = 'rgba(160,170,210,.35)'; [[-8, -6, 7], [9, 5, 5], [-2, 12, 4]].forEach(([a, b, r]) => { x.beginPath(); x.arc(S.x + a, S.y + b, r, 0, 7); x.fill(); });
  } else {
    glow(x, S.x, S.y, key === 'sunset' ? 900 : 620, S.glow, key === 'sunset' ? .55 : .42);
    glow(x, S.x, S.y, 200, S.glow, .55);
    x.fillStyle = rg(x, S.x, S.y, 0, S.r, [[0, '#ffffff'], [.7, S.col], [1, hexA(S.col, .9)]]); x.beginPath(); x.arc(S.x, S.y, S.r, 0, 7); x.fill();
  }
  // clouds
  x.save(); x.translate(OX, 0); drawClouds(x, key, P, R); if (OX > 0) { x.translate(-OX * 2 + 60, 30); drawClouds(x, key, P, rng(99)); } x.restore();
  if (EXT_T) { x.save(); x.translate(OX, 0); drawCloudsHigh(x, key, P, rng(77)); x.restore(); }
  // city skyline layers (game art masks, tinted with the scene palette like RunRenderer.paintCityLayers)
  const layers = [
    { img: ART.far, lit: ART.farLit, neon: ART.farNeon, col: P.far, top: 318, sc: .8, off: 300, fogA: .55 },
    { img: ART.mid, lit: ART.midLit, neon: ART.midNeon, col: P.mid, top: 452, sc: .78, off: 900, fogA: .42 },
    { img: ART.near, lit: ART.nearLit, neon: ART.nearNeon, col: P.near, top: 560, sc: .72, off: 150, fogA: .3 },
  ];
  layers.forEach((L, i) => {
    const w = L.img.width * L.sc, h = L.img.height * L.sc;
    const t = tint(L.img, L.col, w, h, xx => lg(xx, 0, 0, 0, h, [[0, hexA(P.rim, key === 'night' ? .05 : .10)], [.25, hexA(L.col, 0)], [1, hexA(P.fog, L.fogA * .6)]]));
    for (let k = -1; k < 3; k++) x.drawImage(t, -L.off + k * w, L.top, w, h);
    x.fillStyle = L.col; x.fillRect(0, L.top + h - 1, W, HF);
    if (P.lit > 0) {
      const lw = L.lit.width * 2 * L.sc, lh = L.lit.height * 2 * L.sc;
      const lt = tint(L.lit, '#ffc478', lw, lh);
      x.save(); x.globalAlpha = P.lit * (.55 + .15 * i); x.filter = 'blur(5px)'; x.globalCompositeOperation = 'screen';
      for (let k = -1; k < 2; k++) x.drawImage(tint(L.lit, '#ffa850', lw, lh), -L.off + k * w, L.top, lw, lh);
      x.restore(); x.save(); x.globalAlpha = P.lit * (.7 + .1 * i);
      for (let k = -1; k < 2; k++) x.drawImage(lt, -L.off + k * w, L.top, lw, lh);
      x.restore();
    }
    if (P.neon > 0) {
      const nw = L.neon.width * 2 * L.sc, nh = L.neon.height * 2 * L.sc, nc = i === 1 ? '#ff6ec8' : '#6ee6ff';
      x.save(); x.globalCompositeOperation = 'screen'; x.globalAlpha = P.neon; x.filter = 'blur(6px)';
      for (let k = -1; k < 2; k++) x.drawImage(tint(L.neon, nc, nw, nh), -L.off + k * w, L.top, nw, nh);
      x.filter = 'none';
      for (let k = -1; k < 2; k++) x.drawImage(tint(L.neon, nc, nw, nh), -L.off + k * w, L.top, nw, nh);
      x.restore();
    }
    // fog between layers
    x.fillStyle = lg(x, 0, L.top + h * .35, 0, L.top + h, [[0, hexA(P.fog, 0)], [1, hexA(P.fog, L.fogA)]]);
    x.fillRect(0, L.top + h * .35, W, h * .65 + 1);
    x.fillStyle = hexA(P.fog, L.fogA); x.fillRect(0, L.top + h, W, HF);
    if (i === 0 && key === 'sunset') { // volumetric shafts from the low sun
      x.save(); x.globalCompositeOperation = 'screen';
      for (let s = 0; s < 5; s++) { x.save(); x.translate(S.x, S.y); x.rotate((-160 + s * 31) * Math.PI / 180); x.fillStyle = lg(x, 0, 0, 1400, 0, [[0, 'rgba(255,196,140,.07)'], [1, 'rgba(255,190,130,0)']]); x.beginPath(); x.moveTo(0, 0); x.lineTo(1400, -60 - s * 8); x.lineTo(1400, 60 + s * 8); x.fill(); x.restore(); }
      x.restore();
    }
  });
  // aviation warning lights on the tallest far towers
  cache[key] = c;
  return c;
}

function cloudBlob(x, cx, cy, w, h, lit, shade, a, R, puffs = 9) {
  const c = mk(Math.ceil(w * 1.6), Math.ceil(h * 2.6)), q = c.getContext('2d');
  const ox = w * .3, oy = h * 1.2;
  q.fillStyle = '#fff';
  for (let i = 0; i < puffs; i++) {
    const u = i / (puffs - 1), px = ox + u * w, r = h * (.45 + .55 * Math.sin(u * Math.PI)) * (.75 + R() * .5);
    q.beginPath(); q.arc(px, oy + h * .25 - r * .55 + (R() - .5) * h * .2, r, 0, 7); q.fill();
  }
  q.fillRect(ox, oy + h * .05, w, h * .3);
  q.globalCompositeOperation = 'source-in';
  q.fillStyle = lg(q, 0, oy - h * .9, 0, oy + h * .55, [[0, lit], [.55, lit], [1, shade]]); q.fillRect(0, 0, c.width, c.height);
  x.save(); x.globalAlpha = a; x.filter = `blur(${CLOUD_BLUR}px)`; x.drawImage(c, cx - ox, cy - oy); x.restore();
}
let CLOUD_BLUR = 2.5;
function drawClouds(x, key, P, R) {
  CLOUD_BLUR = key === 'night' ? 4.5 : 2.5;
  const strat = [sprite('stratus_1'), sprite('stratus_2')];
  const wisp = (i, cx, cy, sc, a, col) => { const s = strat[i % 2]; const t = tint(ART.atlas, col, ART.atlas.width, ART.atlas.height); x.save(); x.globalAlpha = a; x.drawImage(t, s.sx, s.sy, s.sw, s.sh, cx, cy, s.w * sc, s.h * sc); x.restore(); };
  if (key === 'day') {
    cloudBlob(x, 1230, 215, 300, 70, '#ffffff', '#d2deec', .95, R);
    cloudBlob(x, 1590, 300, 210, 50, '#ffffff', '#d6e2ee', .9, R);
    cloudBlob(x, 140, 330, 260, 54, '#ffffff', '#d4e0ec', .85, R);
    wisp(0, 820, 260, 1.6, .55, '#ffffff'); wisp(1, -120, 120, 1.5, .4, '#ffffff'); wisp(0, 1400, 90, 1.2, .35, '#ffffff');
  } else if (key === 'sunset') {
    wisp(0, 640, 270, 2.2, .75, '#ffb08a'); wisp(1, 1250, 180, 1.9, .65, '#ff9c84'); wisp(0, -60, 150, 1.7, .55, '#c88aa0');
    wisp(1, 1500, 360, 1.5, .6, '#ffc39a'); wisp(0, 200, 400, 1.4, .45, '#ffb495');
    cloudBlob(x, 260, 250, 320, 46, '#ffb9a0', '#7c4c70', .75, R, 11);
    cloudBlob(x, 1560, 250, 280, 40, '#ffc2a0', '#83507a', .7, R, 11);
  } else {
    // overcast deck, undersides lit by the city; the moon peeks through a gap
    for (let i = 0; i < 9; i++) { const cx = -200 + i * 260 + R() * 80; if (Math.abs(cx + 190 - P.sun.x) < 170) continue; cloudBlob(x, cx, 90 + R() * 120, 380 + R() * 160, 70 + R() * 40, '#34436a', '#1a2240', 1, R, 12); }
    glow(x, P.sun.x, P.sun.y, 300, '#9fb0e8', .28); glow(x, P.sun.x, P.sun.y, 80, '#dfe6ff', .4);
    x.fillStyle = '#e8eeff'; x.beginPath(); x.arc(P.sun.x, P.sun.y, 30, 0, 7); x.fill();
    x.fillStyle = 'rgba(150,160,200,.35)'; [[-8, -6, 7], [9, 5, 5], [-2, 12, 4]].forEach(([a, b, r]) => { x.beginPath(); x.arc(P.sun.x + a, P.sun.y + b, r, 0, 7); x.fill(); });
    wisp(0, P.sun.x - 330, P.sun.y - 10, 1.3, .45, '#56648e');
    for (let i = 0; i < 7; i++) cloudBlob(x, -150 + i * 320 + R() * 90, 300 + R() * 90, 300 + R() * 140, 48 + R() * 28, '#3e4c76', '#5a4a62', .9, R, 11);
    x.fillStyle = lg(x, 0, 250, 0, 520, [[0, 'rgba(255,150,90,0)'], [1, 'rgba(255,150,90,.10)']]); x.fillRect(0, 250, W, 270);
  }
}

// portrait: clouds in the extra sky above the frame
function drawCloudsHigh(x, key, P, R) {
  CLOUD_BLUR = key === 'night' ? 4.5 : 2.5;
  const strat = [sprite('stratus_1'), sprite('stratus_2')];
  const wisp = (i, cx, cy, sc, a, col) => { const s = strat[i % 2]; const t = tint(ART.atlas, col, ART.atlas.width, ART.atlas.height); x.save(); x.globalAlpha = a; x.drawImage(t, s.sx, s.sy, s.sw, s.sh, cx, cy, s.w * sc, s.h * sc); x.restore(); };
  if (key === 'day') {
    cloudBlob(x, 300, -260, 360, 80, '#ffffff', '#d2deec', .92, R);
    cloudBlob(x, 1240, -640, 300, 66, '#ffffff', '#d6e2ee', .85, R);
    cloudBlob(x, 560, -1180, 420, 90, '#ffffff', '#d4e0ec', .7, R);
    cloudBlob(x, 1380, -1560, 280, 60, '#ffffff', '#d4e0ec', .55, R);
    wisp(1, 900, -420, 1.8, .45, '#ffffff'); wisp(0, 100, -900, 1.6, .35, '#ffffff'); wisp(1, 1300, -1150, 1.4, .3, '#ffffff');
  } else if (key === 'sunset') {
    wisp(1, 260, -220, 2.2, .6, '#ff9c84'); wisp(0, 1100, -520, 2.0, .5, '#c88aa0'); wisp(1, 380, -900, 1.8, .4, '#9a6a98');
    wisp(0, 1250, -1300, 1.6, .3, '#7a5a8a');
    cloudBlob(x, 1200, -260, 300, 44, '#ffb9a0', '#7c4c70', .65, R, 11);
    cloudBlob(x, 300, -640, 280, 40, '#e8a0a0', '#5c3c68', .5, R, 11);
  } else {
    for (let i = 0; i < 7; i++) cloudBlob(x, -150 + i * 300 + R() * 90, -200 - R() * 220, 320 + R() * 140, 60 + R() * 30, '#2c3a5e', '#141c34', .85, R, 12);
    for (let i = 0; i < 4; i++) cloudBlob(x, -100 + i * 520 + R() * 120, -900 - R() * 600, 300 + R() * 160, 50 + R() * 26, '#1e2a48', '#0e1428', .6, R, 11);
  }
}

// neighbouring rooftops, just below our parapet (game facades + rooftop props at native scale)
function drawNeighbors(x, key, P) {
  x.translate(OX, 0);
  const B = [
    { x0: -460, x1: -40, top: 736, fac: 'facB', lit: 'facBLit', props: [['ac', -420], ['panel', -330], ['panel', -270], ['vent', -150]] },
    { x0: 1960, x1: 2360, top: 716, fac: 'facA', lit: 'facALit', props: [['antenna', 2000], ['tank', 2200], ['ac', 2290]] },
    { x0: -20, x1: 300, top: 724, fac: 'facC', lit: 'facCLit', props: [['ac', 30], ['ac', 110], ['planter', 190]] },
    { x0: 330, x1: 700, top: 752, fac: 'facA', lit: 'facALit', props: [['panel', 360], ['panel', 420], ['panel', 480], ['panel', 540], ['tank', 620]] },
    { x0: 1160, x1: 1500, top: 700, fac: 'facB', lit: 'facBLit', props: [['antenna', 1190], ['ac', 1300], ['vent', 1400]] },
    { x0: 1530, x1: 1940, top: 740, fac: 'facC', lit: 'facCLit', props: [['planter', 1560], ['planter', 1666], ['tank', 1840]] },
  ];
  B.forEach((b, i) => {
    const pat = x.createPattern(ART[b.fac], 'repeat'); pat.setTransform(new DOMMatrix().translate(b.x0 + i * 37, b.top + 14).scale(.5));
    x.fillStyle = pat; x.fillRect(b.x0, b.top + 14, b.x1 - b.x0, PAR_Y + 60 - b.top);
    if (P.lit > 0) { const lp = x.createPattern(ART[b.lit], 'repeat'); lp.setTransform(new DOMMatrix().translate(b.x0 + i * 37, b.top + 14).scale(.5)); x.save(); x.globalAlpha = P.lit * .8; x.fillStyle = lp; x.fillRect(b.x0, b.top + 14, b.x1 - b.x0, PAR_Y + 60 - b.top); x.restore(); }
    // tint toward the haze / night
    x.fillStyle = hexA(P.neighborTint[0], P.neighborTint[1]); x.fillRect(b.x0, b.top, b.x1 - b.x0, PAR_Y + 60 - b.top);
    // cornice + parapet
    x.fillStyle = 'rgba(10,8,16,.35)'; x.fillRect(b.x0, b.top + 14, b.x1 - b.x0, 4);
    x.fillStyle = lg(x, 0, b.top, 0, b.top + 14, [[0, key === 'night' ? '#4a5272' : '#d8cfc0'], [1, key === 'night' ? '#2a3048' : '#9d9387']]); x.fillRect(b.x0 - 3, b.top, b.x1 - b.x0 + 6, 14);
    x.fillStyle = hexA(P.rim, .5); x.fillRect(b.x0 - 3, b.top, b.x1 - b.x0 + 6, 1.5);
    b.props.forEach(([n, px]) => { const s = sprite(n); x.save(); if (key === 'night') x.filter = 'brightness(.45) saturate(.7)'; else if (key === 'sunset') x.filter = 'brightness(.8) sepia(.25)'; drawSprite(x, n, px, b.top + 2 - s.h * .9, .9); x.restore(); });
  });
  if (P.lit) { glow(x, 1214, 700 - 132, 10, '#ff4a3a', .9); }
}

// ---------- foreground: our roof ----------
const SOL = { x: 960, feet: 1012, h: 440 };
const HUT = { x0: 1400, x1: 1820, top: 520, bot: 962, k: .12 };
const DOOR = { x0: 1578, x1: 1728, top: 676, bot: 962 };
const ANT = { x: 250, base: 905, top: 262 };
const PAN = { x0: 455, x1: 815, top: 772, bot: 858 };
const TICK = { x0: 1146, x1: 1336, top: 742, bot: 852, legs: 936 };
const TOOL = { x0: 300, x1: 470, top: 1014, bot: 1086 };
const backPt = (px, py, k) => [px + (VPX - px) * k, py + (HOR - py) * k];

function drawParapet(x, key, P) {
  // front face of the low wall at the back edge of our roof
  x.fillStyle = lg(x, 0, PAR_Y, 0, FLOOR_Y, [[0, '#d9d1c4'], [.22, '#c3b9aa'], [.28, '#8f877c'], [1, '#6f675e']]);
  x.fillRect(XL, PAR_Y, XW, FLOOR_Y - PAR_Y);
  x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(XL, PAR_Y, XW, 2);
  x.fillStyle = 'rgba(40,30,24,.28)'; x.fillRect(XL, PAR_Y + 11, XW, 3);
  for (let px = 40 - 172 * Math.ceil(OX / 172); px < W - OX; px += 172) { x.fillStyle = 'rgba(40,30,24,.30)'; x.fillRect(px, PAR_Y, 2, FLOOR_Y - PAR_Y); x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(px + 2, PAR_Y, 1.5, FLOOR_Y - PAR_Y); }
  // weathering streaks
  const R = rng(11); for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(50,40,32,${.05 + R() * .08})`; x.fillRect(XL + R() * XW, PAR_Y + 14, 1 + R() * 3, 8 + R() * 24); }
  x.fillStyle = lg(x, 0, FLOOR_Y - 10, 0, FLOOR_Y, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(20,14,10,.35)']]); x.fillRect(XL, FLOOR_Y - 10, XW, 10);
}

function drawFloor(x, key, P) {
  x.fillStyle = lg(x, 0, FLOOR_Y, 0, H, [[0, P.floor[0]], [.45, P.floor[1]], [1, P.floor[2]]]);
  x.fillRect(XL, FLOOR_Y, XW, HF - FLOOR_Y);
  // membrane sheets: seams converging to the vanishing point + perspective rows
  x.save(); x.beginPath(); x.rect(XL, FLOOR_Y, XW, HF - FLOOR_Y); x.clip();
  for (let i = -20; i <= 20; i++) {
    const bx = VPX + i * 150, t = (HF + 40 - HOR) / (FLOOR_Y - HOR), ex = VPX + (bx - VPX) * t;
    x.strokeStyle = 'rgba(20,16,14,.22)'; x.lineWidth = 2; x.beginPath(); x.moveTo(bx, FLOOR_Y); x.lineTo(ex, HF + 40); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(bx + 2, FLOOR_Y); x.lineTo(ex + 2 * t, HF + 40); x.stroke();
  }
  for (let k = 1; HOR + (FLOOR_Y - HOR) * (1 + .36 * k) < HF + 4 || k < 6; k++) { const y = HOR + (FLOOR_Y - HOR) * (1 + .36 * k); x.fillStyle = 'rgba(20,16,14,.16)'; x.fillRect(XL, y, XW, 2); x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(XL, y + 2, XW, 1.5); }
  // stains and patches
  const R = rng(23);
  for (let i = 0; i < 18; i++) { const cx = XL + R() * XW, cy = FLOOR_Y + 30 + R() * 320, rw = 40 + R() * 160; x.fillStyle = `rgba(30,24,20,${.05 + R() * .07})`; x.beginPath(); x.ellipse(cx, cy, rw, rw * .22 * (cy - HOR) / 400, 0, 0, 7); x.fill(); }
  // grain
  const pat = x.createPattern(ART.noise, 'repeat'); x.globalAlpha = .07; x.globalCompositeOperation = 'overlay'; x.fillStyle = pat; x.fillRect(XL, FLOOR_Y, XW, HF - FLOOR_Y);
  x.restore();
  if (key !== 'night') { x.fillStyle = lg(x, 0, FLOOR_Y, 0, 1010, [[0, key === 'day' ? 'rgba(255,240,210,.18)' : 'rgba(255,160,100,.22)'], [1, 'rgba(255,240,210,0)']]); x.fillRect(XL, FLOOR_Y, XW, 164); }
  // drain
  x.fillStyle = '#3a3532'; x.beginPath(); x.ellipse(720, 1128, 34, 9, 0, 0, 7); x.fill();
  x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 2; for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(720 + i * 11, 1121); x.lineTo(720 + i * 11, 1135); x.stroke(); }
  // front vignette (closer to camera = darker edge)
  x.fillStyle = lg(x, 0, 1080, 0, H, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(8,6,10,.28)']]); x.fillRect(XL, 1080, XW, HF - 1080);
}

function shadowPoly(x, P, pts, blur = 8, a = 1) { x.save(); x.filter = `blur(${blur}px)`; x.globalAlpha = a; x.fillStyle = P.shadow; x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.closePath(); x.fill(); x.restore(); }
function castBox(x, P, x0, x1, y, h, a = 1) { const [dx, dy] = P.shDir; shadowPoly(x, P, [[x0, y], [x1, y], [x1 + dx * h, y + dy * h], [x0 + dx * h, y + dy * h]], 10, a); }

function drawFestoon(x, P, t) {
  const posts = [790, 1000, 1210, 1380];
  posts.forEach(px => { x.fillStyle = '#3b3f46'; x.fillRect(px - 2, 706, 4, 96); x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(px - 2, 706, 1.2, 96); });
  const bulbs = [];
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1];
    x.strokeStyle = 'rgba(30,30,36,.85)'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(a, 710); x.quadraticCurveTo((a + b) / 2, 752, b, 710); x.stroke();
    for (let k = 1; k < 6; k++) { const u = k / 6, bx = a + (b - a) * u, by = 710 + 84 * u * (1 - u) + 7; bulbs.push([bx, by]); }
  }
  bulbs.forEach(([bx, by]) => { x.fillStyle = '#2a2a30'; x.fillRect(bx - 2, by - 6, 4, 5); x.fillStyle = P.festoon > .2 ? '#fff0c4' : '#e8e2d6'; x.beginPath(); x.ellipse(bx, by + 3, 4.2, 5.4, 0, 0, 7); x.fill(); });
  return bulbs;
}

function drawAntenna(x, key, P, st) {
  const { x: ax, base, top } = ANT;
  const [dx, dy] = P.shDir; const hgt = base - top;
  // thin cast shadow of the mast
  shadowPoly(x, P, [[ax - 26, base], [ax + 26, base], [ax + 9 + dx * hgt, base + dy * hgt], [ax - 9 + dx * hgt, base + dy * hgt]], 6, .8);
  // guy wires
  x.strokeStyle = 'rgba(40,44,52,.55)'; x.lineWidth = 1.4;
  [[ax - 150, 958], [ax + 175, 940], [ax - 70, 1000]].forEach(([gx, gy]) => { x.beginPath(); x.moveTo(ax, 430); x.lineTo(gx, gy); x.stroke(); x.fillStyle = '#4a4e56'; x.fillRect(gx - 5, gy - 3, 10, 5); });
  // concrete plinth
  x.fillStyle = '#bdb3a4'; x.beginPath(); x.moveTo(ax - 70, base - 8); x.lineTo(ax + 70, base - 8); x.lineTo(ax + 62, base - 22); x.lineTo(ax - 62, base - 22); x.fill();
  x.fillStyle = lg(x, 0, base - 8, 0, base + 18, [[0, '#a59b8d'], [1, '#7a7166']]); x.fillRect(ax - 70, base - 8, 140, 26);
  x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(ax - 70, base - 8, 140, 1.5);
  // lattice mast
  const yb = base - 22, wb = 30, wt = 9;
  const L = y => ax - (wt + (wb - wt) * (y - top) / (yb - top)), Rr = y => ax + (wt + (wb - wt) * (y - top) / (yb - top));
  x.lineCap = 'round';
  // bracing
  x.strokeStyle = '#59616c'; x.lineWidth = 2;
  for (let y = yb, i = 0; y > top + 10; i++) { const ny = y - (24 + (y - top) * .07); x.beginPath(); x.moveTo(L(y), y); x.lineTo(Rr(ny), ny); x.moveTo(Rr(y), y); x.lineTo(L(ny), ny); x.stroke(); x.beginPath(); x.moveTo(L(ny), ny); x.lineTo(Rr(ny), ny); x.stroke(); y = ny; }
  // legs (lit side + shade side)
  x.lineWidth = 5; x.strokeStyle = '#3b424c'; x.beginPath(); x.moveTo(L(yb), yb); x.lineTo(L(top), top); x.moveTo(Rr(yb), yb); x.lineTo(Rr(top), top); x.stroke();
  x.lineWidth = 1.6; x.strokeStyle = 'rgba(220,228,236,.8)'; x.beginPath(); x.moveTo(L(yb) - 1.5, yb); x.lineTo(L(top) - 1.5, top); x.stroke();
  // service platform
  x.fillStyle = '#4a525c'; x.fillRect(ax - 44, 560, 88, 6); x.strokeStyle = '#4a525c'; x.lineWidth = 2; x.beginPath(); x.moveTo(ax - 44, 560); x.lineTo(ax - 44, 538); x.lineTo(ax + 44, 538); x.lineTo(ax + 44, 560); x.stroke();
  // sector panel antennas
  [[-30, 330], [22, 318]].forEach(([o, y]) => { x.fillStyle = lg(x, ax + o, 0, ax + o + 15, 0, [[0, '#f2f2ee'], [1, '#c4c8cc']]); rr(x, ax + o, y, 15, 74, 4); x.fill(); x.fillStyle = '#7a828c'; x.fillRect(ax + o + 5, y + 74, 5, 10); });
  // dish
  x.save(); x.translate(ax + 34, 470); x.rotate(-.25);
  x.fillStyle = '#5b636e'; x.fillRect(-20, -4, 22, 8);
  x.fillStyle = lg(x, 0, -46, 0, 46, [[0, '#ffffff'], [.6, '#d6dade'], [1, '#9aa2aa']]); x.beginPath(); x.ellipse(10, 0, 18, 46, 0, 0, 7); x.fill();
  x.strokeStyle = 'rgba(80,88,98,.6)'; x.lineWidth = 1.5; x.stroke();
  x.strokeStyle = '#5b636e'; x.lineWidth = 2.2; x.beginPath(); x.moveTo(14, -40); x.lineTo(44, 0); x.lineTo(14, 40); x.stroke(); x.fillStyle = '#3b424c'; x.beginPath(); x.arc(44, 0, 4.5, 0, 7); x.fill();
  x.restore();
  // whip + beacon housing
  x.strokeStyle = '#3b424c'; x.lineWidth = 3; x.beginPath(); x.moveTo(ax, top); x.lineTo(ax, top - 50); x.stroke();
  x.fillStyle = '#2b3038'; x.fillRect(ax - 7, top - 56, 14, 8);
  x.fillStyle = '#9a2a22'; x.beginPath(); x.arc(ax, top - 62, 8, Math.PI, 0); x.fill(); x.fillRect(ax - 8, top - 62, 16, 6);
  // junction box: secretary "on" LED
  x.fillStyle = lg(x, ax - 24, 0, ax + 24, 0, [[0, '#d8dbd8'], [1, '#a7aca8']]); rr(x, ax - 24, 760, 48, 62, 5); x.fill();
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(ax - 24, 818, 48, 4);
  icon(x, ICONS.call, ax, 786, 22, '#4b545e');
}

function drawPanels(x, key, P, st) {
  const { x0, x1, top, bot } = PAN; const n = 3, gap = 10, pw = (x1 - x0 - gap * (n - 1)) / n;
  castBox(x, P, x0, x1, 905, 80, .9);
  // back legs and rails
  x.fillStyle = '#7d858e';
  for (let i = 0; i <= n; i++) { const lx = x0 + i * (pw + gap) - (i === n ? gap : 0); x.fillRect(lx + 4, top + 8, 5, 890 - top); x.fillRect(lx + 2, bot, 5, 905 - bot); }
  x.fillStyle = '#9aa2aa'; x.fillRect(x0 - 6, 886, x1 - x0 + 12, 7); x.fillStyle = '#6a7179'; x.fillRect(x0 - 6, 900, x1 - x0 + 12, 7);
  for (let i = 0; i < n; i++) {
    const px = x0 + i * (pw + gap), ins = 7;
    const quad = [[px + ins, top], [px + pw - ins, top], [px + pw, bot], [px, bot]];
    const q = () => { x.beginPath(); quad.forEach(([a, b], j) => j ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); };
    // frame
    q(); x.fillStyle = '#d9dfe4'; x.fill();
    // cells: reflect the sky
    const sky = SCENES[key].sky;
    x.save(); q(); x.clip();
    const cellTop = key === 'night' ? '#1b2a52' : key === 'sunset' ? '#3a3d78' : '#2c5fb8';
    const cellBot = key === 'night' ? '#0c1430' : key === 'sunset' ? '#1c1e46' : '#123a80';
    x.fillStyle = lg(x, 0, top, 0, bot, [[0, cellTop], [1, cellBot]]); x.fillRect(px, top, pw, bot - top);
    // inner bezel
    x.strokeStyle = '#e8edf1'; x.lineWidth = 5; q(); x.stroke();
    // grid
    x.strokeStyle = 'rgba(190,215,250,.32)'; x.lineWidth = 1.2;
    for (let c = 1; c < 6; c++) { const u = c / 6; x.beginPath(); x.moveTo(px + ins + (pw - 2 * ins) * u, top); x.lineTo(px + pw * u, bot); x.stroke(); }
    for (let r = 1; r < 4; r++) { const v = r / 4, yy = top + (bot - top) * v, l = px + ins * (1 - v), rr_ = px + pw - ins * (1 - v); x.beginPath(); x.moveTo(l, yy); x.lineTo(rr_, yy); x.stroke(); }
    // specular sweep (sun / sky reflection)
    x.fillStyle = lg(x, px, top, px + pw, bot, [[0, 'rgba(255,255,255,0)'], [.42, 'rgba(255,255,255,0)'], [.5, `rgba(255,255,255,${key === 'night' ? .08 : .28})`], [.58, 'rgba(255,255,255,0)']]); x.fillRect(px, top, pw, bot - top);
    if (key === 'sunset') { x.fillStyle = 'rgba(255,170,110,.25)'; x.fillRect(px, top, pw, (bot - top) * .4); }
    x.restore();
    x.strokeStyle = 'rgba(60,70,80,.55)'; x.lineWidth = 1; q(); x.stroke();
    x.fillStyle = 'rgba(255,255,255,.7)'; x.fillRect(px + ins, top, pw - 2 * ins, 1.5);
  }
  // inverter box with agent LEDs
  const bx = x1 + 16;
  x.fillStyle = lg(x, bx, 0, bx + 50, 0, [[0, '#e1e3e0'], [1, '#aeb3b0']]); rr(x, bx, 838, 50, 66, 6); x.fill();
  x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(bx, 900, 50, 4);
  x.fillStyle = '#20262c'; rr(x, bx + 9, 850, 32, 16, 3); x.fill();
  return { leds: [[bx + 16, 880], [bx + 34, 880]] };
}

function drawTicker(x, key, P, st, lang) {
  const { x0, x1, top, bot, legs } = TICK;
  castBox(x, P, x0 + 20, x1 - 20, legs, 120, .7);
  x.fillStyle = '#2c3138'; [x0 + 26, x1 - 32].forEach(lx => { x.fillRect(lx, bot - 4, 7, legs - bot + 4); x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(lx, bot - 4, 1.5, legs - bot + 4); x.fillStyle = '#2c3138'; });
  x.fillRect(x0 + 18, legs - 3, 24, 5); x.fillRect(x1 - 40, legs - 3, 24, 5);
  // housing
  x.fillStyle = lg(x, 0, top - 14, 0, bot, [[0, '#3b414a'], [1, '#1d2127']]); rr(x, x0 - 6, top - 14, x1 - x0 + 12, bot - top + 18, 10); x.fill();
  x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(x0, top - 13, x1 - x0, 1.5);
  drawTickerScreen(x, lang);
  x.textAlign = 'left';
}

function drawTickerScreen(x, lang) {
  const { x0, x1, top, bot } = TICK;
  x.fillStyle = '#07090c'; rr(x, x0 + 6, top + 18, x1 - x0 - 12, bot - top - 26, 5); x.fill();
  if (PLATE) return;
  // header
  x.font = '800 12.5px Manrope'; x.fillStyle = '#f5c542'; x.textBaseline = 'middle'; x.textAlign = 'left';
  x.fillText('SLICE', x0 + 10, top + 3); x.textAlign = 'right'; x.fillStyle = 'rgba(245,197,66,.65)'; x.fillText(lang === 'uk' ? 'ПАПІР $1 000' : 'PAPER $1,000', x1 - 10, top + 3);
  const rows = [['SOL', '+2,4%', 1], ['JUP', '−0,8%', 0], ['BONK', '+5,1%', 1]];
  rows.forEach(([s, v, up], i) => {
    const y = top + 34 + i * 25; const en = lang !== 'uk'; const val = en ? v.replace(',', '.') : v;
    x.textAlign = 'left'; x.font = '800 17px Manrope'; x.fillStyle = '#e9eef3'; x.fillText(s, x0 + 16, y);
    const col = up ? '#5bd69a' : '#ff7a7a';
    x.fillStyle = col; x.beginPath(); if (up) { x.moveTo(x1 - 92, y + 5); x.lineTo(x1 - 84, y - 6); x.lineTo(x1 - 76, y + 5); } else { x.moveTo(x1 - 92, y - 5); x.lineTo(x1 - 84, y + 6); x.lineTo(x1 - 76, y - 5); } x.fill();
    x.textAlign = 'right'; x.fillText(val, x1 - 16, y);
  });
  x.textAlign = 'left';
}

function drawToolbox(x, key, P) {
  const { x0, x1, top, bot } = TOOL;
  castBox(x, P, x0, x1, bot, 70, .9);
  x.fillStyle = 'rgba(10,8,8,.35)'; x.filter = 'blur(5px)'; x.beginPath(); x.ellipse((x0 + x1) / 2, bot + 2, (x1 - x0) / 2 + 10, 10, 0, 0, 7); x.fill(); x.filter = 'none';
  // body
  x.fillStyle = lg(x, 0, top, 0, bot, [[0, '#e0563c'], [1, '#a5301f']]); rr(x, x0, top, x1 - x0, bot - top, 6); x.fill();
  // top face (seen from above)
  x.fillStyle = '#f07258'; x.beginPath(); x.moveTo(x0 + 4, top); x.lineTo(x1 - 4, top); x.lineTo(x1 - 14, top - 16); x.lineTo(x0 + 14, top - 16); x.closePath(); x.fill();
  x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(x0 + 14, top - 16, x1 - x0 - 28, 1.5);
  // lid line + latches
  x.fillStyle = 'rgba(60,10,6,.45)'; x.fillRect(x0, top + 18, x1 - x0, 3);
  x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(x0, top + 21, x1 - x0, 1.5);
  [x0 + 24, x1 - 40].forEach(lx => { x.fillStyle = lg(x, 0, top + 10, 0, top + 32, [[0, '#e9edf0'], [1, '#9aa3ab']]); rr(x, lx, top + 10, 16, 22, 3); x.fill(); });
  // handle
  x.strokeStyle = '#2b2f35'; x.lineWidth = 7; x.lineCap = 'round'; x.beginPath(); x.moveTo(x0 + 52, top - 12); x.quadraticCurveTo((x0 + x1) / 2, top - 52, x1 - 52, top - 12); x.stroke();
  x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 2; x.beginPath(); x.moveTo(x0 + 56, top - 16); x.quadraticCurveTo((x0 + x1) / 2, top - 52, x1 - 56, top - 16); x.stroke();
  // gear decal
  icon(x, ICONS.gear, (x0 + x1) / 2, top + 48, 30, 'rgba(255,236,220,.85)');
  // wrench on the floor
  x.save(); x.translate(x1 + 50, bot - 6); x.rotate(-.18);
  x.fillStyle = 'rgba(10,8,8,.3)'; x.filter = 'blur(3px)'; x.fillRect(-46, 2, 96, 8); x.filter = 'none';
  x.fillStyle = lg(x, 0, -6, 0, 6, [[0, '#eef2f5'], [1, '#8e979f']]); rr(x, -36, -5, 74, 10, 5); x.fill();
  x.beginPath(); x.arc(-40, 0, 12, 0, 7); x.fill(); x.fillStyle = P.floor[1]; x.beginPath(); x.moveTo(-56, -5); x.lineTo(-40, -2); x.lineTo(-40, 2); x.lineTo(-56, 5); x.fill();
  x.fillStyle = lg(x, 0, -6, 0, 6, [[0, '#eef2f5'], [1, '#8e979f']]); x.beginPath(); x.arc(40, 0, 10, 0, 7); x.fill(); x.fillStyle = '#5a6168'; x.beginPath(); x.arc(40, 0, 4.5, 0, 7); x.fill();
  x.restore();
}

function brick(x, x0, y0, w, h, base, dark) {
  x.fillStyle = base; x.fillRect(x0, y0, w, h);
  const R = rng(5); const bh = 15, bw = 40;
  for (let r = 0, y = y0; y < y0 + h; r++, y += bh) {
    for (let bx = x0 - (r % 2) * bw / 2; bx < x0 + w; bx += bw) { const v = R(); x.fillStyle = v < .33 ? 'rgba(255,220,190,.07)' : v < .66 ? 'rgba(40,10,0,.08)' : 'rgba(0,0,0,0)'; x.fillRect(bx, y, bw - 2, bh - 2); }
    x.fillStyle = dark; x.fillRect(x0, y + bh - 2, w, 2);
    for (let bx = x0 - (r % 2) * bw / 2; bx < x0 + w; bx += bw) x.fillRect(bx + bw - 2, y, 2, bh - 2);
  }
}

function drawHut(x, key, P, st, lang) {
  const { x0, x1, top, bot, k } = HUT;
  castBox(x, P, x0, x1, bot, 440, 1);
  const [sbx, sby] = backPt(x0, bot, k), [stx, sty] = backPt(x0, top, k);
  // side face (receding)
  x.save(); x.beginPath(); x.moveTo(x0, top); x.lineTo(stx, sty); x.lineTo(sbx, sby); x.lineTo(x0, bot); x.closePath(); x.clip();
  brick(x, sbx - 2, top - 10, x0 - sbx + 4, bot - top + 20, '#7d5444', 'rgba(60,40,30,.55)');
  x.fillStyle = key === 'day' ? 'rgba(255,230,190,.10)' : 'rgba(0,0,10,.25)'; x.fillRect(sbx - 2, top - 10, x0 - sbx + 4, bot - top + 20);
  x.restore();
  // front face
  x.save(); x.beginPath(); x.rect(x0, top, x1 - x0, bot - top); x.clip();
  brick(x, x0, top, x1 - x0, bot - top, '#8b6250', 'rgba(70,46,36,.55)');
  x.fillStyle = key === 'day' ? 'rgba(20,10,30,.10)' : 'rgba(0,0,0,0)'; x.fillRect(x0, top, x1 - x0, bot - top);
  // plinth band
  x.fillStyle = lg(x, 0, bot - 40, 0, bot, [[0, '#8e877d'], [1, '#6b645b']]); x.fillRect(x0, bot - 40, x1 - x0, 40);
  x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(x0, bot - 40, x1 - x0, 1.5);
  // under-roof shadow
  x.fillStyle = lg(x, 0, top, 0, top + 40, [[0, 'rgba(20,10,8,.45)'], [1, 'rgba(20,10,8,0)']]); x.fillRect(x0, top, x1 - x0, 40);
  x.restore();
  // roof slab with overhang (seen slightly from below)
  x.fillStyle = lg(x, 0, top - 30, 0, top, [[0, '#cfc6b6'], [1, '#9c9284']]); x.fillRect(x0 - 14, top - 30, x1 - x0 + 28, 30);
  x.fillStyle = 'rgba(255,255,255,.45)'; x.fillRect(x0 - 14, top - 30, x1 - x0 + 28, 2);
  x.fillStyle = '#7d7468'; x.beginPath(); x.moveTo(x0 - 14, top - 30); x.lineTo(stx - 12, sty - 28); x.lineTo(stx - 12, sty - 2); x.lineTo(x0 - 14, top); x.fill();
  // roof vent pipe + light conduit
  x.fillStyle = '#8c939a'; x.fillRect(x1 - 90, top - 66, 22, 36); x.fillStyle = '#6c737a'; x.fillRect(x1 - 96, top - 72, 34, 9);
  // door frame + opening
  const D = DOOR, open = st.doorOpen || 0;
  x.fillStyle = '#4d535b'; rr(x, D.x0 - 14, D.top - 14, D.x1 - D.x0 + 28, D.bot - D.top + 14, 4); x.fill();
  x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(D.x0 - 14, D.top - 14, D.x1 - D.x0 + 28, 2);
  // interior: warm stairwell light
  x.fillStyle = lg(x, 0, D.top, 0, D.bot, [[0, '#ffe2ae'], [.55, '#f6b766'], [1, '#d07a34']]); x.fillRect(D.x0, D.top, D.x1 - D.x0, D.bot - D.top);
  // stair rail silhouette inside
  x.strokeStyle = 'rgba(120,60,20,.45)'; x.lineWidth = 4; x.beginPath(); x.moveTo(D.x0 + 8, D.top + 120); x.lineTo(D.x1 - 10, D.top + 210); x.stroke();
  for (let i = 0; i < 5; i++) { const u = i / 4, rx = D.x0 + 14 + u * (D.x1 - D.x0 - 30); x.beginPath(); x.moveTo(rx, D.top + 124 + u * 86); x.lineTo(rx, D.top + 200 + u * 86); x.stroke(); }
  x.fillStyle = lg(x, D.x0, 0, D.x0 + 26, 0, [[0, 'rgba(255,250,230,.95)'], [1, 'rgba(255,250,230,0)']]); x.fillRect(D.x0, D.top, 26, D.bot - D.top);
  // door leaf (hinged on the right, ajar)
  const gap = 18 + open * (D.x1 - D.x0 - 22);
  const lx0 = D.x0 + gap, lw = D.x1 - lx0;
  if (lw > 4) {
    x.fillStyle = lg(x, lx0, 0, D.x1, 0, [[0, '#24384a'], [.12, '#2f4a60'], [1, '#203242']]); x.fillRect(lx0, D.top, lw, D.bot - D.top);
    // inset panels
    x.strokeStyle = 'rgba(255,255,255,.10)'; x.lineWidth = 2; x.strokeRect(lx0 + 12, D.top + 132, lw - 24, D.bot - D.top - 150);
    // porthole
    const cx = lx0 + lw / 2, cy = D.top + 70;
    if (lw > 60) { x.fillStyle = '#5c6670'; x.beginPath(); x.arc(cx, cy, 25, 0, 7); x.fill(); x.fillStyle = rg(x, cx, cy, 0, 19, [[0, '#ffe2a8'], [1, '#f0a050']]); x.beginPath(); x.arc(cx, cy, 19, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.arc(cx - 6, cy - 6, 6, 0, 7); x.fill(); }
    // painted bolt stencil
    if (lw > 80) icon(x, ICONS.bolt, cx, D.top + 196, 64, 'rgba(245,197,66,.92)');
    // handle
    x.fillStyle = '#c9ced3'; rr(x, lx0 + 10, D.top + 150, 8, 26, 3); x.fill();
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(lx0, D.top, 3, D.bot - D.top);
  }
  // step
  x.fillStyle = '#b8ae9f'; x.beginPath(); x.moveTo(D.x0 - 30, bot); x.lineTo(D.x1 + 30, bot); x.lineTo(D.x1 + 40, bot + 20); x.lineTo(D.x0 - 40, bot + 20); x.closePath(); x.fill();
  x.fillStyle = lg(x, 0, bot + 20, 0, bot + 40, [[0, '#8c8377'], [1, '#6a6258']]); x.fillRect(D.x0 - 40, bot + 20, D.x1 - D.x0 + 80, 20);
  x.fillStyle = 'rgba(255,255,255,.3)'; x.fillRect(D.x0 - 40, bot + 20, D.x1 - D.x0 + 80, 1.5);
  // bulkhead lamp
  const lx = (D.x0 + D.x1) / 2, ly = D.top - 40;
  x.fillStyle = '#3a3f46'; rr(x, lx - 22, ly - 12, 44, 10, 3); x.fill();
  x.fillStyle = P.lamp > .2 ? '#fff1c8' : '#e9e4d8'; x.beginPath(); x.ellipse(lx, ly + 2, 18, 13, 0, 0, Math.PI); x.fill();
  x.strokeStyle = '#3a3f46'; x.lineWidth = 2; x.beginPath(); x.ellipse(lx, ly + 2, 18, 13, 0, 0, Math.PI); x.stroke(); x.beginPath(); x.moveTo(lx, ly); x.lineTo(lx, ly + 15); x.stroke();
  // record plate (Kyiv street-sign style enamel)
  const px = 1424, py = 690, pw = 132, ph = 84;
  x.fillStyle = 'rgba(0,0,0,.28)'; rr(x, px + 3, py + 5, pw, ph, 8); x.fill();
  x.fillStyle = lg(x, 0, py, 0, py + ph, [[0, '#2350a8'], [1, '#183a82']]); rr(x, px, py, pw, ph, 8); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.92)'; x.lineWidth = 2.5; rr(x, px + 5, py + 5, pw - 10, ph - 10, 5); x.stroke();
  x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '800 12.5px Manrope'; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (!PLATE) { x.letterSpacing = '2.5px'; x.fillText(lang === 'uk' ? 'РЕКОРД' : 'BEST RUN', px + pw / 2 + 1, py + 25); x.letterSpacing = '0px'; }
  x.fillStyle = '#ffffff'; if (!PLATE) { const rec = lang === 'uk' ? '1 548 м' : '1,548 m'; let fs = 25; x.font = `700 ${fs}px Unbounded`; while (x.measureText(rec).width > pw - 26 && fs > 16) { fs -= 1; x.font = `700 ${fs}px Unbounded`; } x.fillText(rec, px + pw / 2, py + 55); }
  x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(px + 8, py + 6, pw - 16, 1.5);
  [[px + 10, py + 10], [px + pw - 10, py + 10], [px + 10, py + ph - 10], [px + pw - 10, py + ph - 10]].forEach(([a, b]) => { x.fillStyle = '#cfd6e6'; x.beginPath(); x.arc(a, b, 2, 0, 7); x.fill(); });
  x.textAlign = 'left';
  // intercom box
  x.fillStyle = lg(x, 1752, 0, 1798, 0, [[0, '#d5d8d4'], [1, '#a2a7a3']]); rr(x, 1752, 770, 46, 66, 5); x.fill();
  x.fillStyle = '#2a3036'; rr(x, 1760, 780, 30, 18, 3); x.fill();
  x.fillStyle = '#3a3f46'; x.fillRect(1772, 640, 6, 130);
  // potted plant by the step
  drawSprite(x, 'planter', 1748, bot - 50, 1.05);
}

function drawSol(x, st, zoom = 1) {
  const img = st.solSide ? ART.heroSide : ART.hero;
  const h = SOL.h, w = img.width * h / img.height;
  const bob = st.reduced ? 0 : Math.sin(st.t * Math.PI * 2 / 2.6) * 5;
  const breath = 1 + (st.reduced ? 0 : Math.sin(st.t * Math.PI * 2 / 2.6) * .006);
  const y0 = SOL.feet - h - bob;
  const zs = Math.min(zoom, img.height / h) ; const c = mk(Math.ceil(w * zs), Math.ceil(h * zs)), q = c.getContext('2d');
  q.drawImage(img, 0, 0, c.width, c.height);
  // blink: close the screen eyes for ~120 ms
  if (!st.solSide && st.blink) {
    const s = c.height / img.height;
    q.save(); q.scale(s, s);
    q.fillStyle = '#0d1219'; [[362, 522], [497, 522]].forEach(([ex, ey]) => { q.beginPath(); q.ellipse(ex, ey, 46, 30, 0, 0, 7); q.fill(); });
    q.strokeStyle = '#8fe9ff'; q.lineWidth = 9; q.lineCap = 'round'; q.shadowColor = '#6fe0ff'; q.shadowBlur = 14;
    [[362, 528], [497, 528]].forEach(([ex, ey]) => { q.beginPath(); q.moveTo(ex - 28, ey); q.quadraticCurveTo(ex, ey + 9, ex + 28, ey); q.stroke(); });
    q.restore();
  }
  x.save(); x.translate(SOL.x, SOL.feet); x.scale(1 / breath, breath); x.translate(-SOL.x, -SOL.feet);
  x.drawImage(c, SOL.x - w / 2, y0, w, h);
  x.restore();
  return { c, x0: SOL.x - w / 2, y0, w, h };
}

const ICONS = {
  call: 'M6.6,10.8c1.4,2.8 3.8,5.1 6.6,6.6l2.2,-2.2c0.3,-0.3 0.7,-0.4 1,-0.2c1.1,0.4 2.3,0.6 3.6,0.6c0.6,0 1,0.4 1,1V20c0,0.6 -0.4,1 -1,1C10.6,21 3,13.4 3,4c0,-0.6 0.4,-1 1,-1h3.5c0.6,0 1,0.4 1,1c0,1.3 0.2,2.5 0.6,3.6c0.1,0.3 0,0.7 -0.2,1L6.6,10.8z',
  gear: 'M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.620,9.08 2.66,9.34 2.86,9.48l2.030,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.980,15.6 12,15.6z',
  bolt: 'M13.5,1.5L4.5,13.2c-0.35,0.45 -0.03,1.1 0.54,1.1H11l-1.5,8.2c-0.1,0.6 0.66,0.93 1.03,0.45l9,-11.7c0.35,-0.45 0.03,-1.1 -0.54,-1.1H13l1.5,-8.2c0.1,-0.6 -0.66,-0.93 -1,-0.45z',
};

// ---------- frame composition ----------
const layerCanvas = { fg: mk(W, HT), fgA: mk(W, HT), lights: mk(W, HT), scratch: mk(W, HT), mid: {} };

function camMatrix(st, depth) {
  const p = st.fly ? ease(clamp(st.fly, 0, 1)) : 0;
  const T0 = st.flyTarget || [ (DOOR.x0 + DOOR.x1) / 2, (DOOR.top + DOOR.bot) / 2 + 10 ], T = [T0[0] + OX, T0[1]];
  const Z = st.flyZoom || 4.2;
  const z = 1 + (Z - 1) * p * depth;
  const tx = (W / 2 - T[0]) * p * depth, ty = (H / 2 - T[1]) * p * depth;
  return [z, 0, 0, z, T[0] - T[0] * z + tx, T[1] - T[1] * z + ty];
}
function camApply(x, st, depth) { x.setTransform(...camMatrix(st, depth)); }
function camApplyOld(x, st, depth) {
  const p = st.fly ? ease(clamp(st.fly, 0, 1)) : 0;
  const T = st.flyTarget || [ (DOOR.x0 + DOOR.x1) / 2, (DOOR.top + DOOR.bot) / 2 + 10 ];
  const Z = st.flyZoom || 4.2;
  const z = 1 + (Z - 1) * p * depth;
  const tx = (W / 2 - T[0]) * p * depth, ty = (H / 2 - T[1]) * p * depth;
  x.setTransform(z, 0, 0, z, T[0] - T[0] * z + tx, T[1] - T[1] * z + ty);
}

function renderScene(ctx, st) {
  const P = SCENES[st.scene], key = st.scene;
  const t = st.t || 0;
  // In the export modes the camera is fixed and frame y=0 sits EXT_T pixels down the canvas.
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, HT);
  const pf = st.fly ? ease(clamp(st.fly, 0, 1)) : 0;
  if (!SOLONLY) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(buildBackground(key), 0, 0);
    if (!layerCanvas.mid[key]) { const m = mk(W, HT); const mx = m.getContext('2d'); mx.translate(0, EXT_T); drawNeighbors(mx, key, P); layerCanvas.mid[key] = m; }
    ctx.drawImage(layerCanvas.mid[key], 0, 0);
  }

  const fg = layerCanvas.fg, x = fg.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, HT); x.filter = 'none'; x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  const M = [1, 0, 0, 1, OX, EXT_T]; x.setTransform(...M);
  let bulbs = [];
  if (!SOLONLY) {
    drawParapet(x, key, P);
    bulbs = drawFestoon(x, P, t);
    drawFloor(x, key, P);
    drawDeck(x, key, P);
    x.strokeStyle = '#1e2126'; x.lineWidth = 5; x.lineCap = 'round'; x.beginPath(); x.moveTo(PAN.x1 + 40, 902); x.bezierCurveTo(1000, 935, 1150, 930, HUT.x0 + 10, 948); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1.5; x.stroke();
    drawAntenna(x, key, P, st);
  }
  const pan = SOLONLY ? null : drawPanels(x, key, P, st);
  if (!SOLONLY) {
    drawTicker(x, key, P, st, st.lang);
    drawHut(x, key, P, st, st.lang);
    const [dx, dy] = P.shDir;
    x.save(); x.filter = 'blur(9px)'; x.fillStyle = P.shadow; x.globalAlpha = .9;
    x.translate(SOL.x + dx * 110, SOL.feet + dy * 110); x.rotate(Math.atan2(dy, dx)); x.beginPath(); x.ellipse(0, 0, Math.hypot(dx, dy) * 200 + 60, 34, 0, 0, 7); x.fill(); x.restore();
    x.save(); x.filter = 'blur(6px)'; x.fillStyle = 'rgba(10,8,12,.45)'; x.beginPath(); x.ellipse(SOL.x, SOL.feet - 2, 118, 20, 0, 0, 7); x.fill(); x.restore();
  }
  let sol;
  if (PLATE) { const sc = layerCanvas.scratch.getContext('2d'); sc.setTransform(...M); sc.clearRect(-OX, -EXT_T, W, HT); sol = drawSol(sc, st, 1); }
  else sol = drawSol(x, st, 1);
  if (!SOLONLY) {
    drawToolbox(x, key, P);
    drawGrass(x, -OX + 50, 1156, 1.15, 3); drawGrass(x, 1920 + OX - 44, 1150, 1.05, 9);
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  if (P.grade) {
    const a = layerCanvas.fgA, ax = a.getContext('2d'); ax.setTransform(1, 0, 0, 1, 0, 0); ax.clearRect(0, 0, W, HT); ax.drawImage(fg, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = P.grade.mul; x.fillRect(0, 0, W, HT);
    x.globalCompositeOperation = 'source-atop'; x.fillStyle = hexA(P.grade.tint, P.grade.ta); x.fillRect(0, 0, W, HT);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(a, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }
  x.setTransform(...M);
  x.globalCompositeOperation = 'lighter';
  if (!SOLONLY) {
    const D = DOOR, dcx = (D.x0 + D.x1) / 2, open = 0;
    const doorI = clamp(P.door, 0, 1.4);
    { const gx = D.x0 + 9, spread = 1;
      x.save(); x.filter = 'blur(14px)'; x.fillStyle = lg(x, 0, D.bot, 0, D.bot + 260, [[0, `rgba(255,190,110,${.55 * doorI})`], [1, 'rgba(255,170,90,0)']]);
      x.beginPath(); x.moveTo(D.x0, D.bot); x.lineTo(D.x0 + 20, D.bot); x.lineTo(D.x0 + 60 * spread + 80, D.bot + 240); x.lineTo(D.x0 - 120 - 40 * spread, D.bot + 240); x.closePath(); x.fill(); x.restore();
      glow(x, gx, D.top + (D.bot - D.top) * .55, 140, '#ffb860', .22 * doorI); }
    if (P.lamp > 0) { glow(x, dcx, D.top - 30, 170, '#ffc878', .38 * P.lamp); glow(x, dcx, D.top - 30, 40, '#fff0c8', .7 * P.lamp); x.save(); x.filter = 'blur(20px)'; x.fillStyle = `rgba(255,190,110,${.16 * P.lamp})`; x.beginPath(); x.ellipse(dcx, D.bot + 40, 200, 40, 0, 0, 7); x.fill(); x.restore(); }
    if (P.festoon > 0) {
      const lb = layerCanvas.lights, lx = lb.getContext('2d'); lx.setTransform(1, 0, 0, 1, 0, 0); lx.clearRect(0, 0, W, HT); lx.setTransform(...M); lx.globalCompositeOperation = 'lighter';
      bulbs.forEach(([bx, by], i) => { glow(lx, bx, by + 3, 26, '#ffcf7a', .55 * P.festoon * .92); glow(lx, bx, by + 3, 7, '#fff4d8', .9 * P.festoon); });
      lx.globalCompositeOperation = 'destination-out'; lx.drawImage(sol.c, sol.x0, sol.y0, sol.w, sol.h); lx.fillRect(TICK.x0 - 6, TICK.top - 14, TICK.x1 - TICK.x0 + 12, TICK.legs - TICK.top + 14); lx.fillRect(HUT.x0 - 60, HUT.top - 40, W, H);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(lb, 0, 0); x.restore();
    }
    if (key !== 'day') { x.save(); x.globalCompositeOperation = 'source-over'; x.globalAlpha = key === 'night' ? .92 : .8; drawTickerScreen(x, st.lang); x.restore(); x.globalCompositeOperation = 'lighter'; }
    glow(x, (TICK.x0 + TICK.x1) / 2, (TICK.top + TICK.bot) / 2 + 10, 150, '#5bd69a', key === 'day' ? .05 : .12);
    pan.leds.forEach(([lx, ly]) => { glow(x, lx, ly, 9, '#5bd69a', .45); x.fillStyle = '#b8ffd8'; x.beginPath(); x.arc(lx, ly, 2.6, 0, 7); x.fill(); });
  }
  if (!PLATE && key !== 'day') {
    const rim = mk(sol.c.width, sol.c.height), rq = rim.getContext('2d'); rq.drawImage(sol.c, 0, 0);
    rq.globalCompositeOperation = 'source-in';
    rq.fillStyle = lg(rq, 0, 0, sol.c.width, 0, [[0, 'rgba(255,170,90,0)'], [.62, 'rgba(255,170,90,0)'], [1, `rgba(255,180,100,${key === 'night' ? .55 : .45})`]]); rq.fillRect(0, 0, sol.c.width, sol.c.height);
    x.drawImage(rim, sol.x0, sol.y0, sol.w, sol.h);
    x.globalCompositeOperation = 'source-over';
    x.save(); const s = sol.h / ART.hero.height; x.beginPath(); x.roundRect(sol.x0 + 292 * s, sol.y0 + 452 * s, 300 * s, 196 * s, 60 * s); x.clip(); x.globalAlpha = key === 'night' ? .8 : .55; x.drawImage(sol.c, sol.x0, sol.y0, sol.w, sol.h); x.restore();
  }
  x.globalCompositeOperation = 'source-over';
  x.setTransform(1, 0, 0, 1, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fg, 0, 0);
  window.SOLRECT = [sol.x0, sol.y0, sol.w, sol.h];
}

function sparkle(x, cx, cy, r, a) {
  x.save(); x.translate(cx, cy); x.fillStyle = `rgba(255,236,170,${a})`;
  x.beginPath(); x.moveTo(0, -r); x.quadraticCurveTo(0, 0, r, 0); x.quadraticCurveTo(0, 0, 0, r); x.quadraticCurveTo(0, 0, -r, 0); x.quadraticCurveTo(0, 0, 0, -r); x.fill();
  x.restore();
}

// screen-space position of a roof-space point under the current camera
function roofToScreen(st, px, py) {
  const p = st.fly ? ease(clamp(st.fly, 0, 1)) : 0, T = st.flyTarget || [(DOOR.x0 + DOOR.x1) / 2, (DOOR.top + DOOR.bot) / 2 + 10], Z = st.flyZoom || 4.2;
  const M = camMatrix(st, 1); return [(px + OX) * M[0] + M[4], py * M[3] + M[5]];
}

const DECK = { y0: 900, y1: 1132, x0: 742, x1: 1178 };
function deckX(bx, y) { return VPX + (bx - VPX) * (y - HOR) / (DECK.y0 - HOR); }
function drawDeck(x, key, P) {
  const { y0, y1, x0, x1 } = DECK;
  const fl = deckX(x0, y1), fr = deckX(x1, y1);
  // soft contact shadow under the deck
  x.save(); x.filter = 'blur(10px)'; x.fillStyle = 'rgba(10,8,8,.35)'; x.beginPath(); x.moveTo(x0 - 6, y0 + 6); x.lineTo(x1 + 6, y0 + 6); x.lineTo(fr + 14, y1 + 24); x.lineTo(fl - 14, y1 + 24); x.fill(); x.restore();
  const quad = () => { x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y0); x.lineTo(fr, y1); x.lineTo(fl, y1); x.closePath(); };
  x.save(); quad(); x.clip();
  x.fillStyle = lg(x, 0, y0, 0, y1, [[0, '#a8794f'], [1, '#86593a']]); x.fillRect(fl, y0, fr - fl, y1 - y0);
  const R = rng(41), n = 15;
  for (let i = 0; i < n; i++) {
    const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n;
    const v = R();
    x.fillStyle = v < .33 ? 'rgba(255,220,170,.08)' : v < .66 ? 'rgba(60,30,10,.10)' : 'rgba(0,0,0,0)';
    x.beginPath(); x.moveTo(a, y0); x.lineTo(b, y0); x.lineTo(deckX(b, y1), y1); x.lineTo(deckX(a, y1), y1); x.fill();
    // grain streaks
    x.strokeStyle = 'rgba(70,40,20,.10)'; x.lineWidth = 1;
    for (let g = 0; g < 3; g++) { const u = .2 + R() * .6, ga = a + (b - a) * u; x.beginPath(); x.moveTo(ga, y0); x.lineTo(deckX(ga, y1), y1); x.stroke(); }
    // gap
    x.strokeStyle = 'rgba(35,18,8,.55)'; x.lineWidth = 2.2; x.beginPath(); x.moveTo(b, y0); x.lineTo(deckX(b, y1), y1); x.stroke();
    x.strokeStyle = 'rgba(255,230,190,.12)'; x.lineWidth = 1; x.beginPath(); x.moveTo(b + 1.5, y0); x.lineTo(deckX(b, y1) + 2.5, y1); x.stroke();
  }
  // plank butt joints
  for (let i = 0; i < n; i++) { const yj = y0 + (y1 - y0) * (.25 + R() * .55), a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n; x.fillStyle = 'rgba(35,18,8,.4)'; x.fillRect(deckX(a, yj), yj, deckX(b, yj) - deckX(a, yj), 1.6); }
  const pat = x.createPattern(ART.noise, 'repeat'); x.globalAlpha = .06; x.globalCompositeOperation = 'overlay'; x.fillStyle = pat; x.fillRect(fl, y0, fr - fl, y1 - y0);
  x.restore();
  // front edge board
  x.fillStyle = lg(x, 0, y1, 0, y1 + 16, [[0, '#6e4a30'], [1, '#4f3422']]); x.fillRect(fl, y1, fr - fl, 16);
  x.fillStyle = 'rgba(255,225,180,.35)'; x.fillRect(fl, y1, fr - fl, 1.5);
  // back edge highlight
  x.fillStyle = 'rgba(255,235,200,.25)'; x.fillRect(x0, y0, x1 - x0, 1.5);
}
function drawGrass(x, cx, base, s, seed) {
  const R = rng(seed);
  // pot
  const pw = 92 * s, ph = 86 * s;
  x.save(); x.filter = 'blur(6px)'; x.fillStyle = 'rgba(10,8,8,.35)'; x.beginPath(); x.ellipse(cx, base + 2, pw * .62, 11, 0, 0, 7); x.fill(); x.restore();
  x.fillStyle = lg(x, cx - pw / 2, 0, cx + pw / 2, 0, [[0, '#4a4f57'], [.35, '#6b717a'], [1, '#2f343b']]);
  x.beginPath(); x.moveTo(cx - pw / 2, base - ph); x.lineTo(cx + pw / 2, base - ph); x.lineTo(cx + pw * .42, base); x.lineTo(cx - pw * .42, base); x.closePath(); x.fill();
  x.fillStyle = '#7b818a'; x.fillRect(cx - pw / 2 - 3, base - ph - 6, pw + 6, 8);
  x.fillStyle = 'rgba(255,255,255,.3)'; x.fillRect(cx - pw / 2 - 3, base - ph - 6, pw + 6, 1.5);
  // ornamental grass blades
  for (let i = 0; i < 70; i++) {
    const u = R(), bx = cx - pw * .38 + u * pw * .76, len = (120 + R() * 110) * s, lean = (u - .5) * 1.6 + (R() - .5) * .8;
    const tx = bx + lean * len * .55, ty = base - ph - len;
    const g = 90 + R() * 50 | 0;
    x.strokeStyle = `rgb(${g * .55 | 0},${g},${g * .45 | 0})`; x.lineWidth = 2.2 * s; x.lineCap = 'round';
    x.beginPath(); x.moveTo(bx, base - ph); x.quadraticCurveTo(bx + lean * len * .1, base - ph - len * .6, tx, ty); x.stroke();
  }
  for (let i = 0; i < 14; i++) { const bx = cx - pw * .3 + R() * pw * .6, len = (170 + R() * 80) * s, lean = (R() - .5) * 1.4; x.strokeStyle = `rgba(232,214,160,.9)`; x.lineWidth = 1.6 * s; x.beginPath(); x.moveTo(bx, base - ph); x.quadraticCurveTo(bx, base - ph - len * .6, bx + lean * len * .5, base - ph - len); x.stroke(); }
}

// door opening becomes a portal into the run (the real 0.21.7 countdown screen)
function drawPortal(ctx, st) {
  const g = clamp(st.portal, 0, 1);
  const [ax, ay] = roofToScreen(st, DOOR.x0, DOOR.top), [bx, by] = roofToScreen(st, DOOR.x1, DOOR.bot);
  const e = ease(g);
  const x0 = ax + (0 - ax) * e, y0 = ay + (0 - ay) * e, x1 = bx + (W - bx) * e, y1 = by + (H - by) * e;
  const img = ART.run; const sc = Math.max(W / img.width, H / img.height), iw = img.width * sc, ih = img.height * sc;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.fillStyle = `rgba(255,224,168,${.8 * Math.min(1, g * 2.2)})`; ctx.fill('evenodd'); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
  ctx.drawImage(img, (W - iw) / 2 + 300 * (1 - e), (H - ih) / 2, iw, ih);
  // warm light still pouring in around the frame
  const a = 1 - e;
  ctx.fillStyle = `rgba(255,214,150,${.32 * a})`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.shadowColor = 'rgba(255,200,120,.9)'; ctx.shadowBlur = 60 * a; ctx.strokeStyle = `rgba(255,214,150,${.8 * a})`; ctx.lineWidth = 6; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.restore();
}
