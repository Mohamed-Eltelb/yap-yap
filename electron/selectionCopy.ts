// When an app does not share its selection through accessibility (Firefox, Zed, some Electron
// apps), the selection is copied with a simulated copy shortcut and the user's clipboard is put back.

const pattern = (names: string[]) => new RegExp(`^(?:${names.join('|')})$`, 'i');

/** Apps where no copy shortcut is safe, or where one copies something that was never selected. */
const NEVER_COPY = pattern([
  // Terminals whose copy keys are unknown. Ctrl+C in a terminal stops the running command.
  'wezterm-gui', 'alacritty', 'mintty', 'putty', 'kitty', 'hyper', 'tabby', 'warp', 'wsl', 'bash',
  // Remote desktops and virtual machines pass the keys on to the other computer, maybe to a terminal.
  'mstsc', 'msrdc', 'vmconnect', 'vmware', 'vmplayer', 'virtualboxvm', 'teamviewer', 'anydesk', 'parsecd',
  'vncviewer', 'rustdesk',
  // Python's IDLE stops the running code on Ctrl+C.
  'pythonw',
  // Something is always selected here: the active cell in Excel, a slide or shape in PowerPoint,
  // files in File Explorer and on the desktop.
  'excel', 'powerpnt', 'explorer',
]);

/**
 * Apps that get Ctrl+Insert, the older Windows copy shortcut, instead of Ctrl+C. In a terminal it
 * copies a selection and does nothing without one, where Ctrl+C would stop the running command
 * (Zed's terminal, Windows Terminal, the console). Code editors take it too, since Zed is both.
 */
const COPY_WITH_INSERT = pattern([
  'windowsterminal', 'openconsole', 'conhost', 'cmd', 'powershell', 'pwsh',
  'code', 'code - insiders', 'cursor', 'windsurf', 'antigravity', 'kiro', 'trae', 'void', 'positron',
  '[a-z]+64', 'fleet', 'devenv', 'sublime_text', 'zed',
]);

/** Code editors copy the whole line under the caret when nothing is selected. */
const COPIES_LINE = pattern([
  'code', 'code - insiders', 'cursor', 'windsurf', 'antigravity', 'kiro', 'trae', 'void', 'positron',
  '[a-z]+64', 'fleet', 'devenv', 'sublime_text', 'zed',
]);

export type CopyKeys = 'ctrl+c' | 'ctrl+insert';

export interface CopyPlan {
  keys: CopyKeys;
  /** A copy that is one whole line with its line break is the editor's line copy, not a selection. */
  dropLineCopy: boolean;
}

/** How to copy the selection in this app, or undefined when it must not be copied from. */
export function copyPlanFor(processName: string): CopyPlan | undefined {
  const name = processName.replace(/\.exe$/i, '');
  if (!name || NEVER_COPY.test(name)) return undefined;
  return { keys: COPY_WITH_INSERT.test(name) ? 'ctrl+insert' : 'ctrl+c', dropLineCopy: COPIES_LINE.test(name) };
}

export const mayCopySelection = (processName: string) => !!copyPlanFor(processName);

/** One line ending in its line break: what an editor copies when nothing is selected. */
export const isLineCopy = (text: string) => /^[^\r\n]*\r?\n$/.test(text);

export interface CopyDeps {
  foregroundWindow: () => unknown;
  modifiersDown: () => boolean;
  clipboardSequence: () => number;
  sendCopy: (keys: CopyKeys) => void;
  readCopied: () => Promise<string>;
  /** Saves the user's clipboard and returns how to put it back once the copy has been read. */
  saveClipboard: () => Promise<(copied: string) => Promise<void>>;
  wait: (ms: number) => Promise<void>;
}

/**
 * Copies the selection in the window that was in front when the shortcut was pressed. It waits
 * for the shortcut's keys to be released, since a copy shortcut sent with Alt or Win still held
 * would be a different shortcut, and gives up if the user moved to another window meanwhile.
 */
export async function copySelection(
  window: unknown,
  deps: CopyDeps,
  plan: CopyPlan = { keys: 'ctrl+c', dropLineCopy: false },
  maxWaitMs = 30_000,
): Promise<string | undefined> {
  for (let waited = 0; deps.modifiersDown(); waited += 30) {
    if (waited >= maxWaitMs || deps.foregroundWindow() !== window) return undefined;
    await deps.wait(30);
  }
  if (deps.foregroundWindow() !== window) return undefined;

  const restore = await deps.saveClipboard();
  if (deps.foregroundWindow() !== window || deps.modifiersDown()) return undefined;
  const before = deps.clipboardSequence();
  deps.sendCopy(plan.keys);
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
  if (!text.trim() || (plan.dropLineCopy && isLineCopy(text))) return undefined;
  return text;
}
