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
