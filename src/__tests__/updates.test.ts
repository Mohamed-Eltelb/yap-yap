import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { checkForUpdate, downloadInstaller } from '../../electron/updates';

const payload = 'example installer bytes';
const asset = {
  name: 'Yap-Yap-1.0.10-windows-x64.exe', size: payload.length, state: 'uploaded',
  digest: 'sha256:' + createHash('sha256').update(payload).digest('hex'),
};
const release = { tag_name: 'v1.0.10', draft: false, prerelease: false, assets: [asset] };

afterEach(() => vi.unstubAllGlobals());

it('selects a newer Windows installer numerically and ignores same or older releases', async () => {
  const fetcher = vi.fn(async () => Response.json(release));
  vi.stubGlobal('fetch', fetcher);
  expect((await checkForUpdate('1.0.9', 'win32', 'x64')).installer?.name).toBe(asset.name);
  expect((await checkForUpdate('1.0.10')).installer).toBeUndefined();
  expect((await checkForUpdate('2.0.0')).installer).toBeUndefined();
  expect((await checkForUpdate('1.0.9', 'win32', 'arm64')).url).toContain('/releases/latest');
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('saves a verified download and removes an incomplete or corrupt download', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yapyap-update-test-'));
  try {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)));
    const download = { ...asset, url: 'https://example.invalid/installer' };
    const saved = await downloadInstaller(download, dir, vi.fn());
    expect(await readFile(saved, 'utf8')).toBe(payload);
    for (const change of [{ digest: 'invalid' }, { size: 1 }, { size: 999 }]) {
      await expect(downloadInstaller({ ...download, ...change }, dir, vi.fn())).rejects.toThrow();
    }
    expect(await readdir(dir)).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
