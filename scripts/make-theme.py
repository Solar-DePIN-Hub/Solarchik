#!/usr/bin/env python3
"""Warm rooftop lo-fi loop — long enough it doesn't nag on the first chorus."""
from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np

SR = 44100
BPM = 84.0
BEAT = 60.0 / BPM
BAR = BEAT * 4.0
BARS = 16
DUR = BARS * BAR
N = int(SR * DUR)


def linspace(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def adsr(n: int, a=0.02, d=0.12, s=0.65, r=0.25) -> np.ndarray:
    e = np.zeros(n, dtype=np.float64)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    ns = max(0, n - na - nd - nr)
    i = 0
    if na:
        e[i : i + na] = np.linspace(0, 1, na, endpoint=False)
        i += na
    if nd:
        e[i : i + nd] = np.linspace(1, s, nd, endpoint=False)
        i += nd
    if ns:
        e[i : i + ns] = s
        i += ns
    if nr and i < n:
        e[i : i + nr] = np.linspace(s if ns or nd else 1, 0, min(nr, n - i), endpoint=True)
    return e


def place(buf: np.ndarray, start: float, sig: np.ndarray, pan: float = 0.0) -> None:
    i = int(start * SR)
    n = sig.shape[0]
    if i >= buf.shape[1]:
        return
    n = min(n, buf.shape[1] - i)
    sig = sig[:n]
    l = math.cos((pan + 1) * 0.25 * math.pi)
    r = math.sin((pan + 1) * 0.25 * math.pi)
    buf[0, i : i + n] += sig * l
    buf[1, i : i + n] += sig * r


def fm_ep(freq: float, t: np.ndarray, env: np.ndarray) -> np.ndarray:
    mod = np.sin(2 * np.pi * freq * 2.01 * t) * (freq * 1.15) * np.exp(-t * 2.4)
    tone = np.sin(2 * np.pi * freq * t + mod)
    tone += 0.18 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 3.2)
    return tone * env


def pad_tone(freq: float, t: np.ndarray, env: np.ndarray) -> np.ndarray:
    det = 0.004
    s = (
        0.55 * np.sin(2 * np.pi * freq * t)
        + 0.28 * np.sin(2 * np.pi * freq * (1 + det) * t)
        + 0.18 * np.sin(2 * np.pi * freq * (1 - det) * t)
        + 0.12 * np.sin(2 * np.pi * freq * 0.5 * t)
    )
    return s * env


def bass_tone(freq: float, t: np.ndarray, env: np.ndarray) -> np.ndarray:
    s = np.sin(2 * np.pi * freq * t)
    s += 0.25 * np.tanh(2.2 * np.sin(2 * np.pi * freq * 0.5 * t))
    return s * env


def bell(freq: float, t: np.ndarray, env: np.ndarray) -> np.ndarray:
    s = np.sin(2 * np.pi * freq * t) * np.exp(-t * 3.8)
    s += 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 6.0)
    return s * env


def noise_hit(n: int, decay: float) -> np.ndarray:
    rng = np.random.default_rng(7)
    x = rng.standard_normal(n)
    # cheap 1-pole lowpass
    a = 0.18
    y = np.zeros(n)
    for i in range(1, n):
        y[i] = y[i - 1] + a * (x[i] - y[i - 1])
    t = np.arange(n) / SR
    return y * np.exp(-t * decay)


# Fmaj7, Cadd9, Dm7, Bbmaj7 — two phrases
CHORDS = [
    (174.61, 220.00, 261.63, 329.63),  # F3 A3 C4 E4
    (130.81, 196.00, 261.63, 293.66),  # C3 G3 C4 D4
    (146.83, 220.00, 261.63, 349.23),  # D3 A3 C4 F4
    (116.54, 174.61, 233.08, 349.23),  # Bb2 F3 Bb3 F4
]
ROOTS = [87.31, 65.41, 73.42, 58.27]  # F2 C2 D2 Bb1

# pentatonic-ish rooftop melody, two 8-bar phrases (beat offsets inside bar)
MELODY_A = [  # bars 0-7
    (0.0, 659.25, 0.70),  # E5
    (1.5, 523.25, 0.45),  # C5
    (2.5, 587.33, 0.55),  # D5
    (4.0, 698.46, 0.90),  # F5
    (6.0, 523.25, 0.80),
    (8.0, 440.00, 0.70),
    (9.5, 523.25, 0.40),
    (10.5, 587.33, 0.50),
    (12.0, 392.00, 1.10),
    (14.0, 523.25, 1.40),
]
MELODY_B = [  # bars 8-15, different contour
    (0.0, 523.25, 0.80),
    (1.0, 587.33, 0.40),
    (2.0, 659.25, 0.90),
    (4.0, 440.00, 0.70),
    (5.5, 392.00, 0.50),
    (6.5, 349.23, 0.70),
    (8.0, 523.25, 0.60),
    (10.0, 698.46, 0.90),
    (12.0, 659.25, 0.70),
    (13.5, 587.33, 0.55),
    (14.5, 523.25, 1.20),
]


