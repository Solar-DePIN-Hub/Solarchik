"""Solarchik run music: four seamless loops, composed and synthesized here (original, CC0).

  golden.ogg  golden hour: calm D-major synth, plucked arpeggio, soft beat      84 bpm, 16 bars
  night.ogg   night city: F-minor synthwave pulse, bell motif, big clap        96 bpm, 16 bars
  storm.ogg   storm line: C-minor ostinato, toms, risers, tense                112 bpm, 16 bars
  boss.ogg    maintenance drone: E-minor driving bass, stabs, lead            132 bpm, 16 bars

Run: python3 music.py <out_dir>
"""
import sys, os
import numpy as np
from synth import *

N = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}
FLAT = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}


def m(name):
    """'C#4' / 'Eb3' -> midi number."""
    p, o = name[:-1], int(name[-1])
    p = FLAT.get(p, p)
    return 12 * (o + 1) + N[p]


def pad(notes, dur, cutoff=1800, gain=0.12, a=0.9, r=1.4, detune=0.004):
    out = None
    for n in notes:
        f = midi(m(n) if isinstance(n, str) else n)
        x = sum(additive(f, dur + r, harmonics=14, tilt=1.0, cutoff=cutoff, detune=d) for d in (-detune, 0.0, detune))
        x *= adsr(len(x), a=a, d=0.6, s=0.8, r=r)
        out = x if out is None else out + x
    return out * gain


def pluck(n, dur=0.7, cutoff=3200, decay=5.0, gain=0.22):
    f = midi(m(n) if isinstance(n, str) else n)
    x = additive(f, dur, harmonics=18, tilt=1.1, cutoff=cutoff, decay=decay)
    return x * adsr(len(x), a=0.003, d=0.05, s=1.0, r=0.08) * gain


def bell(n, dur=1.6, gain=0.16):
    f = midi(m(n) if isinstance(n, str) else n)
    t = t_axis(dur)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 2.2)
         + 0.45 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 3.5)
         + 0.22 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t * 6)
         + 0.12 * np.sin(2 * np.pi * f * 4.2 * t) * np.exp(-t * 9))
    return x * adsr(len(x), a=0.004, d=0.1, s=1.0, r=0.2) * gain


def bass(n, dur, cutoff=520, gain=0.4, sub=0.6):
    f = midi(m(n) if isinstance(n, str) else n)
    t = t_axis(dur)
    x = additive(f, dur, harmonics=10, tilt=1.3, cutoff=cutoff) * 0.6 + np.sin(2 * np.pi * f * t) * sub
    return np.tanh(x * adsr(len(x), a=0.005, d=0.12, s=0.75, r=0.06) * 1.4) * gain


def lead(n, dur, cutoff=2600, gain=0.14, vib=5.5):
    f = midi(m(n) if isinstance(n, str) else n)
    t = t_axis(dur)
    x = sum(additive(f * (1 + 0.003 * np.sin(2 * np.pi * vib * 0.0)), dur, harmonics=26, tilt=1.0, cutoff=cutoff, detune=d) for d in (-0.003, 0.003))
    x *= 1 + 0.08 * np.sin(2 * np.pi * vib * t) * np.clip(t / 0.4, 0, 1)
    return x * adsr(len(x), a=0.02, d=0.15, s=0.7, r=0.12) * gain


def riser(dur, gain=0.12):
    t = t_axis(dur)
    nz = noise(dur, 21)
    # crude sweep: blend of band-filtered copies, brighter towards the end
    lo = fft_filter(nz, lo=300, hi=1200); hi = fft_filter(nz, lo=2000, hi=8000)
    u = t / dur
    return (lo * (1 - u) + hi * u) * (u ** 2) * gain


def chord_tones(ch, octave_lo=4):
    return ch


