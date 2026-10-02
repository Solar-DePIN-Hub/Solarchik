"""Tiny numpy synth used to author the Solarchik run music and SFX (all original, generated here).

Band-limited additive oscillators (no aliasing), FFT filters, a synthetic stereo reverb and
synthesized drums. Everything is deterministic (seeded), so the assets can be regenerated.
"""
import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def adsr(n, a=0.01, d=0.1, s=0.7, r=0.2, hold=None):
    """Envelope of n samples: attack, decay to sustain, hold, release at the end."""
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    a_n = max(1, min(a_n, n)); d_n = max(1, min(d_n, n - a_n))
    r_n = max(1, min(r_n, n - a_n - d_n)) if n - a_n - d_n > 1 else 1
    s_n = max(0, n - a_n - d_n - r_n)
    env = np.concatenate([
        np.linspace(0, 1, a_n, endpoint=False),
        np.linspace(1, s, d_n, endpoint=False),
        np.full(s_n, s),
        np.linspace(s, 0, r_n),
    ])
    return env[:n] if len(env) >= n else np.pad(env, (0, n - len(env)))


def additive(freq, dur, harmonics=24, tilt=1.0, cutoff=4000.0, decay=None, detune=0.0, phase_rand=True, odd=False, glide=None):
    """Band-limited tone: sum of harmonics with 1/k^tilt amplitudes and a soft low-pass at cutoff.
    decay: per-harmonic decay rate (pluck), higher harmonics fade faster. glide: end frequency."""
    t = t_axis(dur)
    out = np.zeros_like(t)
    f = freq * (1 + detune)
    if glide is not None:
        inst = f * (glide / freq) ** (t / max(dur, 1e-6))
        phase = 2 * np.pi * np.cumsum(inst) / SR
    else:
        phase = 2 * np.pi * f * t
    for k in range(1, harmonics + 1):
        if odd and k % 2 == 0:
            continue
        fk = f * k
        if fk > SR * 0.45:
            break
        amp = 1.0 / k ** tilt
        amp *= 1.0 / (1.0 + (fk / cutoff) ** 4)
        ph = rng.uniform(0, 2 * np.pi) if phase_rand else 0.0
        h = amp * np.sin(k * phase + ph)
        if decay is not None:
            h *= np.exp(-t * decay * (1 + 0.35 * (k - 1)))
        out += h
    return out


def noise(dur, seed=None):
    g = np.random.default_rng(seed) if seed is not None else rng
    return g.standard_normal(int(dur * SR))


def fft_filter(x, lo=None, hi=None, order=2):
    """Zero-phase band filter in the frequency domain (soft Butterworth-like magnitude)."""
    n = len(x)
    X = np.fft.rfft(x, n * 2)
    f = np.fft.rfftfreq(n * 2, 1 / SR)
    H = np.ones_like(f)
    if hi is not None:
        H *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo is not None:
        H *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * H, n * 2)[:n]


def kick(dur=0.45, f0=150, f1=45, punch=1.0):
    t = t_axis(dur)
    f = f1 + (f0 - f1) * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7)
    click = fft_filter(noise(dur, 1), lo=1500, hi=6000) * np.exp(-t * 300) * 0.25 * punch
    return np.tanh((body + click) * 1.6) * 0.9


def snare(dur=0.3, tone=190, bright=5000):
    t = t_axis(dur)
    n = fft_filter(noise(dur, 2), lo=900, hi=bright) * np.exp(-t * 16)
    b = np.sin(2 * np.pi * tone * t) * np.exp(-t * 26) * 0.6
    return (n * 0.9 + b) * 0.8


def clap(dur=0.35):
    t = t_axis(dur)
    n = fft_filter(noise(dur, 3), lo=1000, hi=4500)
    env = np.zeros_like(t)
    for d in (0.0, 0.011, 0.023):
        env += np.where(t >= d, np.exp(-(t - d) * 90), 0)
    env += np.where(t >= 0.03, np.exp(-(t - 0.03) * 14) * 0.6, 0)
    return n * env * 0.7