def main() -> None:
    stereo = np.zeros((2, N), dtype=np.float64)
    rng = np.random.default_rng(21)

    # bed: very quiet vinyl + air
    air = rng.standard_normal(N) * 0.012
    # brown-ish
    for i in range(1, N):
        air[i] = 0.86 * air[i - 1] + 0.14 * air[i]
    air *= 0.35
    stereo += air

    for bar in range(BARS):
        start = bar * BAR
        chord = CHORDS[bar % 4]
        root = ROOTS[bar % 4]
        # pad across the bar
        tn = int((BAR + 0.35) * SR)
        t = linspace(tn)
        env = adsr(tn, 0.18, 0.3, 0.72, 0.45)
        pad = np.zeros(tn)
        for i, f in enumerate(chord):
            pad += pad_tone(f, t, env) * (0.22 if i < 2 else 0.16)
        place(stereo, start, pad, pan=(-0.15 if bar % 2 == 0 else 0.18))

        # bass on beats 1 and 3
        for hit in (0.0, 2.0):
            bn = int(1.6 * BEAT * SR)
            bt = linspace(bn)
            benv = adsr(bn, 0.01, 0.08, 0.55, 0.5)
            place(stereo, start + hit * BEAT, bass_tone(root, bt, benv) * 0.55, pan=0.0)

        # soft rhodes on the chord, beat 1
        rn = int(2.2 * BEAT * SR)
        rt = linspace(rn)
        renv = adsr(rn, 0.006, 0.18, 0.4, 0.55)
        rh = np.zeros(rn)
        for i, f in enumerate(chord):
            rh += fm_ep(f, rt, renv) * (0.18 if i else 0.24)
        place(stereo, start, rh, pan=0.08)

        # light hat on 2 and 4, snare-ish on 3
        hat = noise_hit(int(0.12 * SR), 28.0) * 0.045
        place(stereo, start + 1 * BEAT, hat, pan=0.35)
        place(stereo, start + 3 * BEAT, hat * 0.85, pan=-0.3)
        snap = noise_hit(int(0.18 * SR), 16.0) * 0.07
        place(stereo, start + 2 * BEAT, snap, pan=0.05)

    # melody A then B
    for phrase, offset_bar in ((MELODY_A, 0), (MELODY_B, 8)):
        base = offset_bar * BAR
        for beat_off, freq, hold in phrase:
            tn = int((hold * BEAT + 0.12) * SR)
            t = linspace(tn)
            env = adsr(tn, 0.02, 0.1, 0.55, 0.35)
            sig = bell(freq, t, env) * 0.22
            # quiet lower octave ghost
            sig += fm_ep(freq * 0.5, t, env) * 0.05
            pan = -0.1 if (int(beat_off) % 2 == 0) else 0.12
            place(stereo, base + beat_off * BEAT, sig, pan=pan)

    # extra sparkle every 4th bar
    for bar in (3, 7, 11, 15):
        tn = int(1.4 * BEAT * SR)
        t = linspace(tn)
        env = adsr(tn, 0.005, 0.08, 0.3, 0.4)
        place(stereo, bar * BAR + 3 * BEAT, bell(1046.5, t, env) * 0.09, pan=0.4)

    # loop crossfade 180ms
    fade = int(0.18 * SR)
    ramp = np.linspace(0, 1, fade)
    stereo[:, :fade] = stereo[:, :fade] * ramp + stereo[:, -fade:] * (1 - ramp)
    stereo[:, -fade:] = stereo[:, :fade] * (1 - ramp)[::-1] + stereo[:, -fade:] * ramp[::-1]

    # soft limiter
    peak = np.max(np.abs(stereo))
    stereo *= 0.72 / max(peak, 1e-9)
    stereo = np.tanh(stereo * 1.15) * 0.92

    pcm = np.clip(stereo.T * 32767.0, -32767, 32767).astype(np.int16)
    out_wav = Path("/tmp/theme.wav")
    with wave.open(str(out_wav), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("wav", out_wav, "dur", round(DUR, 2), "peak", float(peak))


if __name__ == "__main__":
    main()
