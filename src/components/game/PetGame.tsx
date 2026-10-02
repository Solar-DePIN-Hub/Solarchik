import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Mic, Phone, Send, Volume2, VolumeX } from "lucide-react";
import type { SaveData } from "@/lib/game/save";
import { todayKey } from "@/lib/game/save";
import {
  VIBES,
  VOICES,
  canChat,
  cleanChat,
  cleanName,
  cleanSpeech,
  emotionOf,
  isPetVoice,
  petAgeDays,
  stageOf,
  type PetEmotion,
  type PetVibe,
  type PetVoice,
} from "@/lib/game/pet";
import { liveAsk, liveHear, liveSpeak, canNativeListen, nativeListen, nativeStopListen } from "@/lib/game/buddyNet";
import { errKey, failOf } from "@/lib/game/netErr";
import type { Locale, MsgKey, TFunc } from "@/lib/game/i18n";
import { play, unlockAudio, speakLocal, stopLocalVoice, isVoiceOn, setVoiceOn, playVoiceB64 } from "@/lib/game/audio";
import { ReportCard, SecretaryDesk } from "./SecretaryDesk";
import type { SecretaryReport } from "@/lib/game/secretary";
import { ACT_TEXT, actLang, linkParts, looksLikeCommand, planAction, readyText, statusText, type ActLang, type ActPlan } from "@/lib/game/sol-act-plan";
import type { Loaded } from "@/lib/game/sol-act-web";
import { SolActCard } from "./SolActCard";

type Props = {
  save: SaveData;
  t: TFunc;
  now?: number;
  onBack: () => void;
  onSetup: (name: string, vibe: PetVibe, voice: PetVoice) => void;
  onPoke?: () => boolean;
  onChat: (user: string, buddy: string) => void;
  onSecretary: (user: string, buddy: string, report: SecretaryReport) => void;
  onSecretaryRead: (id: string) => void;
  onSecretaryArchive: (id: string) => void;
  onAddContact: (name: string) => void;
  onDropContact: (id: string) => void;
  onPower: (on: boolean) => void;
  onSecNumber: (raw: string) => void;
  onRedirect: (on: boolean) => void;
  onFwdCountry: (id: string) => void;
  onImportBook: (names: string[]) => number;
  onPend: (ref: string, usd: number) => void;
  onPaid: (sig: string, from: string, ref: string, usd: number) => void;
  onWallet: (address: string) => void;
  onWork: () => void;
};

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

