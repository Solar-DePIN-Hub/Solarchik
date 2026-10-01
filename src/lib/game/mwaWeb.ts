import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { encodeBase58 } from "@/lib/agents/base58";
import { PAY_WALLET } from "@/lib/game/pay";
import { dayMod, todayKey } from "./save";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
let registered = false;

export type MwaProof =
  | { ok: true; address: string; signature: string; cluster: "mainnet" | "devnet"; kind: "tx" | "message" }
  | { ok: false; error: string };

type MwaAccount = { address: string; publicKey: Uint8Array; chains: readonly string[] };
type MwaWallet = {
  name: string;
  features: {
    "standard:connect"?: { connect: () => Promise<{ accounts: readonly MwaAccount[] }> };
    "solana:signAndSendTransaction"?: {
      signAndSendTransaction: (input: {
        account: MwaAccount;
        transaction: Uint8Array;
        chain: string;
      }) => Promise<readonly { signature: Uint8Array }[]>;
    };
    "solana:signMessage"?: {
      signMessage: (input: { account: MwaAccount; message: Uint8Array }) => Promise<readonly { signature: Uint8Array }[]>;
    };
  };
};

function androidPhone(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");
}

function stopped(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("declin") || message.includes("reject") || message.includes("cancel") || message.includes("denied");
}

async function ensureWallet() {
  if (registered) return;
  const mwa = await import("@solana-mobile/wallet-standard-mobile");
  registered = true;
  mwa.registerMwa({
    appIdentity: {
      name: "Solarchik",
      uri: "https://solardepin.net",
      icon: "favicon.ico",
    },
    authorizationCache: mwa.createDefaultAuthorizationCache(),
    chains: ["solana:mainnet", "solana:devnet"],
    chainSelector: mwa.createDefaultChainSelector(),
    onWalletNotFound: async () => {},
  });
}

async function memoBytes(payer: PublicKey, rpc: string, memo: string): Promise<Uint8Array> {
  const connection = new Connection(rpc, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
  tx.add(
    new TransactionInstruction({
      programId: MEMO,
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      data: Buffer.from(memo, "utf8"),
    }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}

export async function signClockInMwa(meters: number, _score: number, streak: number): Promise<MwaProof> {
  if (!androidPhone()) return { ok: false, error: "no-wallet" };
  try {
    await ensureWallet();
    const [{ getWallets }, mwa] = await Promise.all([
      import("@wallet-standard/app"),
      import("@solana-mobile/wallet-standard-mobile"),
    ]);
    const wallet = getWallets()
      .get()
      .find((item) => item.name === mwa.SolanaMobileWalletAdapterWalletName) as MwaWallet | undefined;
    if (!wallet) return { ok: false, error: "wallet" };
    const feature = wallet.features["standard:connect"];
    if (!feature) return { ok: false, error: "wallet" };
    const { accounts } = await feature.connect();
    const account = accounts[0];
    if (!account?.address || account.address.length < 32) return { ok: false, error: "Wallet signed without account" };
    const chain = account.chains.includes("solana:mainnet") ? "solana:mainnet" : "solana:devnet";
    const cluster = chain === "solana:mainnet" ? "mainnet" : "devnet";
    const rpc = cluster === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
    const day = todayKey();
    const memo = `solarchik clock ${day} ${meters | 0}m s${streak | 0} ${dayMod(day)}`;
    const send = wallet.features["solana:signAndSendTransaction"];
    if (send) {
      try {
        const raw = await memoBytes(new PublicKey(account.publicKey), rpc, memo);
        const out = await send.signAndSendTransaction({ account, transaction: raw, chain });
        const sig = encodeBase58(out[0]?.signature ?? new Uint8Array());
        if (sig.length >= 32) return { ok: true, address: account.address, signature: sig, cluster, kind: "tx" };
      } catch (error) {
        if (stopped(error)) return { ok: false, error: error instanceof Error ? error.message : "Wallet did not sign" };
      }
    }
    const sign = wallet.features["solana:signMessage"];
    if (!sign) return { ok: false, error: "wallet" };
    const signed = await sign.signMessage({ account, message: new TextEncoder().encode(memo) });
    const sig = encodeBase58(signed[0]?.signature ?? new Uint8Array());
    if (sig.length < 32) return { ok: false, error: "Wallet sent no signature" };
    return { ok: true, address: account.address, signature: sig, cluster, kind: "message" };
  } catch (error) {
    if (stopped(error)) return { ok: false, error: error instanceof Error ? error.message : "Wallet did not sign" };
    return { ok: false, error: "wallet" };
  }
}

/** Devnet SOL to the game treasury. Refuses a mainnet-only wallet instead of charging it. */
export async function payTreasuryMwa(sol: number): Promise<{ ok: true; sig: string } | { ok: false; error: string }> {
  if (!androidPhone()) return { ok: false, error: "no-wallet" };
  if (!(sol > 0)) return { ok: false, error: "amount" };
  try {
    await ensureWallet();
    const [{ getWallets }, mwa] = await Promise.all([
      import("@wallet-standard/app"),
      import("@solana-mobile/wallet-standard-mobile"),
    ]);
    const wallet = getWallets()
      .get()
      .find((item) => item.name === mwa.SolanaMobileWalletAdapterWalletName) as MwaWallet | undefined;
    if (!wallet?.features["standard:connect"] || !wallet.features["solana:signAndSendTransaction"]) {
      return { ok: false, error: "wallet" };
    }
    const { accounts } = await wallet.features["standard:connect"].connect();
    const account = accounts[0];
    if (!account?.publicKey) return { ok: false, error: "wallet" };
    if (!account.chains.includes("solana:devnet")) return { ok: false, error: "mainnet-only" };
    const payer = new PublicKey(account.publicKey);
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: new PublicKey(PAY_WALLET),
        lamports: Math.round(sol * 1_000_000_000),
      }),
    );
    const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const out = await wallet.features["solana:signAndSendTransaction"].signAndSendTransaction({
      account,
      transaction: raw,
      chain: "solana:devnet",
    });
    const sig = encodeBase58(out[0]?.signature ?? new Uint8Array());
    if (sig.length < 32) return { ok: false, error: "Wallet sent no signature" };
    return { ok: true, sig };
  } catch (error) {
    if (stopped(error)) return { ok: false, error: error instanceof Error ? error.message : "Wallet did not sign" };
    return { ok: false, error: "wallet" };
  }
}
