"""Solarpunk city skyline layers for the native runner (Alto's-Odyssey-like silhouettes).
Each layer is an alpha mask (white + alpha): the game tints it per time of day, and a
matching window-light mask fades in at dusk. Horizontally seamless (buildings wrap).
Units: world units; rendered at 2 px/unit with 3x supersampling."""
import math, random, os
from PIL import Image, ImageDraw, ImageFilter
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'city')
os.makedirs(OUT, exist_ok=True)
PX = 2      # px per unit in the output
SS = 3      # supersampling
K = PX * SS

class Layer:
    def __init__(self, W, H):
        self.W, self.H = W, H
        self.m = Image.new('L', (W * K, H * K), 0)
        self.l = Image.new('L', (W * K, H * K), 0)
        self.n = Image.new('L', (W * K, H * K), 0)
        self.dm, self.dl, self.dn = ImageDraw.Draw(self.m), ImageDraw.Draw(self.l), ImageDraw.Draw(self.n)
    def _wrap(self, xs):
        offs = [0]
        if min(xs) < 0: offs.append(self.W)
        if max(xs) > self.W: offs.append(-self.W)
        return offs
    def poly(self, pts, d=None, v=255):
        d = d or self.dm
        for o in self._wrap([p[0] for p in pts]):
            d.polygon([((x + o) * K, y * K) for x, y in pts], fill=v)
    def rect(self, x, y, w, h, d=None, v=255):
        self.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], d, v)
    def ellipse(self, cx, cy, rx, ry, d=None, v=255):
        d = d or self.dm
        for o in self._wrap([cx - rx, cx + rx]):
            d.ellipse([(cx - rx + o) * K, (cy - ry) * K, (cx + rx + o) * K, (cy + ry) * K], fill=v)
    def line(self, pts, w, d=None, v=255):
        d = d or self.dm
        for o in self._wrap([p[0] for p in pts]):
            d.line([((x + o) * K, y * K) for x, y in pts], fill=v, width=max(1, int(w * K)))
    def save(self, name, blur_lights=0.0):
        for img, suf in ((self.m, ''), (self.l, '_lit'), (self.n, '_neon')):
            if img.getbbox() is None: continue
            small = img.resize((self.W * PX, self.H * PX), Image.LANCZOS)
            if suf and blur_lights: small = Image.composite(small, small, small).filter(ImageFilter.GaussianBlur(blur_lights)).point(lambda v: min(255, int(v * 1.6)))
            out = Image.new('RGBA', small.size, (255, 255, 255, 0)); out.putalpha(small)
            out.save(f'{OUT}/{name}{suf}.png')
            print('saved', name + suf, out.size)

