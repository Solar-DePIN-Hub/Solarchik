import { useEffect } from "react";
import { useAgents } from "@/lib/agents/store";
import { laneEnabledOn } from "@/lib/agents/classes";

const STEP = 1.15;

export function useWorkLoop() {
  const working = useAgents((s) => s.working);
  const tick = useAgents((s) => s.tick);

  useEffect(() => {
    if (!working) return;
    let raf = 0;
    let acc = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        tick(Date.now());
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [working, tick]);

  useEffect(() => {
    const poll = () => {
      void useAgents.getState().pollQuote();
      void useAgents.getState().refreshFigures();
    };
    poll();
    const id = window.setInterval(poll, 8000);
    const crypto = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const s = useAgents.getState();
      if (!s.liveArmed || !s.liveAck || s.autoRun) return;
      const cryptoOn = s.nfts.some(
        (n) => s.wallet && n.owner === s.wallet.pubkey && n.classId !== 2 && laneEnabledOn(n.strategy.prediction, "crypto", n.classId),
      );
      if (!cryptoOn) return;
      if (s.grokFlight || s.polyBusy || s.polyTicket || s.polyCancel || s.polyRedeem || s.polyOpenId) return;
      if (s.polyHold && s.polyHold.lane !== "events" && s.polyHold.lane !== "weather") return;
      void s.reviewPoly("crypto");
    }, 8000);
    const onShow = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", poll);
    return () => {
      window.clearInterval(id);
      window.clearInterval(crypto);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", poll);
    };
  }, []);
}