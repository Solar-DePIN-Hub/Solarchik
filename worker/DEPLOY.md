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

**Call secretary** (`wrangler.screen.toml`, source `solarchik-screen.js`, recovered from the Grok export; it matches deployed 744a4bf8). Live version `78069545-439c-4d0c-9646-ea4b992578ca` (2 Oct). Roll back with `wrangler rollback 58787520-b5de-43ff-ae1c-352d900b8a25 --name solarchik-screen` (the previous paid-topup build); the older base is `744a4bf8-8a96-4332-8c1a-70aa47b9dfa1`.
- `/topup` no longer adds a free $5. It takes `{userId, sig}` or `{userId, ref}`, fetches the mainnet transaction (RPCs `SOLANA_RPC`, then api.mainnet-beta, then publicnode, because mainnet-beta refuses Workers egress) and credits the USDC that reached PAY_WALLET ($1–$100). The memo must equal `userId.slice(0, 32)`. Each signature is credited once (KV `paid:<sig>`), and the tx must be ≤30 days old. Errors: 402 PAYMENT_REQUIRED / PAYMENT_NOT_FOUND / PAYMENT_INVALID{detail}, 409 ALREADY_USED, 503 RPC_UNAVAILABLE.
- **Auth (78069545).** The routes that write data are now guarded:
  - `/sip` (and the `/openai-webhook` alias) checks the OpenAI Standard Webhooks signature: the `webhook-id`, `webhook-timestamp` and `webhook-signature` headers, HMAC-SHA256 over `id.timestamp.body` with `OPENAI_WEBHOOK_SECRET`, timestamp within ±5 min. A missing or invalid signature gets 401. The check is enforced only while the secret is set; until then each call logs `sip_unverified`.
  - `/expect`, `/voicemail` and `/phone` need `Authorization: Bearer <SECRETARY_TOKEN>` and stay closed (401) without it. No app calls them: Android and web only use `/balance`, `/topup`, `/screen` and `/inbox`.
- **Incoming calls.** Zadarma +380914810885 forwards calls to OpenAI SIP (`proj_…@sip.api.openai.com`), and OpenAI posts `realtime.call.incoming` to `/sip`.
  - **Identifying the player:** the worker reads the forwarded number from the SIP `Diversion` header (falling back to `History-Info`, then `To`) and the caller from `From`. KV `phone:<E.164>` maps a number to a userId (set with `POST /phone {number, userId}`). The secretary's own number (`SECRETARY_NUMBER`, default +380914810885) maps to `OWNER_USER_ID`.
  - **Mapped player with credit:** $0.20 is debited, an inbox line "Call answered…" is added, and the call is accepted with `gpt-realtime` plus a `save_call_note` remote MCP tool at `/mcp`. The tool is authorised by a per-call HMAC token in the `x-solarchik-call` header. The model calls it before goodbye, and the same inbox line becomes the caller note (`text` plus a structured `summary`), which both apps already show from `/inbox`.
  - **Failures:** if OpenAI refuses the tool, the call is accepted without it. If accepting fails entirely, the $0.20 is refunded.
  - **Mapped player without credit:** a "missed call, no credit" line is added and the call is rejected with 486.
  - **Unmapped number:** the call is accepted exactly as before (no billing).
  - **Not done:** a full transcript would need a sideband WebSocket (`wss://api.openai.com/v1/realtime?call_id=…`) held for the whole call, which a plain Worker request cannot do. That needs a Durable Object (class plus `[[migrations]] new_sqlite_classes` in this toml), and the worker has none today.
- Secrets/vars to set (Cloudflare, never in this file): `OPENAI_WEBHOOK_SECRET` (whsec_… from the OpenAI webhook settings), `SECRETARY_TOKEN` (operator token), `OWNER_USER_ID` (owner/demo account userId). `CALL_TOKEN_SECRET` is optional; without it the per-call token key falls back to the webhook secret, then the API key.
- Tests: `node --test scripts/screen-worker.test.mjs`.

