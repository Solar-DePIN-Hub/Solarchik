import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronsDown, Heart, Home, Pause, Play, Shield, Volume2, VolumeX } from "lucide-react";
import { createRun, step, chapterLabel, type DayMod, type Ev, type PlatSkin, type RunState, HEARTS } from "@/lib/game/sim";
import { drawWorld } from "@/lib/game/draw";
import { isMuted, play, pauseMusic, setMuted, startMusic, stopMusic, unlockAudio } from "@/lib/game/audio";
import type { RobotId } from "@/lib/game/robots";
import { SPR } from "@/lib/game/sprites";
import type { Locale, TFunc } from "@/lib/game/i18n";
import type { PetVibe, PetVoice } from "@/lib/game/pet";
import { RunRadio } from "./RunRadio";
import { todayKey, writeGhost } from "@/lib/game/save";

type Props = {
  seed: number;
  daily: boolean;
  skin: PlatSkin;
  robot: RobotId;
  offerBonus: boolean;
  careBoost?: boolean;
  mod?: DayMod;
  t: TFunc;
  locale: Locale;
  buddyName: string;
  buddyVibe: PetVibe;
  buddyVoice: PetVoice | "";
  buddyHistory: { role: "user" | "buddy"; text: string }[];
  playerId?: string;
  onResult: (result: {
    score: number;
    suns: number;
    maxCombo: number;
    distance: number;
    didBonus: boolean;
  }) => void;
  onYard: () => void;
  onRetry: () => void;
};

