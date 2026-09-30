let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfx: GainNode | null = null;
let musicMuted = false;
let armed = false;
let musicEl: HTMLAudioElement | null = null;
let wantMusic = false;

const MUTE_KEY = "solarchik-mute";
const VOICE_KEY = "solarchik-voice";
const MUSIC_MP3 = "/audio/theme.mp3?v=6";
const MUSIC_OGG = "/audio/theme.ogg?v=6";

const SPEECH_LANG: Record<string, string> = {
  en: "en-US",
  uk: "uk-UA",
  es: "es-ES",
  pt: "pt-BR",
  de: "de-DE",
  ja: "ja-JP",
};

function readMute(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistMute(v: boolean) {
  try {
    window.localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* private mode */
  }
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new C({ latencyHint: "interactive" });
    master = ctx.createGain();
    sfx = ctx.createGain();
    sfx.gain.value = 0.85;
    sfx.connect(master);
    master.connect(ctx.destination);
    musicMuted = readMute();
    master.gain.value = 1;
  }
  return ctx;
}

export function armUnlock() {
  if (typeof window === "undefined" || armed) return;
  armed = true;
  musicMuted = readMute();
  const boot = () => unlockAudio();
  window.addEventListener("pointerdown", boot, { capture: true });
  window.addEventListener("touchstart", boot, { capture: true });
  window.addEventListener("keydown", boot, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") unlockAudio();
    else if (!wantMusic) musicEl?.pause();
    else if (musicMuted) musicEl?.pause();
  });
  window.addEventListener("focus", () => unlockAudio());
}

export function unlockAudio() {
  armUnlock();
  const c = ac();
  if (c && c.state === "suspended") void c.resume();
  if (wantMusic && !musicMuted) resumeMusic();
}

function musicSrc(): string {
  return MUSIC_MP3;
}

function ensureMusicEl() {
  if (typeof window === "undefined") return null;
  if (!musicEl) {
    const a = new Audio();
    a.preload = "auto";
    a.loop = true;
    a.volume = 0.2;
    a.muted = musicMuted;
    a.setAttribute("playsinline", "true");
    a.setAttribute("webkit-playsinline", "true");
    a.crossOrigin = "anonymous";
    a.src = MUSIC_MP3;
    a.addEventListener("error", () => {
      if (a.getAttribute("data-fallback") === "1") return;
      a.setAttribute("data-fallback", "1");
      a.src = MUSIC_OGG;
      if (wantMusic && !musicMuted) void a.play().catch(() => {});
    });
    document.body.appendChild(a);
    musicEl = a;
  }
  return musicEl;
}

function resumeMusic() {
  const el = ensureMusicEl();
  if (!el || musicMuted || !wantMusic) return;
  el.muted = false;
  if (el.paused) {
    void el.play().then(() => {
      if (!wantMusic || musicMuted) el.pause();
    }).catch(() => {});
  }
}

export function startMusic() {
  if (typeof window === "undefined") return;
  wantMusic = true;
  unlockAudio();
  if (musicMuted) return;
  resumeMusic();
}

export function stopMusic() {
  wantMusic = false;
  if (musicEl) {
    musicEl.pause();
    try {
      musicEl.currentTime = 0;
    } catch {
      /* some webviews */
    }
  }
}

export function pauseMusic() {
  if (musicEl) musicEl.pause();
}

export function setMuted(v: boolean) {
  musicMuted = v;
  persistMute(v);
  if (!musicEl) {
    if (!v && wantMusic) resumeMusic();
    return;
  }
  musicEl.muted = v;
  if (v) musicEl.pause();
  else if (wantMusic) void musicEl.play().catch(() => {});
}

export function duckMusic(on: boolean) {
  if (!musicEl) return;
  musicEl.volume = on ? 0.07 : 0.2;
}

export function isMuted() {
  if (typeof window !== "undefined" && !armed) musicMuted = readMute();
  return musicMuted;
}

export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

function readVoice(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(VOICE_KEY) !== "0";
  } catch {
    return true;
  }
}

function persistVoice(v: boolean) {
  try {
    window.localStorage.setItem(VOICE_KEY, v ? "1" : "0");
  } catch {
    /* private mode */
  }
}

let voiceOn = true;

export function isVoiceOn() {
  if (typeof window !== "undefined") voiceOn = readVoice();
  return voiceOn;
}

