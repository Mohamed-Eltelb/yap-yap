import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { retargetLinuxAutostart, setLinuxAutostart } from '../../electron/linuxAutostart';

it('registers the current AppImage path and removes the entry on disable', () => {
  const config = mkdtempSync(join(tmpdir(), 'yapyap-autostart-'));
  try {
    const entry = join(config, 'autostart', 'com.yapyap.desktop.desktop');
    setLinuxAutostart(config, false, []);
    setLinuxAutostart(config, true, ['/apps/My Yap Yap.AppImage']);
    expect(readFileSync(entry, 'utf8')).toContain('Exec="/apps/My Yap Yap.AppImage"\n');
    setLinuxAutostart(config, true, ['/apps/100% portable.AppImage']);
    expect(readFileSync(entry, 'utf8')).toContain('Exec="/apps/100%% portable.AppImage"\n');
    setLinuxAutostart(config, false, []);
    expect(readdirSync(join(config, 'autostart'))).toEqual([]);
  } finally {
    rmSync(config, { recursive: true, force: true });
  }
});

it('follows the AppImage to its new file name after an update, only while enabled', () => {
  const config = mkdtempSync(join(tmpdir(), 'yapyap-autostart-'));
  try {
    const entry = join(config, 'autostart', 'com.yapyap.desktop.desktop');
    retargetLinuxAutostart(config, ['/apps/Yap-Yap-1.1.0-linux-x64.AppImage']);
    expect(existsSync(entry)).toBe(false);
    setLinuxAutostart(config, true, ['/apps/Yap-Yap-1.0.0-linux-x64.AppImage', '--hidden']);
    retargetLinuxAutostart(config, ['/apps/Yap-Yap-1.1.0-linux-x64.AppImage', '--hidden']);
    expect(readFileSync(entry, 'utf8')).toContain('Exec="/apps/Yap-Yap-1.1.0-linux-x64.AppImage" "--hidden"\n');
  } finally {
    rmSync(config, { recursive: true, force: true });
  }
});
