# Sol friend Worker (`solarchik-ai-friend`, https://friend.solardepin.net)

`solarchik-ai-friend.js` is built on the version that was live before round 4 (65501e10, "Fast chat and voice routes for
Solarchik Super App"). Routes, origin allowlist, CORS headers, secret names and response shapes are unchanged:
`GET /healthz`, `POST /v1/chat`, `POST /v1/transcribe`. Origins: `https://solarchik-super-app.vercel.app`,
`https://appassets.androidplatform.net` (the Android client sends this), `https://friend.solardepin.net`, `null`, or no Origin.

## Deploy

```sh
unset NPM_CONFIG_PREFIX; source ~/.nvm/nvm.sh && nvm use 22
cd worker
npx wrangler@latest deploy -c wrangler.friend.toml --message "<what changed>"
```

- The config mirrors the live script: fetch handler only, compatibility date 2025-09-15, no vars or bindings, workers.dev on,
  custom domain friend.solardepin.net. Secrets `FEATHERLESS_API_KEY` and `GEMINI_API_KEY` stay in Cloudflare (deploy
  keeps them). Optional vars `FEATHERLESS_MODEL` and `GEMINI_MODEL` are not set (defaults: Qwen2.5-14B, gemini-3.6-flash).
- Test first: `node --test scripts/ai-friend-worker.test.mjs` and `npx wrangler@latest deploy -c wrangler.friend.toml --dry-run`.
- Live check: `curl https://friend.solardepin.net/healthz`, then POST `/v1/chat` with `{"message":"…","language":"uk"}`.
- Logs: `npx wrangler@latest tail solarchik-ai-friend --format json` (one `{"event":"llm",…}` line per provider call, no text).

## Roll back

```sh
npx wrangler@latest versions list --name solarchik-ai-friend
npx wrangler@latest rollback <version-id> --name solarchik-ai-friend
```

Pre-round-4 version: `65501e10-4945-4c7b-8cae-562076b64a14`.

## Round 4 changes (live since 2026-10-01)

- The system prompt holds the game facts: streak, fee-free windows (7 days → 48 h, 30 days → 7 days), 5% Free fee on
  profits, Pro 0.1 SOL once, risk limits, devnet default, strategies are forecasts, not bets.
- Replies follow the language of the player's message, falling back to the app language.
- Max tokens: Featherless 600 (was 80), Gemini 800 (was 80). The reply is capped at 900 chars and a reply cut by the cap
  keeps whole sentences only.
- A degenerate reply (one char repeated, like the live "Пр!!!!…" seen before deploy) counts as no reply and goes to Gemini.
- History accepts `text` or `content`. The Android client sends `content`, which the old worker dropped.
- Timeouts: Featherless 7 s, then Gemini 6 s, so the total fits the Android client's 15 s read timeout.

Do not put keys in the APK.

## 2026-10-02 deploys

**Sol friend** (`wrangler.friend.toml`). Live version `1032ba42-cecc-4a77-9b03-6ba348d5aedb`; roll back with `77b7a415-1382-4780-838f-44bc8cf650d5`.
- `/v1/transcribe`: `wrangler tail` showed `gemini-3.5-transcribe` returning 200 with empty text, which is why every voice note failed. The new order is `gemini-flash-lite-latest` (~0.7–0.9 s), then the chat model, then the old model, inside an 8.5 s budget so the Vercel `/api/transcribe` proxy (10 s) never times out.
- `/v1/chat`: a Ukrainian/Russian reply containing stray lower-case Latin words (live: "відст kupi") counts as broken and goes to Gemini. Gemini tries `gemini-flash-lite-latest` (4 s) and then the main model, within a 14 s total budget.

**Call secretary** (`wrangler.screen.toml`, source `solarchik-screen.js`, recovered from the Grok export; it matches deployed 744a4bf8). Live version `58787520-b5de-43ff-ae1c-352d900b8a25`; roll back with `744a4bf8-8a96-4332-8c1a-70aa47b9dfa1`.
- `/topup` no longer adds a free $5. It takes `{userId, sig}` or `{userId, ref}`, fetches the mainnet transaction (RPCs `SOLANA_RPC`, then api.mainnet-beta, then publicnode, because mainnet-beta refuses Workers egress) and credits the USDC that reached PAY_WALLET ($1–$100). The memo must equal `userId.slice(0, 32)`. Each signature is credited once (KV `paid:<sig>`), and the tx must be ≤30 days old. Errors: 402 PAYMENT_REQUIRED / PAYMENT_NOT_FOUND / PAYMENT_INVALID{detail}, 409 ALREADY_USED, 503 RPC_UNAVAILABLE.
- Tests: `node --test scripts/screen-worker.test.mjs`.

**Desk** (`wrangler.desk.toml`): added the `/api/titan` quote route to the source. It is NOT deployed, because deployed bc237b32 may differ from this file (see the note in the file).
