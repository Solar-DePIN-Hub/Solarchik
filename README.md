# Solarchik

A solar robot game for Solana Mobile: a roof runner, a daily wallet-signed **CLOCK IN**, and a **Work** desk where strategy-NFT agents read real markets. This branch (`web-fees`) is the web app; the native Android app is on branch `native-full`.

Українською: [README.uk.md](README.uk.md).

## For judges

- **Live app:** https://solarchik-market.vercel.app — Solana **devnet** only. "Get devnet SOL" on the desk funds a fresh room wallet: public devnet airdrop first, then the server faucet (0.2 SOL, one per wallet per day). If the faucet wallet runs low the server falls back to a devnet airdrop for that wallet; if devnet is rate-limited too, the desk says so and points to faucet.solana.com.
- **APK:** there is no GitHub release. `public/Solarchik-CLOCK-IN-0.19.51.apk` is an old 0.19.51 build, not the review build. The current Android source is branch `native-full` (0.21.x, native Kotlin, no WebView). APKs built before commit `22a84a3` call the old server `solarchik-super-app.vercel.app`, which has no `/api/native/*` routes, so their market tab fails; build the judge APK from current `native-full` (server `https://solarchik-market.vercel.app`). Build steps and hashes: `artifacts/solarchik-handoff/NATIVE_PROGRESS.md` on that branch.
- **Network:** devnet for mints, payments, fees and the market. Nothing on this deploy moves mainnet funds.
- **What is real:** Polymarket markets and prices, Backpack order books and Titan/Jupiter quotes (read only), Metaplex Core strategy NFTs on devnet, devnet payments (Pro mint 0.1 devnet SOL, Free 5% fee), the strategy NFT market and its 240 h sale lock, Sol chat (Gemini) and voice input/output.
- **What is simulated (labelled in the UI):**
  - Live real-money trading is **off**. Every real-money path — Polymarket CLOB orders (manual and auto mode), the Polymarket deposit relayer and Solana→pUSD bridge, mainnet top-ups of the arb treasury and mainnet arb fills on Backpack — is gated behind the server env flag `LIVE_TRADING_ENABLED` (unset = off; see `src/lib/agents/live-trading.ts`). With it off the UI does not offer live mode and the server refuses those calls. Turning it on requires geo-blocking and a legal review first.
  - Prediction agents trade paper / devnet stakes priced from real Polymarket prices.
  - The arb desk runs as `SIMULATION · devnet, no money` on real Backpack spreads; no orders are sent and no credit is spent.
  - AI decisions: the prediction agent asks Grok and falls back to Gemini. This deploy has no xAI key, so Gemini answers, and the desk labels each decision with the model that actually made it.
- **Strategy NFT results on chain:** the server records each live (devnet-stake) prediction open and close in its own position ledger (Postgres on Neon, linked through the Vercel Neon integration as `POSTGRES_URL`; `DATABASE_URL` also works) and, after each close, writes trades / win rate / PnL / APR into the NFT attributes with the server key. Live proof from the public deploy: a position on the Market Test NFT opened and closed through `/api/native/position-open` / `position-close` (2026-10-02), and the server's results write on chain ([tx](https://explorer.solana.com/tx/4z8UG2F5LBbqtUdYkznxFrjFuwovRncjox83pqyXpZDhsByvqfqocxmrVAcnosxF6K2Nm5StN4etifXJiYTD6p71?cluster=devnet)). Paper-track trades are not recorded and write nothing. If the store is missing, the desk says so and nothing is written.
- **Timeline:** Started Sep 19, 2026; the Sep 30 bulk commit imports code built in Grok Build in Sep 2026; an older unrelated Solarchik Telegram prototype (Jul 2026) is not part of this submission; also entered MunichTech (Sep 2026).

### Devnet addresses and proofs

