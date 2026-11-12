# Yap Yap

A multi-provider BYOK (Bring Your Own Key) voice dictation, translation, and AI assistant desktop app built with **Electron**, **React**, **TypeScript**, and **Tailwind CSS**.

## Features

- **Bring Your Own API Key (Multi-Provider)**:
  - **Speech-to-Text**: Groq (`whisper-large-v3-turbo`, `whisper-large-v3`), OpenAI (`gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`), Google Gemini (`gemini-2.5-flash`), Deepgram (`nova-3`, `nova-2`), ElevenLabs (`scribe_v1`), and Custom OpenAI-compatible endpoints (local Whisper, etc.).
  - **AI Cleanup, Translate & Ask Anything**: OpenAI, Groq, Google Gemini, Anthropic Claude, and Custom OpenAI-compatible endpoints (OpenRouter, Ollama, LM Studio).
- **Three Voice Modes**:
  - **Dictate**: Clean, punctuated voice-to-text with custom dictionary vocabulary hints.
  - **Translate**: Dictate in any language and translate directly into up to 3 configured target languages.
  - **Ask anything**: Speak a question or command and get a concise, ready-to-paste answer.
- **Insights & Activity Heatmap**: Word counts, time saved, average WPM, active days, streaks, interactive 28-week activity heatmap, personalization radial breakdown, and Share Insights PNG export.
- **Private Local History**: Retention controls, RTL/LTR transcript rendering, audio replay/download, one-click retry with any configured provider, and JSON export.
- **Custom Dictionary**: Auto-added and manually-added terms + CSV import, automatically passed as vocabulary hints to transcription and AI models.
- **Light & Dark Modes**: Full theme parity plus customizable shortcuts, microphone selection, and interaction sounds.

## Development

```bash
npm install
npm run dev        # Launches Vite + Electron desktop app
npm run dev:web    # Launches Vite web UI only at http://localhost:5173
```

## Testing & Building

```bash
npm run typecheck
npm test
npm run build           # Builds React renderer + Electron main/preload
npm run build:electron  # Packages desktop installers via electron-builder
```
