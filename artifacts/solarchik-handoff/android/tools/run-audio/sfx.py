"""Solarchik run sound effects, synthesized here (original, CC0). Run: python3 sfx.py <out_dir>

Each effect is a short mono clip; the game plays them through a SoundPool (coin pitch rises with the
streak through the playback rate)."""
import sys, os
import numpy as np
from synth import *


def env_exp(n, k):
    return np.exp(-np.arange(n) / SR * k)


def tone(f0, f1, dur, harm=8, tilt=1.2, cutoff=5000, k=None):
    x = additive(f0, dur, harmonics=harm, tilt=tilt, cutoff=cutoff, glide=f1, phase_rand=False)
    if k is not None:
        x *= env_exp(len(x), k)
    return x


def fade(x, a=0.003, r=0.02):
    n = len(x)
    e = np.ones(n)
    an, rn = int(a * SR), int(r * SR)
    e[:an] = np.linspace(0, 1, an)
    e[n - rn:] *= np.linspace(1, 0, rn)
    return x * e


def mix(*parts):
    n = max(int(at * SR) + len(p) for p, at in parts)
    out = np.zeros(n)
    for p, at in parts:
        i = int(at * SR)
        out[i:i + len(p)] += p
    return out


def norm(x, peak=0.9):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def whoosh(dur, lo, hi, k=6.0, seed=31):
    nz = noise(dur, seed)
    t = t_axis(dur)
    a = fft_filter(nz, lo=lo, hi=hi)
    e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    return a * e


SFX = {}


def sfx(fn):
    SFX[fn.__name__] = fn
    return fn


@sfx
def jump():
    return norm(fade(mix((tone(330, 620, 0.16, harm=6, tilt=1.4, cutoff=2600, k=14), 0), (0.25 * whoosh(0.14, 1500, 5000), 0))), 0.7)


@sfx
def double():
    a = tone(500, 980, 0.16, harm=6, tilt=1.3, cutoff=3500, k=12)
    b = tone(1000, 1500, 0.12, harm=3, cutoff=6000, k=18) * 0.4
    return norm(fade(mix((a, 0), (b, 0.04), (0.3 * whoosh(0.2, 2000, 7000), 0))), 0.72)


@sfx
def land():
    t = t_axis(0.18)
    thud = np.sin(2 * np.pi * np.cumsum(70 + 90 * np.exp(-t * 40)) / SR) * env_exp(len(t), 22)
    grit = fft_filter(noise(0.18, 5), lo=600, hi=3000) * env_exp(len(t), 45) * 0.5
    return norm(fade(thud + grit), 0.75)


@sfx
def slide():
    t = t_axis(0.42)
    s = fft_filter(noise(0.42, 6), lo=1200, hi=4500) * np.sin(np.pi * t / 0.42) ** 0.6
    s *= 1 + 0.25 * np.sin(2 * np.pi * 34 * t)
    return norm(fade(s, r=0.06), 0.55)


@sfx
def coin():
    a = tone(1318, 1318, 0.09, harm=4, tilt=2, cutoff=8000, k=30)
    b = tone(1976, 1976, 0.28, harm=3, tilt=2, cutoff=9000, k=12)
    shimmer = fft_filter(noise(0.2, 7), lo=6000, hi=12000) * env_exp(int(0.2 * SR), 25) * 0.15
    return norm(fade(mix((a, 0), (b, 0.05), (shimmer, 0.04))), 0.6)


@sfx
def gold():
    notes = [1318, 1661, 1976, 2637]
    parts = [(tone(f, f, 0.3, harm=3, tilt=2, cutoff=9000, k=10), i * 0.045) for i, f in enumerate(notes)]
    parts.append((fft_filter(noise(0.4, 8), lo=6000, hi=13000) * env_exp(int(0.4 * SR), 9) * 0.18, 0.02))
    return norm(fade(mix(*parts)), 0.65)


@sfx
def hurt():
    t = t_axis(0.38)
    body = tone(220, 70, 0.38, harm=14, tilt=1.0, cutoff=1800, k=8)
    crunch = fft_filter(noise(0.38, 9), lo=300, hi=2500) * env_exp(len(t), 14)
    x = np.tanh((body + crunch * 0.8) * 2.2)
    return norm(fade(x), 0.55)


@sfx
def dead():
    a = tone(260, 55, 0.9, harm=14, tilt=1.0, cutoff=1500, k=3.5)
    b = fft_filter(noise(0.9, 10), lo=80, hi=900) * env_exp(int(0.9 * SR), 5) * 0.6
    return norm(fade(np.tanh((a + b) * 1.8), r=0.1), 0.55)


@sfx
def shield():
    a = tone(523, 1046, 0.5, harm=5, tilt=1.6, cutoff=5000, k=5)
    b = tone(784, 1568, 0.55, harm=4, tilt=1.6, cutoff=6000, k=4) * 0.6
    x = mix((a, 0), (b, 0.06))
    x *= 1 + 0.3 * np.sin(2 * np.pi * 6 * np.arange(len(x)) / SR)
    return norm(fade(x, r=0.08), 0.6)


