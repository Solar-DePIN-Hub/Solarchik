import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { WorkApp } from "@/components/work/work-app";
import type { Locale } from "@/lib/game/i18n";
import { translateText } from "./work-translate";

const ATTRS = ["placeholder", "aria-label", "title"] as const;

function paintLocale(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const raw = node.nodeValue ?? "";
    const value = translateText(raw);
    if (value !== raw) node.nodeValue = value;
    node = walker.nextNode();
  }
  root.querySelectorAll<HTMLElement>("[placeholder], [aria-label], [title]").forEach((el) => {
    for (const attr of ATTRS) {
      const cur = el.getAttribute(attr);
      if (!cur) continue;
      const mapped = translateText(cur);
      if (mapped !== cur) el.setAttribute(attr, mapped);
    }
  });
}

export function WorkDesk({ locale, onBack }: { locale: Locale; onBack: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || locale === "uk") return;
    let timer = 0;
    const mo = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        mo.disconnect();
        paintLocale(root);
        mo.observe(root, { subtree: true, childList: true, characterData: true });
      }, 80);
    });
    paintLocale(root);
    mo.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      mo.disconnect();
    };
  }, [locale]);

  return (
    <div className="pet-work-layer fixed inset-0 z-[240] bg-bg">
      <button
        type="button"
        onClick={onBack}
        className="absolute left-3 top-[max(0.45rem,env(safe-area-inset-top))] z-40 grid size-11 place-items-center rounded-full bg-bg/80 text-fg"
        aria-label={locale === "uk" ? "Назад" : "Back"}
      >
        <ArrowLeft className="size-5" />
      </button>
      <div ref={ref} className="h-full">
        <WorkApp />
      </div>
    </div>
  );
}
