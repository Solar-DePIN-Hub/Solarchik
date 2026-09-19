# Solarchik

A small solar robot friend on your phone.

In the **room** you talk to him by voice or text.  
In the **runner** he runs with you and answers when you tap the mic.  
In the **red phone booth** he becomes a secretary: who called, why, what to do next — then he speaks the report.

One character. One voice. Play, talk, handle the call.

## Modes

| Mode | What he does |
|---|---|
| Friend | Room chat, tap-to-talk mic, voice you pick at first setup |
| Runner | Roof run companion. Short lines every 30–40s. Stays quiet if you already opened a conversation |
| Secretary | Booth desk: on/off, new / archive / book, session credit, spoken summary |

## Stack

- React + TypeScript (room, runner HUD, secretary desk)
- Gemini primary replies, OpenAI / Featherless fallback
- Android `SpeechRecognizer` in the APK, Web Speech API on web
- On-device TTS for the chosen voice
- No API keys in this repo

## Architecture

```
Player voice
    │
    ▼
Speech-to-text (Android / web)
    │
    ▼
Solarchik brain (Gemini → fallback)
    │
    ├── room chat (1–2 spoken sentences)
    ├── runner line (one sentence, same voice)
    └── secretary report (who / why / next action)
    │
    ▼
TTS out + on-screen caption
```

## Links

- Site: [solardepin.net](https://solardepin.net)
- X: [@SolarDePin](https://x.com/SolarDePin)
- Built by Solar DePin (Vadym), Ukraine