export function PetGame({ save, t, now: nowProp, onBack, onSetup, onChat, onSecretary, onSecretaryRead, onSecretaryArchive, onAddContact, onDropContact, onPower, onSecNumber, onRedirect, onFwdCountry, onImportBook, onPend, onPaid, onWallet, onWork }: Props) {
  const [clock, setClock] = useState(() => Date.now());
  const now = nowProp ?? clock;
  useEffect(() => {
    if (nowProp) return;
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [nowProp]);

  const pet = save.pet;
  const stage = stageOf(pet);
  const age = petAgeDays(pet, now);
  const emotion = emotionOf(pet, now);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState("");
  const [chatNote, setChatNote] = useState("");
  const [holding, setHolding] = useState(false);
  const [talking, setTalking] = useState(false);
  const [voiceOn, setVoiceUi] = useState(isVoiceOn);
  const [deskOpen, setDeskOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(Boolean(save.secretary));
  /** Sol's pending action: shown as a card; nothing runs until Confirm. */
  const [act, setAct] = useState<{ plan: ActPlan; loaded: Loaded; lang: ActLang } | null>(null);
  const [actBusy, setActBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const srRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const heardRef = useRef("");
  const listenGen = useRef(0);
  const micTapAt = useRef(0);
  const speakGen = useRef(0);
  const sendingRef = useRef(false);
  const holdingRef = useRef(false);

  const SPEECH_LANG: Record<string, string> = {
    en: "en-US",
    uk: "uk-UA",
    es: "es-ES",
    pt: "pt-BR",
    de: "de-DE",
    ja: "ja-JP",
  };

  useEffect(() => {
    const frames = [
      ...[1, 2, 3, 4].map((n) => `/sprites/pet/buddy-idle-${n}.png?v=2`),
      ...[1, 2, 3, 4].map((n) => `/sprites/pet/buddy-talk-${n}.png?v=2`),
      "/sprites/pet/buddy-happy.png?v=2",
      "/sprites/pet/buddy-sleepy.png?v=2",
      "/sprites/pet/buddy-think.png?v=2",
    ];
    for (const src of frames) {
      const img = new Image();
      img.src = src;
    }
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [pet.chat.length, sending, pending]);

  useEffect(() => {
    return () => {
      speakGen.current += 1;
      stopLocalVoice();
      try {
        audioRef.current?.pause();
      } catch {
        /* unmount */
      }
    };
  }, []);

  const voiceOf = (): PetVoice => (isPetVoice(pet.voice) ? pet.voice : "eve");

  const hush = () => {
    speakGen.current += 1;
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

  const speak = async (text: string) => {
    const spoken = cleanSpeech(text);
    if (!spoken) return;
    hush();
    const gen = speakGen.current;
    unlockAudio();
    setTalking(true);
    const done = () => {
      if (gen === speakGen.current) setTalking(false);
    };
    if (!isVoiceOn()) {
      window.setTimeout(done, Math.min(1800, 55 * spoken.split(/\s+/).length + 400));
      return;
    }
    try {
      const clip = await liveSpeak(spoken, voiceOf(), save.locale);
      if (gen !== speakGen.current) return;
      if (clip.ok && (await playVoiceB64(clip.audio, clip.mime, done)) && gen === speakGen.current) return;
    } catch {
      /* browser voice */
    }
    if (gen !== speakGen.current) return;
    if (!speakLocal(spoken, save.locale, voiceOf(), done)) done();
  };

  /** Request → ONE proposed action → confirmation card. False = not an action, carry on with plain chat. */
  const proposeAct = async (clean: string): Promise<boolean> => {
    const lang = actLang(save.locale);
    let loaded: Loaded;
    let ask: Awaited<ReturnType<typeof import("@/lib/game/sol-act-web").askAct>>;
    try {
      const web = await import("@/lib/game/sol-act-web");
      loaded = await web.loadActContext();
      ask = await web.askAct(clean, lang, loaded.ctx, pet.chat.slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "model", text: m.text })));
    } catch (e) {
      console.warn("[sol-act] context", e);
      return false;
    }
    if (!ask.action) return false;
    if (ask.action.type === "agent_status") {
      const text = statusText(ask.action.agent ?? "", loaded.ctx, loaded.side, lang);
      onChat(clean, text);
      play("collect");
      void speak(text);
      return true;
    }
    const plan = planAction(ask.action, loaded.ctx, loaded.side, lang);
    const say = plan.blocked ? readyText(plan, lang) : ask.reply || readyText(plan, lang);
    onChat(clean, say);
    play("collect");
    void speak(say);
    setAct({ plan, loaded, lang });
    return true;
  };

  const confirmAct = async () => {
    if (!act || actBusy) return;
    setActBusy(true);
    play("tick");
    try {
      const { executePlan } = await import("@/lib/game/sol-act-web");
      const r = await executePlan(act.plan, act.loaded, act.lang);
      const text = r.link ? `${r.text} ${r.link}` : r.text;
      onChat(ACT_TEXT[act.lang].confirm, text);
      play(r.ok ? "collect" : "hurt");
      void speak(r.text);
    } finally {
      setActBusy(false);
      setAct(null);
    }
  };

  const cancelAct = () => {
    if (!act || actBusy) return;
    onChat(ACT_TEXT[act.lang].cancel, ACT_TEXT[act.lang].cancelled);
    play("tick");
    setAct(null);
  };

  const sendText = async (text: string) => {
    const clean = cleanChat(text);
    if (!clean || sendingRef.current) return;
    const gate = canChat(pet, Date.now(), todayKey());
    if (gate === "wait") {
      setChatNote(t("pet.chat.wait"));
      return;
    }
    if (gate === "setup") {
      setChatNote(t("pet.chat.sleep"));
      return;
    }
    sendingRef.current = true;
    unlockAudio();
    play("tick");
    setDraft("");
    setPending(clean);
    setSending(true);
    setChatNote("");
    try {
      if (!act && looksLikeCommand(clean) && (await proposeAct(clean))) return;
      const res = await liveAsk({
        name: pet.name,
        vibe: pet.vibe,
        stage,
        emotion,
        locale: save.locale,
        charge: pet.charge,
        mood: pet.mood,
        rest: pet.rest,
        shine: pet.shine,
        careDays: pet.careDays,
        history: pet.chat.slice(-8).map((m) => ({ role: m.role, text: m.text })),
        message: clean,
        playerId: save.playerId,
      });
      if (res.ok && res.text) {
        onChat(clean, res.text);
        play("collect");
        if (res.offline) setChatNote(t("pet.chat.offline"));
        else void speak(res.text);
      } else {
        setChatNote(t(errKey(!res.ok ? res.error : "bad")));
        play("hurt");
      }
    } catch (e) {
      setChatNote(t(errKey(failOf(e))));
      play("hurt");
    } finally {
      sendingRef.current = false;
      setSending(false);
      setPending("");
    }
  };

  const stopTalk = async () => {
    listenGen.current += 1;
    const rec = recRef.current;
    recRef.current = null;
    const sr = srRef.current;
    srRef.current = null;
    holdingRef.current = false;
    setHolding(false);
    const heard = heardRef.current.trim();
    heardRef.current = "";
    if (canNativeListen()) {
      nativeStopListen();
      return;
    }
    if (sr) {
      try {
        sr.stop();
      } catch {
        try {
          sr.abort?.();
        } catch {
          /* already ended */
        }
      }
    }
    if (rec && rec.state !== "inactive") {
      rec.stop();
      return;
    }
    if (heard) void sendText(heard);
  };

  const startRecorder = async () => {
    unlockAudio();
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
        setHolding(false);
        const spoken = heardRef.current.trim();
        heardRef.current = "";
        if (spoken) {
          void sendText(spoken);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 800) {
          setChatNote(t("pet.talk.short"));
          play("hurt");
          return;
        }
        setSending(true);
        setChatNote(t("pet.chat.wait"));
        try {
          const b64 = await blobToB64(blob);
          const heard = await liveHear(b64, blob.type || "audio/webm");
          if (!heard.ok || !heard.text) {
            setChatNote(t("pet.talk.short"));
            play("hurt");
            setSending(false);
            return;
          }
          setSending(false);
          await sendText(heard.text);
        } catch {
          setChatNote(t("pet.talk.needMic"));
          setSending(false);
        }
      };
      recRef.current = rec;
      rec.start(200);
      setHolding(true);
      setChatNote(t("pet.talk.listening"));
      window.setTimeout(() => {
        if (recRef.current === rec) void stopTalk();
      }, 8000);
    } catch (e) {
      holdingRef.current = false;
      if (srRef.current) {
        setHolding(true);
        setChatNote(t("pet.talk.listening"));
        window.setTimeout(() => {
          if (srRef.current) void stopTalk();
        }, 8000);
      } else {
        setHolding(false);
        setChatNote(t(failOf(e) === "denied" ? "pet.talk.needMic" : "pet.talk.type"));
        play("tick");
        inputRef.current?.focus();
      }
    }
  };

  const toggleTalk = () => {
    if (sendingRef.current) return;
    if (holdingRef.current || recRef.current || srRef.current) {
      void stopTalk();
      return;
    }
    unlockAudio();
    holdingRef.current = true;
    setHolding(true);
    setChatNote(t("pet.talk.listening"));
    play("tick");
    heardRef.current = "";
    const gen = ++listenGen.current;
    if (canNativeListen()) {
      void nativeListen(save.locale)
        .then((text) => {
          if (gen !== listenGen.current) return;
          holdingRef.current = false;
          setHolding(false);
          if (text) void sendText(text);
          else setChatNote(t("pet.talk.short"));
        })
        .catch(() => {
          if (gen !== listenGen.current) return;
          holdingRef.current = false;
          setHolding(false);
          setChatNote(t("pet.talk.needMic"));
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
        r.lang = SPEECH_LANG[save.locale] || "en-US";
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
          if (listenGen.current === gen && srRef.current === r) void stopTalk();
        }, 8000);
        return;
      } catch {
        /* recorder fallback */
      }
    }
    void startRecorder();
  };

  const hour = new Date(now).getHours();
  const nightRoom = hour < 6 || hour >= 20 || pet.sleeping;

  if (!pet.setupDone) {
    return <SetupRoom t={t} locale={save.locale} onBack={onBack} onSetup={onSetup} />;
  }
  if (!isPetVoice(pet.voice)) {
    return (
      <VoicePick
        t={t}
        locale={save.locale}
        name={pet.name}
        onBack={onBack}
        onPick={(voice) => onSetup(pet.name, pet.vibe, voice)}
      />
    );
  }

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-bg text-fg">
      <img
        src="/sprites/pet/room.jpg?v=8"
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[50%_62%]"
      />
      <div className={"pointer-events-none absolute inset-0 " + (nightRoom ? "bg-bg/50" : "bg-bg/10")} />
      <div className="pet-vignette pointer-events-none absolute inset-0" />

      <SecretaryDesk
        open={deskOpen}
        locale={save.locale}
        t={t}
        playerId={save.playerId}
        inbox={save.secretaryInbox}
        book={save.phonebook}
        secretaryOn={save.secretaryOn}
        secNumber={save.secNumber}
        redirectOn={save.redirectOn}
        fwdCountry={save.fwdCountry}
        onClose={() => setDeskOpen(false)}
        onDone={(user, reply, report) => {
          onSecretary(user, reply, report);
          setCardOpen(true);
          void speak(reply);
        }}
        onRead={onSecretaryRead}
        onArchive={onSecretaryArchive}
        onAddContact={onAddContact}
        onDropContact={onDropContact}
        onPower={onPower}
        onNumber={onSecNumber}
        onRedirect={onRedirect}
        onCountry={onFwdCountry}
        onImport={onImportBook}
        live={save.secLive}
        credit={save.secCredit}
        paySigs={save.secPaySigs}
        playerWallet={save.playerWallet}
        pending={save.secPending}
        onPend={onPend}
        onPaid={onPaid}
        onWallet={onWallet}
      />

      <header className="relative z-20 flex items-center justify-between gap-2 px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          className="grid size-11 place-items-center rounded-full bg-bg/65 text-fg"
          aria-label={t("pet.back")}
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 rounded-full bg-bg/65 px-3 py-1.5 text-center">
          <p className="truncate font-display text-sm font-semibold leading-tight">{pet.name}</p>
          <p className="text-xs font-semibold tracking-wide text-primary">{t("pet.age", { n: age })}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !isVoiceOn();
            setVoiceOn(next);
            setVoiceUi(next);
            if (!next) hush();
            play("tick");
          }}
          className={
            "flex h-11 max-w-[9.5rem] items-center gap-1.5 rounded-full px-3 text-xs font-semibold " +
            (voiceOn ? "bg-primary text-primary-fg" : "bg-bg/65 text-fg")
          }
          aria-label={voiceOn ? t("pet.voice.on") : t("pet.voice.off")}
        >
          {voiceOn ? <Volume2 className="size-4 shrink-0" /> : <VolumeX className="size-4 shrink-0" />}
          <span className="truncate">{voiceOn ? t("pet.voice.on") : t("pet.voice.off")}</span>
        </button>
      </header>

      <ReportCard report={save.secretary} t={t} open={cardOpen} onToggle={() => setCardOpen((v) => !v)} />

      <div className="pointer-events-none relative z-10 mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col px-4">
        <div className="relative flex min-h-0 w-full flex-[1.05] items-end justify-center">
          {!deskOpen && (
            <div className="relative z-10 mb-[2%]">
              <BuddyFigure talking={talking} thinking={sending} emotion={emotion} />
            </div>
          )}
        </div>
        <div ref={threadRef} className="pointer-events-auto relative z-20 mb-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-2">
          {pet.chat.length === 0 && !sending && !pending && (
            <p className="py-4 text-center text-sm text-muted">{t("pet.chat.empty")}</p>
          )}
          {pet.chat.map((m, i) => (
            <p
              key={`${m.at}-${i}`}
              className={
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug " +
                (m.role === "user" ? "ml-auto bg-primary text-primary-fg" : "bg-bg/75 text-fg")
              }
            >
              {m.role === "user"
                ? m.text
                : linkParts(m.text).map((part, j) =>
                    part.href ? (
                      <a key={j} href={part.href} target="_blank" rel="noreferrer" className="block break-all font-semibold text-primary underline" data-testid="sol-act-explorer">
                        {ACT_TEXT[actLang(save.locale)].explorer}
                      </a>
                    ) : (
                      <span key={j}>{part.text}</span>
                    ),
                  )}
            </p>
          ))}
          {pending && (
            <p className="ml-auto max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm leading-snug text-primary-fg">{pending}</p>
          )}
          {sending && <p className="max-w-[85%] rounded-2xl bg-bg/75 px-3 py-2 text-sm text-muted">{t("pet.chat.wait")}</p>}
        </div>
      </div>

      {!deskOpen && (
        <button
          type="button"
          className="pet-work-btn"
          data-testid="pet-work"
          onPointerDown={(e) => {
            e.stopPropagation();
            play("tick");
          }}
          onClick={(e) => {
            e.stopPropagation();
            onWork();
          }}
        >
          {t("pet.work")}
        </button>
      )}

      {!deskOpen && (
        <button
          type="button"
          onPointerDown={(e) => {
            e.stopPropagation();
            setDeskOpen(true);
            play("tick");
          }}
          onClick={(e) => {
            e.stopPropagation();
            setDeskOpen(true);
          }}
          className="pet-booth-phone"
          aria-label={t("pet.sec")}
        >
          <Phone className="size-9" />
        </button>
      )}

      <div className="pet-dock relative z-20 px-4 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2">
        {act && (
          <SolActCard plan={act.plan} lang={act.lang} busy={actBusy} onConfirm={() => void confirmAct()} onCancel={cancelAct} />
        )}
        <p className="mb-2 text-center text-xs font-semibold text-muted">
          {holding ? t("pet.talk.listening") : chatNote || t("pet.talk.tap")}
        </p>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void sendText(draft);
          }}
        >
          <button
            type="button"
            disabled={sending}
            onPointerDown={(e) => {
              e.stopPropagation();
              const now = Date.now();
              if (now - micTapAt.current < 350) return;
              micTapAt.current = now;
              if (!holdingRef.current) toggleTalk();
              else void stopTalk();
            }}
            className={
              "grid size-12 shrink-0 place-items-center rounded-full text-primary-fg disabled:opacity-40 " +
              (holding ? "bg-danger pet-mic" : "bg-primary")
            }
            aria-label={holding ? t("pet.talk.stop") : t("pet.talk")}
          >
            <Mic className="size-5" />
          </button>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={240}
            placeholder={t("pet.chat.ph")}
            aria-label={t("pet.chat.ph")}
            className="h-12 min-w-0 flex-1 rounded-full border border-border bg-elevated px-4 text-sm text-fg outline-none placeholder:text-subtle"
          />
          <button
            type="submit"
            disabled={sending || !cleanChat(draft)}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-fg disabled:opacity-40"
            aria-label={t("pet.chat.send")}
          >
            <Send className="size-5" />
          </button>
        </form>
      </div>
    </div>
  );
}

