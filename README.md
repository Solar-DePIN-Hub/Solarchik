# Solarchik — CLOCK IN (Solana Mobile hackathon) submission

**Solarchik** is a native Android companion game for Seeker: a small solar robot (Sol) you talk to, a daily roof run that unlocks a signed **CLOCK IN** on Solana, and an agent desk where five strategy NFTs forecast on live public markets.

- **Native Kotlin APK, no WebView**: `artifacts/solarchik-handoff/android` (package `net.solardepin.solarchik`, minSdk 26, targetSdk 35).
- **Solana Mobile Stack**: Mobile Wallet Adapter (`mobile-wallet-adapter-clientlib-ktx` 2.0.7) for connect, sign-and-send and sign-only fallback; Seed Vault on Seeker.
- **On Solana**: CLOCK IN memo transaction, Metaplex Core NFT mint (5 strategy SKUs, Free/Pro, royalties + attributes), devnet fee payment (transfer + memo with a de-dup ref), on-chain ownership checks.
- **Safety**: agents never send exchange orders; paper mode (virtual 1 SOL) and devnet mode only. Paid mainnet mint is compiled off (`MAINNET_PAID_MINT=false`).
- **Privacy**: [PRIVACY.md](PRIVACY.md); Settings → Privacy & data → Delete my data.
- Hackathon compliance checklist: [docs/CLOCKIN_COMPLIANCE.md](docs/CLOCKIN_COMPLIANCE.md). Build/test notes and APK hashes: [NATIVE_PROGRESS.md](artifacts/solarchik-handoff/NATIVE_PROGRESS.md).

### Five tabs
| Tab | What it does |
| --- | --- |
| Yard | streak, today's shift (run → CLOCK IN → signed proof), fee-free reward windows, week strip, crew |
| Run | native SurfaceView roof runner; 1200 m opens the day |
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
A signed release needs your own keystore (`app/solarchik-release.jks` + `keystore.properties`, both gitignored). Without it `assembleRelease` produces an unsigned APK.