export function setVoiceOn(v: boolean) {
  voiceOn = v;
  persistVoice(v);
  if (!v && typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
}

export function repairAudio(): { ok: boolean; text: string } {
  const wasOff = !isVoiceOn();
  if (wasOff) setVoiceOn(true);
  unlockAudio();
  const c = ac();
  let unstuck = false;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.getVoices();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        unstuck = true;
      }
    } catch {
      /* webview */
    }
  }
  if (!c) return { ok: false, text: "У цьому вікні немає звуку." };
  if (c.state === "suspended") {
    return {
      ok: false,
      text: wasOff
        ? "Голос увімкнув, але браузер ще блокує звук. Натисни кнопку ще раз."
        : "Звук чекає натискання кнопки.",
    };
  }
  if (wasOff && unstuck) return { ok: true, text: "Голос увімкнув і зняв зависання." };
  if (wasOff) return { ok: true, text: "Голос був вимкнений. Увімкнув." };
  if (unstuck) return { ok: true, text: "Зняв зависання голосу." };
  return { ok: true, text: "Голос готовий." };
}

export function toggleVoiceOn(): boolean {
  const next = !isVoiceOn();
  setVoiceOn(next);
  return next;
}

let localGen = 0;
let voiceSrc: AudioBufferSourceNode | null = null;

function stopVoiceBuffer() {
  const src = voiceSrc;
  voiceSrc = null;
  if (!src) return;
  try {
    src.onended = null;
    src.stop();
  } catch {
    /* already stopped */
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Play server TTS (wav/mp3) through the AudioContext unlocked on the user's tap. */
export async function playVoiceB64(b64: string, mime: string, onEnd?: () => void): Promise<boolean> {
  if (!b64 || typeof window === "undefined") return false;
  const gen = localGen;
  const c = ac();
  if (!c) return false;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      return false;
    }
  }
  if (gen !== localGen) return false;
  let audioBuf: AudioBuffer;
  try {
    const bytes = b64ToBytes(b64);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    audioBuf = await c.decodeAudioData(copy);
  } catch {
    return false;
  }
  if (gen !== localGen) return false;
  stopVoiceBuffer();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* webview */
  }
  const src = c.createBufferSource();
  src.buffer = audioBuf;
  src.connect(master!);
  voiceSrc = src;
  src.onended = () => {
    if (voiceSrc === src) voiceSrc = null;
    if (gen === localGen) onEnd?.();
  };
  try {
    src.start();
  } catch {
    voiceSrc = null;
    return false;
  }
  return true;
}

export function stopLocalVoice() {
  localGen += 1;
  stopVoiceBuffer();
  if (typeof window === "undefined") return;
  try {
    (window.SolarchikNative as { hush?: () => void } | undefined)?.hush?.();
  } catch {
    /* native */
  }
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* webview */
  }
}

export function speakLocal(
  text: string,
  locale: string,
  voiceHint = "eve",
  onEnd?: () => void,
): boolean {
  if (!text || !isVoiceOn()) {
    onEnd?.();
    return false;
  }
  const native = typeof window !== "undefined" ? window.SolarchikNative : undefined;
  if (native && typeof (native as { speak?: unknown }).speak === "function") {
    const gen = ++localGen;
    try {
      (native as { speak: (t: string, l: string, v: string) => void }).speak(text, locale, voiceHint);
      const ms = Math.min(9000, 80 * text.split(/\s+/).length + 500);
      window.setTimeout(() => {
        if (gen === localGen) onEnd?.();
      }, ms);
      return true;
    } catch {
      /* device TTS */
    }
  }
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd?.();
    return false;
  }
  const gen = ++localGen;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* webview */
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[locale] || "en-US";
  u.rate = voiceHint === "rex" ? 0.92 : voiceHint === "leo" ? 1.12 : voiceHint === "ara" ? 1.06 : 1.0;
  u.pitch = voiceHint === "rex" ? 0.72 : voiceHint === "leo" ? 0.9 : voiceHint === "ara" ? 1.28 : 1.05;
  const voices = window.speechSynthesis.getVoices();
  const lang = u.lang.slice(0, 2).toLowerCase();
  const gendered =
    voiceHint === "rex" || voiceHint === "leo"
      ? /male|david|arthur|daniel|google uk english male|oleksandr|ivan/i
      : /female|samantha|zira|anna|google uk english female|natasha|lesya|lesja|kalyna|oksana|ukrainian/i;
  const match =
    voices.find((v) => v.lang.toLowerCase().startsWith(lang) && gendered.test(v.name)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(lang)) ||
    voices.find((v) => gendered.test(v.name));
  if (match) u.voice = match;
  const done = () => {
    if (gen === localGen) onEnd?.();
  };
  u.onend = done;
  u.onerror = done;
  window.setTimeout(() => {
    if (gen !== localGen) return;
    try {
      window.speechSynthesis.speak(u);
    } catch {
      done();
      return;
    }
    const kick = window.setInterval(() => {
      if (gen !== localGen) {
        window.clearInterval(kick);
        return;
      }
      try {
        if (!window.speechSynthesis.speaking) {
          window.clearInterval(kick);
          return;
        }
        window.speechSynthesis.resume();
      } catch {
        window.clearInterval(kick);
      }
    }, 2500);
    u.onend = () => {
      window.clearInterval(kick);
      done();
    };
    u.onerror = () => {
      window.clearInterval(kick);
      done();
    };
  }, 120);
  return true;
}