function BuddyFigure({ talking, thinking, emotion }: { talking: boolean; thinking: boolean; emotion: PetEmotion }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ms = talking ? 90 : 380;
    const id = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [talking]);
  const v = "v=2";
  let src = `/sprites/pet/buddy-idle-1.png?${v}`;
  let cls = "farm-bob";
  if (talking) {
    const lips = [1, 2, 3, 4, 3, 2];
    src = `/sprites/pet/buddy-talk-${lips[tick % lips.length]}.png?${v}`;
    cls = "pet-talk";
  } else if (thinking) {
    src = `/sprites/pet/buddy-think.png?${v}`;
    cls = "pet-think";
  } else if (emotion === "sleepy") {
    src = `/sprites/pet/buddy-sleepy.png?${v}`;
    cls = "pet-droop";
  } else if (emotion === "excited" || emotion === "proud" || emotion === "happy") {
    src = `/sprites/pet/buddy-happy.png?${v}`;
    cls = "pet-hype";
  } else {
    const cycle = [1, 2, 1, 3, 1, 1, 4, 1, 2, 1];
    src = `/sprites/pet/buddy-idle-${cycle[tick % cycle.length]}.png?${v}`;
  }
  return (
    <div className={"relative h-52 w-40 sm:h-60 sm:w-48 " + cls}>
      <img src={src} alt="" draggable={false} className="h-full w-full object-contain object-bottom select-none" />
    </div>
  );
}