def golden():
    T = Track(84, 16)
    prog = [['D3', 'F#3', 'A3', 'C#4', 'E4'], ['B2', 'D3', 'F#3', 'A3', 'C#4'], ['G2', 'B2', 'D3', 'F#3', 'C#4'], ['A2', 'D3', 'E3', 'A3', 'C#4']]
    arps = [['D4', 'A4', 'C#5', 'E5', 'F#5', 'E5', 'C#5', 'A4'], ['B3', 'F#4', 'A4', 'C#5', 'D5', 'C#5', 'A4', 'F#4'],
            ['G3', 'D4', 'F#4', 'B4', 'C#5', 'B4', 'F#4', 'D4'], ['A3', 'E4', 'A4', 'C#5', 'D5', 'C#5', 'A4', 'E4']]
    roots = ['D2', 'B1', 'G1', 'A1']
    for c in range(8):
        k = c % 4
        b0 = c * 8
        T.add(pad(prog[k], 8 * T.beat, cutoff=1500, gain=0.1), b0, send=0.45)
        for i in range(16):
            n = arps[k][i % 8]
            T.add(pluck(n, 0.9, cutoff=2600, decay=4.0, gain=0.12 if i % 4 else 0.15), b0 + i * 0.5, pan=(-0.45 if i % 2 else 0.45), send=0.4)
        T.add(bass(roots[k], 1.6 * T.beat, cutoff=380, gain=0.32), b0)
        T.add(bass(roots[k], 1.2 * T.beat, cutoff=380, gain=0.22), b0 + 2.5)
        T.add(bass(roots[k], 1.6 * T.beat, cutoff=380, gain=0.3), b0 + 4)
        T.add(bass(roots[k][:-1] + str(int(roots[k][-1]) + 1), 1.0 * T.beat, cutoff=380, gain=0.18), b0 + 6.5)
        if c >= 2:
            for bar in range(2):
                o = b0 + bar * 4
                T.add(kick(0.5, 120, 45, 0.5), o, gain=0.42, send=0.05)
                T.add(kick(0.5, 120, 45, 0.5), o + 2.5, gain=0.3, send=0.05)
                T.add(clap(), o + 3, gain=0.18, send=0.5)
                for e in range(8):
                    T.add(hat(0.05), o + e * 0.5, gain=0.07 if e % 2 else 0.04, pan=0.3, send=0.15)
    # a slow bell motif over the second half
    motif = [('F#5', 32), ('E5', 33.5), ('A5', 35), ('C#6', 38), ('B5', 40), ('A5', 41.5), ('F#5', 43), ('E5', 46),
             ('D5', 48), ('E5', 49.5), ('F#5', 51), ('A5', 54), ('G5', 56), ('F#5', 57.5), ('E5', 59), ('C#5', 62)]
    for n, b in motif:
        T.add(bell(n, 2.2, 0.11), b, pan=-0.2, send=0.6)
    return T.render(ir_seconds=3.0, damp=3500, lufs_rms=-17.0, air=10000)


def night():
    T = Track(96, 16)
    prog = [['F3', 'Ab3', 'C4', 'Eb4', 'G4'], ['Db3', 'F3', 'Ab3', 'C4'], ['Ab2', 'C3', 'Eb3', 'G3', 'Bb3'], ['Eb3', 'G3', 'Bb3', 'C4']]
    roots = ['F1', 'Db1', 'Ab1', 'Eb1']
    kicks = []
    for c in range(8):
        k = c % 4
        b0 = c * 8
        T.add(pad(prog[k], 8 * T.beat, cutoff=1300, gain=0.11, a=1.2), b0, send=0.5)
        for e in range(16):
            octv = 1 if e % 2 else 0
            r = roots[k]
            n = r[:-1] + str(int(r[-1]) + 1 + octv)
            T.add(bass(n, 0.42 * T.beat, cutoff=900 if e % 2 else 600, gain=0.24, sub=0.4), b0 + e * 0.5, send=0.05)
        for beat in range(8):
            T.add(kick(0.45, 130, 42, 0.8), b0 + beat, gain=0.5, send=0.03)
            kicks.append(b0 + beat)
            if beat % 2 == 1:
                T.add(clap(), b0 + beat, gain=0.32, send=0.55)
                T.add(snare(0.25, 200, 6000), b0 + beat, gain=0.14, send=0.4)
        for s in range(32):
            T.add(hat(0.04), b0 + s * 0.25, gain=0.05 if s % 2 else 0.08, pan=0.35, send=0.1)
            if s % 4 == 2:
                T.add(hat(open_=True), b0 + s * 0.25, gain=0.035, pan=-0.3, send=0.2)
    motif = ['C5', 'Eb5', 'F5', 'G5', 'Bb5', 'G5', 'F5', 'Eb5']
    rhythm = [0, 1.5, 3, 4, 6, 7.5, 9, 10.5]
    for rep in range(4):
        for i, (n, b) in enumerate(zip(motif, rhythm)):
            if rep % 2 == 1 and i in (3, 4):
                n = ['Ab5', 'C6'][i - 3]
            o = 16 * rep + b
            T.add(bell(n, 1.6, 0.12), o, pan=0.25, send=0.55)
            T.add(bell(n, 1.2, 0.05), o + 0.75, pan=-0.4, send=0.6)  # dotted-eighth echo
    duck = T.duck_curve(kicks, depth=0.3)
    return T.render(ir_seconds=2.6, damp=3000, duck=duck, lufs_rms=-15.5)