def hat(dur=0.08, open_=False):
    d = 0.35 if open_ else dur
    t = t_axis(d)
    n = fft_filter(noise(d, 4), lo=7000, hi=14000)
    return n * np.exp(-t * (9 if open_ else 55)) * 0.5


def tom(f=110, dur=0.5):
    t = t_axis(dur)
    fr = f * (1 + 0.6 * np.exp(-t * 20))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 6) * 0.8


def reverb_ir(seconds=2.4, pre=0.012, damp=3000, seed=11):
    g = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 6.9 / seconds)
    irs = []
    for ch in range(2):
        x = g.standard_normal(n) * env
        x = fft_filter(x, lo=180, hi=damp)
        x = np.concatenate([np.zeros(int(pre * SR)), x])
        irs.append(x / np.sqrt(np.sum(x ** 2)))
    return irs


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:n]


class Track:
    """A stereo loop of `bars` bars; notes past the loop end wrap round to the start (seamless)."""

    def __init__(self, bpm, bars, beats=4):
        self.bpm = bpm
        self.beat = 60.0 / bpm
        self.length = bars * beats * self.beat
        self.n = int(round(self.length * SR))
        tail = int(4 * SR)
        self.dry = np.zeros((2, self.n + tail))
        self.wet = np.zeros((2, self.n + tail))

    def add(self, x, at_beats, gain=1.0, pan=0.0, send=0.2):
        i = int(round(at_beats * self.beat * SR))
        x = x * gain
        l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
        end = min(i + len(x), self.dry.shape[1])
        seg = x[: end - i]
        self.dry[0, i:end] += seg * l * (1 - send * 0.5)
        self.dry[1, i:end] += seg * r * (1 - send * 0.5)
        self.wet[0, i:end] += seg * l * send
        self.wet[1, i:end] += seg * r * send

    def render(self, ir_seconds=2.4, damp=3000, duck=None, master=0.9, lufs_rms=-18.0, air=11000):
        irs = reverb_ir(ir_seconds, damp=damp)
        mix = self.dry.copy()
        for ch in range(2):
            w = convolve(self.wet[ch], irs[ch])[: mix.shape[1]]
            mix[ch] += w * 0.9
        if duck is not None:
            mix *= duck[: mix.shape[1]]
        # wrap the tail round to the start: seamless loop
        out = mix[:, : self.n].copy()
        tail = mix[:, self.n:]
        k = min(tail.shape[1], self.n)
        out[:, :k] += tail[:, :k]
        # tame the top end a little, then set the loudness (RMS) and soft-limit the peaks
        out = np.vstack([fft_filter(out[0], hi=air, order=1), fft_filter(out[1], hi=air, order=1)])
        rms = np.sqrt(np.mean(out ** 2)) + 1e-9
        out = out * (10 ** (lufs_rms / 20) / rms)
        out = np.tanh(out / 0.92) * 0.92
        return out

    def duck_curve(self, beats, depth=0.35, release=0.22):
        """Sidechain-like volume dips on the given beats (for pads under a kick)."""
        n = self.dry.shape[1]
        curve = np.ones(n)
        t = np.arange(int(release * 3 * SR)) / SR
        dip = 1 - depth * np.exp(-t / release * 2.2)
        for b in beats:
            i = int(round(b * self.beat * SR)) % self.n
            e = min(i + len(dip), n)
            curve[i:e] = np.minimum(curve[i:e], dip[: e - i])
        return np.vstack([curve, curve])


def write_ogg(path, stereo_or_mono, quality=4):
    import subprocess, tempfile, wave, os
    x = np.asarray(stereo_or_mono)
    if x.ndim == 1:
        x = x[None, :]
    pcm = (np.clip(x.T, -1, 1) * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(x.shape[0]); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    if path.endswith('.wav'):
        os.replace(tmp, path)
        return
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-c:a', 'libvorbis', '-q:a', str(quality), path], check=True)
    os.remove(tmp)