function beep(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
  const c = ac();
  if (!c || !sfx) return;
  if (c.state === "suspended") void c.resume();
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(sfx);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let lastSfx = 0;
const BUSY = new Set(["near", "collect", "land", "grind"]);

export function play(kind: string) {
  if (BUSY.has(kind)) {
    const n = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (n - lastSfx < 55) return;
    lastSfx = n;
  }
  unlockAudio();
  switch (kind) {
    case "start":
      beep(392, 0.1, "triangle", 0.12, 0, 0);
      beep(494, 0.1, "triangle", 0.12, 0, 0.08);
      beep(587, 0.16, "sine", 0.14, 0, 0.16);
      beep(784, 0.22, "sine", 0.12, 40, 0.28);
      break;
    case "jump":
      beep(520, 0.09, "square", 0.16, 180);
      break;
    case "double":
      beep(640, 0.1, "square", 0.17, 240);
      beep(960, 0.08, "triangle", 0.09, 80);
      break;
    case "land":
      beep(140, 0.08, "sine", 0.16, -40);
      beep(90, 0.05, "triangle", 0.07, -20);
      break;
    case "collect":
      beep(880 + Math.random() * 40, 0.07, "triangle", 0.15, 200);
      break;
    case "gold":
      beep(740, 0.06, "triangle", 0.14, 120);
      beep(1180, 0.1, "sine", 0.14, 80);
      break;
    case "combo":
      beep(523, 0.08, "square", 0.12);
      beep(659, 0.1, "square", 0.12, 0, 0.06);
      beep(784, 0.16, "square", 0.14, 0, 0.12);
      beep(1046, 0.18, "triangle", 0.1, 0, 0.2);
      break;
    case "hurt":
      beep(180, 0.2, "sawtooth", 0.2, -90);
      beep(90, 0.16, "square", 0.12, -40);
      break;
    case "dead":
      beep(160, 0.3, "sawtooth", 0.22, -80);
      beep(70, 0.28, "triangle", 0.12, -30);
      break;
    case "tick":
      beep(440, 0.06, "square", 0.12);
      break;
    case "near":
      beep(1240, 0.05, "sine", 0.08);
      break;
    case "stomp":
      beep(180, 0.1, "square", 0.22, -50);
      beep(520, 0.08, "triangle", 0.12, 180);
      beep(90, 0.07, "sawtooth", 0.1, -20);
      break;
    case "shield":
      beep(640, 0.1, "sine", 0.14, 220);
      beep(980, 0.12, "triangle", 0.11);
      break;
    case "slide":
      beep(220, 0.12, "sawtooth", 0.13, -90);
      beep(140, 0.08, "triangle", 0.09, -40);
      break;
    case "grind":
      beep(420, 0.16, "square", 0.12, 260);
      beep(880, 0.12, "triangle", 0.09, 80);
      break;
    case "bonus":
      beep(523, 0.09, "triangle", 0.13);
      beep(659, 0.1, "triangle", 0.13, 0, 0.07);
      beep(784, 0.12, "sine", 0.15, 0, 0.14);
      beep(1046, 0.2, "sine", 0.12, 0, 0.22);
      break;
    case "thunder":
      beep(70, 0.28, "sawtooth", 0.2, -20);
      beep(42, 0.34, "triangle", 0.15, -10);
      break;
    case "boss":
      beep(110, 0.22, "sawtooth", 0.18, -30);
      beep(330, 0.18, "square", 0.1, 40);
      beep(880, 0.12, "triangle", 0.09);
      break;
    case "chapter":
      beep(392, 0.08, "triangle", 0.12);
      beep(523, 0.1, "triangle", 0.13, 0, 0.07);
      beep(784, 0.16, "sine", 0.14, 0, 0.14);
      break;
    default:
      break;
  }
}
