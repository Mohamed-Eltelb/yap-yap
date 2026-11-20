# Contributing to Yap Yap

Start with the [source setup](README.md#run-from-source). To reproduce a dictation issue, include the app version, operating system, mode, provider and model, and what you expected to appear at the cursor. Use example text and remove credentials from screenshots and logs. For sensitive findings, use the [security reporting instructions](SECURITY.md).

## Find the right code

| Area | Location |
| --- | --- |
| Home, Settings, History, and recorder UI | `src/components/` |
| Recording and dictation flow | `src/App.tsx`, `src/utils/audioRecorder.ts` |
| Provider connections and model selection | `src/services/providers/` |
| Desktop windows, shortcuts, paste, and storage | `electron/` |
| Windows keyboard hook | `native/windows/` |
| Tests | `src/__tests__/` |

## Check a change

```sh
npm run typecheck
npm test
npm run build
```

The tests mock provider calls. For a shortcut or microphone change, also try one recording from a blank note in the desktop app and check the result in History. For a UI change, include a screenshot with sample data. Include the OS and checks you ran in the pull request.

## Build an installer

Run `npm run build:electron` on the target platform. The installer goes into `release/`. The configured targets are Windows NSIS (`.exe`), macOS disk image (`.dmg`), and Linux AppImage. Windows x64 contributors can rebuild the bundled helper with `npm run build:keyhook` before packaging.

The **Desktop CI** workflow runs tests and builds on all three platforms. A maintainer can use **Actions → Desktop CI → Run workflow** to produce installer artifacts for testing. Download the artifact for each platform, extract it, and check installation, microphone access, shortcuts, and pasting on that OS. The workflow packages without publishing. For a public release, use a tag matching the package version (for example `v1.0.0`), identify each installer’s architecture and signing status, and attach the tested installers to its GitHub release.