function PetFrame({
  night,
  overlay,
  dim,
  children,
}: {
  night?: boolean;
  dim?: boolean;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="pet-shell">
      <div className="pet-stage">
        <img
          src="/sprites/pet/room.jpg?v=8"
          alt=""
          draggable={false}
          className="pet-room pointer-events-none"
        />
        <div
          className={
            "pointer-events-none absolute inset-0 " + (dim ? "bg-bg/55" : night ? "bg-bg/40" : "bg-bg/8")
          }
        />
        <div className="pet-vignette pointer-events-none absolute inset-0" />
        {children}
      </div>
      {overlay}
    </div>
  );
}

function SetupRoom({
  t,
  locale,
  onBack,
  onSetup,
}: {
  t: TFunc;
  locale: Locale;
  onBack: () => void;
  onSetup: (name: string, vibe: PetVibe, voice: PetVoice) => void;
}) {
  const [name, setName] = useState("");
  const [vibe, setVibe] = useState<PetVibe>("sunny");
  const [voice, setVoice] = useState<PetVoice>("eve");
  const [err, setErr] = useState(false);
  const go = () => {
    const n = cleanName(name);
    if (!n) {
      setErr(true);
      play("hurt");
      return;
    }
    unlockAudio();
    play("bonus");
    onSetup(n, vibe, voice);
  };
  return (
    <PetFrame dim>
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-[max(0.45rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          className="grid size-10 place-items-center rounded-full bg-bg/70"
          aria-label={t("pet.back")}
        >
          <ArrowLeft className="size-5" />
        </button>
        <p className="font-display text-base font-semibold">{t("pet.setup.title")}</p>
        <span className="size-10" />
      </header>
      <div className="absolute inset-x-0 bottom-0 top-14 z-10 flex flex-col items-center overflow-y-auto px-4 pb-4">
        <div className="relative mt-3 h-32 w-24 farm-bob">
          <img src="/sprites/pet/buddy-idle-1.png?v=2" alt="" draggable={false} className="h-full w-full object-contain object-bottom" />
        </div>
        <p className="mt-2 max-w-[36ch] text-center text-sm text-muted">{t("pet.setup.blurb")}</p>
        <label className="mt-3 w-full text-xs font-semibold tracking-wide text-primary">
          {t("pet.setup.name")}
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErr(false);
            }}
            maxLength={16}
            placeholder={t("pet.setup.namePh")}
            className="mt-1.5 h-12 w-full rounded-2xl border border-border bg-elevated px-3 font-display text-lg font-semibold text-fg outline-none placeholder:text-subtle"
            autoComplete="off"
            autoCapitalize="words"
          />
        </label>
        {err && <p className="mt-1 text-xs font-semibold text-danger">{t("pet.setup.needName")}</p>}
        <p className="mt-3 w-full text-xs font-semibold tracking-wide text-primary">{t("pet.setup.vibe")}</p>
        <div className="mt-2 grid w-full grid-cols-2 gap-2">
          {VIBES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setVibe(id)}
              className={"rounded-2xl px-3 py-2 text-left " + (vibe === id ? "bg-primary text-primary-fg" : "bg-elevated text-fg")}
            >
              <span className="block font-display text-sm font-semibold">{t(`pet.setup.vibe.${id}` as MsgKey)}</span>
              <span className={"mt-0.5 block text-xs " + (vibe === id ? "text-primary-fg/80" : "text-muted")}>
                {t(`pet.setup.vibe.${id}Blurb` as MsgKey)}
              </span>
            </button>
          ))}
        </div>
        <VoiceGrid t={t} locale={locale} name={cleanName(name) || t("pet.setup.namePh")} voice={voice} onPick={setVoice} />
        <button
          type="button"
          onClick={go}
          className="mt-4 h-12 w-full rounded-full bg-primary font-display text-base font-semibold text-primary-fg"
        >
          {t("pet.setup.go")}
        </button>
      </div>
    </PetFrame>
  );
}

