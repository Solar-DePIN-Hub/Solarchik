/**
 * Real devnet addresses of the Strategy NFT run (scripts/strategy-devnet-run.ts, 2026-10-02).
 * Public addresses and signatures only. The demo NFTs belong to the test seller wallet; each was
 * minted with its strategy (v1) and is frozen under the server until its 240 h sale lock ends.
 */
export const DEVNET_STRATEGY = {
  /** Server key of that run (collection update authority, freeze / transfer delegate). */
  authority: "8eKeV2Vh7QhGHjsTgQN2m938iyeALqsGyhSiNQRJAxR3",
  /** Server collection (derived from the authority key). */
  collection: "74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC",
  seller: "u2irHRaCwjogBYjdRQK7NmmzkGtLZzUqGfsSWAqsrQq",
  buyer: "Gkgpdi8M9ZzHVHB9HsqthyS7c5fVMvRbsgjE6E212yTw",
  /** Lock test: mint -> strategy change (v2) -> transfer refused by Core -> server-written results. */
  lockTest: {
    asset: "BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip",
    name: "Lock Test BTC Windows",
    mintTxs: ["5DN2JdkPAtn7dWUmrdWUDohiFwXMXjqpFxDU6rkV13BJ8jBTv5YvgoqgYWmHRDYq1aDimKuvVaifuLmo3taZwdPh", "3iToTdZKs6rEnbYF8nvhDwNaNgNVemHp4Zs7GwrABRn2xM6jVa8YKXYREjb4C1mCBG6Pfy1MZmyY3cGrH96dEhP3"],
    strategyTx: "FU9HaQSHsQqU9x2s9T7HogELLk3b51i2jMdfkLFhHLzbqnEiZb6LGdt3NT6tN55HLBbqskNDyJsh65JpqwgY7p6",
    /** Owner transfer while frozen: failed on chain (mpl-core custom error 0x9). */
    refusedTransferTx: "2kUUn4L8rNN6ntfEvMawocHDqsrysdSdEhoxYbuugZuSH3wnUw1rz8Zjgdqhg9HaouA3ghvw7g5MhMJfeHTxN9if",
    resultsTx: "3JZbHzWkShuR54dc46frsas2zrBK6vSNPGuxwYaWoDHoZTGttkKGTghUpm8UjxxEEoR4Sk8zzwivPTh5GjwbjTqH",
    unlockSec: 1791823081,
  },
  demos: [
    { asset: "sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH", name: "Calm Hourly BTC", style: "calm", mintTx: "2G2RoFqfTnaACG3arUYGbXqngSYBgVnK6agb8LGtJ8MXHcfPcSJEeK4ZZkLZMjRcNvHvvQ9epun476B8DvB5dSU5", unlockSec: 1791823103, priceSol: 0.05 },
    { asset: "AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX", name: "Momentum Rider 5m", style: "momentum", mintTx: "3NHFpwDB5KcNTC395HYtgedwdqRJL86wwrjKY99KV5takTykqyLexnzrGcdBHPYuueNPumfTLB5PcXhafNPhJtWY", unlockSec: 1791823106, priceSol: 0.12 },
    { asset: "2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7", name: "Mean Revert Scout", style: "mean-reversion", mintTx: "2BTpdJTszR4ShNKHmfEakoff8dFySwibwUS5hnJneNi7xfNbVimaTw2m8RMRjbBNgFLvUyfvKTDjqP3585bUuXdL", unlockSec: 1791823110, priceSol: 0.08 },
  ],
} as const;
