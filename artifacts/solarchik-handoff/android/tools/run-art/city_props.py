"""Building facades (tileable), the parapet strip, rooftop props, the maintenance-drone boss
and wispy stratus masks for the solarpunk city run. SVG -> headless Chrome -> PNG (2 px/unit)."""
import os, random, math, subprocess
from PIL import Image, ImageDraw, ImageFilter
OUT = '/workspace/art/city'
def render(name, w, h, body, defs='', scale=2):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><defs>{defs}</defs>{body}</svg>'
    p = f'{OUT}/{name}.html'
    open(p, 'w').write(f'<html><body style="margin:0;background:transparent;overflow:hidden">{svg}</body></html>')
    subprocess.run(['google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
                    f'--force-device-scale-factor={scale}', f'--window-size={w},{h}', f'--screenshot={OUT}/{name}.png', f'file://{p}'], capture_output=True, timeout=90)
    print('rendered', name)

def litmask(name, w, h, rects, seed):
    rnd = random.Random(seed)
    m = Image.new('L', (w * 2, h * 2), 0); d = ImageDraw.Draw(m)
    for (x, y, ww, hh) in rects:
        if rnd.random() < 0.42:
            v = int(255 * rnd.uniform(0.5, 1.0))
            d.rectangle([x * 2, y * 2, (x + ww) * 2 - 1, (y + hh) * 2 - 1], fill=v)
    m = m.filter(ImageFilter.GaussianBlur(0.6))
    out = Image.new('RGBA', m.size, (255, 255, 255, 0)); out.putalpha(m); out.save(f'{OUT}/{name}.png'); print('mask', name)

GLASS = '''<linearGradient id="gl" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#5d6f80"/><stop offset="0.45" stop-color="#324150"/><stop offset="1" stop-color="#232d38"/></linearGradient>
<linearGradient id="refl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.04"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.10 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>'''

def facade_a():
    # warm concrete, deep-set windows, planters every other floor
    W = H = 128; rects = []; body = f'<rect width="{W}" height="{H}" fill="#8e8780"/>'
    body += f'<rect width="{W}" height="{H}" fill="#000" filter="url(#grain)" opacity="0.9"/>'
    for f in range(3):
        y0 = f * 42.67
        body += f'<rect x="0" y="{y0+38}" width="{W}" height="4.67" fill="#7a736c"/><rect x="0" y="{y0+38}" width="{W}" height="1" fill="#a49d95"/>'
        for c in range(4):
            x = c * 32 + 7; y = y0 + 9; ww, hh = 18, 24
            rects.append((x + 1, y + 1, ww - 2, hh - 2))
            body += f'<rect x="{x-1.5}" y="{y-1.5}" width="{ww+3}" height="{hh+4}" fill="#6a645e"/>'
            body += f'<rect x="{x}" y="{y}" width="{ww}" height="{hh}" fill="url(#gl)"/><rect x="{x}" y="{y}" width="{ww}" height="{hh}" fill="url(#refl)"/>'
            body += f'<rect x="{x+ww/2-0.5}" y="{y}" width="1" height="{hh}" fill="#59636c"/>'
            body += f'<rect x="{x-2.5}" y="{y+hh+0.5}" width="{ww+5}" height="2.2" fill="#b3aca3"/>'
            if f % 2 == 0:
                body += f'<rect x="{x-2}" y="{y+hh+2.7}" width="{ww+4}" height="4.5" rx="1" fill="#5b4a3c"/>'
                for k in range(5):
                    body += f'<circle cx="{x+k*4.5}" cy="{y+hh+2.2}" r="{2.6+(k%2)*0.8}" fill="{["#5e7748","#4f673e","#6f8a52"][k%3]}"/>'
    render('facade_a', W, H, body, GLASS); litmask('facade_a_lit', W, H, rects, 1)

def facade_b():
    # dark glass curtain wall with bronze mullions
    W = H = 128; rects = []
    defs = GLASS + '''<linearGradient id="cw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d5566"/><stop offset="0.5" stop-color="#26394a"/><stop offset="1" stop-color="#1d2b38"/></linearGradient>'''
    body = f'<rect width="{W}" height="{H}" fill="url(#cw)"/>'
    for r in range(4):
        for c in range(8):
            x, y = c * 16 + 1.2, r * 32 + 3
            rects.append((x, y, 13.6, 25))
            body += f'<rect x="{x}" y="{y}" width="13.6" height="25" fill="url(#gl)" opacity="0.75"/>'
            body += f'<rect x="{x}" y="{y}" width="13.6" height="25" fill="url(#refl)"/>'
        body += f'<rect x="0" y="{r*32+28}" width="{W}" height="4" fill="#2a3540"/><rect x="0" y="{r*32+28}" width="{W}" height="0.8" fill="#8c7a62"/>'
    for c in range(9):
        body += f'<rect x="{c*16-0.8}" y="0" width="1.6" height="{H}" fill="#7d6c57"/>'
    render('facade_b', W, H, body, defs); litmask('facade_b_lit', W, H, rects, 2)

