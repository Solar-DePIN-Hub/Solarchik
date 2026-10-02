import math, random, os, subprocess, sys
OUT='out'
INK='#3a281c'
def svg(w,h,body,defs=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><defs>{defs}</defs>{body}</svg>'
def render(name,w,h,content,scale=2):
    html=f'<html><body style="margin:0;background:transparent;overflow:hidden">{content}</body></html>'
    p=f'{OUT}/{name}.html'; open(p,'w').write(html)
    subprocess.run(['google-chrome','--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--default-background-color=00000000',
        f'--force-device-scale-factor={scale}',f'--window-size={w},{h}',f'--screenshot={OUT}/{name}.png',f'file://{p}'],capture_output=True,timeout=90)
    print('rendered',name)

def periodic(W,base,terms):
    # terms: (amp, n, phase) -> seamless ridge
    def f(x): return base+sum(a*math.sin(2*math.pi*n*x/W+ph) for a,n,ph in terms)
    return f
def ridge_path(W,H,f,step=8):
    d=f'M0,{H} L0,{f(0):.1f} '
    x=0
    while x<=W:
        d+=f'L{x},{f(x):.1f} '; x+=step
    d+=f'L{W},{f(W):.1f} L{W},{H} Z'
    return d

# ---------------- far layer ----------------
def far():
    W,H=1280,260
    back=periodic(W,95,[(28,3,0.4),(16,5,1.3),(9,11,2.0),(5,17,0.2)])
    front=periodic(W,150,[(18,2,2.1),(10,7,0.7),(6,13,1.9)])
    defs='''<linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9c9e2"/><stop offset="1" stop-color="#c9def0"/></linearGradient>
    <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93bfc2"/><stop offset="1" stop-color="#b8d8d6"/></linearGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eaf6ff" stop-opacity="0"/><stop offset="1" stop-color="#eaf6ff" stop-opacity="0.85"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="1.2"/></filter>'''
    b=f'<path d="{ridge_path(W,H,back)}" fill="url(#gb)"/>'
    # sunlit faces on the back range: lighter strokes along the ridge
    b+=f'<path d="{ridge_path(W,H,lambda x: back(x)+5)}" fill="#ffffff" opacity="0.10"/>'
    b+=f'<path d="{ridge_path(W,H,lambda x: back(x)+14)}" fill="#a2c2db" opacity="0.6"/>'
    b+=f'<path d="{ridge_path(W,H,front)}" fill="url(#gf)"/>'
    # distant tree clumps + tiny village on the front ridge
    rnd=random.Random(3)
    for i in range(70):
        x=rnd.uniform(0,W); y=front(x)+rnd.uniform(2,8); r=rnd.uniform(4,8)
        for dx in (-W,0,W):
            b+=f'<ellipse cx="{x+dx:.1f}" cy="{y:.1f}" rx="{r*1.1:.1f}" ry="{r:.1f}" fill="#7fae9f" opacity="0.9"/>'
    for x in (210,640,1010):
        y=front(x)+6
        for k in range(3):
            hx=x+k*13
            b+=f'<rect x="{hx}" y="{y-9}" width="10" height="8" fill="#e8eef0"/><path d="M{hx-1},{y-9} L{hx+5},{y-14} L{hx+11},{y-9} Z" fill="#c98a76"/>'
    b+=f'<rect x="0" y="120" width="{W}" height="{H-120}" fill="url(#haze)"/>'
    render('bg_far',W,H,svg(W,H,b,defs))

# ---------------- houses / trees helpers ----------------
def house(x,y,s=1.0,roof='#c85a3c',wall='#f7e6c4',lit=False):
    # x,y = bottom centre
    w=64*s; h=40*s; rh=30*s
    L=x-w/2; T=y-h
    o=''
    o+=f'<ellipse cx="{x+4*s}" cy="{y+1}" rx="{w*0.62}" ry="{5*s}" fill="#21401a" opacity="0.25"/>'
    if lit:
        for wx in (L+10*s, L+w-22*s):
            o+=f'<rect x="{wx-6*s}" y="{T+8*s}" width="{24*s}" height="{24*s}" rx="{6*s}" fill="#ffd27a" filter="url(#glow)"/>'
            o+=f'<rect x="{wx}" y="{T+12*s}" width="{12*s}" height="{13*s}" rx="{2*s}" fill="#ffe7a6"/>'
        return o
    # chimney
    o+=f'<rect x="{x+w*0.22}" y="{T-rh*0.95}" width="{8*s}" height="{rh*0.7}" fill="#a8564a" stroke="{INK}" stroke-width="{1.6*s}"/>'
    # wall
    o+=f'<rect x="{L}" y="{T}" width="{w}" height="{h}" fill="url(#wall)" stroke="{INK}" stroke-width="{1.8*s}"/>'
    o+=f'<rect x="{L+w*0.72}" y="{T}" width="{w*0.28}" height="{h}" fill="#000" opacity="0.08"/>'
    # windows + door
    for wx in (L+10*s, L+w-22*s):
        o+=f'<rect x="{wx}" y="{T+12*s}" width="{12*s}" height="{13*s}" rx="{2*s}" fill="#4f7fa8" stroke="{INK}" stroke-width="{1.3*s}"/>'
        o+=f'<path d="M{wx+2*s},{T+14*s} l{4*s},0 l-{3*s},{8*s} l-{1*s},0 Z" fill="#fff" opacity="0.55"/>'
    o+=f'<rect x="{x-6*s}" y="{y-20*s}" width="{12*s}" height="{20*s}" rx="{2*s}" fill="#8a5232" stroke="{INK}" stroke-width="{1.3*s}"/>'
    # roof (front slope) with solar panels
    rp=f'M{L-7*s},{T+2*s} L{L+8*s},{T-rh} L{L+w-8*s},{T-rh} L{L+w+7*s},{T+2*s} Z'
    o+=f'<path d="{rp}" fill="{roof}" stroke="{INK}" stroke-width="{1.8*s}" stroke-linejoin="round"/>'
    o+=f'<path d="M{L-7*s},{T+2*s} L{L+w+7*s},{T+2*s} L{L+w+5*s},{T-3*s} L{L-5*s},{T-3*s} Z" fill="#000" opacity="0.18"/>'
    # tile rows
    for k in range(1,4):
        yy=T-rh+k*rh/4
        o+=f'<line x1="{L+8*s-k*3.5*s}" y1="{yy}" x2="{L+w-8*s+k*3.5*s}" y2="{yy}" stroke="#000" stroke-opacity="0.15" stroke-width="{1*s}"/>'
    # panels
    pw=(w-16*s)/2-3*s
    for k in range(2):
        px=L+11*s+k*(pw+5*s)
        o+=f'<path d="M{px},{T-3*s} L{px+3*s},{T-rh+5*s} L{px+pw+3*s},{T-rh+5*s} L{px+pw},{T-3*s} Z" fill="url(#panel)" stroke="#20314a" stroke-width="{1.2*s}"/>'
        for c in range(1,3):
            cx=px+pw*c/3
            o+=f'<line x1="{cx}" y1="{T-3*s}" x2="{cx+3*s}" y2="{T-rh+5*s}" stroke="#9fd0ff" stroke-opacity="0.45" stroke-width="{0.8*s}"/>'
        o+=f'<line x1="{px+1.5*s}" y1="{T-rh/2}" x2="{px+pw+1.5*s}" y2="{T-rh/2}" stroke="#9fd0ff" stroke-opacity="0.45" stroke-width="{0.8*s}"/>'
        o+=f'<path d="M{px+pw*0.25},{T-3*s} L{px+pw*0.25+3*s},{T-rh+5*s} L{px+pw*0.42+3*s},{T-rh+5*s} L{px+pw*0.42},{T-3*s} Z" fill="#fff" opacity="0.22"/>'
    return o

def tree(x,y,s=1.0,dark='#3f8a36',mid='#5fae42',light='#9ad665'):
    o=f'<ellipse cx="{x+3*s}" cy="{y+1}" rx="{20*s}" ry="{4*s}" fill="#1e3a18" opacity="0.25"/>'
    o+=f'<path d="M{x-3*s},{y} L{x-2*s},{y-22*s} L{x+2*s},{y-22*s} L{x+3*s},{y} Z" fill="#7a4e2c" stroke="{INK}" stroke-width="{1.3*s}"/>'
    blobs=[(-11,-30,13),(10,-31,12),(0,-44,15),(-2,-30,12)]
    for bx,by,r in blobs:
        o+=f'<circle cx="{x+bx*s}" cy="{y+by*s}" r="{r*s+1.6*s}" fill="{INK}"/>'
    for bx,by,r in blobs:
        o+=f'<circle cx="{x+bx*s}" cy="{y+by*s}" r="{r*s}" fill="{mid}"/>'
    o+=f'<circle cx="{x+6*s}" cy="{y-29*s}" r="{11*s}" fill="{dark}" opacity="0.55"/>'
    o+=f'<circle cx="{x-5*s}" cy="{y-48*s}" r="{7*s}" fill="{light}" opacity="0.9"/>'
    o+=f'<circle cx="{x-13*s}" cy="{y-34*s}" r="{5*s}" fill="{light}" opacity="0.7"/>'
    return o

COMMON_DEFS='''<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3d8"/><stop offset="1" stop-color="#ecd3a6"/></linearGradient>
<linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb4ee"/><stop offset="1" stop-color="#2d5f9e"/></linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>'''

# ---------------- mid layer: village hill ----------------
MID_W,MID_H=1280,330
mid_crest=periodic(MID_W,120,[(22,2,0.3),(12,3,2.2),(6,7,1.0)])
HOUSES=[(150,1.0,'#c85a3c'),(560,0.9,'#b9503f'),(905,1.05,'#c66a3a'),(1150,0.85,'#a9473a')]
def mid(lit=False):
    W,H=MID_W,MID_H
    defs=COMMON_DEFS+'''<linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93d35e"/><stop offset="0.5" stop-color="#6dbb49"/><stop offset="1" stop-color="#4f9c3c"/></linearGradient>'''
    b=''
    if not lit:
        b+=f'<path d="{ridge_path(W,H,mid_crest)}" fill="url(#hill)"/>'
        # crest rim light
        d='M0,%.1f '%mid_crest(0)+' '.join('L%d,%.1f'%(x,mid_crest(x)) for x in range(0,W+1,8))
        b+=f'<path d="{d}" fill="none" stroke="#c4ef8a" stroke-width="3" opacity="0.8"/>'
        # meadow stripes
        for k in range(3):
            f=lambda x,k=k: mid_crest(x)+40+k*45
            d='M0,%.1f '%f(0)+' '.join('L%d,%.1f'%(x,f(x)) for x in range(0,W+1,10))
            b+=f'<path d="{d}" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="14"/>'
        # small solar field
        for x0 in (330,): 
            for k in range(5):
                px=x0+k*26; py=mid_crest(px)+30
                b+=f'<path d="M{px},{py} L{px+20},{py} L{px+24},{py-12} L{px+4},{py-12} Z" fill="url(#panel)" stroke="#20314a" stroke-width="1.2"/><line x1="{px+10}" y1="{py}" x2="{px+10}" y2="{py+5}" stroke="#555" stroke-width="2"/>'
        rnd=random.Random(7)
        trees=[(60,0.8),(250,1.0),(290,0.75),(460,0.95),(700,1.1),(740,0.8),(1010,0.9),(1060,1.0),(1240,0.85)]
        items=[]
        for x,s in trees: items.append((mid_crest(x)+16, tree(x,mid_crest(x)+16,s)))
        for x,s,roof in HOUSES: items.append((mid_crest(x)+24, house(x,mid_crest(x)+24,s,roof)))
        for _,o in sorted(items): b+=o
    else:
        for x,s,roof in HOUSES: b+=house(x,mid_crest(x)+24,s,roof,lit=True)
    render('bg_mid_lights' if lit else 'bg_mid',W,H,svg(W,H,b,defs))

# ---------------- near layer: bushes, fence, flowers ----------------
def near():
    W,H=1280,240
    crest=periodic(W,78,[(14,2,1.7),(8,5,0.4),(4,9,2.5)])
    defs='''<linearGradient id="hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6cc04a"/><stop offset="0.6" stop-color="#4c9f3a"/><stop offset="1" stop-color="#3a8231"/></linearGradient>
    <radialGradient id="bush" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="#8fd45c"/><stop offset="0.7" stop-color="#4f9e3a"/><stop offset="1" stop-color="#3a7f30"/></radialGradient>'''
    b=f'<path d="{ridge_path(W,H,crest)}" fill="url(#hill2)"/>'
    d='M0,%.1f '%crest(0)+' '.join('L%d,%.1f'%(x,crest(x)) for x in range(0,W+1,8))
    b+=f'<path d="{d}" fill="none" stroke="#a8e070" stroke-width="3" opacity="0.7"/>'
    rnd=random.Random(11)
    bushes=[]
    for i in range(16):
        x=i*80+rnd.uniform(-20,20); bushes.append(x)
    for x in bushes:
        y=crest(x)+8; s=rnd.uniform(0.8,1.3)
        for dx in (-W,0,W):
            cx=x+dx
            for bx,by,r in ((-14,-6,13),(4,-12,16),(20,-5,12)):
                b+=f'<circle cx="{cx+bx*s:.1f}" cy="{y+by*s:.1f}" r="{r*s+1.8:.1f}" fill="{INK}"/>'
            for bx,by,r in ((-14,-6,13),(4,-12,16),(20,-5,12)):
                b+=f'<circle cx="{cx+bx*s:.1f}" cy="{y+by*s:.1f}" r="{r*s:.1f}" fill="url(#bush)"/>'
            b+=f'<circle cx="{cx-2*s:.1f}" cy="{y-20*s:.1f}" r="{5*s:.1f}" fill="#b7ea7e" opacity="0.8"/>'
    # fence segments
    for x0 in (300,900):
        for k in range(6):
            px=x0+k*22; py=crest(px)+30
            b+=f'<rect x="{px-3}" y="{py-28}" width="6" height="30" rx="2" fill="#a8743f" stroke="{INK}" stroke-width="1.4"/>'
        for ry in (-20,-10):
            b+=f'<line x1="{x0}" y1="{crest(x0)+30+ry}" x2="{x0+110}" y2="{crest(x0+110)+30+ry}" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>'
            b+=f'<line x1="{x0}" y1="{crest(x0)+30+ry}" x2="{x0+110}" y2="{crest(x0+110)+30+ry}" stroke="#c18a50" stroke-width="3" stroke-linecap="round"/>'
    render('bg_near',W,H,svg(W,H,b,defs))

# ---------------- foreground grass ----------------
def fg():
    W,H=1280,130
    rnd=random.Random(5)
    defs='''<linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fa83c"/><stop offset="1" stop-color="#2d6c2b"/></linearGradient>'''
    base=periodic(W,62,[(8,3,0.5),(5,7,1.1)])
    b=f'<path d="{ridge_path(W,H,base)}" fill="url(#gr)"/>'
    blades=''
    for layer,(col,hmin,hmax,n) in enumerate((('#3f8f36',18,40,260),('#5cb544',14,32,240),('#86d35a',8,20,160))):
        for i in range(n):
            x=rnd.uniform(0,W); h=rnd.uniform(hmin,hmax); lean=rnd.uniform(-7,7); wd=rnd.uniform(3,5.5)
            y=base(x)+6+layer*6
            for dx in (-W,0,W):
                cx=x+dx
                blades+=f'<path d="M{cx-wd:.1f},{y:.1f} Q{cx+lean*0.3:.1f},{y-h*0.6:.1f} {cx+lean:.1f},{y-h:.1f} Q{cx+lean*0.2+1:.1f},{y-h*0.5:.1f} {cx+wd:.1f},{y:.1f} Z" fill="{col}"/>'
    b+=blades
    # flowers
    for i in range(26):
        x=rnd.uniform(0,W); y=base(x)+rnd.uniform(4,26)
        col=rnd.choice(['#ffffff','#ffd84a','#ff9fb4','#c9b2ff'])
        for dx in (-W,0,W):
            cx=x+dx
            for k in range(5):
                a=k*2*math.pi/5
                b+=f'<circle cx="{cx+math.cos(a)*3.6:.1f}" cy="{y+math.sin(a)*3.6:.1f}" r="2.8" fill="{col}" stroke="{INK}" stroke-width="0.6"/>'
            b+=f'<circle cx="{cx:.1f}" cy="{y:.1f}" r="2.2" fill="#f2a516"/>'
    # sunflowers
    for x in (180,760,1130):
        y=base(x)+8
        b+=f'<path d="M{x},{y+20} Q{x+3},{y-10} {x},{y-34}" stroke="#3c7a2c" stroke-width="3.4" fill="none"/><ellipse cx="{x+7}" cy="{y-12}" rx="7" ry="3.5" fill="#4f9e3a" transform="rotate(-25 {x+7} {y-12})"/>'
        for k in range(12):
            a=k*math.pi/6
            b+=f'<ellipse cx="{x+math.cos(a)*8:.1f}" cy="{y-36+math.sin(a)*8:.1f}" rx="5" ry="2.6" fill="#ffc928" stroke="#c98a10" stroke-width="0.8" transform="rotate({math.degrees(a):.0f} {x+math.cos(a)*8:.1f} {y-36+math.sin(a)*8:.1f})"/>'
        b+=f'<circle cx="{x}" cy="{y-36}" r="5.5" fill="#6b3e1a" stroke="{INK}" stroke-width="1"/>'
    render('bg_fg',W,H,svg(W,H,b,defs))

# ---------------- clouds + sun ----------------
def clouds():
    shapes=[[(60,70,34),(105,52,42),(155,64,36),(195,78,26),(30,84,22)],
            [(50,64,28),(92,50,36),(135,62,30),(170,74,22)],
            [(40,60,24),(80,48,32),(120,58,26)]]
    for i,sh in enumerate(shapes):
        W,H=240,130
        defs='''<linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.65" stop-color="#f4f8fd"/><stop offset="1" stop-color="#d4e2f0"/></linearGradient>
        <filter id="cb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter><clipPath id="cc">'''+''.join(f'<circle cx="{x}" cy="{y}" r="{r}"/>' for x,y,r in sh)+f'<rect x="{sh[0][0]-10}" y="70" width="{sh[-2][0]-sh[0][0]+20}" height="{max(y+r for x,y,r in sh)-70}"/></clipPath>'
        body=f'<g filter="url(#cb)" opacity="0.25" transform="translate(4,8)">'+''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#7ea2c4"/>' for x,y,r in sh)+'</g>'
        body+=f'<g clip-path="url(#cc)"><rect width="{W}" height="{H}" fill="url(#cg)"/>'
        body+=''.join(f'<circle cx="{x-r*0.25}" cy="{y-r*0.3}" r="{r*0.55}" fill="#ffffff" opacity="0.9"/>' for x,y,r in sh)+'</g>'
        render(f'cloud_{i+1}',W,H,svg(W,H,body,defs))
def sun():
    W=H=220
    defs='''<radialGradient id="sg" cx="0.42" cy="0.38" r="0.65"><stop offset="0" stop-color="#fffbe0"/><stop offset="0.45" stop-color="#ffd84a"/><stop offset="1" stop-color="#f59b1e"/></radialGradient>
    <radialGradient id="glw" cx="0.5" cy="0.5" r="0.5"><stop offset="0.45" stop-color="#ffe9a0" stop-opacity="0.65"/><stop offset="1" stop-color="#ffe9a0" stop-opacity="0"/></radialGradient>'''
    b=f'<circle cx="110" cy="110" r="110" fill="url(#glw)"/>'
    for k in range(12):
        a=k*math.pi/6
        x1,y1=110+math.cos(a)*62,110+math.sin(a)*62; x2,y2=110+math.cos(a)*80,110+math.sin(a)*80
        b+=f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#ffc53a" stroke-width="7" stroke-linecap="round"/>'
    b+=f'<circle cx="110" cy="110" r="54" fill="url(#sg)" stroke="#e8891a" stroke-width="3"/>'
    b+=f'<ellipse cx="92" cy="88" rx="18" ry="11" fill="#fff" opacity="0.55" transform="rotate(-30 92 88)"/>'
    render('sun',W,H,svg(W,H,b,defs))

# ---------------- rooftop tiles ----------------
RH=80
def roof_part(kind, glass=False):
    # kind: 'mid' (64 wide) or 'left'/'right' caps (24 wide)
    W=64 if kind=='mid' else 24
    defs='''<linearGradient id="alu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c4ce"/><stop offset="0.6" stop-color="#7d8b98"/><stop offset="1" stop-color="#5b6874"/></linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f29a62"/><stop offset="0.35" stop-color="#e07a46"/><stop offset="1" stop-color="#a9472a"/></linearGradient>
    <linearGradient id="tileV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.25"/><stop offset="0.25" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></linearGradient>
    <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8c8c8"/><stop offset="1" stop-color="#5a5a5a"/></linearGradient>
    <filter id="sh" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>'''
    b=''
    top=6; deckB=41; tileT=42; tileB=60; base=65
    if glass:
        if kind=='mid':
            gx,gy,gw,gh=2.5,top+2.5,W-5,deckB-top-5
            b+=f'<rect x="{gx}" y="{gy}" width="{gw}" height="{gh}" rx="1.5" fill="url(#gl)"/>'
            for c in range(1,4):
                b+=f'<line x1="{gx+gw*c/4}" y1="{gy}" x2="{gx+gw*c/4}" y2="{gy+gh}" stroke="#2a2a2a" stroke-opacity="0.55" stroke-width="0.9"/>'
            b+=f'<line x1="{gx}" y1="{gy+gh/2}" x2="{gx+gw}" y2="{gy+gh/2}" stroke="#2a2a2a" stroke-opacity="0.55" stroke-width="0.9"/>'
            # reflections
            b+=f'<path d="M{gx+gw*0.12},{gy} L{gx+gw*0.34},{gy} L{gx+gw*0.2},{gy+gh} L{gx-gw*0.02},{gy+gh} Z" fill="#fff" opacity="0.35"/>'
            b+=f'<path d="M{gx+gw*0.4},{gy} L{gx+gw*0.46},{gy} L{gx+gw*0.32},{gy+gh} L{gx+gw*0.26},{gy+gh} Z" fill="#fff" opacity="0.25"/>'
            b+=f'<rect x="{gx}" y="{gy}" width="{gw}" height="1.6" fill="#fff" opacity="0.6"/>'
        render(f'roof_{kind}_glass',W,RH,svg(W,RH,b,defs),scale=3)
        return
    # shadow under
    b+=f'<rect x="{-6 if kind!="left" else 6}" y="{base-6}" width="{W+12 if kind=="mid" else W}" height="16" fill="#14240f" opacity="0.38" filter="url(#sh)"/>'
    lr=10 if kind!='mid' else 0
    def slab(x,y,w,h,r_left,r_right,fill,extra=''):
        # rect with selectively rounded left/right ends
        return f'<path d="M{x+r_left},{y} L{x+w-r_right},{y} Q{x+w},{y} {x+w},{y+r_right} L{x+w},{y+h-r_right} Q{x+w},{y+h} {x+w-r_right},{y+h} L{x+r_left},{y+h} Q{x},{y+h} {x},{y+h-r_left} L{x},{y+r_left} Q{x},{y} {x+r_left},{y} Z" fill="{fill}" {extra}/>'
    rl = 9 if kind=='left' else 0; rr = 9 if kind=='right' else 0
    x0 = 2 if kind=='left' else 0; w0 = W-2 if kind!='mid' else W
    # ink silhouette
    b+=slab(x0-0 if kind!='left' else x0, top-3, w0 if kind=='mid' else w0, base-top+3, rl, rr, INK)
    ix = x0+2.2 if kind=='left' else x0; iw = w0-(2.2 if kind!='mid' else 0)
    # tiles band
    b+=slab(ix, tileT, iw, tileB-tileT+3, max(0,rl-2), max(0,rr-2), '#6a2c18')
    clipd=slab(ix, tileT-8, iw, tileB-tileT+11, max(0,rl-2), max(0,rr-2), '#000').replace('<path d=','<path id="tcp" d=')
    defs_extra=f'<clipPath id="tc">{clipd}</clipPath>'
    b+='<g clip-path="url(#tc)">'
    tw=16
    start = {'mid':0,'left':W-2*tw,'right':0}[kind]
    tx=start
    i=0
    while tx < ix+iw:
        b+=f'<rect x="{tx+0.6:.1f}" y="{tileT-6}" width="{tw-1.2}" height="{tileB-tileT+6}" rx="{(tw-1.2)/2:.1f}" fill="url(#tile)" stroke="#6a2c18" stroke-width="0.8"/>'
        b+=f'<rect x="{tx+0.6:.1f}" y="{tileT-6}" width="{tw-1.2}" height="{tileB-tileT+6}" rx="{(tw-1.2)/2:.1f}" fill="url(#tileV)"/>'
        b+=f'<rect x="{tx+3.2:.1f}" y="{tileT+1}" width="2.4" height="{(tileB-tileT)*0.6:.1f}" rx="1.2" fill="#ffd2a8" opacity="0.75"/>'
        tx+=tw; i+=1
    b+='</g>'
    if kind!='mid':
        # clip tiles at the rounded end by redrawing ink outside
        pass
    # gutter
    b+=f'<rect x="{ix}" y="{deckB-1}" width="{iw}" height="4" fill="#5d6873"/>'
    b+=f'<rect x="{ix}" y="{deckB-1}" width="{iw}" height="1.2" fill="#aab4bd"/>'
    # deck frame
    b+=slab(ix, top, iw, deckB-top, max(0,rl-2), max(0,rr-2), 'url(#alu)')
    if kind=='mid':
        b+=f'<rect x="2" y="{top+2}" width="{W-4}" height="{deckB-top-4}" rx="2" fill="#3a4450"/>'  # glass seat (glass layer drawn on top)
        b+=f'<rect x="0" y="{top}" width="1.4" height="{deckB-top}" fill="#8d98a3"/>'
    else:
        # end bolt + ridge cap
        bx = ix+iw*0.5
        b+=f'<circle cx="{bx}" cy="{(top+deckB)/2}" r="2.6" fill="#8d98a3" stroke="#5d6873" stroke-width="0.8"/>'
    b+=f'<rect x="{ix+(3 if kind=="left" else 0)}" y="{top+0.6}" width="{iw-(3 if kind!="mid" else 0)}" height="1.6" fill="#ffffff" opacity="0.85"/>'
    render(f'roof_{kind}',W,RH,svg(W,RH,b,defs+defs_extra),scale=3)

# ---------------- sun coin spin frames ----------------
def coins():
    W=H=48
    defs='''<radialGradient id="cf" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#fff6c2"/><stop offset="0.45" stop-color="#ffcf3a"/><stop offset="1" stop-color="#e48a1a"/></radialGradient>
    <linearGradient id="ce" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b86412"/><stop offset="0.5" stop-color="#e9a030"/><stop offset="1" stop-color="#9a520e"/></linearGradient>'''
    for i in range(8):
        th=i*math.pi/8
        sx=max(0.14,abs(math.cos(th)))
        edge=(1-sx)*4.5*(1 if math.cos(th)>=0 else -1)
        cx,cy,r=24,24,16
        b=f'<ellipse cx="{cx+edge:.2f}" cy="{cy}" rx="{r*sx+1.8:.2f}" ry="{r+1.8}" fill="{INK}"/>'
        b+=f'<ellipse cx="{cx+edge*0.5:.2f}" cy="{cy}" rx="{r*sx+abs(edge)*0.5:.2f}" ry="{r}" fill="url(#ce)"/>'
        b+=f'<ellipse cx="{cx-edge*0.3:.2f}" cy="{cy}" rx="{r*sx+1.8:.2f}" ry="{r+1.8}" fill="{INK}"/>'
        b+=f'<g transform="translate({cx-edge*0.3:.2f},{cy}) scale({sx:.3f},1)">'
        b+=f'<circle r="{r}" fill="url(#cf)"/>'
        b+=f'<circle r="{r*0.74}" fill="none" stroke="#c46f12" stroke-opacity="0.55" stroke-width="1.6"/>'
        b+=f'<circle r="{r*0.74}" fill="none" stroke="#fff3b0" stroke-opacity="0.6" stroke-width="0.8" transform="translate(-0.6,-0.6)"/>'
        # embossed sun
        for k in range(8):
            a=k*math.pi/4
            p1=(math.cos(a)*r*0.36,math.sin(a)*r*0.36); p2=(math.cos(a)*r*0.6,math.sin(a)*r*0.6)
            b+=f'<line x1="{p1[0]:.2f}" y1="{p1[1]:.2f}" x2="{p2[0]:.2f}" y2="{p2[1]:.2f}" stroke="#d27a14" stroke-width="2.2" stroke-linecap="round"/>'
            b+=f'<line x1="{p1[0]-0.5:.2f}" y1="{p1[1]-0.5:.2f}" x2="{p2[0]-0.5:.2f}" y2="{p2[1]-0.5:.2f}" stroke="#fff1a8" stroke-width="1.1" stroke-linecap="round"/>'
        b+=f'<circle r="{r*0.27}" fill="#f0a52a" stroke="#c46f12" stroke-width="1"/>'
        b+=f'<ellipse cx="{-r*0.38}" cy="{-r*0.42}" rx="{r*0.28}" ry="{r*0.16}" fill="#fff" opacity="0.85" transform="rotate(-35 {-r*0.38} {-r*0.42})"/>'
        b+='</g>'
        render(f'coin_{i}',W,H,svg(W,H,b,defs),scale=3)

which=sys.argv[1:] or ['far','mid','lights','near','fg','clouds','sun','roof','coins']
if 'far' in which: far()
if 'mid' in which: mid()
if 'lights' in which: mid(lit=True)
if 'near' in which: near()
if 'fg' in which: fg()
if 'clouds' in which: clouds()
if 'sun' in which: sun()
if 'roof' in which:
    for k in ('mid','left','right'): roof_part(k)
    roof_part('mid',glass=True)
if 'coins' in which: coins()
