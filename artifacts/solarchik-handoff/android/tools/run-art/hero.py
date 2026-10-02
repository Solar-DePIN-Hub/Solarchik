"""Pre-upscale the low-res web hero frames (public/sprites/hero-*.png, ~80x150) to crisp
~3x WebP for the native runner: premultiplied LANCZOS, a smoothed alpha edge (kills the
staircase of the hard source cutout), then a light unsharp mask on colour. Output is trimmed
to a common canvas per frame (the renderer draws every frame at the same height, like the web)."""
import sys, os
from PIL import Image, ImageFilter, ImageChops

SRC = sys.argv[1] if len(sys.argv) > 1 else 'public/sprites'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'out/hero'
SCALE = 3
os.makedirs(OUT, exist_ok=True)

def up(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    big = im.convert('RGBa').resize((w * SCALE, h * SCALE), Image.LANCZOS).convert('RGBA')
    r, g, b, a = big.split()
    # smooth the jagged cutout, then pull the soft ramp back to ~1.5 px so the edge stays crisp
    a = a.filter(ImageFilter.GaussianBlur(1.1)).point(lambda v: max(0, min(255, int((v - 128) * 2.2 + 128))))
    rgb = Image.merge('RGB', (r, g, b)).filter(ImageFilter.UnsharpMask(radius=1.6, percent=70, threshold=2))
    out = Image.merge('RGBA', (*rgb.split(), a))
    # fully transparent pixels: zero colour (smaller WebP, no fringes)
    out = Image.composite(out, Image.new('RGBA', out.size, (0, 0, 0, 0)), a.point(lambda v: 255 if v > 0 else 0))
    return out

for name in [f'hero-run-{i}' for i in range(1, 9)] + [f'hero-jump-{i}' for i in range(1, 5)]:
    o = up(os.path.join(SRC, name + '.png'))
    dst = os.path.join(OUT, name.replace('hero-', '') + '.webp')
    o.save(dst, 'WEBP', quality=88, method=6, alpha_quality=90)
    print(dst, o.size, os.path.getsize(dst))

# slide: the take-off crouch leaned back ~55 degrees (head and panel trailing, feet first)
crouch = Image.open(os.path.join(OUT, 'jump-1.webp')).convert('RGBA')
sl = crouch.convert('RGBa').rotate(55, resample=Image.BICUBIC, expand=True).convert('RGBA')
sl = sl.crop(sl.getbbox())
sl.save(os.path.join(OUT, 'slide.webp'), 'WEBP', quality=88, method=6, alpha_quality=90)
print('slide', sl.size, os.path.getsize(os.path.join(OUT, 'slide.webp')))