@sfx
def stomp():
    t = t_axis(0.3)
    thump = np.sin(2 * np.pi * np.cumsum(60 + 160 * np.exp(-t * 30)) / SR) * env_exp(len(t), 12)
    squish = tone(700, 260, 0.16, harm=6, cutoff=3000, k=18) * 0.5
    pop = tone(900, 1500, 0.12, harm=3, cutoff=6000, k=20) * 0.35
    return norm(fade(mix((thump, 0), (squish, 0), (pop, 0.06))), 0.85)


@sfx
def near():
    return norm(fade(whoosh(0.3, 900, 6000, seed=11), r=0.05), 0.55)


@sfx
def combo():
    notes = [784, 988, 1175, 1568]
    return norm(fade(mix(*[(tone(f, f, 0.22, harm=6, tilt=1.4, cutoff=5000, k=9), i * 0.06) for i, f in enumerate(notes)])), 0.6)


@sfx
def tick():
    return norm(fade(tone(880, 880, 0.12, harm=6, tilt=1.6, cutoff=5000, k=30)), 0.5)


@sfx
def start():
    notes = [523, 659, 784, 1046]
    p = [(tone(f, f, 0.35 if i == 3 else 0.14, harm=8, tilt=1.3, cutoff=4500, k=6 if i == 3 else 16), i * 0.1) for i, f in enumerate(notes)]
    return norm(fade(mix(*p), r=0.06), 0.62)


@sfx
def grind():
    t = t_axis(0.35)
    x = tone(1200, 1500, 0.35, harm=10, tilt=0.9, cutoff=7000) * env_exp(len(t), 6)
    x *= 1 + 0.5 * np.sign(np.sin(2 * np.pi * 45 * t))
    return norm(fade(mix((x * 0.6, 0), (fft_filter(noise(0.35, 12), lo=3000, hi=9000) * env_exp(len(t), 8) * 0.4, 0))), 0.45)


@sfx
def bonus():
    notes = [523, 659, 784, 1046, 1318]
    return norm(fade(mix(*[(tone(f, f, 0.4, harm=4, tilt=1.8, cutoff=7000, k=5), i * 0.07) for i, f in enumerate(notes)]), r=0.08), 0.62)


@sfx
def thunder():
    d = 2.2
    t = t_axis(d)
    rumble = fft_filter(noise(d, 13), lo=25, hi=260) * (np.exp(-t * 1.6) * (1 - np.exp(-t * 18)))
    crack = fft_filter(noise(d, 14), lo=800, hi=5000) * np.exp(-t * 14) * 0.5
    return norm(fade(np.tanh((rumble * 1.4 + crack) * 1.5), r=0.3), 0.8)


@sfx
def boss():
    # a two-tone maintenance alarm
    parts = []
    for i in range(4):
        f = 880 if i % 2 == 0 else 660
        parts.append((tone(f, f, 0.2, harm=10, tilt=1.0, cutoff=3500) * 0.5, i * 0.21))
    parts.append((tone(110, 90, 0.9, harm=14, tilt=1.0, cutoff=900, k=3) * 0.6, 0))
    return norm(fade(mix(*parts), r=0.08), 0.7)


@sfx
def chapter():
    notes = [392, 523, 784]
    return norm(fade(mix(*[(tone(f, f, 0.5, harm=5, tilt=1.6, cutoff=5000, k=5), i * 0.09) for i, f in enumerate(notes)]), r=0.1), 0.55)


@sfx
def clock():
    notes = [523, 659, 784, 1046, 1568]
    p = [(tone(f, f, 0.9, harm=5, tilt=1.7, cutoff=7000, k=3.5), i * 0.08) for i, f in enumerate(notes)]
    p.append((fft_filter(noise(1.0, 15), lo=5000, hi=12000) * env_exp(int(1.0 * SR), 4) * 0.15, 0.3))
    return norm(fade(mix(*p), r=0.15), 0.7)


@sfx
def milestone():
    notes = [784, 1175]
    return norm(fade(mix(*[(tone(f, f, 0.45, harm=4, tilt=1.8, cutoff=7000, k=6), i * 0.09) for i, f in enumerate(notes)]), r=0.08), 0.55)


@sfx
def gust():
    d = 1.6
    t = t_axis(d)
    nz = noise(d, 16)
    lo = fft_filter(nz, lo=200, hi=900); hi = fft_filter(nz, lo=900, hi=3500)
    swell = np.sin(np.pi * t / d) ** 1.2
    wob = 1 + 0.3 * np.sin(2 * np.pi * 1.7 * t)
    return norm(fade((lo * 0.8 + hi * 0.5 * swell) * swell * wob, r=0.2), 0.55)