def facade_c():
    # terracotta brick with arched windows and hanging vines
    W = H = 128; rects = []
    body = f'<rect width="{W}" height="{H}" fill="#8a6050"/>'
    for yy in range(0, H, 4):
        off = 0 if (yy // 4) % 2 == 0 else 6
        body += f'<rect x="0" y="{yy+3.4}" width="{W}" height="0.6" fill="#7e4b38" opacity="0.7"/>'
        for xx in range(-12 + off, W, 12):
            body += f'<rect x="{xx}" y="{yy}" width="0.6" height="3.4" fill="#7e4b38" opacity="0.5"/>'
    body += f'<rect width="{W}" height="{H}" fill="#000" filter="url(#grain)" opacity="0.8"/>'
    for f in range(2):
        y0 = f * 64
        body += f'<rect x="0" y="{y0+58}" width="{W}" height="6" fill="#b88a6c"/><rect x="0" y="{y0+63}" width="{W}" height="1" fill="#6a3e2e"/>'
        for c in range(4):
            x = c * 32 + 8; y = y0 + 14; ww, hh = 16, 32
            rects.append((x, y + 4, ww, hh - 4))
            body += f'<path d="M{x-2},{y+hh+1} L{x-2},{y+6} A{ww/2+2},{ww/2+2} 0 0 1 {x+ww+2},{y+6} L{x+ww+2},{y+hh+1} Z" fill="#cfa98a"/>'
            body += f'<path d="M{x},{y+hh} L{x},{y+7} A{ww/2},{ww/2} 0 0 1 {x+ww},{y+7} L{x+ww},{y+hh} Z" fill="url(#gl)"/>'
            body += f'<path d="M{x},{y+hh} L{x},{y+7} A{ww/2},{ww/2} 0 0 1 {x+ww},{y+7} L{x+ww},{y+hh} Z" fill="url(#refl)"/>'
            body += f'<rect x="{x+ww/2-0.5}" y="{y+2}" width="1" height="{hh-2}" fill="#4d4a48"/>'
    # vines (tile-safe: stay inside x)
    rnd = random.Random(5)
    for vx in (4, 70, 101):
        ln = rnd.uniform(40, 120); y = 0
        while y < ln:
            body += f'<circle cx="{vx+math.sin(y*0.3)*2.5}" cy="{y}" r="{rnd.uniform(1.6,2.8)}" fill="{rnd.choice(["#4f6b3e","#5f7d48","#3f5a33"])}"/>'
            y += 2.4
    render('facade_c', W, H, body, GLASS); litmask('facade_c_lit', W, H, rects, 3)

def parapet():
    W, H = 64, 18
    defs = '''<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2d9cb"/><stop offset="1" stop-color="#c2b8a8"/></linearGradient>
<linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a39a8d"/><stop offset="1" stop-color="#7f776d"/></linearGradient>'''
    body = f'<rect x="0" y="0" width="{W}" height="6" fill="url(#top)"/><rect x="0" y="0" width="{W}" height="1.2" fill="#f4eee4"/>'
    body += f'<rect x="0" y="6" width="{W}" height="10" fill="url(#face)"/><rect x="0" y="6" width="{W}" height="0.8" fill="#6c655c"/>'
    body += f'<rect x="0" y="16" width="{W}" height="2" fill="#4a4540" opacity="0.8"/>'
    for x in (0, 32):
        body += f'<rect x="{x}" y="0" width="0.8" height="16" fill="#8a8277" opacity="0.6"/>'
    render('parapet', W, H, body, defs)

PROP_DEFS = '''<linearGradient id="alu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3ccd3"/><stop offset="1" stop-color="#6b7680"/></linearGradient>
<linearGradient id="pglass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8e8e8"/><stop offset="0.35" stop-color="#9a9a9a"/><stop offset="1" stop-color="#3a3a3a"/></linearGradient>
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa3aa"/><stop offset="0.4" stop-color="#d0d6da"/><stop offset="1" stop-color="#6c757c"/></linearGradient>
<linearGradient id="wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6e4a32"/><stop offset="0.45" stop-color="#9a6d4a"/><stop offset="1" stop-color="#5a3c28"/></linearGradient>'''

def panel(glass_only=False):
    # a tilted module on a rack, seen three-quarter from the front (glass separate for skins)
    W, H = 56, 34
    legs = '' if glass_only else '<rect x="9" y="18" width="2.2" height="16" fill="#59636c"/><rect x="45" y="18" width="2.2" height="16" fill="#59636c"/><rect x="27" y="12" width="2" height="22" fill="#4a535b"/><rect x="4" y="32" width="48" height="2" fill="#4a535b"/>'
    frame = '' if glass_only else '<polygon points="6,2 50,2 55,23 1,23" fill="url(#alu)"/>'
    g = '<polygon points="7.5,3.5 48.5,3.5 52.8,21.5 3.2,21.5" fill="url(#pglass)"/>'
    grid = ''.join(f'<line x1="{7.5+k*41/6:.2f}" y1="3.5" x2="{3.2+k*49.6/6:.2f}" y2="21.5" stroke="#1a1a1a" stroke-width="0.5"/>' for k in range(1, 6))
    grid += '<line x1="5.4" y1="12.5" x2="50.6" y2="12.5" stroke="#1a1a1a" stroke-width="0.5"/>'
    body = legs + frame + g + grid
    render('panel_glass' if glass_only else 'panel', W, H, body, PROP_DEFS)

def props():
    render('ac', 30, 22, '''<rect x="1" y="2" width="28" height="19" rx="2" fill="url(#metal)"/><rect x="1" y="2" width="28" height="2" fill="#e6eaec"/>
<circle cx="11" cy="12" r="6.5" fill="#3d454c"/><circle cx="11" cy="12" r="5" fill="#59636c"/>''' + ''.join(f'<line x1="11" y1="12" x2="{11+5*math.cos(a)}" y2="{12+5*math.sin(a)}" stroke="#2a3036" stroke-width="1.2"/>' for a in [0, 2.1, 4.2]) +
        ''.join(f'<rect x="20" y="{6+i*3}" width="7" height="1.2" fill="#59636c"/>' for i in range(4)) + '<rect x="0" y="20" width="30" height="2" fill="#3a3530" opacity="0.6"/>', PROP_DEFS)
    render('tank', 30, 52, '''<rect x="4" y="30" width="2" height="22" fill="#4a3e34"/><rect x="24" y="30" width="2" height="22" fill="#4a3e34"/><line x1="5" y1="34" x2="25" y2="48" stroke="#4a3e34" stroke-width="1"/><line x1="25" y1="34" x2="5" y2="48" stroke="#4a3e34" stroke-width="1"/>
<rect x="2" y="10" width="26" height="22" fill="url(#wood)"/>''' + ''.join(f'<rect x="2" y="{13+i*6}" width="26" height="1.2" fill="#3c2a1e"/>' for i in range(3)) +
        '<polygon points="1,11 15,1 29,11" fill="#5a3c28"/><polygon points="1,11 15,1 15,3 3,11" fill="#7d5a40"/>', PROP_DEFS)
    render('antenna', 26, 80, '''<rect x="12" y="6" width="2" height="74" fill="#59636c"/><rect x="12.2" y="6" width="0.7" height="74" fill="#aab4bb"/>
<line x1="13" y1="20" x2="4" y2="80" stroke="#59636c" stroke-width="0.6"/><line x1="13" y1="20" x2="22" y2="80" stroke="#59636c" stroke-width="0.6"/>
<rect x="6" y="18" width="14" height="1.5" fill="#59636c"/><rect x="8" y="30" width="10" height="1.4" fill="#59636c"/>
<ellipse cx="18" cy="42" rx="5" ry="7" fill="url(#metal)" transform="rotate(-20 18 42)"/><circle cx="13" cy="5" r="2.4" fill="#d24a3a"/>''', PROP_DEFS)
    render('vent', 16, 18, '''<rect x="5" y="7" width="6" height="11" fill="url(#metal)"/><path d="M1,8 Q8,0 15,8 Z" fill="url(#metal)"/><rect x="1" y="7" width="14" height="1.5" fill="#59636c"/>''', PROP_DEFS)
    shr = ''.join(f'<circle cx="{4+k*5}" cy="{9-(k%3)}" r="{4+(k%2)*1.2}" fill="{["#56704a","#476140","#6a8452","#3f5838"][k%4]}"/>' for k in range(9))
    render('planter', 48, 26, f'''{shr}<rect x="1" y="11" width="46" height="14" rx="1.5" fill="url(#wood)"/><rect x="1" y="11" width="46" height="2" fill="#b38660"/><rect x="0" y="24" width="48" height="2" fill="#3a3530" opacity="0.5"/>
<path d="M26,4 Q30,-2 33,6" stroke="#d9a441" stroke-width="1.6" fill="none"/><circle cx="33" cy="5" r="2" fill="#e8b84a"/>''', PROP_DEFS)

def boss():
    W, H = 180, 120
    defs = PROP_DEFS + '''<radialGradient id="eye" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff2c0"/><stop offset="0.35" stop-color="#ff7a3a"/><stop offset="1" stop-color="#7a1a10"/></radialGradient>
<linearGradient id="hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9b25a"/><stop offset="0.5" stop-color="#b8862e"/><stop offset="1" stop-color="#6e4a1a"/></linearGradient>
<linearGradient id="dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5560"/><stop offset="1" stop-color="#1e252c"/></linearGradient>'''
    body = ''
    for rx in (22, 158):  # rotor arms + rotors
        body += f'<rect x="{min(rx,90)}" y="34" width="{abs(90-rx)}" height="6" fill="url(#dark)"/>'
        body += f'<rect x="{rx-4}" y="22" width="8" height="16" fill="url(#dark)"/>'
        body += f'<ellipse cx="{rx}" cy="20" rx="22" ry="4" fill="#cfd8de" opacity="0.35"/><ellipse cx="{rx}" cy="20" rx="22" ry="1.4" fill="#e8eef2" opacity="0.6"/>'
        body += f'<circle cx="{rx}" cy="20" r="3" fill="#2a3036"/>'
    body += '<path d="M48,40 Q90,18 132,40 L124,78 Q90,92 56,78 Z" fill="url(#hull)"/>'
    body += '<path d="M48,40 Q90,18 132,40 L131,44 Q90,24 49,44 Z" fill="#f0d488"/>'
    for i in range(6):
        body += f'<polygon points="{58+i*11},74 {64+i*11},74 {60+i*11},82 {54+i*11},82" fill="#2a2a2a"/><polygon points="{64+i*11},74 {69+i*11},74 {65+i*11},82 {60+i*11},82" fill="#e8c040"/>'
    body += '<rect x="66" y="44" width="48" height="24" rx="10" fill="url(#dark)"/>'
    body += '<circle cx="90" cy="56" r="9" fill="url(#eye)"/><circle cx="87" cy="53" r="2.2" fill="#fff"/>'
    body += '<rect x="80" y="84" width="20" height="14" rx="3" fill="url(#dark)"/><rect x="84" y="96" width="12" height="8" rx="2" fill="#3a444c"/><circle cx="90" cy="104" r="3.4" fill="#ff5a3a"/>'
    body += '<path d="M60,80 L50,104 L56,106 L66,84 Z" fill="url(#dark)"/><path d="M120,80 L130,104 L124,106 L114,84 Z" fill="url(#dark)"/>'
    body += '<rect x="44" y="102" width="16" height="4" rx="1" fill="#59636c"/><rect x="120" y="102" width="16" height="4" rx="1" fill="#59636c"/>'
    body += '<text x="90" y="40" font-family="sans-serif" font-size="7" font-weight="700" fill="#5a3a10" text-anchor="middle">SVC-7</text>'
    render('boss', W, H, body, defs)

def crack():
    W, H = 72, 22
    rnd = random.Random(9); d = ''
    for k in range(5):
        x = rnd.uniform(6, 66); y = rnd.uniform(2, 8); pts = [(x, y)]
        for s in range(5):
            x += rnd.uniform(-7, 7); y += rnd.uniform(2, 4); pts.append((x, y))
        d += '<polyline points="' + ' '.join(f'{a:.1f},{b:.1f}' for a, b in pts) + '" stroke="#141a20" stroke-width="1.3" fill="none" stroke-linejoin="round"/>'
        d += '<polyline points="' + ' '.join(f'{a+0.6:.1f},{b+0.5:.1f}' for a, b in pts) + '" stroke="#e8f2ff" stroke-width="0.5" fill="none" opacity="0.7"/>'
    render('crack', W, H, d)

def stratus():
    for i, seed in ((1, 3), (2, 8)):
        W, H = 560, 70
        m = Image.new('L', (W * 2, H * 2), 0); d = ImageDraw.Draw(m); rnd = random.Random(seed)
        for k in range(28):
            cx = rnd.uniform(60, W - 60) * 2; cy = rnd.uniform(26, 44) * 2
            rx = rnd.uniform(40, 120) * 2; ry = rnd.uniform(3, 9) * 2
            d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=int(rnd.uniform(90, 200)))
        m = m.filter(ImageFilter.GaussianBlur(9))
        out = Image.new('RGBA', m.size, (255, 255, 255, 0)); out.putalpha(m); out.save(f'{OUT}/stratus_{i}.png'); print('stratus', i)

if __name__ == '__main__':
    facade_a(); facade_b(); facade_c(); parapet(); panel(); panel(True); props(); boss(); crack(); stratus()