function VoicePick({
  t,
  locale,
  name,
  onBack,
  onPick,
}: {
  t: TFunc;
  locale: Locale;
  name: string;
  onBack: () => void;
  onPick: (voice: PetVoice) => void;
}) {
  const [voice, setVoice] = useState<PetVoice>("eve");
  return (
    <PetFrame dim>
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-[max(0.45rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onBack} className="grid size-10 place-items-center rounded-full bg-bg/70" aria-label={t("pet.back")}>
          <ArrowLeft className="size-5" />
        </button>
        <p className="font-display text-base font-semibold">{t("pet.setup.voice")}</p>
        <span className="size-10" />
      </header>
      <div className="absolute inset-x-0 bottom-0 top-14 z-10 flex flex-col items-center overflow-y-auto px-4 pb-4">
        <div className="relative mt-4 h-32 w-24 farm-bob">
          <img src="/sprites/pet/buddy-idle-1.png?v=2" alt="" draggable={false} className="h-full w-full object-contain object-bottom" />
        </div>
        <p className="mt-3 font-display text-lg font-semibold">{name}</p>
        <VoiceGrid t={t} locale={locale} name={name} voice={voice} onPick={setVoice} />
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            play("bonus");
            onPick(voice);
          }}
          className="mt-auto h-12 w-full rounded-full bg-primary font-display text-base font-semibold text-primary-fg"
        >
          {t("pet.setup.go")}
        </button>
      </div>
    </PetFrame>
  );
}

