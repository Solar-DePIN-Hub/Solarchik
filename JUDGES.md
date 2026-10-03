# Solarchik for CLOCK IN judges

Native Kotlin app for Seeker. Daily roof run unlocks a signed CLOCK IN on Solana devnet. Sol is a voice companion. The agent desk forecasts on live public prices and never sends an exchange order.

Who it is for: someone who will open a Seeker every day. The run is the habit. The signature is the proof. The agents are the reason to come back after the run.

## Install

Review build is 0.22.3, versionCode 78, devnet only. Do not install `public/Solarchik-CLOCK-IN-0.19.51.apk`.

https://github.com/Solar-DePIN-Hub/Solarchik/releases/download/v0.22.3/solarchik.apk

Demo: https://www.youtube.com/watch?v=oAxoliLwUXo

Deck file (the form link is a GitHub HTML page; this one is the PDF): https://raw.githubusercontent.com/Solar-DePIN-Hub/Solarchik/native-full/docs/clockin-deck.pdf

## On-chain, devnet

Signatures are in the deck, page 9, and in [docs/devnet-strategy-run.md](docs/devnet-strategy-run.md).

- CLOCK IN memo from the built-in wallet: `2FfPKtFz…hafpMuFL5`
- Free Metaplex Core agent mint: `4ixhbEV1…UerUe9sLh`
- Strategy collection: https://explorer.solana.com/address/74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC?cluster=devnet

Mainnet mint and the arb desk were built, then switched off in this build. `MAINNET_PAID_MINT=false`. The review APK cannot spend mainnet SOL. SKR is mainnet-only, so it is not in this build.

## After the security scan

The desk gate token is no longer in `src/lib/agents/grok-fetch.ts`. The worker secret was not rotated, so the submitted APK still passes the gate. The xAI key was never in that file. It stays in the Worker env.
