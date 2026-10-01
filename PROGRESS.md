# PROGRESS

## Done

- STEP 0. `/solana-rpc` reads `SOLANA_RPC_DEVNET` / `SOLANA_RPC_MAINNET`, else the public nodes. No token in source.
- STEP 1. Strategy NFTs have `tier` `pro` | `free`. Prices are only in `src/lib/agents/fees.config.ts` (Pro 0.1 SOL). Free is one per room wallet. Pro pays from Phantom or a devnet MWA wallet to `PAY_WALLET`, then `mintCore`. Mainnet-only Seeker is refused, not charged. New mints get Core Royalties 5% to the same treasury and attribute `tr`. Old mints with no `tr` stay Pro. Desk badges: "Pro · 0% fee" / "Free · 5% of profit".
- STEP 2. Settled positions write `feeLedger` on the agent save. Free tier, live track, profit, and no covering window: 5% via the room key to the treasury. Losses and Pro are 0. Paper shows the would-be fee and sends nothing. A failed transfer stays `unsent` with an empty signature.
- STEP 3. Streak still moves only in `stampClock`. `clockDays`, `seven`, and `thirty` persist on the game save. 7 signed days grant a 48h window and restart that counter. 30/60/90 grant a 7-day window and the 30-day counter keeps going. Each id is granted once. A missed UTC day zeros streak and both counters. The window stays `available` until "Activate fee-free window". The yard shows days left and the countdown. Native `GameSave.recordRun` no longer bumps the streak; `stampClock` does, with the same windows.
- STEP 4. Once per UTC day the yard shows Sol's note from the real ledger and streak. If yesterday has no rows, it says so. A model line is spoken only when every number in it already appears in that note.
- STEP 5. Risk panel on the work desk. Caps persist in `solarchik.limits.v1` and cannot exceed 0.02 / 0.3 / 2 losses / 0.3 day-loss. Pause calls `stopWork`. A stricter user cap skips the trade and writes the reason into the desk log.
- STEP 6. Native alarms (AlarmManager, not a push vendor): streak about 3h before UTC midnight if not signed, reward available once that day, fee-free window ending about 3h out, daily note once. Toggles per type. `POST_NOTIFICATIONS` on API 33+. Strings in `values` and `values-uk`.
- STEP 7. Arb fire is authorized on the server (`arb-guard.server.ts`). No secret in the browser: the room key signs `solarchik:arb:v1` with dir, symbol, asset and time (2 min window, single use in `wallet_proofs`). The server checks the signature, that the wallet owns the asset on devnet and that it is class 2 or a combo. Caps live in Postgres (`migrations/0002_guards.sql`), booked with one atomic upsert each: 30 s spacing global and per wallet, per wallet 0.01 SOL and 2 fires per UTC day, global 0.02 SOL per UTC day (mainnet). Simulation caps: 1 SOL global, 0.1 SOL and 20 fires per wallet. A clean miss refunds the booking; ok or broken stays booked. Settling never throws after a fire.
- STEP 8. Mainnet is off by default. `ARB_MAINNET_ENABLED=true` and `DATABASE_URL` are both required. Unset: `simulateArbOnServer` sizes the leg on the live Backpack book, signs and sends nothing, the desk shows «СИМУЛЯЦІЯ · devnet, без грошей» and does not spend arb credit. No `DATABASE_URL` on a deploy: closed, with the reason in the desk. In-memory PGLite only under `vite dev`, simulation only. No runtime file writes (the old `server/arb-fire-ledger.json` and `ARB_FIRE_SECRET` are gone).
- STEP 9. Mint entitlement on the server (`mint.server.ts`, `mint-rules.ts`, `migrations/0003_mints.sql`). The client asks `mintStatus` before any payment. With `MINT_AUTHORITY_SECRET` the server builds the whole Core mint: the asset joins the server collection (derived key, update authority = server key), tier goes into the URI `urn:solarchik:agent:pro|free`, Attributes stay owner-editable (stats), Royalties 5% and FreezeDelegate as before. The server signs (authority + asset, collection on first use), the room key only adds the payer signature; any change breaks the server signature. Pro: the player pays 0.1 SOL to `PAY_WALLET` with memo `solarchik-pro:<room wallet>` (or from the room wallet itself); the server reads the devnet tx (exact lamports, destination, no error, under 3 days) and books it in `mint_claims` so one payment mints once, never for another wallet; a prepared but never-landed mint can be re-prepared after 2 min. Free: room-key proof + on-chain check (no free tier asset owned, uri or `tr`) + one slot per wallet. Without the key: dev mints from the browser; a deploy closes Pro ("Pro закрито…", nothing charged) and lets Free mint from the browser after the server check. An unfinished Pro payment is kept in `solarchik.pending-pro` and reused instead of charging again. Verified in LiteSVM with the real Core program: co-signed txs execute; a room-only mint into the server collection fails (0x1a); the owner can update Attributes but not the URI.
- STEP 11. Mainnet house secrets come from env: `ARB_HOUSE_KEY` (must be H7zK…), `BACKPACK_API_KEY` + `BACKPACK_SECRET`, `TITAN_SECRET` (or `TITAN_API_KEY`). The old `server/*.secret|key` files are a `vite dev` fallback only. Still gated by `ARB_MAINNET_ENABLED`.
- STEP 12. Native bundle: arb fire, arb house and mint go over HTTPS to the deployed server (`server-calls.ts` → `/api/native/arb-fire|arb-house|mint-status|mint-prepare`, `server/middleware/native-api.ts`, CORS `*`, every state change still needs the wallet proof). Server code is not in `build-native`. `/api/desk/*` answers CORS preflight for origins in `DESK_PROXY_ORIGINS`.
- STEP 13. Fee windows (`src/lib/game/fee-windows.ts`, mirrored by the native app): a trade is fee-free if its openedAt is inside ANY activated window (startedAt <= openedAt < endsAt), active or already spent. Reward ids carry the UTC grant day: `h48-<N>-<YYYY-MM-DD>`, `d7-<thirty>-<YYYY-MM-DD>`; same id the same day is granted once; old ids (`d7-30`, `h48-2`) stay and never block new ones. At most 24 rows: available/active first, then the newest spent; loading reads all rows and then trims, so a new reward is never dropped at the cap. `h48` numbers continue from the highest milestone.
- STEP 14. `npm test` is green: tests that need files absent from this checkout skip with the missing path (release keystore/APK/Android SDK, `.grok/skills/og`, `.grok/app-env.json`); grok-pwa tests run in an empty workspace so the app's own `src/lib/og/site.json` does not leak into template assertions.
- STEP 10. Desk token: no literal in source. Server code uses `DESK_TOKEN` env. Browser/native code calls `/api/desk/grok|titan` (`server/middleware/desk-proxy.ts`), which adds the token, POST only, 64 KB, same origin or `DESK_PROXY_ORIGINS`, 30/min per IP per instance. `/api/poly` is server-only. Without `DESK_TOKEN` the proxy answers 503.

