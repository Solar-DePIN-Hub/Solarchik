"""Review exports: an SFX montage (every clip, then a rising coin streak) and a music crossfade demo.

python3 montage.py ASSETS_AUDIO_DIR OUT_DIR
"""
import os, subprocess, sys
import numpy as np

SR = 44100
ORDER = ['start', 'jump', 'double', 'land', 'slide', 'coin', 'gold', 'near', 'combo', 'grind', 'shield', 'stomp',
         'hurt', 'gust', 'crack', 'shatter', 'zap', 'thunder', 'boss', 'charge', 'beam', 'overheat', 'downed',
         'chapter', 'milestone', 'clock', 'bonus', 'tick', 'dead']
# per-clip mix gains, same as RunSounds.GAIN in RunAudio.kt
GAIN = dict(jump=.55, double=.6, land=.5, slide=.75, coin=.55, gold=.7, hurt=.9, dead=1, shield=.8, stomp=.8, near=.7,
            combo=.7, tick=.7, start=.75, grind=.8, bonus=.8, thunder=.75, boss=.85, chapter=.8, clock=1, milestone=.8,
            gust=.9, crack=.85, shatter=.9, zap=1, charge=.8, beam=.85, overheat=.85, downed=1)
SCALE = [0, 2, 4, 5, 7, 9, 11, 12]


def load(path, ch=1):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-'],
                         check=True, capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    return x.reshape(-1, ch) if ch > 1 else x


def rate(x, r):
    """SoundPool-style playback rate: resample (pitch and speed together)."""
    n = int(len(x) / r)
    return np.interp(np.arange(n) * r, np.arange(len(x)), x)


def save(x, base):
    x = np.clip(x, -1, 1)
    pcm = (x * 32767).astype('<i2').tobytes()
    ch = 1 if x.ndim == 1 else x.shape[1]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', str(ch), '-i', '-', base + '.wav'], input=pcm, check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', base + '.wav', '-c:a', 'libvorbis', '-q:a', '5', base + '.ogg'], check=True)


def main(src, out):
    os.makedirs(out, exist_ok=True)
    parts, cues, t = [], [], 0.0
    for name in ORDER:
        x = load(os.path.join(src, 'sfx', name + '.ogg')) * GAIN[name] * 0.9
        cues.append(f'{t:6.2f}s  {name}')
        parts += [x, np.zeros(int(0.35 * SR))]
        t += len(x) / SR + 0.35
    # coin streak: 10 coins 0.16 s apart climb the major scale to the octave and hold
    coin = load(os.path.join(src, 'sfx', 'coin.ogg')) * GAIN['coin'] * 0.9
    streak = np.zeros(int(2.4 * SR))
    for i in range(10):
        c = rate(coin, 2 ** (SCALE[min(i, 7)] / 12))
        a = int(i * 0.16 * SR)
        streak[a:a + len(c)] += c[:len(streak) - a]
    cues.append(f'{t:6.2f}s  coin streak x10 (rising pitch)')
    parts.append(streak)
    save(np.concatenate(parts), os.path.join(out, 'sfx-montage'))
    with open(os.path.join(out, 'sfx-montage-cues.txt'), 'w') as f:
        f.write('\n'.join(cues) + '\n')
    # music crossfade demo: golden 10 s -> night (1.6 s fade, as in RunAudio) -> storm -> boss
    segs = ['golden', 'night', 'storm', 'boss']
    tracks = [load(os.path.join(src, 'music', s + '.ogg'), 2) for s in segs]
    seg, fade = int(10 * SR), int(1.6 * SR)
    total = seg * len(segs) + fade
    mix = np.zeros((total, 2))
    for i, tr in enumerate(tracks):
        a = i * seg
        n = seg + fade if i < len(segs) - 1 else seg
        x = np.tile(tr, (int(np.ceil((n + 1) / len(tr))), 1))[:n]
        env = np.ones(n)
        if i > 0: env[:fade] = np.linspace(0, 1, fade)
        if i < len(segs) - 1: env[seg:] = np.linspace(1, 0, n - seg)
        mix[a:a + n] += x * env[:, None]
    mix[-int(1.5 * SR):] *= np.linspace(1, 0, int(1.5 * SR))[:, None]
    save(mix * 0.7, os.path.join(out, 'music-crossfade-demo'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