def storm():
    T = Track(112, 16)
    roots = ['C2', 'Ab1', 'F1', 'G1']
    chords = [['C3', 'Eb3', 'G3'], ['Ab2', 'C3', 'Eb3'], ['F2', 'Ab2', 'C3'], ['G2', 'B2', 'D3']]
    pattern = [0, 0, 12, 0, 7, 0, 3, 0, 0, 0, 12, 0, 8, 7, 3, 2]
    for c in range(8):
        k = c % 4
        b0 = c * 8
        T.add(pad(chords[k], 8 * T.beat, cutoff=900, gain=0.12, a=0.6, detune=0.006), b0, send=0.45)
        T.add(pad([roots[k][:-1] + '1'], 8 * T.beat, cutoff=300, gain=0.2, a=0.3), b0, send=0.1)
        base = m(roots[k]) + 12
        for s in range(32):
            n = base + pattern[s % 16]
            T.add(pluck(n, 0.22, cutoff=1800, decay=14, gain=0.16 if s % 4 == 0 else 0.11), b0 + s * 0.25, pan=0.2 if s % 2 else -0.2, send=0.12)
        for bar in range(2):
            o = b0 + bar * 4
            T.add(kick(0.5, 140, 40, 1.0), o, gain=0.55, send=0.05)
            T.add(kick(0.5, 140, 40, 1.0), o + 1.75, gain=0.4, send=0.05)
            T.add(kick(0.5, 140, 40, 1.0), o + 2.5, gain=0.45, send=0.05)
            T.add(snare(0.35, 180, 5500), o + 3, gain=0.36, send=0.45)
            T.add(tom(98, 0.5), o + 3.5, gain=0.25, pan=0.3, send=0.3)
            T.add(tom(73, 0.6), o + 3.75, gain=0.28, pan=-0.3, send=0.3)
            for s in range(16):
                T.add(hat(0.03), o + s * 0.25, gain=0.045, pan=0.4, send=0.08)
        if c % 2 == 1:
            T.add(riser(4 * T.beat, 0.1), b0 + 4, send=0.4)
    # a high string-like line, tense half steps
    line = [('G4', 16, 4), ('Ab4', 20, 4), ('G4', 24, 3), ('F4', 27, 1), ('Eb4', 28, 4), ('D4', 32, 4), ('Eb4', 36, 4), ('F4', 40, 4), ('G4', 44, 4)]
    for n, b, d in line:
        T.add(pad([n], d * T.beat, cutoff=2200, gain=0.06, a=0.4, r=0.6, detune=0.003), b + 16, send=0.5)
        T.add(pad([n], d * T.beat, cutoff=2200, gain=0.06, a=0.4, r=0.6, detune=0.003), b - 16 if b >= 16 else b, send=0.5)
    return T.render(ir_seconds=2.2, damp=2600, lufs_rms=-15.0)


def boss():
    T = Track(132, 16)
    roots = ['E1', 'C1', 'D1', 'B0']
    stabs = [['E3', 'G3', 'B3'], ['C3', 'E3', 'G3'], ['D3', 'F#3', 'A3'], ['B2', 'D#3', 'F#3']]
    arp = [['E5', 'G5', 'B5', 'G5'], ['E5', 'G5', 'C6', 'G5'], ['D5', 'F#5', 'A5', 'F#5'], ['D#5', 'F#5', 'B5', 'F#5']]
    kicks = []
    for bar in range(16):
        k = bar % 4
        o = bar * 4
        base = m(roots[k]) + 12
        for s in range(16):
            n = base + (12 if s % 4 == 2 else 0)
            T.add(bass(n, 0.22 * T.beat, cutoff=1100, gain=0.26, sub=0.45), o + s * 0.25, send=0.03)
        for b in range(4):
            T.add(kick(0.42, 160, 45, 1.2), o + b, gain=0.6, send=0.02)
            kicks.append(o + b)
            T.add(hat(open_=True), o + b + 0.5, gain=0.035, pan=0.3, send=0.15)
        T.add(clap(), o + 1, gain=0.28, send=0.35); T.add(snare(0.25, 210, 7000), o + 1, gain=0.15, send=0.3)
        T.add(clap(), o + 3, gain=0.28, send=0.35); T.add(snare(0.25, 210, 7000), o + 3, gain=0.15, send=0.3)
        for s in range(16):
            T.add(hat(0.03), o + s * 0.25, gain=0.04, pan=-0.35, send=0.05)
        for st in (0.5, 1.75, 2.5, 3.5):
            for n in stabs[k]:
                x = additive(midi(m(n)), 0.26, harmonics=26, tilt=1.0, cutoff=3000) * adsr(int(0.26 * SR), 0.004, 0.06, 0.5, 0.06)
                T.add(x * 0.07, o + st, pan=0.15, send=0.3)
        if bar >= 8:
            for s in range(16):
                T.add(lead(arp[k][s % 4], 0.24 * T.beat, cutoff=3200, gain=0.07), o + s * 0.25, pan=-0.15, send=0.25)
        if bar % 4 == 3:
            T.add(riser(4 * T.beat, 0.08), o, send=0.3)
    # a stern lead line in the first half
    line = [('B4', 0, 3), ('A4', 3, 1), ('G4', 4, 2), ('E4', 6, 2), ('C5', 8, 3), ('B4', 11, 1), ('A4', 12, 4),
            ('B4', 16, 3), ('C5', 19, 1), ('D5', 20, 2), ('C5', 22, 2), ('B4', 24, 3), ('A4', 27, 1), ('B4', 28, 4)]
    for n, b, d in line:
        T.add(lead(n, d * T.beat, gain=0.09), b, send=0.3)
    duck = T.duck_curve(kicks, depth=0.4, release=0.16)
    return T.render(ir_seconds=1.8, damp=4000, duck=duck, lufs_rms=-14.0, air=12000)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    only = sys.argv[2:] or ['golden', 'night', 'storm', 'boss']
    for name in only:
        x = globals()[name]()
        write_ogg(os.path.join(out, name + '.ogg'), x, quality=3)
        print(name, x.shape[1] / SR, 's')
