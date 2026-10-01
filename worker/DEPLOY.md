# Deploy Solarchik AI friend Worker

Not deployed automatically. Vadym deploys by hand.

## Option A: wrangler (from the repo root)

```sh
cd worker
npx wrangler@latest deploy -c wrangler.friend.toml
```

- Needs `npx wrangler login` (or `CLOUDFLARE_API_TOKEN`) for the account that owns `solardepin.net`.
- Secrets `FEATHERLESS_API_KEY` and `GEMINI_API_KEY` are kept as they are. To set them: `npx wrangler secret put FEATHERLESS_API_KEY -c wrangler.friend.toml`.
- Check: `curl -s -X POST https://friend.solardepin.net/v1/chat -H 'content-type: application/json' -d '{"message":"Привіт, що таке безкоштовне вікно?","language":"uk"}'`. The reply should be in Ukrainian, finish its sentences and mention the 48 h / 7 day windows.

## Option B: dashboard

Cloudflare dashboard → Workers → `solarchik-ai-friend` → Edit code.

1. Paste all of `solarchik-ai-friend.js`.
2. Keep secrets: `FEATHERLESS_API_KEY`, `GEMINI_API_KEY`.
3. Save and Deploy.

## What changed (round 4)

- The system prompt now holds the game facts: streak, fee-free windows (7 days → 48 h, 30 days → 7 days), 5% Free fee on profits, Pro 0.1 SOL once, risk limits (0.02 SOL/trade, 0.3 SOL/day, 0.3 SOL day loss, stop after 2 losses), devnet default, strategies are forecasts, not bets.
- Replies follow the language of the player's message (Cyrillic → Ukrainian, plus Spanish/Portuguese hints), with the app language as fallback.
- Max tokens went from 120 to 600 (retry 800), the reply cap from 420 to 900 chars, and a cut reply keeps whole sentences only.

The chain is 14B → retry → 32B → Gemini 3.5-flash-lite → canned.

Do not put keys in the APK.
