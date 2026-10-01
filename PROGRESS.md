# PROGRESS

## Done

- STEP 0. `/solana-rpc` reads `SOLANA_RPC_DEVNET` / `SOLANA_RPC_MAINNET`, else the public nodes. No token in source. `fireArb` refuses unless `ARB_FIRE_SECRET` is at least 16 characters and the ticket matches. Server day cap 0.02 SOL and 30s gap in `server/arb-fire-ledger.json` (gitignored). Client credit is not an input. The desk still calls `fireArb` without the secret, so a browser fire stays closed ("Каса не озброєна.") until a server caller sends the ticket. The secret is not in the client bundle.
- STEP 1. Strategy NFTs have `tier` `pro` | `free`. Prices are only in `src/lib/agents/fees.config.ts` (Pro 0.1 SOL). Free is one per room wallet. Pro pays from Phantom or a devnet MWA wallet to `PAY_WALLET`, then `mintCore`. Mainnet-only Seeker is refused, not charged. New mints get Core Royalties 5% to the same treasury and attribute `tr`. Old mints with no `tr` stay Pro. Desk badges: "Pro · 0% fee" / "Free · 5% of profit".
- STEP 2. Settled positions write `feeLedger` on the agent save. Free tier, live track, profit, and no covering window: 5% via the room key to the treasury. Losses and Pro are 0. Paper shows the would-be fee and sends nothing. A failed transfer stays `unsent` with an empty signature.
- STEP 3. Streak still moves only in `stampClock`. `clockDays`, `seven`, and `thirty` persist on the game save. 7 signed days grant a 48h window and restart that counter. 30/60/90 grant a 7-day window and the 30-day counter keeps going. Each id is granted once. A missed UTC day zeros streak and both counters. The window stays `available` until "Activate fee-free window". The yard shows days left and the countdown. Native `GameSave.recordRun` no longer bumps the streak; `stampClock` does, with the same windows.
- STEP 4. Once per UTC day the yard shows Sol's note from the real ledger and streak. If yesterday has no rows, it says so. A model line is spoken only when every number in it already appears in that note.
- STEP 5. Risk panel on the work desk. Caps persist in `solarchik.limits.v1` and cannot exceed 0.02 / 0.3 / 2 losses / 0.3 day-loss. Pause calls `stopWork`. A stricter user cap skips the trade and writes the reason into the desk log.
- STEP 6. Native alarms (AlarmManager, not a push vendor): streak about 3h before UTC midnight if not signed, reward available once that day, fee-free window ending about 3h out, daily note once. Toggles per type. `POST_NOTIFICATIONS` on API 33+. Strings in `values` and `values-uk`.

## In progress

- Nothing in this list.

## Next

- Put `ARB_FIRE_SECRET` on the server and pass the same ticket from a trusted server caller if the desk should fire again. Do not put the secret in `VITE_`.
- Assemble release APK `0.19.53` on a machine with the keystore. The file in `public/` and the yard link stay on `0.19.51` until that APK exists.
- Pro payment is devnet-only. A mainnet Seeker still cannot buy Pro.

## Tested

- `npm run typecheck` and `npm run build` after these edits (see the latest run).
- Android source was not compiled here. No new APK.

## Stub

- Browser `fireArb` has no ticket, so it cannot pass the new guard.
- Fee transfer uses the room key on devnet. If that key has no SOL, the row stays `unsent`.
- Seeker mainnet Pro purchase is refused.
- Native notifications and the 0.19.53 yard are source-only until a release APK is built.
