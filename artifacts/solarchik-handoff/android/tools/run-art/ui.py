import subprocess, os
from PIL import Image
OUT='out'; RES='../../app/src/main/res/drawable-xxhdpi'
os.makedirs(RES,exist_ok=True)
def render(name,w,h,body,defs=''):
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><defs>{defs}</defs>{body}</svg>'
    p=f'{OUT}/{name}.html'; open(p,'w').write(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
    subprocess.run(['google-chrome','--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--default-background-color=00000000','--force-device-scale-factor=1',f'--window-size={w},{h}',f'--screenshot={OUT}/{name}.png',f'file://{p}'],capture_output=True,timeout=60)
    return Image.open(f'{OUT}/{name}.png').convert('RGBA')
def ninepatch(im,name,stretch_x,stretch_y,pad):
    w,h=im.size
    out=Image.new('RGBA',(w+2,h+2),(0,0,0,0))
    out.paste(im,(1,1))
    px=out.load()
    for x in range(stretch_x[0],stretch_x[1]): px[x+1,0]=(0,0,0,255)
    for y in range(stretch_y[0],stretch_y[1]): px[0,y+1]=(0,0,0,255)
    l,t,r,b=pad
    for x in range(l,w-r): px[x+1,h+1]=(0,0,0,255)
    for y in range(t,h-b): px[w+1,y+1]=(0,0,0,255)
    out.save(f'{RES}/{name}.9.png')
INK='#1d140d'
def button(name,top,bot,edge,rim,pressed):
    W=H=132; R=42; E=12  # 14dp radius, 4dp edge @xxhdpi
    fy=E if pressed else 0
    defs=f'''<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bot}"/></linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0.04"/></linearGradient>'''
    b=f'<rect x="1.5" y="{1.5+ (E if pressed else 0)}" width="{W-3}" height="{H-3-(E if pressed else 0)}" rx="{R}" fill="{INK}"/>'
    if not pressed: b+=f'<rect x="4.5" y="{E+4}" width="{W-9}" height="{H-E-8}" rx="{R-3}" fill="{edge}"/>'
    b+=f'<rect x="4.5" y="{4.5+fy}" width="{W-9}" height="{H-E-9}" rx="{R-3}" fill="url(#f)"/>'
    b+=f'<rect x="12" y="{9+fy}" width="{W-24}" height="{(H-E)*0.36}" rx="{(H-E)*0.18}" fill="url(#g)"/>'
    b+=f'<rect x="6" y="{6+fy}" width="{W-12}" height="{H-E-12}" rx="{R-4.5}" fill="none" stroke="{rim}" stroke-opacity="0.55" stroke-width="2"/>'
    im=render(name,W,H,b,defs)
    ninepatch(im,name,(R+2,W-R-2),(R+2,H-R-2),(0,0,0,0))
def chip(name,c0,c1,rim,alpha):
    W=H=96; R=36
    defs=f'''<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{c0}" stop-opacity="{alpha}"/><stop offset="1" stop-color="{c1}" stop-opacity="{alpha}"/></linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'''
    b=f'<rect x="1.5" y="1.5" width="{W-3}" height="{H-3}" rx="{R}" fill="{INK}" fill-opacity="{min(1,alpha+0.15)}"/>'
    b+=f'<rect x="4" y="4" width="{W-8}" height="{H-8}" rx="{R-2.5}" fill="url(#f)"/>'
    b+=f'<rect x="10" y="7" width="{W-20}" height="{H*0.36}" rx="{H*0.18}" fill="url(#g)"/>'
    b+=f'<rect x="4.5" y="4.5" width="{W-9}" height="{H-9}" rx="{R-3}" fill="none" stroke="{rim}" stroke-opacity="0.5" stroke-width="2"/>'
    im=render(name,W,H,b,defs)
    ninepatch(im,name,(R+2,W-R-2),(R+2,H-R-2),(0,0,0,0))
button('run_btn_gold','#ffef9e','#f7b928','#a8650e','#fff6c8',False)
button('run_btn_gold_p','#ffe27a','#eaa61c','#a8650e','#fff6c8',True)
button('run_btn_dark','#3b6482','#1c3448','#06111a','#9fd2ff',False)
button('run_btn_dark_p','#335a76','#18303f','#06111a','#9fd2ff',True)
button('run_btn_green','#b6f08e','#4fb03a','#2d6a1c','#eaffd8',False)
button('run_btn_green_p','#a6e47e','#46a034','#2d6a1c','#eaffd8',True)
chip('run_chip','#24425a','#0c1b27','#8fc8f0',0.82)
chip('run_chip_gold','#fff1a6','#f6b52a','#fffbe0',1.0)
print(sorted(f for f in os.listdir(RES) if f.startswith('run_')))
