import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Mic } from "lucide-react";
import type { Locale, TFunc } from "@/lib/game/i18n";
import { cleanSpeech, isPetVoice, type PetVibe, type PetVoice } from "@/lib/game/pet";
import { liveAsk, liveHear, liveSpeak, canNativeListen, nativeListen, nativeStopListen } from "@/lib/game/buddyNet";
import { duckMusic, isVoiceOn, play, playVoiceB64, speakLocal, stopLocalVoice, unlockAudio } from "@/lib/game/audio";
import { eventToBanter, pickBanter, periodicKind, runContext, scriptedBanter, type BanterKind } from "@/lib/game/runBanter";
import type { Ev, RunState } from "@/lib/game/sim";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((ev: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const SPEECH_LANG: Record<string, string> = {
  en: "en-US",
  uk: "uk-UA",
  es: "es-ES",
  pt: "pt-BR",
  de: "de-DE",
  ja: "ja-JP",
};

type Props = {
  locale: Locale;
  name: string;
  vibe: PetVibe;
  voice: PetVoice | "";
  history: { role: "user" | "buddy"; text: string }[];
  t: TFunc;
  paused: boolean;
  live: boolean;
  playerId?: string;
  bind: MutableRefObject<{ push: (events: Ev[], state: RunState) => void } | null>;
};

export function RunRadio({ locale, name, vibe, voice, history, t, paused, live, playerId, bind }: Props) {
  const [caption, setCaption] = useState("");
  const [listening, setListening] = useState(false);
  const speakGen = useRef(0);
  const lastBanter = useRef(0);
  const talking = useRef(false);
  const listeningRef = useRef(false);
  const chatOpen = useRef(false);
  const chatTurn = useRef(0);
  const banterAfter = useRef(0);
  const started = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const srRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const heardRef = useRef("");
  const listenGen = useRef(0);
  const micTapAt = useRef(0);
  const captionTimer = useRef(0);
  const stateRef = useRef<RunState | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const pausedLive = useRef(paused);
  pausedLive.current = paused;
  const historyRef = useRef(history);
  historyRef.current = history;
  const tRef = useRef(t);
  tRef.current = t;
  const voiceOf = (): PetVoice => (isPetVoice(voice) ? voice : "eve");

  const show = (text: string) => {
    setCaption(text);
    window.clearTimeout(captionTimer.current);
    captionTimer.current = window.setTimeout(() => setCaption(""), 4200);
  };

  const hush = () => {
    speakGen.current += 1;
    talking.current = false;
    duckMusic(false);
    try {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.src = "";
      }
    } catch {
      /* webview */
    }
    audioRef.current = null;
    stopLocalVoice();
  };

  const speak = (text: string) => {
    const spoken = cleanSpeech(text);
    if (!spoken) return Promise.resolve();
    hush();
    const gen = speakGen.current;
    talking.current = true;
    duckMusic(true);
    show(spoken);
    return new Promise<void>((resolve) => {
      const done = () => {
        if (gen === speakGen.current) {
          talking.current = false;
          duckMusic(false);
        }
        resolve();
      };
      if (!isVoiceOn()) {
        window.setTimeout(done, Math.min(1800, 55 * spoken.split(/\s+/).length + 400));
        return;
      }
      void (async () => {
        try {
          const clip = await liveSpeak(spoken, voiceOf(), locale);
          if (gen !== speakGen.current) {
            done();
            return;
          }
          if (clip.ok && (await playVoiceB64(clip.audio, clip.mime, done))) return;
        } catch {
          /* browser voice */
        }
        if (gen !== speakGen.current) {
          done();
          return;
        }
        if (!speakLocal(spoken, locale, voiceOf(), done)) done();
      })();
    });
  };

  const inPlayerChat = () => chatOpen.current || Date.now() < banterAfter.current;

  const endChat = (turn: number, cooldown = true) => {
    if (turn !== chatTurn.current) return;
    chatOpen.current = false;
    if (cooldown) {
      banterAfter.current = Date.now() + 30000;
      lastBanter.current = Date.now();
    }
  };

  const liveLine = async (cue: string, fallback: BanterKind, state: RunState) => {
    if (!liveRef.current || pausedLive.current || listeningRef.current || inPlayerChat()) return;
    if (talking.current && fallback !== "dead") return;
    lastBanter.current = Date.now();
    try {
      const res = await liveAsk({
        name,
        vibe,
        stage: "runner",
        emotion: "excited",
        locale,
        charge: 80,
        mood: 90,
        rest: 80,
        shine: 80,
        careDays: 1,
        history: historyRef.current,
        message: cue,
        scene: "run",
        context: runContext(state),
        playerId,
      });
      if (inPlayerChat()) return;
      if (res.ok && res.text) {
        void speak(res.text);
        return;
      }
    } catch {
      /* fallback */
    }
    if (inPlayerChat()) return;
    const line = pickBanter(fallback, locale, vibe, state.chapter);
    if (line) void speak(line);
  };

  const banter = (kind: BanterKind, state: RunState) => {
    if (!liveRef.current || pausedLive.current || listeningRef.current || inPlayerChat()) return;
    const now = Date.now();
    if (kind !== "go" && kind !== "dead" && now - lastBanter.current < 32000) return;
    if (talking.current && kind !== "dead") return;
    const cue =
      kind === "go"
        ? "The roof run just started. One short spoken cheer in your usual voice."
        : kind === "dead"
          ? "We just fell off. One short spoken line, same as in chat."
          : `Run update: ${runContext(state)}. One short spoken line in your usual voice.`;
    void liveLine(cue, kind, state);
  };

  useEffect(() => {
    bind.current = {
      push: (events, state) => {
        stateRef.current = state;
        const lineKey = scriptedBanter(state, events);
        if (lineKey) show(tRef.current(lineKey));
        if (state.phase === "running" && !started.current) {
          started.current = true;
          banter("go", state);
        }
        for (const ev of events) {
          if (lineKey && ev === "dead") continue;
          const kind = eventToBanter(ev);
          if (kind) banter(kind, state);
        }
      },
    };
    return () => {
      bind.current = null;
    };
    // push reads refs; rebinding every HUD frame dropped comments
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bind]);

  useEffect(() => {
    if (!live || paused) return;
    const id = window.setInterval(() => {
      const s = stateRef.current;
      if (!s || s.phase !== "running") return;
      banter(periodicKind(s), s);
    }, 35000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, paused]);

  useEffect(() => {
    return () => {
      hush();
      window.clearTimeout(captionTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListen = async () => {
    listenGen.current += 1;
    listeningRef.current = false;
    setListening(false);
    const rec = recRef.current;
    recRef.current = null;
    const sr = srRef.current;
    srRef.current = null;
    const heard = heardRef.current.trim();
    heardRef.current = "";
    if (canNativeListen()) {
      nativeStopListen();
      if (heard) void ask(heard);
      else endChat(chatTurn.current, false);
      return;
    }
    if (sr) {
      try {
        sr.stop();
      } catch {
        try {
          sr.abort?.();
        } catch {
          /* ended */
        }
      }
    }
    if (rec && rec.state !== "inactive") {
      rec.stop();
      return;
    }
    if (heard) void ask(heard);
    else endChat(chatTurn.current, false);
  };

  const ask = async (text: string) => {
    const turn = chatTurn.current;
    chatOpen.current = true;
    show(text);
    play("tick");
    try {
      const res = await liveAsk({
        name,
        vibe,
        stage: "runner",
        emotion: "excited",
        locale,
        charge: 80,
        mood: 90,
        rest: 80,
        shine: 80,
        careDays: 1,
        history: historyRef.current,
        message: text,
        scene: "run",
        context: stateRef.current ? runContext(stateRef.current) : "",
      });
      if (turn !== chatTurn.current) return;
      if (res.ok && res.text) await speak(res.text);
    } catch {
      play("hurt");
    }
    endChat(turn);
  };

  const startRecorder = async () => {
    const gen = listenGen.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (gen !== listenGen.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        recRef.current = null;
        listeningRef.current = false;
        setListening(false);
        const spoken = heardRef.current.trim();
        heardRef.current = "";
        if (spoken) {
          void ask(spoken);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 800) {
          endChat(chatTurn.current, false);
          return;
        }
        try {
          const b64 = await blobToB64(blob);
          const heard = await liveHear(b64, blob.type || "audio/webm");
          if (heard.ok && heard.text) void ask(heard.text);
          else endChat(chatTurn.current, false);
        } catch {
          endChat(chatTurn.current, false);
        }
      };
      recRef.current = rec;
      rec.start(200);
      window.setTimeout(() => {
        if (recRef.current === rec) void stopListen();
      }, 5000);
    } catch {
      window.setTimeout(() => {
        if (srRef.current) void stopListen();
      }, 5000);
    }
  };

  const startListen = () => {
    if (paused || !live || listeningRef.current) return;
    unlockAudio();
    chatTurn.current += 1;
    chatOpen.current = true;
    hush();
    heardRef.current = "";
    listenGen.current += 1;
    const listenId = listenGen.current;
    listeningRef.current = true;
    setListening(true);
    show(t("run.listening"));
    play("tick");
    if (canNativeListen()) {
      void nativeListen(locale)
        .then((text) => {
          if (listenId !== listenGen.current) return;
          listeningRef.current = false;
          setListening(false);
          if (text) void ask(text);
          else endChat(chatTurn.current, false);
        })
        .catch(() => {
          if (listenId !== listenGen.current) return;
          listeningRef.current = false;
          setListening(false);
          endChat(chatTurn.current, false);
        });
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (SR) {
      try {
        const r = new SR();
        r.lang = SPEECH_LANG[locale] || "en-US";
        r.interimResults = true;
        r.continuous = true;
        r.maxAlternatives = 1;
        r.onresult = (ev) => {
          const last = ev.results[ev.results.length - 1];
          const text = String(last?.[0]?.transcript || "").trim();
          if (text) heardRef.current = text;
        };
        r.onerror = () => {
          if (srRef.current === r) srRef.current = null;
        };
        r.onend = () => {
          if (srRef.current === r) srRef.current = null;
        };
        srRef.current = r;
        r.start();
        window.setTimeout(() => {
          if (srRef.current === r) void stopListen();
        }, 5000);
        return;
      } catch {
        /* recorder fallback */
      }
    }
    void startRecorder();
  };

  return (
    <>
      {caption && (
        <div className="pointer-events-none absolute bottom-[max(4.4rem,calc(env(safe-area-inset-bottom)+3.4rem))] left-[4.4rem] z-10 flex max-w-[15rem] items-end gap-1.5">
          <img
            src="/sprites/pet/buddy-talk-3.png?v=2"
            alt=""
            className="h-9 w-8 shrink-0 object-contain object-bottom"
          />
          <span className="rounded-2xl bg-bg/80 px-2.5 py-1.5 text-left text-xs font-semibold leading-snug text-fg backdrop-blur-[2px]">
            {caption}
          </span>
        </div>
      )}
      {live && !paused && (
        <button
          type="button"
          className={
            "absolute bottom-[max(4.2rem,calc(env(safe-area-inset-bottom)+3.2rem))] left-3 z-30 grid size-14 place-items-center rounded-full text-primary-fg " +
            (listening ? "bg-danger pet-mic" : "bg-primary")
          }
          onPointerDown={(e) => {
            e.stopPropagation();
            const now = Date.now();
            if (now - micTapAt.current < 350) return;
            micTapAt.current = now;
            if (listeningRef.current) void stopListen();
            else startListen();
          }}
          aria-label={listening ? t("run.talk.stop") : t("run.talk")}
        >
          <Mic className="size-6" />
        </button>
      )}
    </>
  );
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const s = String(reader.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.readAsDataURL(blob);
  });
}
