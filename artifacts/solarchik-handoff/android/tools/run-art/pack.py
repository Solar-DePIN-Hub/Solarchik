from PIL import Image
import json, os
A='../../app/src/main/assets/art'
os.makedirs(A,exist_ok=True)
def L(n): return Image.open(f'out/{n}.png').convert('RGBA')
# entries: name -> (image, logical w, logical h)
ent={}
for i in range(8): ent[f'coin_{i}']=(L(f'coin_{i}'),48,48)
for k in ('left','mid','right'): ent[f'roof_{k}']=(L(f'roof_{k}'),24 if k!='mid' else 64,80)
ent['roof_mid_glass']=(L('roof_mid_glass'),64,80)
for i in (1,2,3): ent[f'cloud_{i}']=(L(f'cloud_{i}'),240,130)
ent['sun']=(L('sun'),220,220)
# shelf pack
W=1024; x=y=rowh=0; rects={}
order=sorted(ent, key=lambda n:-ent[n][0].height)
for n in order:
    im=ent[n][0]
    if x+im.width>W: x=0; y+=rowh+2; rowh=0
    rects[n]=(x,y,im.width,im.height); x+=im.width+2; rowh=max(rowh,im.height)
H=y+rowh
sheet=Image.new('RGBA',(W,H))
for n,(x,y,w,h) in rects.items(): sheet.alpha_composite(ent[n][0],(x,y))
sheet.save(f'{A}/props.webp','WEBP',quality=92,method=6)
json.dump({n:[*rects[n],ent[n][1],ent[n][2]] for n in rects},open(f'{A}/props.json','w'),separators=(',',':'))
for n,q in (('bg_far',88),('bg_mid',88),('bg_near',88),('bg_fg',88)):
    L(n).save(f'{A}/{n}.webp','WEBP',quality=q,method=6)
im=L('bg_mid_lights'); im=im.resize((im.width//2,im.height//2),Image.LANCZOS); im.save(f'{A}/bg_mid_lights.webp','WEBP',quality=85,method=6)
print(W,H)
for f in sorted(os.listdir(A)): print(f, os.path.getsize(f'{A}/{f}'))
