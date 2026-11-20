# Agent guide: Yap Yap desktop app

Electron + React + TypeScript. The marketing site and download page live in a separate repository, `yap-yap-web` (locally `../yap yap web`), with its own `AGENTS.md`.

## Before you commit

```
npm run typecheck
npm test
```

Commit after each verified step. Do not push, tag, or publish a release unless the maintainer asks.

## Releasing a new version

Installed copies of the app check `https://api.github.com/repos/Mohamed-Eltelb/yap-yap/releases/latest` at launch (`electron/updates.ts`). They only offer a direct, checksum-verified download when all of this holds, so treat it as a fixed contract:

- The release is **published** (not a draft or prerelease) and its tag is `v<major>.<minor>.<patch>`, matching `version` in `package.json`.
- The assets are named exactly:
  - `Yap-Yap-<version>-windows-x64.exe`
  - `Yap-Yap-<version>-macos-arm64.dmg`
  - `Yap-Yap-<version>-linux-x64.AppImage`
- Each asset has GitHub's `sha256:` digest (GitHub adds it on upload).

Renaming assets or changing electron-builder output without updating **Stage draft installers** breaks updates for every installed copy: they fall back to a "View releases" link.

Steps:

1. Bump `version` in `package.json` (and `package-lock.json` via `npm version <x.y.z> --no-git-tag-version`). Commit.
2. On GitHub, run **Actions → Desktop CI → Run workflow** on `main`. Test the installer artifacts on each OS.
3. Create a **draft** release with tag `v<version>` targeting that exact commit.
4. Run **Actions → Stage draft installers** with the Desktop CI run ID and the tag. It renames the installers to the names above, uploads them with `SHA256SUMS.txt`, and verifies GitHub's digests.
5. Write the release notes, then publish the draft.
6. Update the website (see `yap-yap-web/AGENTS.md`): the download page version, and a new release-notes entry.

## Product rules

- Fix transcript cleanup through the prompt, never with per-language hard-coded rules. Cleanup level **None** returns the raw transcript.
- Prefer giving users control (settings, levels, per-app styles) over fixed behavior.
