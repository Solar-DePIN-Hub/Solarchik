"""Gameplay preview: mix the run's music + SFX from a RunVideoTest event log and encode the frames to H.264.

python3 preview.py FRAMES_DIR ASSETS_AUDIO_DIR OUT.mp4
FRAMES_DIR holds f00000.jpg.. and events.csv ("seconds,name": SFX names, music:<track>, cut) from
  ./gradlew :app:testDebugUnitTest --tests '*RunVideoTest' -Prunvideo=FRAMES_DIR
Mix rules follow RunAudio: SFX at RunSounds.GAIN x 0.9 (default SFX volume), coin streak pitch, 55 ms
busy-sound limit, music at 0.7 with a 1.6 s crossfade between tracks.
"""
import os, subprocess, sys
import numpy as np
from montage import GAIN, SCALE, SR, load, rate

FPS = 30


def main(frames, src, out):
    n = len([f for f in os.listdir(frames) if f.endswith('.jpg')])
    dur = n / FPS
    total = int(dur * SR)
    events = [(float(t), name) for t, name in (l.strip().split(',') for l in open(os.path.join(frames, 'events.csv')) if l.strip())]
    sfx = np.zeros(total)
    cache = {}
    last_busy, last_coin, streak = -9.0, -9.0, 0
    for t, name in events:
        if name.startswith('music:') or name == 'cut' or name not in GAIN:
            continue
        if name in ('near', 'land', 'grind'):
            if t - last_busy < 0.055: continue
            last_busy = t
        if name not in cache:
            cache[name] = load(os.path.join(src, 'sfx', name + '.ogg'))
        x = cache[name] * GAIN[name] * 0.9
        if name == 'coin':
            streak = streak + 1 if t - last_coin < 0.5 else 0
            last_coin = t
            x = rate(x, 2 ** (SCALE[min(streak, 7)] / 12))
        a = int(t * SR)
        if a >= total: continue
        sfx[a:a + len(x)] += x[:total - a]
    # music: each track plays from its cue, crossfading 1.6 s into the next
    cues = [(t, name.split(':')[1]) for t, name in events if name.startswith('music:')]
    music = np.zeros((total, 2))
    fade = int(1.6 * SR)
    for i, (t, trk) in enumerate(cues):
        a = int(t * SR)
        b = int(cues[i + 1][0] * SR) if i + 1 < len(cues) else total
        end = min(total, b + fade) if i + 1 < len(cues) else total
        m = end - a
        tr = load(os.path.join(src, 'music', trk + '.ogg'), 2)
        x = np.tile(tr, (int(np.ceil((m + 1) / len(tr))), 1))[:m]
        env = np.ones(m)
        if i > 0: env[:min(fade, m)] = np.linspace(0, 1, min(fade, m))
        if i + 1 < len(cues): env[b - a:] = np.linspace(1, 0, m - (b - a))
        music[a:end] += x * env[:, None]
    mix = music * 0.7 + sfx[:, None]
    tail = int(0.6 * SR)
    mix[-tail:] *= np.linspace(1, 0, tail)[:, None]
    peak = np.abs(mix).max()
    if peak > 0.97: mix *= 0.97 / peak
    wav = out + '.mix.wav'
    pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-', wav], input=pcm, check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(frames, 'f%05d.jpg'), '-i', wav,
                    '-vf', 'scale=1280:576:flags=lanczos,setsar=1', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
                    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
                    '-c:a', 'aac', '-b:a', '192k', '-shortest', out], check=True)
    os.remove(wav)
    print(f'{out}: {n} frames, {dur:.2f} s, peak before limit {peak:.2f}')


if __name__ == '__main__':
    main(*sys.argv[1:4])
