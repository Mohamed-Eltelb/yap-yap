import { spawn } from 'node:child_process';

const X11_PLAIN_CLIPBOARD_FORMATS = new Set([
  'text/plain',
  'text/plain;charset=utf-8',
  'utf8_string',
  'string',
  'text',
  'compound_text',
  'targets',
  'timestamp',
  'multiple',
  'save_targets',
]);

function isPlainClipboardType(type: string): boolean {
  const lower = type.toLowerCase();
  if (lower === 'text/plain' || lower.startsWith('text/plain;')) return true;
  const match = lower.match(/^electron application\/osclipboard;format="([^"]+)"$/);
  if (!match) return false;
  const format = match[1];
  return X11_PLAIN_CLIPBOARD_FORMATS.has(format) || format.startsWith('text/plain;');
}

/**
 * Returns the plain-text payload when a clipboard snapshot holds only plain text (and X11
 * text/meta atoms), or undefined if it contains rich formats (HTML, images, files, etc.).
 */
export async function plainTextFromClipboardSnapshot(
  snapshot: ReadonlyArray<Record<string, unknown>>,
): Promise<string | undefined> {
  const nonEmpty = snapshot.filter((item) => Object.keys(item).length > 0);
  if (nonEmpty.length !== 1) return undefined;
  const item = nonEmpty[0];
  if (!Object.keys(item).every(isPlainClipboardType)) return undefined;
  const plain = item['text/plain'];
  if (!(plain instanceof Blob)) return undefined;
  return plain.text();
}

export function runClipboardCommand(
  command: string,
  args: string[],
  input: string | undefined,
  timeoutMs = 1500,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const child = spawn(command, args, {
      // Ignoring stdout/stderr lets daemonizing tools (wl-copy, xclip, xsel) exit promptly.
      stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already exited
      }
      finish(false);
    }, timeoutMs);
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    if (input !== undefined && child.stdin) {
      child.stdin.on('error', () => finish(false));
      child.stdin.end(input, 'utf8');
    }
  });
}

/**
 * Writes plain text to the Linux system clipboard without touching X11 PRIMARY selection
 * (which Electron's clipboard.writeText overwrites, clearing active highlights in GTK apps)
 * and without requiring window focus on Wayland.
 */
export async function writeLinuxClipboardText(
  text: string,
  wayland: boolean,
  runner: typeof runClipboardCommand = runClipboardCommand,
): Promise<boolean> {
  if (wayland) {
    if (!text) return runner('wl-copy', ['--clear'], undefined);
    return runner('wl-copy', ['--type', 'text/plain;charset=utf-8'], text);
  }
  if (await runner('xclip', ['-selection', 'clipboard', '-in'], text)) return true;
  return runner('xsel', ['--clipboard', '--input'], text);
}
