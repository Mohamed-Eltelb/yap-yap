// When an app does not share its selection through accessibility (Firefox, some Electron apps),
// the selection is copied with a simulated Ctrl+C and the user's clipboard is put back.

/** Apps where Ctrl+C is unsafe or copies more than the selection. */
const NEVER_COPY = new RegExp('^(?:' + [
  // In a terminal, Ctrl+C without a selection stops the running command. Terminals share their
  // selection through accessibility instead.
  'windowsterminal', 'cmd', 'powershell', 'pwsh', 'conhost', 'openconsole', 'wezterm-gui', 'alacritty',
  'mintty', 'putty', 'kitty', 'hyper', 'tabby', 'warp', 'wsl', 'bash',
  // Code editors copy the whole line when nothing is selected: VS Code and its forks, JetBrains
  // IDEs, Visual Studio, Sublime Text, and Zed.
  'code', 'code - insiders', 'cursor', 'windsurf', 'antigravity', 'kiro', 'trae', 'void', 'positron',
  '[a-z]+64', 'fleet', 'devenv', 'sublime_text', 'zed',
  // Remote desktops and virtual machines pass Ctrl+C on to the other computer, maybe to a terminal.
  'mstsc', 'msrdc', 'vmconnect', 'vmware', 'vmplayer', 'virtualboxvm', 'teamviewer', 'anydesk', 'parsecd',
  'vncviewer', 'rustdesk',
  // Python's IDLE stops the running code on Ctrl+C.
  'pythonw',
  // Something is always selected here: the active cell in Excel, a slide or shape in PowerPoint,
  // files in File Explorer and on the desktop.
  'excel', 'powerpnt', 'explorer',
].join('|') + ')$', 'i');

export function mayCopySelection(processName: string): boolean {
  return !!processName && !NEVER_COPY.test(processName.replace(/\.exe$/i, ''));
}

export interface CopyDeps {
  foregroundWindow: () => unknown;
  modifiersDown: () => boolean;
  clipboardSequence: () => number;
  sendCopy: () => void;
  readCopied: () => Promise<string>;
  /** Saves the user's clipboard and returns how to put it back once the copy has been read. */
  saveClipboard: () => Promise<(copied: string) => Promise<void>>;
  wait: (ms: number) => Promise<void>;
}

/**
 * Copies the selection in the window that was in front when the shortcut was pressed. It waits
 * for the shortcut's keys to be released, since Ctrl+C sent with Alt or Win still held would be a
 * different shortcut, and gives up if the user moved to another window meanwhile.
 */
export async function copySelection(window: unknown, deps: CopyDeps, maxWaitMs = 30_000): Promise<string | undefined> {
  for (let waited = 0; deps.modifiersDown(); waited += 30) {
    if (waited >= maxWaitMs || deps.foregroundWindow() !== window) return undefined;
    await deps.wait(30);
  }
  if (deps.foregroundWindow() !== window) return undefined;

  const restore = await deps.saveClipboard();
  const before = deps.clipboardSequence();
  deps.sendCopy();
  // Apps put the copy on the clipboard within a few tens of milliseconds; nothing means no selection.
  let changed = false;
  for (let waited = 0; waited < 500 && !changed; waited += 25) {
    await deps.wait(25);
    changed = deps.clipboardSequence() !== before;
  }
  if (!changed) return undefined;
  // Some apps write the clipboard in steps; let them finish.
  await deps.wait(30);
  const text = await deps.readCopied();
  await restore(text);
  return text.trim() ? text : undefined;
}
