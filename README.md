<p align="center">
  <img src="docs/media/cover.png" width="720" alt="Yap Yap">
</p>

<p align="center"><b>Free, open-source voice dictation for your desktop.</b><br>Bring your own AI keys. Windows, macOS and Linux.</p>

<p align="center"><b><a href="https://yapyapapp.site/download.html">Download</a> · <a href="https://youtu.be/43EtNWgVEYs">Watch the trailer</a> · <a href="https://yapyapapp.site/">Try the interactive demo</a> · <a href="https://yapyapapp.site/providers.html">Setup guide</a></b></p>

Tap a shortcut in your notes app, say “um, can we move the launch to Friday?”, and Yap Yap types the cleaned-up sentence at your cursor. Use the same floating recorder to translate a message or ask a question. You choose who transcribes your audio and who edits the text.

<p align="center">
  <img src="docs/media/dictation.gif" width="480" alt="Illustrated dictation demo showing a spoken request being cleaned up as the recording pill moves from listening to finished.">
</p>

- **Your keys, your models.** Pick one provider to transcribe and another to edit, or run fully local with an OpenAI-compatible server. No account and no subscription.
- **You decide how much it edits.** **None** keeps your exact words, **Light** drops the ums and fixes punctuation, **Medium** also rewords for clarity.
- **Writes like you.** A writing style for each kind of app, a personal dictionary, snippets for text you use often, and learning from the edits you make.
- **Stays on your computer.** History, recordings and settings live in your local profile, with a retention period you choose.
- **Coming from Wispr Flow or Typeless?** Import your dictionary, snippets, writing styles and history, and undo it all in one click.

**Yap Yap has been tested on Windows x64.** The macOS and Linux builds are experimental. They pass automated checks, but recording, global shortcuts, and pasting have yet to be tested end to end on those platforms. [Help test them](https://github.com/Mohamed-Eltelb/yap-yap/issues/2).

## Install

Download the installer for your platform from the [download page](https://yapyapapp.site/download.html) or the [latest release](https://github.com/Mohamed-Eltelb/yap-yap/releases/latest). Each release lists SHA-256 checksums in `SHA256SUMS.txt`.

The installers aren’t code-signed, so your system may warn you the first time:

- **Windows:** if SmartScreen says “Windows protected your PC”, choose **More info → Run anyway**.
- **macOS:** if the app is reported as damaged or can’t be opened, move it to Applications and run `xattr -dr com.apple.quarantine "/Applications/Yap Yap.app"` in Terminal.
- **Linux:** make the AppImage executable (`chmod +x Yap-Yap-*.AppImage`) and run it.

## Your first dictation

1. Launch the desktop app. The first-run setup walks you through microphone access, connecting a provider, a microphone check and a test dictation. **Groq** is a good start: one free key handles both transcription and text cleanup. [Provider setup guide](https://yapyapapp.site/providers.html#groq)
2. Click inside a blank note. Tap and release the **Dictate** shortcut shown on Home, speak a sentence, then tap the shortcut again to finish.
3. With auto-paste enabled, the result appears at your cursor. Open **History** to replay, edit, or retry it with another provider.

| Mode | Default shortcut | Try saying |
| --- | --- | --- |
| Dictate | Right Alt | “Remind me to send Noor the slides on Friday.” |
| Translate | Right Alt + Right Shift | “The train arrives at half past six.” Choose a target language to get the translation. |
| Ask anything | Right Alt + Space | “What’s a shorter way to say ‘at your earliest convenience’?” |

Change shortcuts in Settings. Add names to your dictionary to help transcription, or create a snippet that expands a spoken phrase into text you use often.

![Yap Yap Home with example word counts, time saved, a dictation activity heatmap, and the three shortcut keys](docs/media/desktop.webp)

## Updates

Yap Yap checks GitHub for a newer release at launch, and you can also check from **Settings → About**. A new version appears as a card in the sidebar. Nothing downloads until you choose **Download**, and the card shows the download’s progress.

- **Windows and Linux (AppImage):** the update is checked against the release’s SHA-512 checksum, then installs when you choose **Restart now**, or when you quit Yap Yap from the tray.
- **macOS:** the new DMG is checked against its SHA-256 checksum and saved to Downloads for you to install.

## Choose your providers

| Task | Built-in connections |
| --- | --- |
| Speech to text | Groq, OpenAI, Google Gemini, Deepgram, ElevenLabs |
| Cleanup, translation, and answers | Groq, OpenAI, Google Gemini, Anthropic Claude |

The **Custom / OpenAI-Compatible** connection can use a server you run yourself. Use an endpoint that supports the operation you select, such as audio transcription for dictation or chat completions for cleanup. Cloud providers bill usage to your own account.

## Run from source

Use Git and Node.js **24.15 or newer on the 24.x line** for the setup below. The renderer preview and automated tests run without provider keys.

```sh
git clone https://github.com/Mohamed-Eltelb/yap-yap.git
cd yap-yap
npm ci
npm run dev
```

| Platform | Desktop setup |
| --- | --- |
| Windows x64 | The source checkout includes the native shortcut DLL. To rebuild it, install Visual Studio C++ Build Tools with the x64 toolchain and Windows SDK, then run `npm run build:keyhook`. |
| macOS (experimental) | Allow microphone access. Global shortcuts and pasting can require Accessibility, Input Monitoring, and Automation permissions for the app you launch. |
| Linux (experimental) | Use an X11 session with `xdotool` installed for auto-paste. For cursor context and learning from edits in accessible text fields, install the system Python 3 PyGObject and AT-SPI bindings (Debian/Ubuntu: `python3-gi gir1.2-atspi-2.0`). Without them, context falls back to the application name. Browsers can expose their pages, including the site domain used for per-site styles, only while desktop accessibility is enabled. System mute uses `pactl` (PulseAudio or PipeWire-Pulse) or `amixer` (ALSA). In a Wayland session, Yap Yap can't read or paste into native Wayland apps, so the result card keeps the text for you to copy, and global shortcuts are unverified. The floating recorder needs a compositing window manager; without one, its transparent area shows black. |

Use `npm run dev:web` to explore the interface in a browser at `http://localhost:5173`. Global shortcuts, the floating desktop recorder, and cross-app paste run in Electron.

## Where your data goes

Your configured speech provider receives audio for transcription. Cleanup, translation, and Ask anything can send dictated content and enabled personalization context to your AI provider. Models with web search can use their provider’s search service when answering a question.

History, retained recordings, and settings live in your local app profile. **Provider keys are stored locally without application-level encryption.** Treat that profile and its backups as sensitive. History retention, context awareness, and learning from edits can be adjusted in Settings.

## Contribute

The app uses React and TypeScript for the interface, Electron for desktop integration, and a small C++ helper for Windows shortcuts. The contributor guide covers tests, packaging, and where to make changes. [Contributing](CONTRIBUTING.md) · [Report a security issue privately](SECURITY.md)

Yap Yap is released under the MIT license. Fonts, icons, and bundled dependencies carry their own notices. [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
