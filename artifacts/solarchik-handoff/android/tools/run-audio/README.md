# run-audio: the roof run's music and effects, generated from code

Everything here is original and dedicated **CC0 1.0** (see
`app/src/main/assets/licenses/AUDIO-CREDITS.txt`). No third-party samples.

- `synth.py`: tiny numpy synth: band-limited additive oscillators, FFT filters,
  synthetic drums, a noise-built stereo reverb, seamless loop rendering (tails wrap
  to the top), sidechain ducking, loudness targeting + soft limiter, OGG via ffmpeg.
- `music.py OUT`: four chapter loops (golden, night, storm, boss), each ~-18 LUFS,
  true peak below -5 dBFS so in-game mixing has headroom.
- `sfx.py OUT`: 29 one-shot effects (mono 44.1 kHz OGG q4).

```
python3 music.py /tmp/audio && python3 sfx.py /tmp/audio/sfx
cp /tmp/audio/{golden,night,storm,boss}.ogg ../../app/src/main/assets/audio/music/
cp /tmp/audio/sfx/*.ogg ../../app/src/main/assets/audio/sfx/
```

Renders are deterministic (fixed seeds). Per-clip mix gains live in
`RunSounds.GAIN` (RunAudio.kt), the coin streak pitch ladder in `RunSounds.coinRate`.
