# Rooftop plates (0.22.0)

The native rooftop scene (`ui/roof/RooftopView.kt`) draws pre-rendered background plates from
`app/src/main/assets/roof/roof_{land,port,sol}_{day,sunset,night}.webp`. This folder is the
three.js scene they are exported from.

    npm i three puppeteer   # or symlink an existing node_modules here (not committed)
    node plates.mjs /tmp/plates
    python3 - <<'PY'
    from PIL import Image; import glob, os
    for f in glob.glob('/tmp/plates/*.png'):
        n = os.path.basename(f)[:-4].replace('-', '_')
        Image.open(f).convert('RGB').save(f'../../app/src/main/assets/roof/roof_{n}.webp', 'WEBP', quality=82)
    PY

Hit areas and the camera live in `RoofModel.kt` (RoofFrame / RoofCamera.fit); keep them in sync
when the scene layout changes.
