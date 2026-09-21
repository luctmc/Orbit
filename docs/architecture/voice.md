# Voice Architecture

Designed now, built after the MVP (Phase 8), so nothing in the earlier phases precludes it.

## Principle

No LLM or heavy model is kept resident in RAM/VRAM. Wake word and VAD must be light enough
to run continuously; STT and TTS are loaded on demand and unloaded after idle.

## Recommended pipeline

```
cpal capture (16 kHz mono)
  → WebRTC VAD gate            ~0% CPU, always on
  → Silero VAD v5 (ONNX, ~1 MB) <1% CPU, on gated frames
  → openWakeWord (ONNX)         ~1–2% CPU, on speech frames    [Apache-2.0]
  → [wake] → endpointed utterance
  → STT:  macOS 26+ → SpeechAnalyzer (on-device, free, ~55% faster than whisper large-v3-turbo)
          Windows   → cloud (Deepgram Flux, integrated end-of-turn <300 ms) if online,
                      else whisper.cpp small-q5 loaded on demand, unloaded after idle
  → agent
  → TTS:  default AVSpeechSynthesizer / WinRT SpeechSynthesizer (offline, trivial barge-in)
          opt-in ElevenLabs Flash v2.5 (persistent WS, explicit cancel)
```

Realistic idle budget: **~2–3% of one core, ~20 MB RSS, zero GPU**, with no large model
resident until the wake word actually fires.

## Component choices and why

- **openWakeWord (Apache-2.0), not Porcupine.** Porcupine's engine is proprietary: personal
  accounts are non-commercial only, custom training is x86_64-only, and commercial use
  requires a paid Enterprise licence. openWakeWord runs 15–20 models simultaneously in real
  time on a single Pi 3 core — comfortably within budget on any modern laptop. Snowboy is
  dead (discontinued 2020) and is not an option.
- **The macOS/Windows STT asymmetry is permanent, not transitional.** macOS 26's
  `SpeechAnalyzer` is excellent (on-device, no network in the transcription path) but
  **Swift-only** — no C/ObjC surface, so it is driven from the Swift sidecar. Windows Speech
  Recognition was deprecated in December 2023 with no app-facing successor, so Windows means
  cloud STT (Deepgram/AssemblyAI/OpenAI) or local whisper.cpp.
- **Barge-in is what separates production from demo.** With cloud TTS there are *two*
  buffers to drain on interruption — the network stream and the audio device queue.
  Draining only one produces the classic "it kept talking for two more seconds" bug. Native
  synthesizers (`AVSpeechSynthesizer`, WinRT `SpeechSynthesizer`) avoid the problem entirely
  because there is no network buffer.

## Architectural commitments (hold from day one, even before voice is built)

1. **Audio never touches the webview.** Capture, VAD, and wake word live entirely in the
   native layer (the Rust napi-rs addon and the Swift sidecar) — this also sidesteps
   WKWebView's worst area of Chromium divergence.
2. **A long-lived capture process**, never one spawned per utterance.
3. **STT and TTS are traits with per-platform backends**, established now, so the permanent
   platform asymmetry above doesn't require a later rewrite.
4. Microphone permission (`NSMicrophoneUsageDescription` on macOS; the standard Windows
   Settings gate) is requested **when the user enables voice**, never at first launch.