## Env vars (see `.env.example`)

- `DATABASE_URL` — Neon/Postgres. Needed for arb, Pro payment checks and mint slots. Migrations run in `npm run build`.
- `MINT_AUTHORITY_SECRET` — devnet mint authority (base58). Needed for Pro on deploys. Needs no SOL.
- `ARB_HOUSE_KEY`, `BACKPACK_API_KEY`, `BACKPACK_SECRET`, `TITAN_SECRET` — mainnet arb house secrets.
- `ARB_MAINNET_ENABLED` — `true` to allow real mainnet arb. Leave unset for simulation.
- `DESK_TOKEN` — same value as the desk worker secret. Rotate it: the old literal is in git history.
- `DESK_PROXY_ORIGINS` — optional extra origins for `/api/desk/*`.
- `SOLANA_RPC_DEVNET`, `SOLANA_RPC_MAINNET` — optional private RPC URLs.
- `VITE_DESK_PROXY_ORIGIN` — public, build time, only for the native web bundle (default `https://solarchik-super-app.vercel.app`).

## In progress

- Nothing in this list.

## Next

- Rotate the desk worker token (`wrangler secret put DESK_TOKEN` on solarchik-desk) and set the same value as `DESK_TOKEN` in Vercel. The old token is in git history.
- Arb credit is still a client-side ledger. Mainnet should also verify the credit memo on-chain before arming.
- Tier truth is the URI in the server collection. Assets minted before co-signing sit in per-room collections where the owner is the update authority, so their `tr` is not trustworthy; the client treats them as before. Server checks that depend on class/tier (arb) do not yet require the server collection.
- Without `DATABASE_URL`, a co-signed Free mint has no slot lock (two tabs could race the on-chain check).
- Fee transfers are still sent by the client; the server does not verify them.

- Assemble release APK `0.19.53` on a machine with the keystore. The file in `public/` and the yard link stay on `0.19.51` until that APK exists.
- Pro payment is devnet-only. A mainnet Seeker still cannot buy Pro.

## Tested

- `npm run typecheck`, `npx vite build`, native bundle build, `npm test` (scripts 187 pass / 9 skipped, TS 90 pass), eslint on changed files (0 errors).
- No live devnet mint: the public faucet rate-limits (429). Mint verified in LiteSVM 0.8 with the Core program.
- Android source was not compiled here. No new APK.

## Stub

- Fee transfer uses the room key on devnet. If that key has no SOL, the row stays `unsent`.
- Seeker mainnet Pro purchase is refused.
- Native notifications and the 0.19.53 yard are source-only until a release APK is built.
