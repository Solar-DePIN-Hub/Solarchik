# Solarchik CLOCK IN

A solar robot you run with, then sign the day with Solana Mobile Stack.

APK = Clock In submission, native yard, no WebView. Site = Colosseum demo in the browser.

## What to tap

On the APK yard: **Забіг** (tap to jump, finish 1200 m), then **CLOCK IN**. That opens Seed Vault through Mobile Wallet Adapter 2.0.7. Seeker uses mainnet. Any other phone uses devnet. A declined wallet does not stamp the day. A message signature is shown as a signature, not a transaction link.

On Android Chrome the same CLOCK IN button uses Mobile Wallet Adapter. On a desktop browser it says the APK / Seed Vault is required and does not stamp the day.

The desk arb reads a live Backpack SOL/USDC book. Titan only if a key answered. Otherwise Jupiter. It does not send the trade.

## Build the APK

See [artifacts/solarchik-handoff/BUILD.md](artifacts/solarchik-handoff/BUILD.md).

```
cd artifacts/solarchik-handoff/android
# local.properties must set sdk.dir
bash ./gradlew :app:assembleRelease --no-daemon
```

`keystore.properties` and the release `.jks` are not in git. Without them, `assembleDebug` still builds a debuggable APK signed with the debug key. The file shipped for review is `public/Solarchik-CLOCK-IN-0.19.51.apk`: release, not debuggable, Mobile Wallet Adapter, no WebView.

## Web

```
npm install
npm run dev
```

## Not in this repo

A demo video from a live phone and a pitch deck are submission files, not source. Do not treat old screen recordings as the Clock In video.