**Call secretary, update 241bf359** (2 Oct, late). Roll back with `npx wrangler rollback 71b66276-8aad-4cc8-890c-f2d33a72e1ba --name solarchik-screen`.
- **Called number.** A real call at 23:41 logged two `sip_unmapped` lines with no number: OpenAI's `To` is `proj_…@sip.api.openai.com`. The worker now reads, in this order: `Diversion`, `History-Info`, `P-Called-Party-ID`, `Request-URI`, `X-Original-To`, `Original-To`, `X-Called-Party-ID`, then any `X-*` header whose name hints at the called side (num/did/dnis/called/to/dest/line/phone/orig/redirect/forward/divert/uri) or whose value holds a `sip:`/`tel:` URI (caller-ish names such as From/Caller/CLI/ANI/Asserted/Remote are skipped), then `To`. Numbers may be `+380…`, `380…`, `0XXXXXXXXX` (Ukrainian local → +380), `00…`, URL-encoded `%2B`, inside `sip:`/`sips:`/`tel:` user parts or as a bare value; dotted ids, IPs and the caller's own number are never taken. The caller comes from `From`, then `P-Asserted-Identity`, then `Remote-Party-ID`. **No number at all → the secretary's own line** (`SECRETARY_NUMBER` / +380914810885), which maps to `OWNER_USER_ID`.
- **Debug log** `sip_headers` (once per call): header names, values with display names removed, IPs replaced and digit runs cut to the last 4, plus where the number came from (`via`, or `assumed_own_line`) and the `data` keys. Read it with `npx wrangler tail solarchik-screen` during a test call.
- **Dedup.** After the signature check, `realtime.call.incoming` is processed once per `webhook-id` and once per `call_id` (KV `dedup:wh:<id>`, `dedup:call:<id>`, TTL 600 s, plus an in-isolate map set before any await). A repeat gets `200 {"ok":true,"duplicate":true}` with no accept and no charge. If accepting fails, the keys are cleared so OpenAI's retry can still answer. KV is eventually consistent, so two deliveries landing in different data centres within ~1 s could still both pass; strict dedup would need a Durable Object.
- **Language** (per player, KV `secretary_lang:<userId>`, default `auto`). Same access model as `/inbox` and `/balance`: holding the player's random userId is what grants access; there is no other auth.
  - `GET /secretary-lang?userId=<id>` → `{"userId","lang":"auto|uk|en","options":["auto","uk","en"]}`
  - `POST /secretary-lang {"userId","lang":"auto|uk|en"}` → the same shape; 400 `{"error":"userId required"}` (id 8–80 chars, no spaces) or `{"error":"lang must be one of auto, uk, en"}`.
  - The call instructions get `uk` → "Always speak Ukrainian.", `en` → "Always speak English.", `auto` → "Greet in Ukrainian, then reply in the language the caller speaks." Unmapped calls use `auto`.
- **Starter credit** (for judges). Every userId that has never had a paid balance key gets `TRIAL_SESSIONS` (default 3) × $0.20 = $0.60, once. The grant stays virtual until the first trial session: `/balance` reads write nothing, and that first session writes `trial_granted:<id>` and `trial:<id>`. Trial credit is spent before paid credit.
  - `GET /balance` → `{"userId","usd": paid+trial,"paidUsd","trialUsd","trial": trialUsd>0,"sessionUsd":0.2}`. Old clients read `usd`, so the trial shows up as balance with no app change.
  - `/screen` and incoming calls add `"trial":true` when trial credit paid for the session; calls also add `"source":"trial|paid|demo"`.
  - **Budget caps** (KV counters, best effort, UTC day, TTL 2 days): `TRIAL_DAILY_CAP` (default 30) trial-funded sessions per day across everyone, and `TRIAL_CALLER_CAP` (default 3) trial-funded calls per caller number per day. Hidden numbers share one bucket, and numbers are stored hashed.
  - When a cap is hit with no paid credit, the result is the same as having no credit: an inbox line ("today's free trial calls are used up…" / "this caller used up today's free trial calls…"), reject 486, and `{"error":"NEED_TOPUP","reason":"TRIAL_DAILY_CAP|TRIAL_CALLER_CAP"}` (`/screen` returns 402 with the same `reason` and a `detail`).
  - Set any of the three vars to `0` to switch that part off.
- **Demo line.** For a call to the secretary's own line, the owner pays when they can (trial, then paid). Otherwise it is answered from the same daily and per-caller budget with nothing charged (`source:"demo"`, note still saved to the owner's inbox). Without `OWNER_USER_ID` the line is still answered from that budget, but there is no billing and no note. So a judge can simply dial +380914810885.
- **`OWNER_USER_ID` is still unset.** The apps have no fixed owner/demo id: Android `PlayerIds.get` and web `makePlayerId` create a random UUID per install. KV only holds old test balances (`demo`, `exec-test-20261001`, `probe-pay-1/2`, `test-grok-1`). `demo` is shorter than 8 characters, so no app can ever use it. To set it, take the full userId from the owner's install and run `printf %s "<id>" | npx wrangler secret put OWNER_USER_ID --config worker/wrangler.screen.toml`.
- Tests: `node --test scripts/screen-worker.test.mjs` (28).

**Desk** (`wrangler.desk.toml`): added the `/api/titan` quote route to the source. It is NOT deployed, because deployed bc237b32 may differ from this file (see the note in the file).

