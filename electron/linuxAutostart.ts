import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

// Desktop Entry Exec quoting is parsed after the string-value escapes.
function desktopArgument(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Unsupported newline in autostart path');
  const argument = value.replace(/["`$\\]/g, '\\$&').replace(/%/g, '%%');
  return '"' + argument.replace(/\\/g, '\\\\') + '"';
}

export function setLinuxAutostart(configDir: string, enabled: boolean, command: string[]): void {
  const directory = join(configDir, 'autostart');
  const filename = join(directory, 'com.yapyap.desktop.desktop');
  if (!enabled) {
    rmSync(filename, { force: true });
    return;
  }
  const exec = command.map(desktopArgument).join(' ');
  const entry = ['[Desktop Entry]', 'Type=Application', 'Name=Yap Yap', 'Exec=' + exec, 'Terminal=false', ''].join('\n');
  mkdirSync(directory, { recursive: true });
  const temporary = filename + '.' + randomUUID();
  try {
    writeFileSync(temporary, entry, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, filename);
  } finally {
    rmSync(temporary, { force: true });
  }
}
