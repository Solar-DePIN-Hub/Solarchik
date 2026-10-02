# Strategy NFTs: devnet run (2026-10-02)

Real devnet transactions made by `scripts/strategy-devnet-run.ts` with the real server code
(`strategy.server.ts`, `mint.server.ts`, positions ledger) on a persistent PGLite database.
The server clock was never shifted: the 240 h sale lock is honoured exactly as in production.
Times are UTC (Kyiv = UTC+3).

- Server authority (collection update authority, freeze / transfer delegate): `8eKeV2Vh7QhGHjsTgQN2m938iyeALqsGyhSiNQRJAxR3`
- Server collection: [`74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC`](https://explorer.solana.com/address/74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC?cluster=devnet)
- Seller (test wallet, owns the demo NFTs): [`u2irHRaCwjogBYjdRQK7NmmzkGtLZzUqGfsSWAqsrQq`](https://explorer.solana.com/address/u2irHRaCwjogBYjdRQK7NmmzkGtLZzUqGfsSWAqsrQq?cluster=devnet)
- Buyer (test wallet): [`Gkgpdi8M9ZzHVHB9HsqthyS7c5fVMvRbsgjE6E212yTw`](https://explorer.solana.com/address/Gkgpdi8M9ZzHVHB9HsqthyS7c5fVMvRbsgjE6E212yTw?cluster=devnet)

## Funding

| Step | Transaction |
| --- | --- |
| 0.8 SOL authority → seller | [2ojJB3Gq…zSuY2](https://explorer.solana.com/tx/2ojJB3Gq6xDr9GQAUZL6SqgwJHhsizTAntQMAdeUZn2z7THvjfhUN3coKLParVeBoNp3HbEUPUbWcKi6zBszSuY2?cluster=devnet) |
| 0.8 SOL authority → buyer | [LJkdXWPY…5kx9zw](https://explorer.solana.com/tx/LJkdXWPYL8kSmBQzUAxq3LGdxv9W7Tzibm3iW1JFdcPCgoxRiiFN3FtsYNSzYco8LNVSYVQj3CvnCKF6F5kx9zw?cluster=devnet) |

## Lock test NFT `Lock Test BTC Windows`

Asset [`BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip`](https://core.metaplex.com/explorer/BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip?env=devnet), owner: seller.

| Step | Result | Transaction |
| --- | --- | --- |
| 1 collection setup (first mint) | ok | [5DN2JdkP…dwPh](https://explorer.solana.com/tx/5DN2JdkPAtn7dWUmrdWUDohiFwXMXjqpFxDU6rkV13BJ8jBTv5YvgoqgYWmHRDYq1aDimKuvVaifuLmo3taZwdPh?cluster=devnet) |
| 1 co-signed mint, strategy v1, frozen under the server | ok | [3iToTdZK…EhP3](https://explorer.solana.com/tx/3iToTdZKs6rEnbYF8nvhDwNaNgNVemHp4Zs7GwrABRn2xM6jVa8YKXYREjb4C1mCBG6Pfy1MZmyY3cGrH96dEhP3?cluster=devnet) |
| 2 strategy change → v2 (hash `3vsiGK9V…`), sale lock reset to 2026-10-12 16:38 UTC | ok | [FU9HaQSH…wY6p6](https://explorer.solana.com/tx/FU9HaQSHsQqU9x2s9T7HogELLk3b51i2jMdfkLFhHLzbqnEiZb6LGdt3NT6tN55HLBbqskNDyJsh65JpqwgY7p6?cluster=devnet) |
| 3 listing while locked | refused by the server (no tx) | — |
| 3 owner transfer while frozen | **failed on chain** (mpl-core 0x9), owner unchanged | [2kUUn4L8…N9if](https://explorer.solana.com/tx/2kUUn4L8rNN6ntfEvMawocHDqsrysdSdEhoxYbuugZuSH3wnUw1rz8Zjgdqhg9HaouA3ghvw7g5MhMJfeHTxN9if?cluster=devnet) |
| 4 off-strategy trade (stake 0.02 > 0.015) | refused by the server | — |
| 4 server writes results: 3 trades, win 66.7%, PnL 0.0045 SOL, APR 7d/30d/since 10950% | ok; judge recompute matches | [3JZbHzWk…TqH](https://explorer.solana.com/tx/3JZbHzWkShuR54dc46frsas2zrBK6vSNPGuxwYaWoDHoZTGttkKGTghUpm8UjxxEEoR4Sk8zzwivPTh5GjwbjTqH?cluster=devnet) |
| 5 judge faucet drip 0.02 SOL to a fresh wallet (second ask refused) | ok | [4fYWrcsC…aJnA](https://explorer.solana.com/tx/4fYWrcsC1tUaK8uogzJ89tWXGAVGdiceCRGL4jsSkn8n3ZVYz5cSXNQFrepq5d7T6SfmJT94UhNX37ZEVYbdaJnA?cluster=devnet) |

The trades behind the results are scripted entries in the server ledger (simulated prices, like browser
trades); the results write itself is a real server-signed devnet transaction.

## Demo Strategy NFTs (seller wallet)

Each was minted with its own strategy (v1) and is frozen under the server. No strategy change after mint;
the sale lock still runs 240 h from the mint, so the server refuses listing until it ends.

| Name | Strategy | Asset | Mint tx | Sale lock ends (UTC) | Planned price |
| --- | --- | --- | --- | --- | --- |
| Calm Hourly BTC | crypto 60/240 min, calm, stake 0.005, band 0.35–0.65, stop 25 %, take 40 %, `allow if price >= 0.4 and price <= 0.6; deny if hour < 6` | [`sZ4R4sbU…DfVH`](https://core.metaplex.com/explorer/sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH?env=devnet) | [2G2RoFqf…dSU5](https://explorer.solana.com/tx/2G2RoFqfTnaACG3arUYGbXqngSYBgVnK6agb8LGtJ8MXHcfPcSJEeK4ZZkLZMjRcNvHvvQ9epun476B8DvB5dSU5?cluster=devnet) | 2026-10-12 16:38 | 0.05 SOL |
| Momentum Rider 5m | crypto 5/15 min, risky, stake 0.02, band 0.55–0.90, stop 50 %, take 120 %, `allow yes if price >= 0.6; allow no if price >= 0.6; deny if price > 0.88` | [`AV8EgTtP…EWX`](https://core.metaplex.com/explorer/AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX?env=devnet) | [3NHFpwDB…JtWY](https://explorer.solana.com/tx/3NHFpwDB5KcNTC395HYtgedwdqRJL86wwrjKY99KV5takTykqyLexnzrGcdBHPYuueNPumfTLB5PcXhafNPhJtWY?cluster=devnet) | 2026-10-12 16:38 | 0.12 SOL |
| Mean Revert Scout | crypto + events 15/60 min, balanced, stake 0.01, band 0.10–0.40, stop 35 %, take 150 %, `allow if price <= 0.35; deny if price < 0.12; deny if lane = events and stake > 0.008` | [`2ijiD193…dsK7`](https://core.metaplex.com/explorer/2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7?env=devnet) | [2BTpdJTs…uXdL](https://explorer.solana.com/tx/2BTpdJTszR4ShNKHmfEakoff8dFySwibwUS5hnJneNi7xfNbVimaTw2m8RMRjbBNgFLvUyfvKTDjqP3585bUuXdL?cluster=devnet) | 2026-10-12 16:38 | 0.08 SOL |

## Not done yet: list + buy on devnet

Every mint starts the 240 h lock (strategy v1 is written at mint), so no NFT in this run can be listed
before 2026-10-12 16:38 UTC. Listing + escrow + buy with the 5% royalty were run end to end only on a local
validator with the real mpl-core program (server clock advanced in that test only). After the lock ends:

```
JITI_ALIAS='{"@/":"<repo>/src/"}' PHASE=market npx jiti scripts/strategy-devnet-run.ts
```

lists the three demo NFTs at the prices above and lists + buys the lock test NFT with the buyer wallet.