function VoiceGrid({
  t,
  locale,
  name,
  voice,
  onPick,
}: {
  t: TFunc;
  locale: Locale;
  name: string;
  voice: PetVoice;
  onPick: (id: PetVoice) => void;
}) {
  const preview = (id: PetVoice) => {
    onPick(id);
    unlockAudio();
    stopLocalVoice();
    speakLocal(t("pet.setup.sample", { name }), locale, id);
  };
  return (
    <>
      <p className="mt-3 w-full text-xs font-semibold tracking-wide text-primary">{t("pet.setup.voice")}</p>
      <p className="w-full text-xs text-muted">{t("pet.setup.preview")}</p>
      <div className="mt-2 grid w-full grid-cols-2 gap-2">
        {VOICES.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => preview(id)}
            className={"rounded-2xl px-3 py-2 text-left " + (voice === id ? "bg-primary text-primary-fg" : "bg-elevated text-fg")}
          >
            <span className="block font-display text-sm font-semibold">{t(`pet.setup.voice.${id}` as MsgKey)}</span>
            <span className={"mt-0.5 block text-xs " + (voice === id ? "text-primary-fg/80" : "text-muted")}>
              {t(`pet.setup.voice.${id}Blurb` as MsgKey)}
            </span>
          </button>
        ))}
      </div>
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