### For judges: Strategy NFTs on devnet
The Agents tab → Strategy NFT market uses the server routes of the web app (devnet only). Real devnet addresses (server collection [`74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC`](https://explorer.solana.com/address/74Tyscw6gL9mDxvNsSSDuj6v4YHqFPCyUULirjLPeuQC?cluster=devnet)):

| Strategy NFT | Asset |
| --- | --- |
| Calm Hourly BTC | [`sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH`](https://core.metaplex.com/explorer/sZ4R4sbUtuGc8ygfmwHvG34zqL5LoSBRF5YkHDTDfVH?env=devnet) |
| Momentum Rider 5m | [`AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX`](https://core.metaplex.com/explorer/AV8EgTtPaZydbrRDZtFFUfeuDR32jB6oHuRozUhKWEwX?env=devnet) |
| Mean Revert Scout | [`2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7`](https://core.metaplex.com/explorer/2ijiD193pRVfhomaFtXSNuc13ki9XVwhxw7AFXL1dsK7?env=devnet) |
| Lock Test BTC Windows (strategy changed, transfer refused on chain, server-written APR) | [`BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip`](https://core.metaplex.com/explorer/BxXZvfVhEbBDqYRYu3pK8pkBfWq6YQ3GL4QevGm1TDip?env=devnet) |

Their 240 h sale lock (it starts at mint and at every strategy change) ends 2026-10-12 16:38 UTC; listing and buying on devnet come after that. Every signature: [docs/devnet-strategy-run.md](docs/devnet-strategy-run.md).

---

# Solarchik

Сонячний робот на телефоні. Один проєкт, три речі: забіг по даху, щоденний підпис **CLOCK IN** на Solana Mobile, і стіл **Work**, де агент сам читає ринок.

English summary is at the bottom.

## Що це

| Частина | Що робить |
| --- | --- |
| Забіг | Сайд-раннер по даху. Тап або пробіл — стрибок. S або свайп вниз — слайд. Фініш 1200 м. |
| CLOCK IN | Підпис повідомлення гаманцем. Це явка на дах сьогодні, не транзакція. |
| Work | Агенти з NFT. Прогнози і арбітраж Titan × Backpack. Гравець не вводить ключі біржі. |

Сайт — демо в браузері. APK — нативний двір без WebView, Mobile Wallet Adapter 2.0.7, Seed Vault.

## Забіг

- Мета `GOAL_M = 1200`. Метри не крутяться окремим чітом.
- Тап / Space = стрибок. Утримання не потрібне. S / свайп вниз = слайд.
- Не три смуги і не потрійний стрибок.
- День рахується в UTC. Веб і APK бачать один і той самий день.
- Модифікатор дня: `calm`, `wind`, `gold`, `drones`, `wire`. Той самий хеш, що й seed дня.
- Вороги лише mite, drone, bush.
- Смерть: табличка «Ще раз» або «На двір». Тап на смерті не стартує забіг сам.
- Фініш 1200 м не веде на двір. Удар камери і одразу кнопка підпису на забігу.
- Менше 1200 м: ще раз або двір. День не відкривається.

## CLOCK IN

- 1200 м ставить `lastClockDay`. День **відкрито**, ще не зданий. Стрік не росте.
- Живий підпис ставить `signedDay` і стрік. Картка дивиться на підписаний день.
- Відхилений гаманець нічого не ставить.
- Повторний підпис того самого UTC-дня нічого не змінює.
- Наступний UTC-день без вчорашнього підпису обнуляє стрік.
- На десктопі кнопка не штампує день. На Android Chrome та сама кнопка йде в Mobile Wallet Adapter.
- Seeker = mainnet. Інший телефон = devnet.
- Підпис показується як підпис, не як лінк транзакції.
- У memo йде звичайне слово модифікатора (`wind`), не новий ончейн-тип.

Тиждень на дворі фарбує лише підписані дні.

## APK

Старий файл `public/Solarchik-CLOCK-IN-0.19.51.apk` — збірка 0.19.51. Актуальна нативна збірка — 0.20.x (див. NATIVE_PROGRESS.md).

Нативний проєкт: `artifacts/solarchik-handoff/android`.

```bash
cd artifacts/solarchik-handoff/android
bash ./gradlew :app:assembleRelease
```

`keystore.properties` і `.jks` у git не лежать. Без них release не збереться. Debug-збірка для здачі не годиться.

## Сайт

```bash
npm install
npm run dev
```

## Work

Стіл відкривається з гри. Арбітражний агент стартує сам. «Стоп» його зупиняє. Прогнози самі не вмикаються.

Гравець купує NFT класу 2. Своїх ключів Backpack він не вводить. Торгівля йде з каси проєкту.

Дві адреси, їх не плутати:

- Гаманець кімнати / оплата гри: `8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic`
- Каса арбітражу: `H7zKmmnMNfnsMtib6mopdT8XsPYAyPBFuaQeWhBYTpQg`

«Поповнити» на дворі — це кран Devnet для ключа кімнати. «На касу арбу» шле mainnet на касу арбітражу. Memo = asset NFT. Кредит з’являється після підтвердженого переказу. Каса арбітражу не приймає оплату гри і навпаки.

## Арбітраж

Пара не одна. Бот читає кожну спотову пару Backpack проти USDC, яку біржа вміє вивести в Solana. Зараз це 24 пари: SOL, PYTH, JTO, BONK, WIF, USDT, JUP, RENDER, BTC (cbBTC), W, RAY, KMNO, CLOUD, PENGU, TRUMP, PUMP, 2Z, MET, SKR, BP і чотири токенізовані акції.

ETH, DOGE, XRP та інші без Solana-виводу не входять. Інакше нога на Titan була б іншою монетою.

Два напрямки, як у шкільному демо Titan × Backpack:

- A: купити базу на Backpack, продати через Titan.
- B: купити базу через Titan, продати на Backpack.

Чистий край = валовий мінус 0.15% (комісія тейкера Backpack 0.10% і 5 bps на пріоритет і зірвану ногу). Поріг береться зі стратегії NFT. Сторона: sell = лише A, buy = лише B, both = краща.

Кожні кілька секунд освіжається жменя пар. На картці лишається пара з найкращим краєм під обрану сторону.

Ордер іде лише коли одночасно:

1. край вищий за поріг;
2. кредит від 0.005 SOL;
3. на Backpack і на ончейн-касі є і ця монета, і USDC на ногу;
4. на сервері лежить ключ каси, і він збігається з адресою каси.

Нога не більша за 0.005 SOL у доларовому еквіваленті. Якщо мінімум біржі більший, бот пише «Нога менша за мінімум біржі» і нічого не шле. Порожня каса теж не шле IOC.

Кредит списується лише коли обидві ноги повернулись з id. Зірвана нога кредит не чіпає і лишає запис «Зламано, чекає зведення».

Стратегія пишеться в NFT на столі: сторона, поріг у bps, розмір, пауза. Бот читає її з токена.

## Ключі, яких немає в git

Кладуться лише на сервер, не в клієнт і не в коміт:

- `server/titan.secret` — ключ Titan
- `server/backpack.secret` — API key і secret каси, два рядки
- `server/gemini.secret` — Gemini
- `server/arb-house.key` — ключ гаманця каси. Публічний ключ має дорівнювати `H7zKmmnMNfnsMtib6mopdT8XsPYAyPBFuaQeWhBYTpQg`

Без них бот читає книгу і стоїть. Угоду не вигадує.

## Що ще не здано на Solana Mobile

Дедлайн сабміту 8 жовтня 2026. Результати 10 листопада.

Треба окремо: APK, цей GitHub, демо-відео з живого телефона, pitch. Старі скрінкасти за відео сабміту не рахуються.

## English

Solarchik is a solar robot: a roof runner, a daily Solana Mobile **CLOCK IN** signature, and a Work desk.

The run ends at 1200 m. Tap or Space jumps. S or swipe down slides. Reaching 1200 m opens the day (`lastClockDay`) but does not increase the streak. A live wallet signature sets `signedDay` and the streak. A declined wallet stamps nothing. Desktop does not stamp. Android Chrome uses Mobile Wallet Adapter 2.0.7. Seeker is mainnet. Any other phone is devnet. The signature is shown as a signature, not a transaction link. The memo is the UTC day's modifier word: calm, wind, gold, drones, or wire.

`public/Solarchik-CLOCK-IN-0.19.51.apk` is the older 0.19.51 build; the current native build is 0.20.x (see the top of this file). The Work desk / arb text below describes the web app, not the APK. Release keystore is not in git.

The arb bot scans every Backpack USDC spot market that withdraws on Solana (24 markets today). It picks the best net edge after 0.15% costs. It fires only when the edge clears the NFT threshold, the player has at least 0.005 SOL of arb credit, both the Backpack account and the on-chain treasury hold that token and USDC, and the treasury key is on the server. The player never pastes a Backpack key. Arb credit is a mainnet transfer to `H7zKmmnMNfnsMtib6mopdT8XsPYAyPBFuaQeWhBYTpQg` with the NFT asset as the memo. That address is not the game pay wallet.

```bash
npm install
npm run dev
```
