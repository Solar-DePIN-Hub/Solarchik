import { useEffect, useRef, useState } from "react";
import { Archive, Mic, Phone, Plus, Power, Send, Trash2, Wallet, X } from "lucide-react";
import type { Locale, MsgKey, TFunc } from "@/lib/game/i18n";
import {
  headlineOf,
  isKnownAction,
  money,
  screenCall,
  sessionCost,
  topupCredit,
  type PhoneContact,
  type SecretaryMessage,
  type SecretaryReport,
} from "@/lib/game/secretary";
import { fwdName, fwdRule, sortedFwd, ussdOffFor, ussdOnFor } from "@/lib/game/fwd";
import { clampPay, confirmPay, confirmPending, newPayRef, PAY_WALLET, payUrl, shortAddr, type PayUsd } from "@/lib/game/pay";
import { play, unlockAudio } from "@/lib/game/audio";
import { canNativeListen, connectPlayerWallet, copyText, importPhonebook, nativeListen, nativeStopListen, nativeUssd, openPay } from "@/lib/game/buddyNet";
import { errKey, failOf } from "@/lib/game/netErr";

type Props = {
  open: boolean;
  locale: Locale;
  t: TFunc;
  playerId: string;
  inbox: SecretaryMessage[];
  book: PhoneContact[];
  secretaryOn: boolean;
  secNumber: string;
  redirectOn: boolean;
  fwdCountry: string;
  onClose: () => void;
  onDone: (user: string, reply: string, report: SecretaryReport) => void;
  onRead: (id: string) => void;
  onArchive: (id: string) => void;
  onAddContact: (name: string) => void;
  onDropContact: (id: string) => void;
  onPower: (on: boolean) => void;
  onNumber: (raw: string) => void;
  onRedirect: (on: boolean) => void;
  onCountry: (id: string) => void;
  onImport: (names: string[]) => number;
  live: boolean;
  credit: number;
  paySigs: string[];
  playerWallet: string;
  pending: { ref: string; usd: PayUsd }[];
  onPend: (ref: string, usd: PayUsd) => void;
  onPaid: (sig: string, from: string, ref: string, usd: PayUsd) => void;
  onWallet: (address: string) => void;
};

const SPEECH_LANG: Record<string, string> = {
  en: "en-US",
  uk: "uk-UA",
  es: "es-ES",
  pt: "pt-BR",
  de: "de-DE",
  ja: "ja-JP",
};

const FIELD: Record<string, MsgKey> = {
  who: "pet.sec.who",
  company: "pet.sec.company",
  back: "pet.sec.back",
  intent: "pet.sec.intent",
  urgency: "pet.sec.urgency",
  spam: "pet.sec.spam",
  action: "pet.sec.action",
  notes: "pet.sec.notes",
};

