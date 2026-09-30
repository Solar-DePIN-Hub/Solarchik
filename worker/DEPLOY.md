# Deploy Solarchik AI friend Worker

Cloudflare dashboard → Workers → `solarchik-ai-friend` → Edit code.

1. Paste all of `solarchik-ai-friend.js`.
2. Keep secrets: `FEATHERLESS_API_KEY`, `GEMINI_API_KEY`.
3. Save and Deploy.

APK 0.20 already talks to `https://friend.solardepin.net/v1/chat`.
Without this paste, the old Worker still uses Qwen 72B (empty 200s).
With this paste: 14B → retry → 32B → Gemini 3.5-flash-lite → canned.

Do not put keys in the APK.
