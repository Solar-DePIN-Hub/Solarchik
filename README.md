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

Файл для рев’ю: `public/Solarchik-CLOCK-IN-0.19.51.apk`. Release, не debuggable. Джерело Android уже `0.19.53`, новий APK у цій збірці не лежить.

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

## NFT стратегії

Два рівні, ціна в `src/lib/agents/fees.config.ts`.

- **Free.** Мінт без ціни, один на гаманець кімнати. 5% з реалізованого плюса. Мінус без комісії.
- **Pro.** 0.1 SOL з гаманця гравця (Phantom або телефон на Devnet) на `8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic`, потім мінт. 0% з прибутку. Seeker лише на mainnet оплату не бере: реальні SOL не списуються.

На кожному новому Core-активі плагін Royalties 5%, творець — та сама адреса. Рівень лежить в атрибуті `tr` (`pro` або `free`). Старі NFT без атрибута лишаються Pro і не оподатковуються.

Комісія пишеться в журнал: час відкриття і закриття, PnL, сума, причина (pro, вікно, мінус, папір, відправлено). Папір лише показує «було б». Підпис не вигадується, якщо переказ не пройшов.

## Стрік і вікна без комісії

Стрік росте лише від підписаного CLOCK IN. Пропуск UTC-дня обнуляє стрік і обидва лічильники.

- 7 підписів підряд дають 48 годин без комісії. Лічильник сімки після цього починається знову. Кожен такий цикл — один раз.
- 30, 60, 90… дають 7 днів без комісії. Лічильник тридцятки не скидається через нагороду. Кожну позначку дають один раз.
- Вікно лежить як «готове», поки гравець не натисне «Увімкнути». Покриває угоду, лише якщо відкриття потрапляє в активне вікно.

Двір показує, скільки днів лишилось, і зворотний відлік, коли вікно вже йде. Раз на UTC-день Сол читає вчорашній журнал. Якщо цифр немає, так і каже. Голос не підставляє чужі числа.

Ліміти гравця в `solarchik.limits.v1` можуть лише знизити стелю (угода 0.02, доба 0.3, два мінуси). Пропущену угоду видно в журналі столу.

Нативний двір рахує стрік так само, від підпису, не від фінішу 1200 м. Сповіщення локальні: стрік, готова нагорода, кінець вікна за ~3 години, записка дня. Окремого push-сервісу немає. Збірка джерела `0.19.53`. Файл у `public/` лишається `Solarchik-CLOCK-IN-0.19.51.apk`, бо новий release APK тут не збирається.

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

The review APK in `public/` is still `Solarchik-CLOCK-IN-0.19.51.apk`. Native source is `0.19.53` (streak only on a signed clock-in, fee-free windows, local alarms). A new release APK was not assembled here. Release keystore is not in git.

Strategy NFTs have two tiers. Free is one mint per room wallet and takes 5% of realized profit. Pro is 0.1 devnet SOL from the player's own wallet to `8J3hxf1XSYV1HKVUJtwtQtVwSvSeaAyW5RmL8EqC67ic`, then 0% of profit. A mainnet-only Seeker is not charged. New Core assets carry a 5% royalties plugin. A 7-day signed streak unlocks 48 fee-free hours and the counter restarts. A 30-day streak unlocks 7 days and the counter keeps going. The window starts only from a button. Prices live in `src/lib/agents/fees.config.ts`.

The arb bot scans every Backpack USDC spot market that withdraws on Solana (24 markets today). It picks the best net edge after 0.15% costs. It fires only when the edge clears the NFT threshold, the player has at least 0.005 SOL of arb credit, both the Backpack account and the on-chain treasury hold that token and USDC, and the treasury key is on the server. The browser holds no arb secret. It signs a short proof with the room key, and the server checks the signature, that the wallet owns the class 2 or combo agent on devnet, and the caps in Postgres: 30 s between fires, 0.01 SOL and 2 fires per wallet per UTC day, 0.02 SOL for all wallets. Mainnet is off by default. It needs `ARB_MAINNET_ENABLED=true` and `DATABASE_URL` on the server. Otherwise the desk runs a simulation on the live Backpack book, labelled «СИМУЛЯЦІЯ · devnet, без грошей», and arb credit is not spent. With no shared database on a deploy the desk is closed. The Free tier is re-checked on the server before a free mint: no Core asset with `tr=free` may already be owned by the wallet on devnet. The desk worker token is the `DESK_TOKEN` server env var; browsers and the native bundle go through `/api/desk/*`. See `.env.example`. The player never pastes a Backpack key. Arb credit is a mainnet transfer to `H7zKmmnMNfnsMtib6mopdT8XsPYAyPBFuaQeWhBYTpQg` with the NFT asset as the memo. That address is not the game pay wallet.

```bash
npm install
npm run dev
```
