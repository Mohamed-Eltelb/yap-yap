import { createHash, randomUUID } from 'node:crypto';
import { access, open, rename, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';

const repository = 'https://github.com/Mohamed-Eltelb/yap-yap';

type Installer = { name: string; url: string; digest: string; size: number };
type Update = { message: string; version?: string; installer?: Installer; url?: string };

/**
 * Windows and AppImage builds update in place with electron-updater. macOS (unsigned, so it
 * can't install its own updates) and other Linux runs download a verified installer instead.
 */
export function installsUpdatesInPlace(platform: string = process.platform, appImage = process.env.APPIMAGE): boolean {
  return platform === 'win32' || (platform === 'linux' && Boolean(appImage));
}

export async function checkForUpdate(current: string, platform = process.platform, arch = process.arch): Promise<Update> {
  const response = await fetch('https://api.github.com/repos/Mohamed-Eltelb/yap-yap/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return { message: 'No release is available to check yet.' };
  if (!response.ok) throw new Error('Release check failed');
  const release = await response.json() as {
    tag_name: string; draft: boolean; prerelease: boolean;
    assets: Array<{ name: string; digest?: string; size: number; state: string }>;
  };
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name);
  if (!match || release.draft || release.prerelease) throw new Error('Unexpected release');
  const version = match[1];
  const installed = current.split('.').map(Number);
  const difference = version.split('.').map((v, i) => Number(v) - installed[i]).find(n => n !== 0);
  if (!difference || difference < 0) return { message: `Yap Yap v${current} is up to date.` };
  const suffixes: Record<string, string> = { 'win32-x64': 'windows-x64.exe', 'darwin-arm64': 'macos-arm64.dmg', 'linux-x64': 'linux-x64.AppImage' };
  const suffix = suffixes[`${platform}-${arch}`];
  const name = `Yap-Yap-${version}-${suffix}`;
  const asset = release.assets.find(a => a.name === name && a.state === 'uploaded');
  const message = `Yap Yap v${version} is available.`;
  if (!suffix || !asset?.digest || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !(asset.size > 0)) {
    return { message, version, url: repository + '/releases/latest' };
  }
  return { message, version, installer: { name, digest: asset.digest, size: asset.size,
    url: `${repository}/releases/download/${release.tag_name}/${name}` } };
}

async function availablePath(folder: string, name: string) {
  const extension = extname(name);
  const base = name.slice(0, name.length - extension.length);
  for (let i = 0; ; i++) {
    const candidate = join(folder, i ? `${base} (${i})${extension}` : name);
    try { await access(candidate); } catch { return candidate; }
  }
}

export async function downloadInstaller(asset: Installer, downloads: string, progress: (fraction: number) => void) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new Error('Download failed');
  const partial = join(downloads, `${asset.name}.${randomUUID()}.part`);
  const file = await open(partial, 'wx', 0o700);
  try {
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > asset.size) throw new Error('Unexpected installer size');
        hash.update(chunk);
        await file.write(chunk);
        progress(bytes / asset.size);
      }
    } finally {
      // Close before verifying or removing: on Windows an open file lingers after it is deleted.
      await file.close();
    }
    if (bytes !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest) throw new Error('Installer verification failed');
    const destination = await availablePath(downloads, asset.name);
    await rename(partial, destination);
    return destination;
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
