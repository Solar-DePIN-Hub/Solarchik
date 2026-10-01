import { useState } from "react";
import { todayKey, type SaveData } from "@/lib/game/save";
import type { TFunc } from "@/lib/game/i18n";

function shortSig(sig: string) {
  if (sig.length < 12) return sig;
  return `${sig.slice(0, 4)}…${sig.slice(-4)}`;
}

function explorerUrl(sig: string, cluster: string) {
  if (cluster === "devnet") return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  return `https://explorer.solana.com/tx/${sig}`;
}

async function paintCard(opts: {
  shift: string;
  meters: number;
  streak: number;
  mod: string;
  proof: string;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#07131c";
  ctx.fillRect(0, 0, 1080, 1350);
  const img = new Image();
  img.src = "/yard-bg.jpg";
  try {
    await img.decode();
    ctx.drawImage(img, 0, 0, 1080, 1350);
  } catch {
    /* flat ground */
  }
  ctx.fillStyle = "rgba(7, 19, 28, 0.5)";
  ctx.fillRect(0, 0, 1080, 1350);
  const primary =
    getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#e8b931";
  ctx.textAlign = "left";
  ctx.fillStyle = primary;
  ctx.font = "600 72px Fredoka, sans-serif";
  ctx.fillText("Solarchik", 80, 520);
  ctx.fillStyle = "#f4efe4";
  ctx.font = "600 48px Fredoka, sans-serif";
  ctx.fillText(opts.shift, 80, 600);
  ctx.fillText(`${opts.meters} m · streak ${opts.streak}`, 80, 680);
  ctx.fillStyle = primary;
  ctx.fillText(opts.mod, 80, 760);
  ctx.fillStyle = "#f4efe4";
  ctx.font = "500 36px Fredoka, sans-serif";
  ctx.fillText(opts.proof, 80, 840);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob;
}

export function DayCard({
  save,
  t,
  shift,
  modLabel,
}: {
  save: SaveData;
  t: TFunc;
  shift: string;
  modLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const day = todayKey();
  if (save.signedDay !== day || !save.clockSig) return null;
  const short = shortSig(save.clockSig);
  const proof =
    save.clockKind === "tx"
      ? `${save.clockCluster} ${short}`
      : `${t("yard.sigWord")} ${short}`;
  const shareText =
    save.clockKind === "tx"
      ? `CLOCK IN ${save.lastDistance}m · streak ${save.streak}\n${short} · ${save.clockCluster}\n${explorerUrl(save.clockSig, save.clockCluster)}`
      : `CLOCK IN ${save.lastDistance}m · streak ${save.streak}\n${short} · ${save.clockCluster}`;

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await paintCard({
        shift,
        meters: save.lastDistance,
        streak: save.streak,
        mod: modLabel,
        proof,
      });
      if (!blob) return;
      const file = new File([blob], `solarchik-${day}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: shareText });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `solarchik-${day}.png`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      /* share sheet dismissed */
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg bg-surface p-3 text-center">
      <p className="font-display text-lg font-semibold text-fg">Solarchik · {shift}</p>
      <p className="mt-1 text-sm text-fg">
        {save.lastDistance} m · streak {save.streak}
      </p>
      <p className="mt-1 text-sm font-semibold text-primary">{modLabel}</p>
      <p className="mt-1 truncate text-xs text-muted">{proof}</p>
      <button
        type="button"
        onClick={() => void share()}
        disabled={busy}
        className="mt-3 flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-fg disabled:opacity-50"
      >
        {t("yard.share")}
      </button>
    </section>
  );
}
