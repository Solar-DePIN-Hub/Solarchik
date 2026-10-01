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
- STEP 9. Free mint: `claimFreeMint` (server) checks the room-key proof, then devnet `getProgramAccounts` on Core for AssetV1 owned by the wallet; any `tr=free` refuses. RPC failure refuses. With a DB, a 10-minute claim lock in `free_mint_claims` stops two tabs racing. The client check stays as UX.
- STEP 10. Desk token: no literal in source. Server code uses `DESK_TOKEN` env. Browser/native code calls `/api/desk/grok|titan` (`server/middleware/desk-proxy.ts`), which adds the token, POST only, 64 KB, same origin or `DESK_PROXY_ORIGINS`, 30/min per IP per instance. `/api/poly` is server-only. Without `DESK_TOKEN` the proxy answers 503.

## Env vars (see `.env.example`)

- `DATABASE_URL` — Neon/Postgres. Needed for arb and the free-mint lock. Migrations run in `npm run build`.
- `ARB_MAINNET_ENABLED` — `true` to allow real mainnet arb. Leave unset for simulation.
- `DESK_TOKEN` — same value as the desk worker secret. Rotate it: the old literal is in git history.
- `DESK_PROXY_ORIGINS` — optional extra origins for `/api/desk/*`.
- `SOLANA_RPC_DEVNET`, `SOLANA_RPC_MAINNET` — optional private RPC URLs.
- `VITE_DESK_PROXY_ORIGIN` — public, build time, only for the native web bundle.

## In progress

- Nothing in this list.

## Next

- Rotate the desk worker token (`wrangler secret put DESK_TOKEN` on solarchik-desk) and set the same value as `DESK_TOKEN` in Vercel. The old token is in git history.
- Arb credit is still a client-side ledger. Mainnet should also verify the credit memo on-chain before arming.
- Pro payment is not verified on the server: a modified client can mint `tr=pro` without paying.

- Assemble release APK `0.19.53` on a machine with the keystore. The file in `public/` and the yard link stay on `0.19.51` until that APK exists.
- Pro payment is devnet-only. A mainnet Seeker still cannot buy Pro.

## Tested

- `npm run typecheck` and `npm run build` after these edits (see the latest run).
- Android source was not compiled here. No new APK.

## Stub

- Fee transfer uses the room key on devnet. If that key has no SOL, the row stays `unsent`.
- Seeker mainnet Pro purchase is refused.
- Native notifications and the 0.19.53 yard are source-only until a release APK is built.
