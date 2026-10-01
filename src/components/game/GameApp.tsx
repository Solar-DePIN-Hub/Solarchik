import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Yard } from "./Yard";
import { RoofRun } from "./RoofRun";
import { Shop } from "./Shop";
import { PetGame } from "./PetGame";
import type { WorkDesk } from "./WorkDesk";
import { GameCatch } from "./GameCatch";
import {
  applyRun,
  daySeed,
  dayMod,
  loadSave,
  petDoChat,
  petDoPoke,
  petDoSecretary,
  petDoSetup,
  petArchiveSecretary,
  petReadSecretary,
  addPhoneContact,
  dropPhoneContact,
  mergePhonebook,
  setSecretaryOn,
  setSecNumber,
  setRedirectOn,
  setFwdCountry,
  markSecretaryPaid,
  queueSecretaryPay,
  setPlayerWallet,
  petShieldOn,
  pickRobot,
  setLocale,
  stampClock,
  activateFeeWindow,
  tickSavePet,
  todayKey,
  writeSave,
  defaultSave,
  type SaveData,
} from "@/lib/game/save";
import { unlockAudio, startMusic, stopMusic, armUnlock, play } from "@/lib/game/audio";
import type { RobotId } from "@/lib/game/robots";
import { isLocale, makeT, type Locale } from "@/lib/game/i18n";
import type { PetVibe, PetVoice } from "@/lib/game/pet";
import { pullNativeInbox, setNativeScreening, isNativeApp, signClockIn } from "@/lib/game/buddyNet";
import { signClockInMwa } from "@/lib/game/mwaWeb";
import { readMessage } from "@/lib/game/secretary";

type Screen = "yard" | "run" | "shop" | "pet" | "work";

