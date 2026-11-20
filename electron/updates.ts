import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const repository = 'https://github.com/Mohamed-Eltelb/yap-yap';

type Installer = { name: string; url: string; digest: string; size: number };
type Update = { message: string; installer?: Installer; url?: string };

export async function checkForUpdate(current: string, platform = process.platform, arch = process.arch): Promise<Update> {
  const response = await fetch('https://api.github.com/repos/Mohamed-Eltelb/yap-yap/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return { message: 'No public release is available to check.' };
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
    return { message, url: repository + '/releases/latest' };
  }
  return { message, installer: { name, digest: asset.digest, size: asset.size,
    url: `${repository}/releases/download/${release.tag_name}/${name}` } };
}

export async function downloadInstaller(asset: Installer, downloads: string, progress: (fraction: number) => void) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new Error('Download failed');
  const folder = await mkdtemp(join(downloads, 'Yap-Yap-'));
  const partial = join(folder, 'installer.part');
  try {
    const hash = createHash('sha256');
    let bytes = 0;
    await pipeline(response.body, async function* (source) {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > asset.size) throw new Error('Unexpected installer size');
        hash.update(chunk);
        progress(bytes / asset.size);
        yield chunk;
      }
    }, createWriteStream(partial, { flags: 'wx', mode: 0o700 }));
    if (bytes !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest) throw new Error('Installer verification failed');
    const destination = join(folder, asset.name);
    await rename(partial, destination);
    return destination;
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}