**Call secretary + Sol, update 79a77437** (3 Oct, ~00:40 Kyiv). Deploy from the repo root: `npx wrangler deploy --config worker/wrangler.screen.toml`. Roll back with `npx wrangler rollback 81e336fa-670a-4e95-b818-e67a1ce609f2 --name solarchik-screen`. Tests: `node --test scripts/screen-worker.test.mjs worker/solarchik-screen.test.mjs` (28 + 19).
- **Duplicate call delivery (live, call …qjb3).** OpenAI posted `realtime.call.incoming` twice 166 ms apart, into different isolates. KV dedup missed the second delivery: its accept failed, it refunded the session and overwrote the good inbox line with "could not pick up".
  - Production now routes `/sip` into a `CallRoom` Durable Object (binding `CALLS`, SQLite class, migration `v1-call-room`), one per call id. Its storage is strongly consistent and its requests are serialised, so one call is processed exactly once.
  - Without the binding (tests, local dev), a `call:<id>` marker (`accepting` → `accepted`) is written before any money moves. It is read again before charging and after a failed accept, so a delivery that finds the call already taken never charges, refunds or rewrites anything.
  - The failure path only rewrites a line that is still `pending`.
  - Every delivery id is remembered, not only the first one.
- **Notes that never arrived.** The instructions now open with a hard NOTE TOOL rule: call `save_call_note` as soon as the caller's wish is known, always before goodbye, even without a name. The tool schema has no `company` field, and the callback defaults to the caller's number.
  - The call room also opens the realtime sideband (`wss://api.openai.com/v1/realtime?call_id=…`) and turns on caller transcription (`gpt-4o-mini-transcribe`).
  - On hang-up (socket close), or from an alarm 16 min after accept, a line that is still `pending` gets a note summarised from the transcript (gpt-4o-mini, `source:"auto"`). With no caller words, it gets "Call answered; the caller left no details."
  - Log events: `sideband_open`, `sideband_refused`, `call_finished {why, lines, note}`.
- **Top-up RPC.** Tested live from a Worker: api.mainnet-beta answers 403 "Your IP or provider is blocked". publicnode and solanatracker answer 200 but keep only recent history, so they return `[]`/`null` for older signatures. solanavibestation has full history but is rate-limited.
  - The order is now `SOLANA_RPC` → mainnet-beta (fails in ~15 ms) → publicnode → solanavibestation → solanatracker. An empty history answer moves on to the next RPC.
  - `GET /rpc-health` shows status, history count and ms per RPC. A `SOLANA_RPC` host is shown as `env`.
  - For a guaranteed lookup, set a keyed RPC: `npx wrangler secret put SOLANA_RPC --name solarchik-screen`.
- **Sol for the Android app (0.21.8).**
  - `POST /sol/chat {message, language, scene, context, agents[], market[], canMintFree, history[], stream}` uses OpenAI `gpt-4.1-mini` (falling back to `gpt-4o-mini`) with a `propose_action` tool. Agents and listings reach the model as short refs (a1, l1), and the worker maps them back to the app's ids. It answers `{ok, reply, action|null, model, ttftMs, ms}`, or NDJSON `{"d":"…"}` lines plus a final `{"done":true,…}` when `stream:true`.
  - `GET /sol/tts?text=&lang=uk|en&voice=marin&fmt=pcm|mp3|wav` uses OpenAI `gpt-4o-mini-tts` with a natural-speech style instruction per language. pcm is 24 kHz s16le mono and streams straight through. The response is Cloudflare-cached per text+lang+voice+fmt, and the `x-sol-tts` header names the engine and voice.
  - Both routes are limited per isolate to 40 requests/min per IP.
  - Live, 3 Oct: chat TTFT 0.43–0.6 s, a full short reply 0.8 s; tts first byte 0.38–1.2 s, a cache hit 0.04 s.
  - The market's Gemini `sol-voice` answered 503 (all four TTS models 429) at the same time. That is why the app fell back to the phone's robotic system voice.

**Call secretary + Sol, update c2fecc69** (3 Oct, ~04:32 Kyiv). Sol's Ukrainian wording for a signed day: ready phrases «День уже підписано, серія N» / «Сьогодні вже зараховано, серія N», never «ти підписано». Two stale expectations in `scripts/screen-worker.test.mjs` were updated to match the current behaviour (`owner` in /balance, canonical `dedup:call:` key). Tests 63/63. Roll back with `npx wrangler rollback cff0aa4f-f97c-471d-9ec5-ac209913fc31 --name solarchik-screen`.

**Sol in the run, update 6fa974bc** (3 Oct, ~05:35 Kyiv). In a run (scene "run") the agent tools and agent list are only offered when the player names agents, strategies, wallet or market. The run rules come first and last in the prompt (talk about the game). An empty reply is never sent. Before this, «Що тут робити?» / «Налаштуй мене» came back as start_agent cards and «А що з налаштуваннями?» as an empty agent_status reply (silence in the app). Tests 64/64. Roll back with `npx wrangler rollback c2fecc69-9b4a-46c2-be45-48165cab6e3f --name solarchik-screen`. Note: after the box restart `node_modules/` was missing and wrangler failed on `/node_modules/.cache`; `mkdir node_modules` in the repo root fixes it.