function when(at: number, locale: Locale): string {
  if (!at) return "";
  try {
    return new Date(at).toLocaleString(locale === "uk" ? "uk-UA" : locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function SecretaryDesk({
  open,
  locale,
  t,
  playerId,
  inbox,
  book,
  secretaryOn,
  secNumber,
  redirectOn,
  fwdCountry,
  onClose,
  onDone,
  onRead,
  onArchive,
  onAddContact,
  onDropContact,
  onPower,
  onNumber,
  onRedirect,
  onCountry,
  onImport,
  live,
  credit,
  paySigs,
  playerWallet,
  pending,
  onPend,
  onPaid,
  onWallet,
}: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [holding, setHolding] = useState(false);
  const [tab, setTab] = useState<"new" | "archive" | "book">("new");
  const [openId, setOpenId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [numDraft, setNumDraft] = useState(secNumber);
  const [importing, setImporting] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [own, setOwn] = useState("");
  const holdingRef = useRef(false);
  const listenGen = useRef(0);
  const micTapAt = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const payWait = useRef(0);
  const usedRef = useRef(paySigs);
  usedRef.current = paySigs;

  useEffect(() => {
    if (!open) return;
    setNote("");
    setTab("new");
    setNumDraft(secNumber);
  }, [open, live, secNumber, credit]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = 0;
  }, [open, tab, inbox.length]);

  if (!open) return null;

  const shown = live ? credit : 0;
  const need = shown < sessionCost();
  const fresh = inbox.filter((m) => !m.archived);
  const archived = inbox.filter((m) => m.archived);
  const unread = fresh.filter((m) => !m.read).length;
  const rows = tab === "new" ? fresh : archived;
  const rule = fwdRule(fwdCountry, locale);
  const onCode = ussdOnFor(numDraft || secNumber, rule.id, locale);
  const offCode = ussdOffFor(rule.id, locale);

  const sendUssd = (code: string) => {
    if (!code) {
      setNote(t("pet.sec.fwd.need"));
      return;
    }
    const ok = nativeUssd(code);
    setNote(ok ? code : t("pet.sec.fwd.need"));
    play("tick");
  };

  const finishPay = async (sig: string, usdAmt: PayUsd, from: string, ref: string) => {
    await topupCredit(playerId, sig);
    onPaid(sig, from, ref, usdAmt);
    setNote(t("pet.sec.pay.ok", { n: money(usdAmt) }));
    play("bonus");
  };

  const doPay = async (usdAmt: PayUsd) => {
    if (busy) return;
    const n = clampPay(usdAmt);
    if (!n) {
      setNote(t("pet.sec.pay.bad"));
      play("hurt");
      return;
    }
    setBusy(true);
    const gen = ++payWait.current;
    const ref = newPayRef();
    onPend(ref, n);
    setNote(t("pet.sec.pay.wait"));
    play("tick");
    await copyText(PAY_WALLET);
    await openPay(payUrl(n, ref, playerId));
    let hit: Awaited<ReturnType<typeof confirmPay>> = null;
    for (let i = 0; i < 24; i++) {
      if (payWait.current !== gen) return;
      await new Promise((r) => window.setTimeout(r, 3500));
      try {
        hit = await confirmPay(ref, n, usedRef.current);
      } catch {
        hit = null;
      }
      if (hit) break;
    }
    if (payWait.current !== gen) return;
    try {
      if (!hit) {
        setNote(t("pet.sec.pay.miss"));
        play("hurt");
        return;
      }
      await finishPay(hit.sig, n, hit.from, ref);
    } catch (e) {
      setNote(t(errKey(failOf(e))));
      play("hurt");
    } finally {
      if (payWait.current === gen) setBusy(false);
    }
  };

  const checkPay = async () => {
    if (busy) return;
    setBusy(true);
    setNote(t("pet.sec.topping"));
    try {
      const hit = await confirmPending(pending, usedRef.current);
      if (!hit) {
        setNote(t("pet.sec.pay.miss"));
        play("hurt");
        return;
      }
      await finishPay(hit.sig, hit.usd, hit.from, hit.ref);
    } catch (e) {
      setNote(t(errKey(failOf(e))));
      play("hurt");
    } finally {
      setBusy(false);
    }
  };

  const connectWallet = async () => {
    if (busy) return;
    setBusy(true);
    setNote(t("pet.sec.pay.connecting"));
    play("tick");
    try {
      const addr = await connectPlayerWallet();
      if (!addr) {
        setNote(t("pet.sec.pay.noconnect"));
        play("hurt");
        return;
      }
      onWallet(addr);
      setNote(t("pet.sec.you.wallet", { n: shortAddr(addr) }));
      play("collect");
    } catch {
      setNote(t("pet.sec.pay.noconnect"));
      play("hurt");
    } finally {
      setBusy(false);
    }
  };

  const send = async (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || busy || !secretaryOn) return;
    if ((shown ?? 0) < sessionCost()) {
      setNote(t("pet.sec.need"));
      return;
    }
    setBusy(true);
    setNote(t("pet.sec.wait"));
    play("tick");
    const res = await screenCall(
      playerId,
      clean,
      book.map((c) => c.name),
      locale,
    );
    if (res.ok) {
      setDraft("");
      setTab("new");
      play("collect");
      onDone(clean, res.reply, {
        at: Date.now(),
        summary: res.summary,
        chargedUsd: res.chargedUsd,
        usd: res.usd,
      });
      setNote(t("pet.sec.ok"));
      setBusy(false);
      return;
    }
    if (res.needTopup) {
      setNote(t("pet.sec.need"));
    } else {
      setNote(t(errKey(res.error)));
      play("hurt");
    }
    setBusy(false);
  };

  const stopListen = () => {
    listenGen.current += 1;
    holdingRef.current = false;
    setHolding(false);
    if (canNativeListen()) nativeStopListen();
  };

  const startListen = () => {
    if (busy || holdingRef.current) return;
    unlockAudio();
    holdingRef.current = true;
    setHolding(true);
    play("tick");
    const gen = ++listenGen.current;
    if (canNativeListen()) {
      void nativeListen(locale).then((text) => {
        if (gen !== listenGen.current) return;
        holdingRef.current = false;
        setHolding(false);
        if (text) setDraft((d) => (d ? `${d} ${text}` : text));
      });
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        start: () => void;
        stop: () => void;
        onresult: ((ev: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        start: () => void;
        stop: () => void;
        onresult: ((ev: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
      };
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      holdingRef.current = false;
      setHolding(false);
      return;
    }
    try {
      const r = new SR();
      r.lang = SPEECH_LANG[locale] || "en-US";
      r.onresult = (ev) => {
        const last = ev.results[ev.results.length - 1];
        const text = String(last?.[0]?.transcript || "").trim();
        if (text) setDraft((d) => (d ? `${d} ${text}` : text));
      };
      r.onend = () => {
        if (gen === listenGen.current) {
          holdingRef.current = false;
          setHolding(false);
        }
      };
      r.onerror = () => {
        if (gen === listenGen.current) {
          holdingRef.current = false;
          setHolding(false);
        }
      };
      r.start();
      window.setTimeout(() => {
        try {
          r.stop();
        } catch {
          /* ended */
        }
      }, 6000);
    } catch {
      holdingRef.current = false;
      setHolding(false);
    }
  };

  return (
    <div className="pet-sec-overlay">
      <button type="button" className="h-[8%] shrink-0" aria-label={t("pet.sec.close")} onClick={onClose} />
      <div className="flex min-h-0 flex-1 flex-col rounded-t-3xl bg-surface px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 shadow-card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-fg">
              <Phone className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-base font-semibold">{t("pet.sec.title")}</p>
              <div className="flex items-center gap-1">
                <p className="text-xs text-muted">
                  {t("pet.sec.bal", { n: money(live ? credit : 0) })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    play("tick");
                    setPayOpen((v) => !v);
                  }}
                  className="grid size-6 place-items-center rounded-full bg-primary text-primary-fg"
                  aria-label={t("pet.sec.topup")}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-full bg-elevated text-fg"
            aria-label={t("pet.sec.close")}
          >
            <X className="size-5" />
          </button>
        </div>

        {payOpen && (
          <div className="mb-3 rounded-2xl bg-elevated px-3 py-3">
            <p className="text-xs leading-snug text-muted">{t("pet.sec.pay.how")}</p>
            <p className="mt-1 text-xs text-fg">{t("pet.sec.you.id", { n: shortAddr(playerId) })}</p>
            <p className="text-xs text-muted">
              {playerWallet ? t("pet.sec.you.wallet", { n: shortAddr(playerWallet) }) : t("pet.sec.you.nowallet")}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void connectWallet()}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-bg font-display text-sm font-semibold text-fg disabled:opacity-40"
            >
              <Wallet className="size-4" />
              {playerWallet ? t("pet.sec.you.wallet", { n: shortAddr(playerWallet) }) : t("pet.sec.pay.connect")}
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void doPay(5)}
                className="h-11 rounded-full bg-primary font-display text-sm font-semibold text-primary-fg disabled:opacity-40"
              >
                {busy ? t("pet.sec.topping") : t("pet.sec.topup")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void doPay(10)}
                className="h-11 rounded-full bg-primary font-display text-sm font-semibold text-primary-fg disabled:opacity-40"
              >
                {busy ? t("pet.sec.topping") : t("pet.sec.top10")}
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={own}
                onChange={(e) => setOwn(e.target.value)}
                inputMode="decimal"
                placeholder={t("pet.sec.pay.own")}
                aria-label={t("pet.sec.pay.own")}
                className="h-11 min-w-0 flex-1 rounded-full border border-border bg-bg px-4 text-sm text-fg outline-none placeholder:text-subtle"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void doPay(clampPay(own))}
                className="h-11 shrink-0 rounded-full bg-primary px-4 font-display text-sm font-semibold text-primary-fg disabled:opacity-40"
              >
                {t("pet.sec.pay.go")}
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void checkPay()}
              className="mt-2 h-10 w-full rounded-full bg-bg text-xs font-semibold text-fg"
            >
              {t("pet.sec.pay.check")}
            </button>
          </div>
        )}

        <p className="mb-3 text-sm leading-snug text-muted">{t("pet.sec.about")}</p>

        <button
          type="button"
          onClick={() => {
            play("tick");
            const next = !secretaryOn;
            onPower(next);
            if (redirectOn) sendUssd(next ? onCode : offCode);
          }}
          className={
            "mb-3 flex h-14 w-full items-center justify-center gap-2 rounded-full font-display text-base font-semibold " +
            (secretaryOn ? "bg-primary text-primary-fg" : "bg-elevated text-fg")
          }
        >
          <Power className="size-5" />
          {secretaryOn ? t("pet.sec.power.on") : t("pet.sec.power.off")}
        </button>
        {!secretaryOn && <p className="mb-3 text-center text-xs text-muted">{t("pet.sec.power.hint")}</p>}

        <div className="mb-3 rounded-2xl bg-elevated px-3 py-3">
          <p className="font-display text-sm font-semibold">{t("pet.sec.fwd")}</p>
          <p className="mt-1 text-xs leading-snug text-muted">{t("pet.sec.fwd.blurb")}</p>
          <label className="mt-2 block text-xs font-semibold text-muted">{t("pet.sec.fwd.country")}</label>
          <select
            value={rule.id}
            onChange={(e) => onCountry(e.target.value)}
            className="mt-1 h-11 w-full rounded-full border border-border bg-bg px-4 text-sm text-fg outline-none"
          >
            {sortedFwd(locale).map((c) => (
              <option key={c.id} value={c.id}>
                {fwdName(c, locale)} +{c.cc}
              </option>
            ))}
          </select>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
            {t("pet.sec.fwd.set")}: {rule.on}
            <br />
            {t("pet.sec.fwd.kill")}: {rule.off}
            {rule.check ? (
              <>
                <br />
                {t("pet.sec.fwd.ask")}: {rule.check}
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => {
              play("tick");
              if (!onCode) {
                setNote(t("pet.sec.fwd.need"));
                return;
              }
              const next = !redirectOn;
              onRedirect(next);
              if (secretaryOn) sendUssd(next ? onCode : offCode);
            }}
            className={
              "mt-2 flex h-11 w-full items-center justify-center rounded-full text-sm font-semibold " +
              (redirectOn ? "bg-primary text-primary-fg" : "bg-bg text-fg")
            }
          >
            {redirectOn ? t("pet.sec.fwd.on") : t("pet.sec.fwd.off")}
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => sendUssd(onCode)}
              className="h-10 rounded-full bg-bg text-xs font-semibold text-fg"
            >
              {t("pet.sec.fwd.go")}
            </button>
            <button
              type="button"
              onClick={() => sendUssd(offCode)}
              className="h-10 rounded-full bg-bg text-xs font-semibold text-fg"
            >
              {t("pet.sec.fwd.stop")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              const code = secretaryOn && redirectOn ? onCode : offCode;
              if (!code) {
                setNote(t("pet.sec.fwd.need"));
                return;
              }
              void copyText(code).then((ok) => {
                setNote(ok ? code : t("pet.sec.fwd.need"));
                play("tick");
              });
            }}
            className="mt-2 h-10 w-full rounded-full bg-bg text-xs font-semibold text-muted"
          >
            {t("pet.sec.fwd.copy")}
          </button>
        </div>

        <div className="mb-2 grid grid-cols-3 gap-1 rounded-full bg-elevated p-1">
          <button
            type="button"
            onClick={() => setTab("new")}
            className={
              "h-9 rounded-full text-xs font-semibold " +
              (tab === "new" ? "bg-primary text-primary-fg" : "text-muted")
            }
          >
            {t("pet.sec.new")}
            {unread > 0 ? ` ${unread}` : ""}
          </button>
          <button
            type="button"
            onClick={() => setTab("archive")}
            className={
              "h-9 rounded-full text-xs font-semibold " +
              (tab === "archive" ? "bg-primary text-primary-fg" : "text-muted")
            }
          >
            {t("pet.sec.archive")}
          </button>
          <button
            type="button"
            onClick={() => setTab("book")}
            className={
              "h-9 rounded-full text-xs font-semibold " +
              (tab === "book" ? "bg-primary text-primary-fg" : "text-muted")
            }
          >
            {t("pet.sec.book")}
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1">
          {tab === "book" ? (
            <>
              <p className="text-xs leading-snug text-muted">{t("pet.sec.book.blurb")}</p>
              <button
                type="button"
                disabled={importing}
                onClick={() => {
                  if (importing) return;
                  setImporting(true);
                  setNote(t("pet.sec.importing"));
                  void importPhonebook()
                    .then((res) => {
                      if (!res.ok) {
                        setNote(t("pet.sec.importFail"));
                        play("hurt");
                        return;
                      }
                      const n = onImport(res.names);
                      setNote(t("pet.sec.imported", { n }));
                      play("bonus");
                    })
                    .finally(() => setImporting(false));
                }}
                className="h-11 w-full rounded-full bg-primary font-display text-sm font-semibold text-primary-fg disabled:opacity-40"
              >
                {importing ? t("pet.sec.importing") : t("pet.sec.import")}
              </button>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = nameDraft.replace(/\s+/g, " ").trim();
                  if (n.length < 2) return;
                  onAddContact(n);
                  setNameDraft("");
                  play("tick");
                }}
              >
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={40}
                  placeholder={t("pet.sec.book.ph")}
                  aria-label={t("pet.sec.book.ph")}
                  className="h-11 min-w-0 flex-1 rounded-full border border-border bg-elevated px-4 text-sm text-fg outline-none placeholder:text-subtle"
                />
                <button
                  type="submit"
                  disabled={nameDraft.trim().length < 2}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-fg disabled:opacity-40"
                  aria-label={t("pet.sec.book.add")}
                >
                  <Plus className="size-5" />
                </button>
              </form>
              {book.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">{t("pet.sec.book.empty")}</p>
              ) : (
                book.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-2xl bg-elevated px-3 py-2">
                    <p className="truncate font-display text-sm font-semibold">{c.name}</p>
                    <button
                      type="button"
                      onClick={() => {
                        onDropContact(c.id);
                        play("tick");
                      }}
                      className="grid size-10 shrink-0 place-items-center rounded-full text-muted"
                      aria-label={t("pet.sec.book.add")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))
              )}
            </>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {tab === "new" ? t("pet.sec.noneNew") : t("pet.sec.noneArch")}
            </p>
          ) : (
            rows.map((m) => {
              const openMsg = openId === m.id;
              const known = isKnownAction(m.summary.action) || isKnownAction(m.summary.notes);
              const lines = [
                ["who", m.summary.caller_name],
                ["company", m.summary.company],
                ["back", m.summary.callback],
                ["intent", m.summary.intent],
                ["urgency", m.summary.urgency],
                ["spam", m.summary.spam_risk],
                ["action", known ? t("pet.sec.known") : m.summary.action],
                ["notes", m.summary.notes],
              ].filter(([, v]) => v) as [string, string][];
              return (
                <article
                  key={m.id}
                  className={"rounded-2xl bg-elevated px-3 py-2 " + (!m.read && !m.archived ? "ring-1 ring-primary/60" : "")}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      setOpenId(openMsg ? null : m.id);
                      if (!m.read) onRead(m.id);
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-display text-sm font-semibold">{headlineOf(m)}</p>
                      <span className="shrink-0 text-[11px] text-subtle">{when(m.at, locale)}</span>
                    </div>
                    {known && <p className="mt-0.5 text-[11px] font-semibold text-primary">{t("pet.sec.known")}</p>}
                    <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{m.reply || m.user}</p>
                  </button>
                  {openMsg && (
                    <div className="mt-2 space-y-2 border-t border-border pt-2">
                      {m.user ? (
                        <p className="text-xs leading-snug">
                          <span className="font-semibold text-muted">{t("pet.sec.you")}: </span>
                          {m.user}
                        </p>
                      ) : null}
                      {m.reply ? <p className="text-sm leading-snug text-fg">{m.reply}</p> : null}
                      {lines.map(([k, v]) => (
                        <p key={k} className="text-xs leading-snug">
                          <span className="font-semibold text-muted">{t(FIELD[k] ?? "pet.sec.notes")}: </span>
                          {v}
                        </p>
                      ))}
                      {!m.archived && (
                        <button
                          type="button"
                          onClick={() => {
                            onArchive(m.id);
                            setOpenId(null);
                            play("tick");
                          }}
                          className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-full bg-bg px-3 text-xs font-semibold text-fg"
                        >
                          <Archive className="size-3.5" />
                          {t("pet.sec.file")}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        {secretaryOn && !need && (
          <form
            className="mt-2 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <button
              type="button"
              disabled={busy}
              onPointerDown={(e) => {
                e.stopPropagation();
                const now = Date.now();
                if (now - micTapAt.current < 350) return;
                micTapAt.current = now;
                if (holdingRef.current) stopListen();
                else startListen();
              }}
              className={
                "grid size-12 shrink-0 place-items-center rounded-full text-primary-fg disabled:opacity-40 " +
                (holding ? "bg-danger pet-mic" : "bg-primary")
              }
              aria-label={t("pet.talk")}
            >
              <Mic className="size-5" />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={400}
              placeholder={t("pet.sec.ph")}
              aria-label={t("pet.sec.ph")}
              disabled={busy}
              className="h-12 min-w-0 flex-1 rounded-full border border-border bg-elevated px-4 text-sm text-fg outline-none placeholder:text-subtle"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-fg disabled:opacity-40"
              aria-label={t("pet.sec.go")}
            >
              <Send className="size-5" />
            </button>
          </form>
        )}
        {note && <p className="mt-2 text-center text-xs font-semibold text-muted">{note}</p>}
      </div>
    </div>
  );
}

export function ReportCard({
  report,
  t,
  open,
  onToggle,
}: {
  report: SecretaryReport | null;
  t: TFunc;
  open: boolean;
  onToggle: () => void;
}) {
  if (!report) return null;
  const rows = [
    ["who", report.summary.caller_name],
    ["company", report.summary.company],
    ["back", report.summary.callback],
    ["intent", report.summary.intent],
    ["urgency", report.summary.urgency],
    ["spam", report.summary.spam_risk],
    ["action", report.summary.action],
    ["notes", report.summary.notes],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <button
      type="button"
      onClick={onToggle}
      className={
        "absolute left-3 z-20 max-w-[11.5rem] rounded-2xl bg-bg/80 px-3 py-2 text-left text-fg backdrop-blur-[2px] " +
        "top-[max(4.6rem,calc(env(safe-area-inset-top)+3.6rem))]"
      }
    >
      <p className="font-display text-xs font-semibold tracking-wide text-primary">{t("pet.sec.card")}</p>
      {open ? (
        <ul className="mt-1 space-y-1">
          {rows.length === 0 ? (
            <li className="text-xs text-muted">{t("pet.sec.empty")}</li>
          ) : (
            rows.map(([k, v]) => (
              <li key={k} className="text-xs leading-snug">
                <span className="font-semibold text-muted">{t(FIELD[k] ?? "pet.sec.notes")}: </span>
                {v}
              </li>
            ))
          )}
        </ul>
      ) : (
        <p className="mt-0.5 truncate text-xs text-muted">
          {report.summary.caller_name || report.summary.intent || report.summary.notes || t("pet.sec.empty")}
        </p>
      )}
    </button>
  );
}