Strategy NFTs live on Solana devnet in the server collection [`74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC`](https://explorer.solana.com/address/74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC?cluster=devnet) (server key `8eKeV2Vh7QhGHjsTgQN2m938iyeALqsGyhSiNQRJAxR3`). Rule: a fresh mint is not locked; every strategy change locks sale for 240 h on chain (FreezeDelegate under the server).

Listed by the test seller [`u2irHRaC…srQq`](https://explorer.solana.com/address/u2irHRaCwjogBYjdRQK7NmmzkGtLZzUqGfsSWAqsrQq?cluster=devnet) (server escrow):

- **Calm Hourly BTC** — 0.05 SOL — [`sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH`](https://core.metaplex.com/explorer/sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH?env=devnet) (calm, hourly windows, small stake)
- **Momentum Rider 5m** — 0.12 SOL — [`AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX`](https://core.metaplex.com/explorer/AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX?env=devnet) (risky, buys the side already above 0.6)
- **Mean Revert Scout** — 0.08 SOL — [`2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7`](https://core.metaplex.com/explorer/2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7?env=devnet) (balanced, buys cheap sides ≤ 0.35)

Proofs:

- **Market Test** — [`8vSSKk1Eio44Ja265FR6WvfDr2QvmBPLsrtjnoEUHjWe`](https://core.metaplex.com/explorer/8vSSKk1Eio44Ja265FR6WvfDr2QvmBPLsrtjnoEUHjWe?env=devnet): fresh mint listed at once ([tx](https://explorer.solana.com/tx/4jquQRLLTLm9e9SenyprJVffuYiiqNVuzAHFKofQpCN73rk37PM1Ty4zEjYSUDqdpDJ5rymV1gZUSMHeqBowkAQw?cluster=devnet)), bought by a second wallet in one tx: 95% to the seller, 5% royalty to the treasury ([tx](https://explorer.solana.com/tx/4cJkFGAC7UqKWwxCcKGnpFVgcmkXsB41zwvXp5FEwMFER7n5zsuDEvx2wZyiDYSEXhMhS2zAW9ULUxNppL9oiSc9?cluster=devnet)); the new owner changed the strategy ([tx](https://explorer.solana.com/tx/37xLuoN5AsQRVqqdZf8Jwptgjx4k6RPxKBY3AY3V1Dfs7CL9Ht7kao8g5QjohA1WDxo3b3rMfbvytnGNv4qCn6LK?cluster=devnet)), so listing is refused and a transfer failed on chain ([tx](https://explorer.solana.com/tx/mRda1HJ4C9wQy1i4EopJKaH1aNpFUvBRtcjLfTNPkUQxw5nXAn7XmU9B5uJNz88CSWprimSWaykQno3qJXabsW8?cluster=devnet)) until 2026-10-12 16:50 UTC.
- **Lock Test BTC Windows** — [`BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip`](https://core.metaplex.com/explorer/BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip?env=devnet): strategy changed to v2 ([tx](https://explorer.solana.com/tx/FU9HaQSHsQqU9x2s9T7HogELLk3b51i2jMdfkLFhHLzbqnEiZb6LGdt3NT6tN55HLBbqskNDyJsh65JpqwgY7p6?cluster=devnet)), owner transfer while frozen failed on chain ([tx](https://explorer.solana.com/tx/2kUUn4L8rNN6ntfEvMawocHDqsrysdSdEhoxYbuugZuSH3wnUw1rz8Zjgdqhg9HaouA3ghvw7g5MhMJfeHTxN9if?cluster=devnet)), server wrote APR / PnL / trades / win rate into the attributes ([tx](https://explorer.solana.com/tx/3JZbHzWkShuR54dc46frsas2zrBK6vSNPGuxwYaWoDHoZTGttkKGTghUpm8UjxxEEoR4Sk8zzwivPTh5GjwbjTqH?cluster=devnet)); locked until 2026-10-12 16:38 UTC.

The demo NFTs were minted while the code still started the lock at mint; since they never had a strategy change, the server released that lock (`su = sc`) and thawed them before listing. All signatures: [docs/devnet-strategy-run.md](docs/devnet-strategy-run.md). The same list is in the app: Work → “For judges”. To see the listings in a deployed app's market, its `MINT_AUTHORITY_SECRET` must be the key of `8eKeV2Vh…AxR3` (the collection is derived from it) and its database (`DATABASE_URL` or the Neon integration's `POSTGRES_URL`) must hold the listings. The public deploy's Neon database holds them.

## What it is

| Part | What it does |
| --- | --- |
| Run | Side-scrolling roof runner. Tap or Space jumps, S or swipe down slides. Goal 1200 m. |
| CLOCK IN | A wallet-signed message: "on the roof today". Not a transaction. |
| Work | NFT agents: prediction agents on real Polymarket markets (Bitcoin windows, events, weather), a Combo agent (Pro only) and an arbitrage desk (Backpack × Titan/Jupiter). The player never enters exchange keys. |

The run ends at 1200 m. Reaching 1200 m opens the day (`lastClockDay`) but does not increase the streak. A live wallet signature sets `signedDay` and the streak. A declined wallet stamps nothing. Desktop does not stamp. Android Chrome uses Mobile Wallet Adapter 2.0.7. Seeker is mainnet, any other phone is devnet (CLOCK IN is a signature, not a payment). The memo is the UTC day's modifier word: calm, wind, gold, drones or wire.

## Strategy NFTs

Two tiers, prices in `src/lib/agents/fees.config.ts`.

- **Free:** one mint per room wallet; 5% of realized profit, no fee on losses.
- **Pro:** 0.1 devnet SOL from the player's wallet to `8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic`, then mint; 0% of profit. Combo agents are Pro only.

New Core assets carry a 5% royalties plugin. With `MINT_AUTHORITY_SECRET` the server builds and co-signs the Core mint into its own collection and writes the tier into the URI, which only the server can change; the room key only adds the payer signature. Pro needs a devnet payment of exactly 0.1 SOL with memo `solarchik-pro:<room wallet>`; one payment mints once. Free is one per wallet, checked on chain. Asset addresses are derived from the server key and the wallet (Free) or payment signature (Pro), so duplicates fail on chain even without a database.

A 7-day signed streak unlocks 48 fee-free hours (the counter restarts); a 30-day streak unlocks 7 days. A window starts only from a button. A trade is fee-free if it was opened inside any activated window. Rules: `src/lib/game/fee-windows.ts` (the native app mirrors them).

Player limits (`solarchik.limits.v1`) can only lower the ceiling: 0.02 SOL per trade, 0.3 per day, two losses in a row.

## Arbitrage

The desk scans every Backpack USDC spot market that withdraws on Solana (24 today) in two directions (buy on Backpack / sell via Titan, and the reverse) and picks the best net edge after 0.15% costs. The threshold, side, size and pause come from the strategy NFT.

In this build it is a simulation on the live book. A real order would additionally need `LIVE_TRADING_ENABLED=true`, `ARB_MAINNET_ENABLED=true`, a shared `DATABASE_URL`, at least 0.005 SOL of arb credit, both legs funded on Backpack and the on-chain treasury (`H7zKmmnMNfnsMtib6mopdT8XsPYAyPBFuaQeWhBYTpQg`, not the game pay wallet), the treasury key on the server, and server caps (30 s between fires, 0.01 SOL and 2 fires per wallet per UTC day, 0.02 SOL for all wallets). The browser holds no arb secret.

## Server secrets (never in git)

Server env vars only (Vercel), see `.env.example`: `MINT_AUTHORITY_SECRET`, `FAUCET_SECRET`, `SOLANA_RPC_DEVNET`, `GEMINI_API_KEY`, optional `XAI_API_KEY`, `DATABASE_URL` (or `POSTGRES_URL` from the Vercel Neon integration), `CRON_SECRET`, and — only for live trading, off here — `LIVE_TRADING_ENABLED`, `ARB_MAINNET_ENABLED`, `TITAN_SECRET`, `BACKPACK_API_KEY`, `BACKPACK_SECRET`, `ARB_HOUSE_KEY`, `DESK_TOKEN`. Without a key the feature says so and does nothing; no trade or result is invented.

## Develop

```bash
npm install
npm run dev
npm test && npx tsc --noEmit && npx eslint .
```

The native bundle reaches the server through `/api/native/*` on the deployed app (`NATIVE_API_ORIGIN`, default `https://solarchik-market.vercel.app`).

Solana Mobile hackathon: submission deadline Oct 8, 2026; results Nov 10, 2026.