export function RoofRun({
  seed,
  daily,
  skin,
  robot,
  offerBonus,
  careBoost,
  mod = "calm",
  t,
  locale,
  buddyName,
  buddyVibe,
  buddyVoice,
  buddyHistory,
  playerId,
  onResult,
  onYard,
  onRetry,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<RunState>(createRun(seed, { skin, robot, offerBonus, careBoost, mod }));
  const inputRef = useRef({
    jumpPressed: false,
    jumpHeld: false,
    slidePressed: false,
    slideHeld: false,
  });
  const ptrRef = useRef({ id: -1, y: 0, sliding: false });
  const reported = useRef(false);
  const ghostWrote = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const flushGhost = () => {
    if (ghostWrote.current) return;
    const s = stateRef.current;
    const meters = Math.round(s.distance / 10);
    if (meters < 400) return;
    ghostWrote.current = true;
    writeGhost(todayKey(), meters, s.ghostTape);
  };
  const leaveYard = () => {
    flushGhost();
    onYard();
  };
  const [hud, setHud] = useState(() => snapshot(stateRef.current));
  const [muted, setMutedUi] = useState(isMuted);
  const [portrait, setPortrait] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const radioRef = useRef<{ push: (events: Ev[], state: RunState) => void } | null>(null);
  const setPausedBoth = (v: boolean) => {
    pausedRef.current = v;
    setPaused(v);
    setHud(snapshot(stateRef.current));
  };
  useEffect(() => {
    if (hud.phase === "dead") {
      stopMusic();
      return;
    }
    if (paused) {
      pauseMusic();
      return;
    }
    startMusic();
  }, [hud.phase, paused]);
  useEffect(() => {
    const mq = () => setPortrait(window.innerHeight > window.innerWidth + 48);
    mq();
    window.addEventListener("resize", mq);
    return () => window.removeEventListener("resize", mq);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.focus({ preventScroll: true });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    SPR.robotSide(robot);
    SPR.robotRun(robot);
    SPR.run();
    SPR.jump();
    SPR.mite();
    SPR.drone();
    SPR.cottage();
    SPR.greenhouse();
    SPR.panel();
    SPR.tracker();

    let raf = 0;
    let last = 0;
    let acc = 0;
    let hudAcc = 0;
    const keys = new Set<string>();
    const JUMP_KEYS = new Set(["Space", "ArrowUp", "KeyW", "KeyK", "Numpad0"]);
    const SLIDE_KEYS = new Set(["ArrowDown", "KeyS", "KeyJ"]);
    const isJumpKey = (e: KeyboardEvent) => JUMP_KEYS.has(e.code) || e.key === " ";

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const parent = canvas.parentElement;
      const w = parent?.clientWidth ?? window.innerWidth;
      const h = parent?.clientHeight ?? window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        if (stateRef.current.phase !== "dead") {
          pausedRef.current = !pausedRef.current;
          setPaused(pausedRef.current);
        }
        return;
      }
      if (pausedRef.current) return;
      if (isJumpKey(e)) {
        e.preventDefault();
        if (!keys.has("jump")) {
          inputRef.current.jumpPressed = true;
          inputRef.current.jumpHeld = true;
          unlockAudio();
        }
        keys.add("jump");
        keys.add(e.code);
        return;
      }
      if (SLIDE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!keys.has(e.code)) {
          inputRef.current.slidePressed = true;
          inputRef.current.slideHeld = true;
          unlockAudio();
        }
        keys.add(e.code);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (isJumpKey(e)) keys.delete("jump");
      if (![...keys].some((k) => k === "jump" || JUMP_KEYS.has(k))) inputRef.current.jumpHeld = false;
      if (![...keys].some((k) => SLIDE_KEYS.has(k))) inputRef.current.slideHeld = false;
    };
    const clearKeys = () => {
      keys.clear();
      inputRef.current.jumpHeld = false;
      inputRef.current.slideHeld = false;
    };
    const onVis = () => {
      if (document.visibilityState === "hidden" && stateRef.current.phase !== "dead") {
        pausedRef.current = true;
        setPaused(true);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", clearKeys);
    document.addEventListener("visibilitychange", onVis);

    let hudKey = "";
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) {
        last = now;
        acc = 0;
        return;
      }
      if (!last) last = now;
      let dt = (now - last) / 1000;
      last = now;
      dt = Math.min(dt, 0.05);
      if (pausedRef.current) {
        acc = 0;
        last = now;
        const cssW = canvas.clientWidth;
        const cssH = canvas.clientHeight;
        drawWorld(ctx, cssW, cssH, stateRef.current, now / 1000);
        return;
      }
      acc += dt;
      const tick = 1 / 60;
      let steps = 0;
      while (acc >= tick && steps < 3) {
        const input = {
          jumpPressed: inputRef.current.jumpPressed,
          jumpHeld: inputRef.current.jumpHeld,
          slidePressed: inputRef.current.slidePressed,
          slideHeld: inputRef.current.slideHeld,
        };
        inputRef.current.jumpPressed = false;
        inputRef.current.slidePressed = false;
        const { state, events } = step(stateRef.current, tick, input);
        stateRef.current = state;
        for (const ev of events) play(ev);
        radioRef.current?.push(events, state);
        if (state.phase === "dead" && !reported.current) {
          reported.current = true;
          flushGhost();
          onResultRef.current({
            score: Math.round(state.score),
            suns: state.suns,
            maxCombo: state.maxCombo,
            distance: Math.round(state.distance / 10),
            didBonus: state.didBonus,
          });
        }
        acc -= tick;
        steps += 1;
      }
      if (steps >= 3) acc = 0;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      drawWorld(ctx, cssW, cssH, stateRef.current, now / 1000);
      hudAcc += dt;
      if (hudAcc > 0.12) {
        hudAcc = 0;
        const s = stateRef.current;
        const k = `${s.phase}|${s.hearts}|${Math.round(s.score)}|${s.combo}|${Math.round(s.distance / 8)}|${s.bonus ? 1 : 0}`;
        if (k !== hudKey) {
          hudKey = k;
          setHud(snapshot(s));
        }
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown, { capture: true } as EventListenerOptions);
      window.removeEventListener("keyup", onKeyUp, { capture: true } as EventListenerOptions);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [seed, skin, robot, offerBonus]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    unlockAudio();
    const st = stateRef.current;
    if (st.phase === "dead" || pausedRef.current) return;
    ptrRef.current = { id: e.pointerId, y: e.clientY, sliding: false };
    inputRef.current.jumpPressed = true;
    inputRef.current.jumpHeld = true;
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (ptrRef.current.id !== e.pointerId) return;
    const dy = e.clientY - ptrRef.current.y;
    if (!ptrRef.current.sliding && dy > 36) {
      ptrRef.current.sliding = true;
      inputRef.current.slidePressed = true;
      inputRef.current.slideHeld = true;
      inputRef.current.jumpHeld = false;
    }
  };
  const onPointerUp = () => {
    inputRef.current.jumpHeld = false;
    inputRef.current.slideHeld = false;
    ptrRef.current.id = -1;
    ptrRef.current.sliding = false;
  };

  const holdSlide = () => {
    if (pausedRef.current) return;
    unlockAudio();
    inputRef.current.slidePressed = true;
    inputRef.current.slideHeld = true;
  };

  return (
    <div
      className={
        portrait
          ? "absolute left-1/2 top-1/2 origin-center overflow-hidden bg-bg"
          : "relative h-full w-full overflow-hidden bg-bg text-fg"
      }
      style={
        portrait
          ? {
              width: "100dvh",
              height: "100dvw",
              transform: "translate(-50%, -50%) rotate(90deg)",
            }
          : undefined
      }
    >
      <div className={"relative h-full w-full overflow-hidden bg-bg text-fg " + (portrait ? "" : "")}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="absolute inset-0 h-full w-full touch-none select-none outline-none"
        onPointerDown={(e) => {
          canvasRef.current?.focus();
          onPointerDown(e);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2">
          {hud.phase !== "dead" && (
            <button
              type="button"
              className="pointer-events-auto grid size-11 place-items-center rounded-md bg-bg/55 text-fg backdrop-blur-[2px]"
              onClick={() => setPausedBoth(!pausedRef.current)}
              aria-label={paused ? t("run.resume") : t("run.pause")}
            >
              {paused ? <Play className="size-5" /> : <Pause className="size-5" />}
            </button>
          )}
          <div className="flex items-center gap-1 rounded-md bg-bg/55 px-2.5 py-1.5 backdrop-blur-[2px]">
            {Array.from({ length: HEARTS }).map((_, i) => (
              <Heart
                key={i}
                className={"size-5 " + (i < hud.hearts ? "text-primary" : "text-fg/25")}
                fill={i < hud.hearts ? "currentColor" : "none"}
                strokeWidth={2.4}
              />
            ))}
            {hud.shield > 0 && <Shield className="size-5 text-ok" fill="currentColor" strokeWidth={2} />}
          </div>
          <div className="rounded-md bg-bg/55 px-2.5 py-1.5 font-display text-lg font-semibold tabular-nums backdrop-blur-[2px]">
            {hud.score}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="rounded-md bg-bg/80 px-2.5 py-1.5 font-display text-lg font-semibold tabular-nums text-fg backdrop-blur-[2px]">
            {hud.distance}m
          </div>
          <div className="rounded-md bg-bg/80 px-2 py-0.5 font-display text-[11px] font-semibold tracking-wide text-primary backdrop-blur-[2px]">
            {hud.chapterLabel}
          </div>
          {hud.grind && !hud.bonus && (
            <div className="rounded-md bg-ok px-2.5 py-1 font-display text-sm font-semibold text-bg">Grind</div>
          )}
          {hud.bonus && (
            <div className="rounded-md bg-primary px-2.5 py-1 font-display text-sm font-semibold text-primary-fg">
              {t("run.flight")} {Math.ceil(hud.bonusLeft)}s
            </div>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
        {hud.phase === "running" && !hud.bonus && (
          <p className="font-display text-sm font-semibold tracking-wide text-fg/80">
            {t("run.hint")}
          </p>
        )}
        {hud.bonus && (
          <p className="mx-auto max-w-sm rounded-lg bg-primary px-3 py-2 font-display text-base font-semibold text-primary-fg">
            {t("run.garden")}
          </p>
        )}
      </div>

      <RunRadio
        locale={locale}
        name={buddyName}
        vibe={buddyVibe}
        voice={buddyVoice}
        history={buddyHistory}
        t={t}
        paused={paused}
        live={hud.phase === "running" || hud.phase === "countdown"}
        playerId={playerId}
        bind={radioRef}
      />

      <button
        type="button"
        className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 z-10 grid size-11 place-items-center rounded-md bg-bg/55 text-fg"
        onClick={() => {
          unlockAudio();
          const next = !isMuted();
          setMuted(next);
          setMutedUi(next);
          if (!next) startMusic();
        }}
        aria-label={muted ? t("run.unmute") : t("run.mute")}
      >
        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </button>

      {hud.phase !== "dead" && !paused && !hud.bonus && (
        <button
          type="button"
          className="absolute right-3 top-[48%] z-20 flex h-16 min-w-16 -translate-y-1/2 touch-none items-center justify-center gap-1 rounded-2xl bg-bg/75 px-3 font-display text-sm font-semibold text-fg shadow-lg backdrop-blur-[2px]"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            holdSlide();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            inputRef.current.slideHeld = false;
          }}
          onPointerCancel={() => {
            inputRef.current.slideHeld = false;
          }}
          aria-label={t("run.slide")}
        >
          <ChevronsDown className="size-5" />
          {t("run.slide")}
        </button>
      )}

      {hud.phase === "countdown" && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-[28%] z-20 text-center">
          <p className="font-display text-6xl font-semibold text-primary drop-shadow-sm">
            {hud.countdown > 0.28 ? Math.ceil(hud.countdown) : "GO"}
          </p>
        </div>
      )}

      {hud.announceLife > 0 && hud.phase === "running" && (
        <div className="pointer-events-none absolute inset-x-0 top-[26%] text-center">
          <p className="font-display text-4xl font-semibold tracking-wide text-primary drop-shadow-sm sm:text-5xl">
            {hud.announce}
          </p>
        </div>
      )}

      {paused && hud.phase !== "dead" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-5 pb-10 pt-16 sm:items-center">
          <div className="pointer-events-auto w-full max-w-sm rounded-xl bg-bg p-6 text-fg shadow-card">
            <p className="text-sm font-semibold tracking-[0.16em] text-primary">{t("run.paused")}</p>
            <h2 className="mt-1 font-display text-3xl font-semibold">{t("run.breath")}</h2>
            <p className="mt-2 text-sm text-muted">
              {hud.distance}m · {hud.score} pts · {hud.suns} {t("run.suns")}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                className="flex h-12 items-center justify-center gap-2 rounded-lg bg-primary font-display text-base font-semibold text-primary-fg"
                onClick={() => setPausedBoth(false)}
              >
                <Play className="size-4" />
                {t("run.resume")}
              </button>
              <button
                type="button"
                className="flex h-12 items-center justify-center gap-2 rounded-md bg-elevated font-semibold"
                onClick={leaveYard}
              >
                <Home className="size-4" />
                {t("run.yard")}
              </button>
            </div>
          </div>
        </div>
      )}

      {hud.phase === "dead" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-5 pb-10 pt-16 sm:items-center">
          <div className="pointer-events-auto w-full max-w-sm rounded-xl bg-bg p-6 text-fg shadow-card">
            <p className="text-sm font-semibold tracking-[0.16em] text-primary">
              {daily ? t("run.daily") : t("run.practice")}
            </p>
            <h2 className="mt-1 font-display text-3xl font-semibold">
              {hud.death === "HIT" ? t("run.hit") : t("run.fell")}
            </h2>
            <p className="mt-1 font-display text-sm font-semibold text-primary">
              {t("run.reached", { name: hud.chapterLabel })}
            </p>
            <p className="mt-2 text-sm text-muted">
              {hud.distance}m · {hud.score} pts · {hud.suns} {t("run.suns")} · {hud.maxCombo}x heat
              {hud.didBonus ? " · garden" : ""}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                className="flex h-12 items-center justify-center rounded-lg bg-primary font-display text-base font-semibold text-primary-fg"
                onClick={onRetry}
              >
                {t("run.again")}
              </button>
              <button
                type="button"
                className="flex h-12 items-center justify-center gap-2 rounded-md bg-elevated font-semibold"
                onClick={leaveYard}
              >
                <Home className="size-4" />
                {t("run.yard")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

function snapshot(s: RunState) {
  return {
    hearts: s.hearts,
    shield: s.shield,
    score: Math.round(s.score),
    distance: Math.round(s.distance / 10),
    combo: s.combo,
    phase: s.phase,
    countdown: s.countdown,
    death: s.death,
    suns: s.suns,
    maxCombo: s.maxCombo,
    bonus: s.bonus,
    bonusLeft: s.bonusLeft,
    grind: s.grind,
    didBonus: s.didBonus,
    chapterLabel: chapterLabel(s.chapter),
    announce: s.announce,
    announceLife: s.announceLife,
  };
}
