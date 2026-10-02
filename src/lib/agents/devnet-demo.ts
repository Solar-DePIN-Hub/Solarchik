/**
 * Real devnet addresses of the Strategy NFT run (scripts/strategy-devnet-run.ts, 2026-10-02).
 * Public addresses and signatures only. Rule: a fresh mint (strategy v1) is not locked; every strategy
 * change locks sale for 240 h (FreezeDelegate under the server).
 */
export const DEVNET_STRATEGY = {
  /** Server key of that run (collection update authority, freeze / transfer delegate). */
  authority: "8eKeV2Vh7QhGHjsTgQN2m938iyeALqsGyhSiNQRJAxR3",
  /** Server collection (derived from the authority key). */
  collection: "74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC",
  /** Royalty receiver (PAY_WALLET). */
  treasury: "8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic",
  seller: "u2irHRaCwjogBYjdRQK7NmmzkGtLZzUqGfsSWAqsrQq",
  buyer: "Gkgpdi8M9ZzHVHB9HsqthyS7c5fVMvRbsgjE6E212yTw",
  /** Lock test: mint -> strategy change (v2) -> transfer refused by Core -> server-written results. Locked until unlockSec. */
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
  /**
   * Demo NFTs, listed by the seller (server escrow). They were minted while the lock wrongly started at mint;
   * with no strategy change ever, the server released that lock (su = sc) and thawed them before listing.
   */
  demos: [
    {
      asset: "sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH",
      name: "Calm Hourly BTC",
      style: "calm",
      priceSol: 0.05,
      mintTx: "2G2RoFqfTnaACG3arUYGbXqngSYBgVnK6agb8LGtJ8MXHcfPcSJEeK4ZZkLZMjRcNvHvvQ9epun476B8DvB5dSU5",
      releaseTx: "5yatn3Yb4oDDoCauJm5zodhLq4QiqbXqUDdKg8NiaYhtwyRF1cEWXsyUV4AuFWKhNYz1pRZSvpuxnmSRDe9azKFM",
      resultsInitTx: "2E4dPPLhvwUFPbywFFnsg7apcjL4EjDua8iAmJRVNu6iZpDKw1SGbVc8Bm57xUxVNDXgP1Ny3zmQiH2NXPE521EB",
      thawTx: "4P2noFsfVtaLL7pnrtaR1xoFnA5DboeZErsYBCL6rCtqSDEvBK5JPFQqxeFHriHzzJXCn7wvaidwQ4AH1DTeoS4L",
      listTx: "QfaYpuPfTW9rMXwzjsiPKcLir9oB9z5nBzHBAFuoETrw7VqYde3yrWq4T7mwc1VneGzb3uczeZxm15dyRov7GJC",
    },
    {
      asset: "AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX",
      name: "Momentum Rider 5m",
      style: "momentum",
      priceSol: 0.12,
      mintTx: "3NHFpwDB5KcNTC395HYtgedwdqRJL86wwrjKY99KV5takTykqyLexnzrGcdBHPYuueNPumfTLB5PcXhafNPhJtWY",
      releaseTx: "5WarpShYdAgN9DYQqsfdLrXtTkGdaMX4sQwXdTQyWGmh21URwonCwVZA3EXUVJpFs4EFTAnHgTviq9AS3W5QY8v1",
      resultsInitTx: "2Zz55YXLGVHEmWhKUVNYaXGrwFtHZuv37LKKenMpp56CgkQVBsEnTRuYagfxvdXbFxZwCQXQ63tXCzWJNsF8EdWh",
      thawTx: "4S3F9rwfeP1k1AK9Tni5bMpZRBX8y37yKC2ByWwzBzEeZMZbzn91ZE2RXz5q4PuBVKDvFt4ewhZd2oXYU766Bd5H",
      listTx: "8nMNNV81tiiou4ELEfpFWvvNsmCUTFx9LiNeQxpj5mfx4TzUkR5E4epxFdYCN5ne1BG3gCpePrXDWddjyuPyWi3",
    },
    {
      asset: "2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7",
      name: "Mean Revert Scout",
      style: "mean-reversion",
      priceSol: 0.08,
      mintTx: "2BTpdJTszR4ShNKHmfEakoff8dFySwibwUS5hnJneNi7xfNbVimaTw2m8RMRjbBNgFLvUyfvKTDjqP3585bUuXdL",
      releaseTx: "3UwL52amkCWY2nYxtU49yeirrTpRuQ2eyxptzJZY9n2E8YeW8stMDbGKepXuJocjufsw4vvqT7pQ1xHmQM4v3SRN",
      resultsInitTx: "Cc6M9D32DdaCXiwn6TjX4pwZUZvCjXx1iuc6M2bRZ2hZ3YNk1gt5b2ZNYe8rx2AY8nWd61oBGL6at4uGgghSNvH",
      thawTx: "4sdpn8ZQgVoC7nCR4guHoKyvnLTJQH6HE4kKdPPDfKmUcJ96VyrYWUd9whELZ7mw2vkWMxA7DCoukGKMhdJsDhN1",
      listTx: "3cVcTaBrAQbV8WhqkTK2ZnbnwXRNXboJo9yDBDxu31eW8PXVa114SgtMAZETrRgTSsB7XpEMGCtKzMH7zkXWv3H4",
    },
  ],
  /** Market test: fresh mint (no lock) -> listed -> bought (95/5) -> buyer changed the strategy -> locked again. */
  marketTest: {
    asset: "8vSSKk1Eio44Ja265FR6WvfDr2QvmBPLsrtjnoEUHjWe",
    name: "Market Test",
    priceSol: 0.02,
    mintTx: "5RwMow4oQJvZqc1n5SVmV8RscdGaq65ebKHeDZNFhnKSjZMkyCGcJwoNHzX2ker2kvdDiL5M8kt5GLTyAY58nNuE",
    listTx: "4jquQRLLTLm9e9SenyprJVffuYiiqNVuzAHFKofQpCN73rk37PM1Ty4zEjYSUDqdpDJ5rymV1gZUSMHeqBowkAQw",
    /** Buyer pays 0.019 SOL to the seller and 0.001 SOL royalty to the treasury; server thaws and transfers. */
    buyTx: "4cJkFGAC7UqKWwxCcKGnpFVgcmkXsB41zwvXp5FEwMFER7n5zsuDEvx2wZyiDYSEXhMhS2zAW9ULUxNppL9oiSc9",
    strategyTxs: ["4k8mwdhyvGYXACfvzXAbMjUtbk2Dm63zNc5DoCTNze5x7wg3eRSPJPEV6NVJvk12vz54rtNBYCZjhA32SBu75rfE", "37xLuoN5AsQRVqqdZf8Jwptgjx4k6RPxKBY3AY3V1Dfs7CL9Ht7kao8g5QjohA1WDxo3b3rMfbvytnGNv4qCn6LK"],
    /** New owner's transfer after the change: failed on chain (0x9). */
    refusedTransferTx: "mRda1HJ4C9wQy1i4EopJKaH1aNpFUvBRtcjLfTNPkUQxw5nXAn7XmU9B5uJNz88CSWprimSWaykQno3qJXabsW8",
    unlockSec: 1791823801,
  },
} as const;
