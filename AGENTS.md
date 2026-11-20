# Agent guide: Yap Yap desktop app

Electron + React + TypeScript. The marketing site and download page live in a separate repository, `yap-yap-web` (locally `../yap yap web`), with its own `AGENTS.md`.

## Before you commit

```
npm run typecheck
npm test
```

Commit after each verified step. Do not push, tag, or publish a release unless the maintainer asks.

## Releasing a new version

Installed copies check GitHub at launch and from **Settings → About**. Treat what they read as a fixed contract:

- **Windows and Linux AppImage** use `electron-updater` with the GitHub provider (`app-update.yml` is generated from `repository` in `package.json`). They read `latest.yml` / `latest-linux.yml` from the latest published release, download the file named there, verify its SHA-512, and install in place. The Windows `.exe.blockmap` enables smaller differential downloads.
- **macOS** (unsigned, so it can't install its own updates) uses `electron/updates.ts`: it reads `https://api.github.com/repos/Mohamed-Eltelb/yap-yap/releases/latest`, downloads the DMG and verifies it against GitHub's `sha256:` asset digest.

So every release must:

- Be **published** (not a draft or prerelease), tagged `v<major>.<minor>.<patch>` matching `version` in `package.json`.
- Contain exactly these files, named by `artifactName` in `package.json` (never rename them afterwards, or `latest*.yml` points at files that don't exist):
  - `Yap-Yap-<version>-windows-x64.exe`, `Yap-Yap-<version>-windows-x64.exe.blockmap`, `latest.yml`
  - `Yap-Yap-<version>-macos-arm64.dmg`
  - `Yap-Yap-<version>-linux-x64.AppImage`, `latest-linux.yml`
  - `SHA256SUMS.txt`

Steps:

1. Bump `version` in `package.json` (and `package-lock.json` via `npm version <x.y.z> --no-git-tag-version`). Commit.
2. On GitHub, run **Actions → Desktop CI → Run workflow** on `main`. Test the installer artifacts on each OS.
3. Create a **draft** release with tag `v<version>` targeting that exact commit.
4. Run **Actions → Stage draft installers** with the Desktop CI run ID and the tag. It uploads the files above, checks that `latest*.yml` name the right installers, and verifies GitHub's digests.
5. Write the release notes, then publish the draft.
6. Update the website (see `yap-yap-web/AGENTS.md`): the download page version, and a new release-notes entry.

To test an in-place update locally, build two versions with a different `appId`, `productName` and `extraMetadata.name` (so they don't replace a real install or share its data) and `-c.publish.provider=generic -c.publish.url=http://localhost:<port>/`, install the older one, and serve the newer build's output folder.

## Product rules

- Fix transcript cleanup through the prompt, never with per-language hard-coded rules. Cleanup level **None** returns the raw transcript.
- Prefer giving users control (settings, levels, per-app styles) over fixed behavior.
