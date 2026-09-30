# Solarchik CLOCK IN

APK = здача Clock In без WebView; сайт = демо Colosseum у браузері.

The launcher is a native yard. The run is a Canvas `SurfaceView`. CLOCK IN calls `SolanaWallet.clockInOnChain` (Mobile Wallet Adapter 2.0.7 / Seed Vault). On a Seeker the cluster is mainnet. Otherwise it is devnet. The website is the Vite app in the repo root and is not packaged into the APK. On Android Chrome, CLOCK IN uses the same Mobile Wallet Adapter. A desktop browser does not stamp the day.

```
cd artifacts/solarchik-handoff/android
# local.properties must set sdk.dir
bash ./gradlew :app:assembleRelease --no-daemon
```

Release output is not debuggable: `app/build/outputs/apk/release/app-release.apk`. The sandbox build directory is `/tmp/solarchik-apk-build`. The site downloads `public/Solarchik-CLOCK-IN-<version>.apk`. Do not commit `keystore.properties` or the `.jks`.

A declined wallet does not stamp the day. A message fallback shows the signature, not a fake transaction link. On a desktop browser, CLOCK IN says the APK / Seed Vault is required and does not stamp the day.
