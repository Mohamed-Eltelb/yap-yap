import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { checkForUpdate, downloadInstaller, installsUpdatesInPlace } from '../../electron/updates';

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
  const update = await checkForUpdate('1.0.9', 'win32', 'x64');
  expect(update).toMatchObject({ status: 'available', version: '1.0.10', installer: { name: asset.name } });
  expect(await checkForUpdate('1.0.10')).toEqual({ status: 'up-to-date', version: '1.0.10' });
  expect(await checkForUpdate('2.0.0')).toEqual({ status: 'up-to-date', version: '2.0.0' });
  expect(await checkForUpdate('1.0.9', 'win32', 'arm64')).toMatchObject({
    status: 'available', url: expect.stringContaining('/releases/latest'),
  });
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
    expect(await readdir(dir)).toEqual([asset.name]);
    const second = await downloadInstaller(download, dir, vi.fn());
    expect(second).toBe(join(dir, 'Yap-Yap-1.0.10-windows-x64 (1).exe'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('updates Windows and AppImage builds in place and macOS or other Linux runs by download', () => {
  expect(installsUpdatesInPlace('win32', undefined)).toBe(true);
  expect(installsUpdatesInPlace('linux', '/home/me/Yap-Yap-1.0.1-linux-x64.AppImage')).toBe(true);
  expect(installsUpdatesInPlace('linux', undefined)).toBe(false);
  expect(installsUpdatesInPlace('darwin', undefined)).toBe(false);
});
