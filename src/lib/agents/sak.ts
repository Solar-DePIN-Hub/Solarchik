import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { KeypairWallet, SolanaAgentKit } from "solana-agent-kit";
import { confirmSig, getConn, rpcUrl } from "./chain";

const PAPER_DECIMALS = 6;

/**
 * DEX execution through Solana Agent Kit.
 * The kit wallet (KeypairWallet) signs, the kit connection lands the tx.
 * On this validator Jupiter isn't available, so the swap leg is the kit's
 * SOL/SPL transfer — the same action as TokenPlugin.transfer, without importing
 * the plugin barrel (it pulls pump.fun and breaks the browser bundle).
 */
function kitFor(payer: Keypair) {
  const wallet = new KeypairWallet(payer, rpcUrl());
  return new SolanaAgentKit(wallet, rpcUrl(), {});
}

export async function sakMove(args: {
  from: Keypair;
  to: PublicKey;
  amount: number;
  mint: PublicKey | null;
}): Promise<string> {
  const amount = Number(args.amount.toFixed(4));
  if (!(amount > 0)) throw new Error("Сума DCA нульова");
  const agent = kitFor(args.from);
  const tx = new Transaction();
  if (!args.mint) {
    const lamports = Math.round(amount * 1_000_000_000);
    if (lamports <= 0) throw new Error("Сума DCA нульова");
    tx.add(
      SystemProgram.transfer({
        fromPubkey: args.from.publicKey,
        toPubkey: args.to,
        lamports,
      }),
    );
  } else {
    const raw = BigInt(Math.round(amount * 10 ** PAPER_DECIMALS));
    if (raw <= 0n) throw new Error("Сума DCA нульова");
    const fromAta = getAssociatedTokenAddressSync(args.mint, args.from.publicKey);
    const toAta = getAssociatedTokenAddressSync(args.mint, args.to);
    const info = await getConn().getAccountInfo(toAta);
    if (!info) {
      tx.add(createAssociatedTokenAccountInstruction(args.from.publicKey, toAta, args.to, args.mint));
    }
    tx.add(
      createTransferCheckedInstruction(
        fromAta,
        args.mint,
        toAta,
        args.from.publicKey,
        raw,
        PAPER_DECIMALS,
      ),
    );
  }
  const latest = await agent.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = args.from.publicKey;
  const signed = await agent.wallet.signTransaction(tx);
  const signature = await agent.connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
  await confirmSig(signature);
  return signature;
}