@sfx
def crack():
    parts = []
    g = np.random.default_rng(17)
    for i in range(6):
        d = 0.03 + g.uniform(0, 0.03)
        c = fft_filter(noise(d, 40 + i), lo=2500, hi=11000) * env_exp(int(d * SR), 90)
        parts.append((c * g.uniform(0.5, 1.0), i * 0.035 + g.uniform(0, 0.02)))
    parts.append((tone(160, 120, 0.2, harm=6, cutoff=1500, k=20) * 0.4, 0))
    return norm(fade(mix(*parts)), 0.7)


@sfx
def shatter():
    d = 0.9
    g = np.random.default_rng(18)
    parts = [(fft_filter(noise(0.25, 50), lo=1500, hi=12000) * env_exp(int(0.25 * SR), 18), 0)]
    for i in range(22):
        f = g.uniform(2500, 7000)
        dd = g.uniform(0.08, 0.3)
        parts.append((tone(f, f * g.uniform(0.98, 1.02), dd, harm=2, tilt=2, cutoff=12000, k=g.uniform(12, 30)) * g.uniform(0.15, 0.4), g.uniform(0.0, 0.5)))
    parts.append((tone(90, 50, 0.4, harm=8, cutoff=700, k=8) * 0.5, 0))
    return norm(fade(mix(*parts), r=0.1), 0.8)


@sfx
def zap():
    d = 0.4
    t = t_axis(d)
    buzz = additive(120, d, harmonics=40, tilt=0.6, cutoff=6000) * (np.sign(np.sin(2 * np.pi * 23 * t)) * 0.5 + 0.6)
    crackle = fft_filter(noise(d, 19), lo=2000, hi=10000) * (np.random.default_rng(19).uniform(0, 1, len(t)) > 0.95) * 2.5
    snap = fft_filter(noise(0.05, 20), lo=1500, hi=9000) * env_exp(int(0.05 * SR), 60)
    x = mix((np.tanh(buzz * 2.2) * env_exp(len(t), 4) * 0.8 + crackle * env_exp(len(t), 3), 0), (snap, 0))
    return norm(fade(x, r=0.05), 0.85)


@sfx
def charge():
    d = 0.75
    t = t_axis(d)
    x = tone(180, 1400, d, harm=8, tilt=1.1, cutoff=4000)
    x *= (t / d) ** 1.2 * (1 + 0.3 * np.sin(2 * np.pi * (8 + 30 * t) * t))
    return norm(fade(mix((x, 0), (0.15 * whoosh(d, 2000, 8000) * (t / d), 0)), r=0.03), 0.6)


@sfx
def beam():
    d = 0.5
    t = t_axis(d)
    core = additive(98, d, harmonics=30, tilt=0.8, cutoff=3500) + additive(147, d, harmonics=20, tilt=0.9, cutoff=3500) * 0.6
    hiss = fft_filter(noise(d, 22), lo=1500, hi=9000) * 0.6
    zap_ = tone(2400, 300, 0.12, harm=6, cutoff=8000, k=20) * 0.6
    core, hiss = core[: len(t)], hiss[: len(t)]
    x = np.tanh((core * 0.6 + hiss) * 1.8) * env_exp(len(t), 4.5)
    return norm(fade(mix((x, 0), (zap_, 0)), r=0.06), 0.85)


@sfx
def overheat():
    d = 1.0
    t = t_axis(d)
    whine = tone(1500, 380, d, harm=6, tilt=1.4, cutoff=4000) * np.exp(-t * 2.5)
    steam = fft_filter(noise(d, 23), lo=2500, hi=9000) * np.sin(np.pi * t / d) * 0.5
    return norm(fade(mix((whine * 0.7, 0), (steam, 0)), r=0.1), 0.65)


@sfx
def downed():
    d = 1.6
    t = t_axis(d)
    boom = fft_filter(noise(d, 24), lo=30, hi=500) * np.exp(-t * 3.2) * (1 - np.exp(-t * 60))
    body = np.sin(2 * np.pi * np.cumsum(45 + 110 * np.exp(-t * 12)) / SR) * np.exp(-t * 4)
    debris = fft_filter(noise(d, 25), lo=1500, hi=8000) * np.exp(-t * 6) * 0.35
    g = np.random.default_rng(26)
    clinks = [(tone(f, f, 0.15, harm=3, cutoff=9000, k=25) * 0.2, g.uniform(0.2, 1.0)) for f in g.uniform(2000, 4500, 7)]
    x = mix((np.tanh((boom * 1.6 + body) * 1.4) + debris, 0), *clinks)
    win = [(tone(f, f, 0.5, harm=4, tilt=1.7, cutoff=7000, k=5) * 0.25, 0.55 + i * 0.08) for i, f in enumerate([784, 988, 1175, 1568])]
    return norm(fade(mix((x, 0), *win), r=0.15), 0.9)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    for name, fn in SFX.items():
        x = fn()
        write_ogg(os.path.join(out, name + '.ogg'), x, quality=4)
    print(len(SFX), 'sfx')
