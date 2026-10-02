from PIL import Image
import json, os
A='/workspace/solarchik-run/artifacts/solarchik-handoff/android/app/src/main/assets/art'
C='/workspace/art/city/'; O='/workspace/art/out/'
def L(p): return Image.open(p).convert('RGBA')
ent={}
for i in range(8): ent[f'coin_{i}']=(L(f'{O}coin_{i}.png'),48,48)
for n,(w,h) in dict(parapet=(64,18),panel=(56,34),panel_glass=(56,34),ac=(30,22),tank=(30,52),antenna=(26,80),vent=(16,18),planter=(48,26),boss=(180,120),crack=(72,22)).items():
    ent[n]=(L(C+n+'.png'),w,h)
for i in (1,2):
    im=L(C+f'stratus_{i}.png'); im=im.resize((im.width//2,im.height//2),Image.LANCZOS)  # soft: 1 px/unit is plenty
    ent[f'stratus_{i}']=(im,560,70)
W=1280; x=y=rowh=0; rects={}
for n in sorted(ent, key=lambda n:-ent[n][0].height):
    im=ent[n][0]
    if x+im.width>W: x=0; y+=rowh+2; rowh=0
    rects[n]=(x,y,im.width,im.height); x+=im.width+2; rowh=max(rowh,im.height)
sheet=Image.new('RGBA',(W,y+rowh))
for n,(x,y,w,h) in rects.items(): sheet.alpha_composite(ent[n][0],(x,y))
sheet.save(f'{A}/city.webp','WEBP',quality=90,method=6,alpha_quality=95)
json.dump({n:[*rects[n],ent[n][1],ent[n][2]] for n in rects},open(f'{A}/city.json','w'),separators=(',',':'))
for n in ('facade_a','facade_b','facade_c'):
    L(C+n+'.png').save(f'{A}/{n}.webp','WEBP',quality=88,method=6)
    L(C+n+'_lit.png').save(f'{A}/{n}_lit.webp','WEBP',quality=80,method=6,alpha_quality=80)
for n in ('city_far','city_mid','city_near'):
    for suf in ('','_lit','_neon'):
        im=L(C+n+suf+'.png')
        if suf: im=im.resize((im.width//2,im.height//2),Image.LANCZOS)  # lights: 1 px/unit, drawn soft
        im.save(f'{A}/{n}{suf}.webp','WEBP',quality=85,method=6,alpha_quality=90)
# old village art is gone
for old in ('bg_far','bg_mid','bg_mid_lights','bg_near','bg_fg','props'):
    for ext in ('.webp','.json'):
        p=f'{A}/{old}{ext}'
        if os.path.exists(p): os.remove(p)
tot=0
for f in sorted(os.listdir(A)):
    if os.path.isfile(f'{A}/{f}'): s=os.path.getsize(f'{A}/{f}'); tot+=s; print(f, s)
print('total', tot, 'sheet', sheet.size)
