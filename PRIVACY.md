# Solarchik privacy policy

Last updated: 2 October 2026 · App: Solarchik (Android, package `net.solardepin.solarchik`) · Contact: open an issue at https://github.com/mcBanCh/Solarchik/issues

## What stays on your phone
Streak and CLOCK IN history, fee-free windows, your agents list, the fee ledger, the agent desk (paper/devnet positions), Sol chat history (last 40 turns), notification settings, a random player id, and the Mobile Wallet Adapter session token. Nothing of this is uploaded to a Solarchik server. Android cloud backup and device transfer are disabled for the app.

## What leaves your phone, and why
| Data | Sent to | Why |
| --- | --- | --- |
| Text you type or dictate to Sol, the last 4 chat turns, your language, a random player id and conversation id | Solarchik AI relay `friend.solardepin.net` (Cloudflare), which forwards the text to its model providers (Featherless, Google Gemini) | to get Sol's reply. The relay keeps no chat content (it logs only timing and size). The providers process it under their own terms. |
| Your public wallet address, transactions you approve in your wallet | Solana RPC (`api.devnet.solana.com`, on a Seeker in mainnet mode `api.mainnet-beta.solana.com`) | balances, CLOCK IN memo, NFT mint, devnet fee payments. Everything sent to Solana is public and permanent. |
| Nothing personal (plain public GET requests) | Coinbase, Kraken, Backpack, Open-Meteo, Polymarket Gamma | live market data for the strategy agents |

Voice input uses Android's on-device/system speech recognizer (`SpeechRecognizer`) and is asked for only when you tap the mic. Replies can be read aloud with the system text-to-speech engine.

## Permissions
- `RECORD_AUDIO`: voice input to Sol, asked on first mic tap.
- `POST_NOTIFICATIONS`: streak, reward, fee-window and desk notes; every kind can be switched off in Settings.
- `READ_CONTACTS`: only used by the optional call-screening service to tell known callers from unknown ones. It is not requested by the current build and the screening is off by default.
- `INTERNET`, plus `WAKE_LOCK`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE` added by Android WorkManager for the background desk and notes.

## Deleting your data
Settings → Privacy & data → **Delete my data** wipes everything listed under "What stays on your phone" and stops the background jobs. Uninstalling the app does the same. On-chain records cannot be deleted by anyone.

## Children
Solarchik is not directed at children under 13 (or the minimum age in your country) and does not knowingly collect their data.

## Money
The strategy agents forecast on real public prices but never send orders to an exchange. Paper mode uses a virtual 1 SOL. Devnet mode moves only devnet SOL, which has no value.
