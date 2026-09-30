import { repairAudio, speakLocal } from "@/lib/game/audio";
import { readMainnetSlot } from "./mainnet";
import { pingAgent } from "./ping";
import { healDevnet } from "./rpc-heal";
import { useAgents } from "./store";

export type FixRow = { name: string; ok: boolean; text: string };

function storageRow(): FixRow {
  try {
    const key = "solarchik-desk-check";
    window.localStorage.setItem(key, "1");
    const value = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);
    if (value !== "1") return { name: "Сховище", ok: false, text: "Сховище не зберегло запис." };
    return { name: "Сховище", ok: true, text: "Сховище пише." };
  } catch {
    return { name: "Сховище", ok: false, text: "Сховище заблоковане. Відкрий звичайне вікно." };
  }
}

async function devnetRow(): Promise<FixRow> {
  const healed = await healDevnet();
  if (healed.switched && healed.probe.ok) {
    return { name: "Devnet", ok: true, text: `Перемкнув Devnet на публічний вузол. Слот ${healed.probe.slot}.` };
  }
  if (healed.probe.ok) return { name: "Devnet", ok: true, text: `Devnet живий. Слот ${healed.probe.slot}.` };
  return { name: "Devnet", ok: false, text: healed.probe.error || "Devnet не відповідає." };
}

async function mainnetRow(): Promise<FixRow> {
  try {
    const slot = await readMainnetSlot();
    if (typeof slot === "number") return { name: "Mainnet", ok: true, text: `Mainnet живий. Слот ${slot}.` };
  } catch {
    /* server function failed closed */
  }
  return { name: "Mainnet", ok: false, text: "Mainnet не відповідає." };
}

async function walletRow(): Promise<FixRow> {
  const before = useAgents.getState();
  const had = Boolean(before.wallet);
  const missed = before.solMiss || !before.solKnown;
  if (!had || missed) {
    try {
      await useAgents.getState().ensureWallet();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Гаманець не відкрився.";
      return { name: "Гаманець", ok: false, text: message };
    }
  }
  const now = useAgents.getState();
  if (!now.wallet) return { name: "Гаманець", ok: false, text: "Гаманець не створився." };
  if (now.notice === "Ключ не розшифрувався") {
    return { name: "Гаманець", ok: false, text: "Ключ не розшифрувався. Встав записаний секрет." };
  }
  if (now.solMiss || !now.solKnown) return { name: "Гаманець", ok: false, text: "Баланс Devnet не зчитався." };
  if (!had) return { name: "Гаманець", ok: true, text: "Створив гаманець на цьому пристрої." };
  if (missed) return { name: "Гаманець", ok: true, text: `Баланс зчитав знову. ${now.sol.toFixed(4)} SOL.` };
  return { name: "Гаманець", ok: true, text: `Гаманець на місці. ${now.sol.toFixed(4)} SOL.` };
}

async function agentRow(): Promise<FixRow> {
  try {
    const ping = await pingAgent();
    if (ping.ok) return { name: "Агент", ok: true, text: "Агент відповів." };
  } catch {
    /* network */
  }
  return { name: "Агент", ok: false, text: "Агент не відповів." };
}

export async function runDeskFix(speak: boolean): Promise<FixRow[]> {
  const storage = storageRow();
  const voice = repairAudio();
  if (speak) speakLocal("Перевірка готова.", "uk");
  const devnet = await devnetRow();
  const [mainnet, wallet, agent] = await Promise.all([mainnetRow(), walletRow(), agentRow()]);
  return [storage, devnet, mainnet, wallet, { name: "Голос", ok: voice.ok, text: voice.text }, agent];
}