def windows(L, x, y, w, h, cw, ch, gx, gy, lit, rnd, neon=0.0):
    """Window grid inside a building face: lit ones go to the lights mask."""
    cols = max(1, int((w - gx) // (cw + gx)))
    rows = max(1, int((h - gy) // (ch + gy)))
    ox = x + (w - cols * (cw + gx) + gx) / 2
    for r in range(rows):
        floor_lit = rnd.random() < 0.85
        for c in range(cols):
            if rnd.random() < lit and floor_lit:
                v = int(255 * rnd.uniform(0.45, 1.0))
                L.rect(ox + c * (cw + gx), y + gy + r * (ch + gy), cw, ch, L.dl, v)

def building(L, x, base, w, h, rnd, kind, detail, lit, wins):
    top = base - h
    if kind == 'box':
        L.rect(x, top, w, h)
    elif kind == 'step':
        s1 = h * rnd.uniform(0.55, 0.75)
        L.rect(x, base - s1, w, s1)
        L.rect(x + w * 0.15, top + h * 0.12, w * 0.7, h - s1 + 2)
        L.rect(x + w * 0.32, top, w * 0.36, h * 0.14)
        top_c = top
    elif kind == 'spire':
        L.rect(x, top + h * 0.1, w, h * 0.9)
        L.poly([(x + w * 0.1, top + h * 0.1), (x + w * 0.5, top - h * 0.12), (x + w * 0.9, top + h * 0.1)])
        L.line([(x + w * 0.5, top - h * 0.12), (x + w * 0.5, top - h * 0.24)], 0.8)
    elif kind == 'dome':
        L.rect(x, top + w * 0.3, w, h - w * 0.3)
        L.ellipse(x + w / 2, top + w * 0.32, w / 2, w * 0.32)
    elif kind == 'slant':   # solar-tilted roof
        L.poly([(x, top + w * 0.35), (x + w, top), (x + w, base), (x, base)])
    elif kind == 'terrace': # stepped garden tower with trees on each terrace
        n = 4
        for i in range(n):
            ww = w * (1 - i * 0.18)
            hh = h * (i + 1) / n
            L.rect(x + (w - ww) / 2, base - hh, ww, hh - 0.5 + h / n * 0)
            if detail:
                for t in range(int(ww // 9)):
                    tx = x + (w - ww) / 2 + 4 + t * 9 + rnd.uniform(-1, 1)
                    L.ellipse(tx, base - hh - 2.5, rnd.uniform(3, 4.5), rnd.uniform(2.5, 4))
    # rooftop furniture
    if detail and kind in ('box', 'slant', 'step'):
        roof_y = top if kind != 'slant' else top + w * 0.17
        r = rnd.random()
        if r < 0.3 and kind == 'box':   # solar panel rows (sawtooth)
            px = x + 3
            while px < x + w - 10:
                L.poly([(px, top), (px + 9, top - 5), (px + 10, top - 4.5), (px + 2, top)])
                px += 11
        elif r < 0.5 and kind == 'box':  # rooftop trees
            for t in range(max(1, int(w // 14))):
                L.ellipse(x + 6 + t * 13 + rnd.uniform(-2, 2), top - 4, rnd.uniform(4, 6), rnd.uniform(4, 6.5))
        elif r < 0.65:   # water tank
            tx = x + w * rnd.uniform(0.2, 0.7)
            L.rect(tx, top - 9, 1, 9); L.rect(tx + 7, top - 9, 1, 9)
            L.poly([(tx - 1, top - 9), (tx + 9, top - 9), (tx + 9, top - 18), (tx + 4, top - 21), (tx - 1, top - 18)])
        elif r < 0.8:    # antenna mast
            ax = x + w * rnd.uniform(0.2, 0.8)
            L.line([(ax, top), (ax, top - rnd.uniform(14, 30))], 1.0)
        if kind == 'box' and rnd.random() < 0.3:  # balconies with planters
            for yy in range(int(top + 12), int(base - 6), 14):
                L.rect(x - 1.5, yy, w + 3, 1.6)
    if wins:
        cw, ch, gx, gy = wins
        windows(L, x + 2, top + 4, w - 4, h - 6, cw, ch, gx, gy, lit, rnd)

def crane(L, x, base, h, rnd):
    L.line([(x, base), (x, base - h)], 1.4)
    for yy in range(int(base - h), int(base), 6):
        L.line([(x - 1.2, yy), (x + 1.2, yy + 6)], 0.4)
    jib = rnd.uniform(40, 70)
    L.line([(x - 14, base - h), (x + jib, base - h)], 1.2)
    L.line([(x, base - h - 8), (x + jib * 0.8, base - h)], 0.5)
    L.line([(x, base - h - 8), (x - 14, base - h)], 0.5)
    L.rect(x - 15, base - h - 1, 5, 4)
    hx = x + jib * rnd.uniform(0.4, 0.8)
    L.line([(hx, base - h), (hx, base - h + rnd.uniform(15, 40))], 0.3)

def turbine(L, x, base, h, rnd, ang):
    L.poly([(x - 1.2, base), (x + 1.2, base), (x + 0.5, base - h), (x - 0.5, base - h)])
    for k in range(3):
        a = ang + k * 2 * math.pi / 3
        bx, by = x + math.cos(a) * h * 0.42, base - h + math.sin(a) * h * 0.42
        nx, ny = -math.sin(a) * 1.0, math.cos(a) * 1.0
        L.poly([(x + nx, base - h + ny), (bx, by), (x - nx, base - h - ny)])

def solar_tower(L, x, base, h):
    L.poly([(x - 4, base), (x + 4, base), (x + 2.2, base - h), (x - 2.2, base - h)])
    L.rect(x - 5, base - h - 12, 10, 12)
    L.ellipse(x, base - h - 6, 4.2, 4.2, L.dn, 255)     # glowing receiver
    L.ellipse(x, base - h - 6, 4.2, 4.2, L.dl, 255)

def far():
    W, H = 1280, 300
    L = Layer(W, H); rnd = random.Random(11)
    base = H
    # low hills with wind turbines behind the city
    hill = [(x, base - 40 - 14 * math.sin(2 * math.pi * x / W * 2 + 0.5) - 8 * math.sin(2 * math.pi * x / W * 5 + 1.1)) for x in range(0, W + 1, 8)]
    L.poly([(0, H)] + hill + [(W, H)])
    for i in range(7):
        tx = rnd.uniform(0, W); hy = base - 40 - 14 * math.sin(2 * math.pi * tx / W * 2 + 0.5) - 8 * math.sin(2 * math.pi * tx / W * 5 + 1.1)
        turbine(L, tx, hy + 2, rnd.uniform(36, 52), rnd, rnd.uniform(0, 6.3))
    solar_tower(L, 180, base - 30, 170)
    solar_tower(L, 905, base - 30, 140)
    x = 0
    while x < W:
        w = rnd.uniform(14, 34)
        h = rnd.choice([rnd.uniform(50, 110), rnd.uniform(90, 170), rnd.uniform(140, 235)]) if rnd.random() < 0.75 else rnd.uniform(30, 60)
        kind = rnd.choices(['box', 'step', 'spire', 'dome', 'slant'], [5, 2, 1.2, 0.6, 1.2])[0]
        building(L, x, base, w, h, rnd, kind, False, 0.35, (1.4, 2.0, 2.2, 3.4))
        x += w + rnd.uniform(-4, 6)
    L.save('city_far')

def mid():
    W, H = 1280, 300
    L = Layer(W, H); rnd = random.Random(23)
    base = H
    for cx in (330, 1010):
        crane(L, cx, base - 120, rnd.uniform(120, 160), rnd)
    x = 0
    while x < W:
        w = rnd.uniform(30, 72)
        h = rnd.uniform(60, 200) if rnd.random() < 0.8 else rnd.uniform(200, 250)
        kind = rnd.choices(['box', 'step', 'terrace', 'slant', 'dome'], [5, 1.6, 1.0, 1.6, 0.4])[0]
        building(L, x, base, w, h, rnd, kind, True, 0.42, (2.6, 3.6, 3.2, 5.0))
        # neon strip on some tops
        if rnd.random() < 0.18:
            L.rect(x + 3, base - h + 6, w - 6, 1.5, L.dn, 255)
        x += w + rnd.uniform(2, 10)
    L.save('city_mid')

def near():
    W, H = 1280, 320
    L = Layer(W, H); rnd = random.Random(37)
    base = H
    x = 0
    while x < W:
        w = rnd.uniform(70, 140)
        h = rnd.uniform(110, 260)
        kind = rnd.choices(['box', 'step', 'slant', 'terrace'], [5, 1.4, 1.4, 0.8])[0]
        building(L, x, base, w, h, rnd, kind, True, 0.4, (5.0, 7.0, 5.0, 8.0))
        if rnd.random() < 0.25:
            L.rect(x + 6, base - h + 10, w - 12, 2.2, L.dn, 255)
        nx = x + w + rnd.uniform(14, 40)
        # cables strung between neighbouring rooftops
        if rnd.random() < 0.5:
            y1 = base - h + 8; y2 = base - rnd.uniform(110, 240) + 8
            pts = [(x + w + t * (nx - x - w) / 10, y1 + (y2 - y1) * t / 10 + 8 * math.sin(math.pi * t / 10)) for t in range(11)]
            L.line(pts, 0.7)
        x = nx
    L.save('city_near')

if __name__ == '__main__':
    far(); mid(); near()
