# Solarchik — CLOCK IN (Solana Mobile hackathon) submission

Українською: [README.uk.md](README.uk.md).

**Solarchik** is a native Android companion game for Seeker: a small solar robot (Sol) you talk to, a daily roof run that unlocks a signed **CLOCK IN** on Solana, and an agent desk where five strategy NFTs forecast on live public markets.

- **Native Kotlin APK, no WebView**: `artifacts/solarchik-handoff/android` (package `net.solardepin.solarchik`, minSdk 26, targetSdk 35).
- **Solana Mobile Stack**: Mobile Wallet Adapter (`mobile-wallet-adapter-clientlib-ktx` 2.0.7) for connect, sign-and-send and sign-only fallback; Seed Vault on Seeker.
- **On Solana**: CLOCK IN memo transaction, Metaplex Core NFT mint (5 strategy SKUs, Free/Pro, royalties + attributes), devnet fee payment (transfer + memo with a de-dup ref), on-chain ownership checks.
- **Safety**: agents never send exchange orders; paper mode (virtual 1 SOL) and devnet mode only. Paid mainnet mint is compiled off (`MAINNET_PAID_MINT=false`).
- **Privacy**: [PRIVACY.md](PRIVACY.md); Settings → Privacy & data → Delete my data.
- Build/test notes and APK hashes: [NATIVE_PROGRESS.md](artifacts/solarchik-handoff/NATIVE_PROGRESS.md). `docs/CLOCKIN_COMPLIANCE.md` is an older checklist (0.20.5) and is not the review build.

## For judges

Review build is **0.22.3** (versionCode 78), submitted 3 Oct 2026. Devnet only.

- **APK:** https://github.com/Solar-DePIN-Hub/Solarchik/releases/download/v0.22.3/solarchik.apk — release [v0.22.3](https://github.com/Solar-DePIN-Hub/Solarchik/releases/tag/v0.22.3). Signed with the box test key, not a production key. sha256 `6555740371aa24b7e519194db56fef0b2da3e55427a881a3d45b1ccb3ac216ee`. Launcher name is plain "Solarchik".
- **Do not install** `public/Solarchik-CLOCK-IN-0.19.51.apk`. That is an old 0.19.51 build. APKs before commit `22a84a3` called `solarchik-super-app.vercel.app`, which has no `/api/native/*` routes, so their Strategy NFT market failed.
- **Demo:** https://www.youtube.com/watch?v=oAxoliLwUXo — roof run, devnet CLOCK IN, voice mid-run, live phone secretary.
- **Live web app (same server the APK uses):** https://solarchik-market.vercel.app — Solana **devnet** only.
- **Network:** devnet for mints, fee payments and the market. The app refuses mainnet desk orders, and the paid mainnet mint is compiled off (`MAINNET_PAID_MINT=false`).
- **What is simulated:** agents never send exchange orders. On the phone they run a rule engine on real public feeds (Polymarket, Coinbase, Kraken, Backpack, Open-Meteo) in paper mode (virtual 1 SOL, labelled) or devnet mode. On the server, every real-money path (Polymarket orders, deposit relayer, mainnet arb) is behind `LIVE_TRADING_ENABLED`, which is off; the web arb desk is labelled SIMULATION. AI: Sol chat goes through the friend worker (`friend.solardepin.net`, Featherless model, no keys on the phone); the web prediction agent uses Grok when an xAI key is set and otherwise Gemini (the live deploy uses Gemini, and says so).
- **Daily loop:** 1200 m unlocks the day's signature. Seven signed days in a row open a 48 h fee-free window on the agent desk. The fee waived is the devnet/paper fee, not mainnet SOL.
- **Languages:** English and Ukrainian follow the phone language. The app sends `lang` to the server, so server reasons come back in the same language.
- **Tests on this release:** 348 total, 11 skipped, 0 failed.
- **Timeline:** Started Sep 19, 2026; the Sep 30 bulk commit imports code built in Grok Build in Sep 2026; an older unrelated Solarchik Telegram prototype (Jul 2026) is not part of this submission; also entered MunichTech (Sep 2026). Submitted to CLOCK IN on Oct 3, 2026.

### Five tabs
| Tab | What it does |
| --- | --- |
| Yard | streak, today's shift (run → CLOCK IN → signed proof), fee-free reward windows, week strip, crew |
| Run | native SurfaceView roof runner; 1200 m opens the day. Voice to Sol works mid-run. |
| Agents | mint strategy NFTs (devnet), run them on paper or devnet, risk caps, fee ledger, pay owed devnet fees in one MWA tx |
| Sol | chat with Sol (EN/UK), voice in/out, daily report built only from real numbers |
| Settings | wallet, network (Seeker can force devnet), notifications, language, privacy & data |

### Build and test
```bash
cd artifacts/solarchik-handoff/android
./gradlew :app:testDebugUnitTest          # Robolectric + JVM tests (no device needed)
./gradlew :app:testDebugUnitTest --tests '*LiveAgentsIT' -PliveAgents=1   # live market data, paper only
./gradlew :app:lintDebug
./gradlew :app:assembleDebug              # app/build → /tmp/solarchik-apk-build/outputs/apk
```
A signed release needs your own keystore (`app/solarchik-release.jks` + `keystore.properties`, both gitignored). Without it `assembleRelease` produces an unsigned APK. The review APK is the release asset above, not a local rebuild.

### Strategy NFTs on devnet
The Agents tab → Strategy NFT market uses the server routes of the web app (devnet only). Rule: a fresh mint is not locked; every strategy change locks sale for 240 h on chain (FreezeDelegate under the server). Real devnet addresses (server collection [`74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC`](https://explorer.solana.com/address/74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC?cluster=devnet)):

| Strategy NFT | Asset | State |
| --- | --- | --- |
| Calm Hourly BTC | [`sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH`](https://core.metaplex.com/explorer/sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH?env=devnet) | listed, 0.05 SOL |
| Momentum Rider 5m | [`AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX`](https://core.metaplex.com/explorer/AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX?env=devnet) | listed, 0.12 SOL |
| Mean Revert Scout | [`2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7`](https://core.metaplex.com/explorer/2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7?env=devnet) | listed, 0.08 SOL |
| Market Test | [`8vSSKk1Eio44Ja265FR6WvfDr2QvmBPLsrtjnoEUHjWe`](https://core.metaplex.com/explorer/8vSSKk1Eio44Ja265FR6WvfDr2QvmBPLsrtjnoEUHjWe?env=devnet) | listed, bought (95/5), buyer changed the strategy → locked until 2026-10-12 16:50 UTC |
| Lock Test BTC Windows | [`BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip`](https://core.metaplex.com/explorer/BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip?env=devnet) | strategy changed, transfer refused on chain, server-written APR; locked until 2026-10-12 16:38 UTC |

Every signature: [docs/devnet-strategy-run.md](docs/devnet-strategy-run.md).

The Ukrainian README ([README.uk.md](README.uk.md)) also documents the web app (branch `web-fees`): run rules, CLOCK IN, fee windows and the arb desk.
