import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { PAY_WALLET } from "@/lib/game/pay";
import { payTreasuryMwa } from "@/lib/game/mwaWeb";
import { getConn } from "./chain";

type PhantomSend = {
  signAndSendTransaction: (tx: VersionedTransaction) => Promise<{ signature?: string } | string>;
};

function sigOf(sent: { signature?: string } | string): string {
  if (typeof sent === "string") return sent;
  return sent.signature ?? "";
}

/** Devnet transfer from the player's wallet to the game treasury. Room key is not the payer. */
export async function paySkuFromPlayer(
  sol: number,
  from: string | null,
  phantom: PhantomSend | null,
): Promise<{ ok: true; sig: string } | { ok: false; reason: string }> {
  if (!(sol > 0)) return { ok: false, reason: "Ціна не задана." };
  if (phantom && from && from.length >= 32) {
    try {
      const conn = getConn();
      const payer = new PublicKey(from);
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const ix = SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: new PublicKey(PAY_WALLET),
        lamports: Math.round(sol * LAMPORTS_PER_SOL),
      });
      const message = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();
      const sig = sigOf(await phantom.signAndSendTransaction(new VersionedTransaction(message)));
      if (sig.length < 32) return { ok: false, reason: "Гаманець не повернув підпис. Мінт не почато." };
      return { ok: true, sig };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Гаманець не підписав.";
      return { ok: false, reason: message.slice(0, 180) };
    }
  }
  const phone = await payTreasuryMwa(sol);
  if (phone.ok) return phone;
  if (phone.error === "mainnet-only") {
    return { ok: false, reason: "Seeker на mainnet. Оплата Pro поки лише Devnet. Нічого не списано." };
  }
  return { ok: false, reason: "Підключи Phantom або гаманець телефону. Оплата з ключа кімнати не йде." };
}