export function GameApp() {
  const [save, setSave] = useState<SaveData | null>(null);
  const [screen, setScreen] = useState<Screen>("yard");
  const [workDesk, setWorkDesk] = useState<typeof WorkDesk | null>(null);
  const [daily, setDaily] = useState(true);
  const [runKey, setRunKey] = useState(0);
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState("");
  const hold = useRef<SaveData | null>(null);
  if (save) hold.current = save;
  const view = save ?? { ...defaultSave(), locale: "en" as const };

  const seed = useMemo(() => {
    if (daily) return daySeed(todayKey());
    return ((runKey + 1) * 2654435761) >>> 0;
  }, [daily, runKey]);

  const offerBonus = ((view?.runs ?? 0) + 1) % 15 === 0;
  const t = useMemo(() => makeT(view?.locale ?? "en"), [view?.locale]);

  useEffect(() => {
    setSave(loadSave());
    armUnlock();
  }, []);

  useEffect(() => {
    let cancel = false;
    const id = window.setTimeout(() => {
      void import("./WorkDesk").then((m) => {
        if (!cancel) setWorkDesk(() => m.WorkDesk);
      });
    }, 400);
    return () => {
      cancel = true;
      window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    if (!save) return;
    const applyIncoming = (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of rows) {
          const m = readMessage(row);
          if (!m?.reply && !m?.user) continue;
          const cur = hold.current;
          if (!cur) continue;
          if (cur.secretaryInbox.some((x) => x.id === m.id || (x.at === m.at && x.user === m.user && x.reply === m.reply))) continue;
          const next = petDoSecretary(cur, m.user, m.reply, {
            at: m.at,
            summary: m.summary,
            chargedUsd: m.chargedUsd,
            usd: m.usd,
          });
          hold.current = next;
          setSave(next);
        }
      } catch {
        /* native payload */
      }
    };
    window.SolarchikIncoming = applyIncoming;
    void pullNativeInbox().then((rows) => {
      if (!rows.length) return;
      applyIncoming(JSON.stringify(rows));
    });
    return () => {
      if (window.SolarchikIncoming === applyIncoming) delete window.SolarchikIncoming;
    };
  }, [save?.playerId]);

  useEffect(() => {
    if (!save) return;
    writeSave(save);
  }, [save]);

  useEffect(() => {
    if (view?.locale) document.documentElement.lang = view.locale;
  }, [view?.locale]);

  useEffect(() => {
    const onHide = () => {
      if (!save) return;
      if (document.visibilityState === "hidden") writeSave(save);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [save]);

  useEffect(() => {
    if (screen === "run") return;
    stopMusic();
  }, [screen]);

  useEffect(() => {
    if (screen !== "pet") return;
    const id = window.setInterval(() => {
      setSave((s) => (s ? tickSavePet(s) : s));
    }, 4000);
    return () => window.clearInterval(id);
  }, [screen]);

  const commit = useCallback(
    (result: { score: number; suns: number; maxCombo: number; distance: number; didBonus: boolean }) => {
      setSave((prev) => (prev ? applyRun(prev, result) : prev));
    },
    [],
  );

  const goYard = () => {
    stopMusic();
    setScreen("yard");
  };

  const start = (isDaily: boolean) => {
    unlockAudio();
    startMusic();
    play("start");
    setDaily(isDaily);
    setRunKey((k) => k + 1);
    setScreen("run");
  };

  const onLocale = (id: Locale) => {
    if (!isLocale(id)) return;
    setSave((s) => {
      if (!s || s.locale === id) return s;
      return setLocale(s, id);
    });
  };

  const resetToYard = () => {
    stopMusic();
    setScreen("yard");
    setSave((s) => s ?? hold.current ?? loadSave());
  };

  const mutatePet = (fn: (s: SaveData) => SaveData) => {
    const cur = hold.current ?? save;
    if (!cur) return cur;
    const next = fn(cur);
    hold.current = next;
    setSave(next);
    return next;
  };

  const WorkDeskView = workDesk;

  const doSign = () => {
    const snap = hold.current;
    if (!snap || signBusy || snap.signedDay === todayKey()) return;
    if (!isNativeApp()) {
      setSignBusy(true);
      setSignError("");
      void signClockInMwa(snap.lastDistance || snap.bestDistance || 0, snap.lastScore || snap.bestScore || 0, snap.streak || 0).then((proof) => {
        setSignBusy(false);
        if (!proof.ok) {
          setSignError(proof.error === "no-wallet" ? "need-apk" : proof.error === "wallet" ? "wallet" : proof.error);
          return;
        }
        setSignError("");
        setSave((s) => (s ? stampClock(s, proof) : s));
      });
      return;
    }
    setSignBusy(true);
    setSignError("");
    void signClockIn(snap.lastDistance || snap.bestDistance || 0, snap.lastScore || snap.bestScore || 0, snap.streak || 0).then((proof) => {
      setSignBusy(false);
      if (!proof.ok) {
        setSignError(proof.error === "timeout" || proof.error === "wallet-missing" ? "wallet" : proof.error);
        return;
      }
      setSignError("");
      setSave((s) => (s ? stampClock(s, proof) : s));
    });
  };

  return (
    <GameCatch onReset={resetToYard}>
      {screen === "run" ? (
        <div className="h-dvh w-full overflow-hidden bg-bg">
          <RoofRun
            key={runKey}
            seed={seed}
            daily={daily}
            skin={view.skin}
            robot={view.robot}
            offerBonus={offerBonus}
            careBoost={petShieldOn(view)}
            mod={dayMod(todayKey())}
            t={t}
            locale={view.locale}
            buddyName={view.pet.setupDone && view.pet.name ? view.pet.name : "Sol"}
            buddyVibe={view.pet.vibe}
            buddyVoice={view.pet.voice}
            buddyHistory={view.pet.chat.slice(-6).map((m) => ({ role: m.role, text: m.text }))}
            playerId={view.playerId}
            onResult={commit}
            onRetry={() => start(daily)}
            onYard={goYard}
            onClock={doSign}
            signed={view.signedDay === todayKey()}
            signBusy={signBusy}
            signError={signError}
            save={view}
          />
        </div>
      ) : screen === "shop" ? (
        <Shop
          save={view}
          t={t}
          onBack={goYard}
          onRobot={(id: RobotId) => setSave((s) => (s ? pickRobot(s, id) : s))}
        />
      ) : screen === "pet" ? (
        <PetGame
          save={view}
          t={t}
          onBack={goYard}
          onSetup={(name: string, vibe: PetVibe, voice: PetVoice) => mutatePet((s) => petDoSetup(s, name, vibe, voice))}
          onPoke={() => {
            const cur = hold.current;
            if (!cur) return false;
            const next = petDoPoke(cur);
            const ok = next.pet.lastPetAt !== cur.pet.lastPetAt;
            hold.current = next;
            setSave(next);
            return ok;
          }}
          onChat={(user, buddy) => mutatePet((s) => petDoChat(s, user, buddy))}
          onSecretary={(user, buddy, report) => mutatePet((s) => petDoSecretary(s, user, buddy, report))}
          onSecretaryRead={(id) => mutatePet((s) => petReadSecretary(s, id))}
          onSecretaryArchive={(id) => mutatePet((s) => petArchiveSecretary(s, id))}
          onAddContact={(name) => mutatePet((s) => addPhoneContact(s, name))}
          onDropContact={(id) => mutatePet((s) => dropPhoneContact(s, id))}
          onPower={(on) => {
            setNativeScreening(on);
            mutatePet((s) => setSecretaryOn(s, on));
          }}
          onSecNumber={(raw) => mutatePet((s) => setSecNumber(s, raw))}
          onRedirect={(on) => mutatePet((s) => setRedirectOn(s, on))}
          onFwdCountry={(id) => mutatePet((s) => setFwdCountry(s, id))}
          onImportBook={(names) => {
            const cur = hold.current;
            if (!cur) return 0;
            const before = cur.phonebook.length;
            const next = mergePhonebook(cur, names);
            hold.current = next;
            setSave(next);
            return Math.max(0, next.phonebook.length - before);
          }}
          onPend={(ref, usd) => mutatePet((s) => queueSecretaryPay(s, ref, usd))}
          onPaid={(sig, from, ref, usd) => mutatePet((s) => markSecretaryPaid(s, sig, from, ref, usd))}
          onWallet={(addr) => mutatePet((s) => setPlayerWallet(s, addr))}
          onWork={() => {
            stopMusic();
            setScreen("work");
            if (!workDesk) {
              void import("./WorkDesk").then((m) => setWorkDesk(() => m.WorkDesk));
            }
          }}
        />
      ) : screen === "work" ? (
        WorkDeskView ? (
          <WorkDeskView locale={view.locale} onBack={() => setScreen("pet")} />
        ) : (
          <div className="grid h-dvh place-items-center bg-bg text-sm text-muted">…</div>
        )
      ) : (
        <div className="h-dvh w-full overflow-y-auto bg-bg">
          <Yard
            save={view}
            t={t}
            onRun={() => start(true)}
            onSign={doSign}
            signBusy={signBusy}
            signError={signError}
            onFarm={() => setScreen("pet")}
            onShop={() => setScreen("shop")}
            onLocale={onLocale}
            onActivateFee={() => setSave((prev) => (prev ? activateFeeWindow(prev) : prev))}
            reportReady={save != null}
            onReportSeen={(day) => setSave((prev) => (prev && prev.reportDay !== day ? { ...prev, reportDay: day } : prev))}
          />
        </div>
      )}
    </GameCatch>
  );
}
