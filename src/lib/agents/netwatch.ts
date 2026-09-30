import { healDevnet, type SlotProbe } from "./rpc-heal";

export type SolProbe = SlotProbe;

/** Confirmed getSlot. If the desk proxy is dead, pins the public Devnet for later reads. */
export async function probeDevnet(): Promise<SolProbe> {
  const healed = await healDevnet();
  return healed.probe;
}
