// When an app does not share its selection through accessibility (Firefox, Zed, some Electron
// apps), the selection is copied with a simulated copy shortcut and the user's clipboard is put back.

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = (names: string[]) => new RegExp(`^(?:${names.map(escapeRegex).join('|')})$`, 'i');

/** Apps where no copy shortcut is safe, or where one copies something that was never selected. */
const NEVER_COPY = pattern([
  // Terminals whose copy keys are unknown or hijack Ctrl+C.
  'putty', 'wsl', 'bash',
  // Remote desktops and virtual machines pass the keys on to the other computer, maybe to a terminal.
  'mstsc', 'msrdc', 'vmconnect', 'vmware', 'vmplayer', 'virtualboxvm', 'teamviewer', 'anydesk', 'parsecd',
  'vncviewer', 'rustdesk',
  // Python's IDLE stops the running code on Ctrl+C.
  'pythonw',
  // Something is always selected here: the active cell in Excel, files in File Explorer and on the desktop.
  'excel', 'explorer',
]);

/** Terminals that safely copy with Ctrl+Insert (never sending Ctrl+C / SIGINT). */
const INSERT_TERMINALS = ['windowsterminal', 'wt', 'openconsole', 'conhost', 'cmd', 'powershell', 'pwsh', 'mintty'];
/** Modern GPU/Electron terminals that copy a selection with Ctrl+Shift+C. */
const SHIFT_C_TERMINALS = ['wezterm-gui', 'alacritty', 'kitty', 'tabby', 'warp', 'hyper'];
const SHIFT_C_TERMINAL_COPY = pattern(SHIFT_C_TERMINALS);
const TERMINAL_COPY = pattern([...INSERT_TERMINALS, ...SHIFT_C_TERMINALS]);

const JETBRAINS_IDES = [
  'idea64', 'pycharm64', 'webstorm64', 'goland64', 'rider64', 'clion64', 'phpstorm64', 'rubymine64',
  'datagrip64', 'rustrover64', 'studio64', 'aqua64', 'dataspell64', 'writerside64', 'mps64',
];

const CODE_EDITORS = [
  'code', 'code - insiders', 'cursor', 'windsurf', 'antigravity', 'kiro', 'trae', 'void', 'positron',
  ...JETBRAINS_IDES, 'fleet', 'devenv', 'sublime_text', 'zed',
];

const COPY_WITH_INSERT = pattern([...INSERT_TERMINALS, ...CODE_EDITORS]);

/** Code editors copy the whole line under the caret when nothing is selected. */
const COPIES_LINE = pattern(CODE_EDITORS);

/**
 * Apps whose editing surface is reliably writable even when UIA exposes a read-only wrapper
 * Document or omits editability metadata (custom canvases, Office, rich chat/note apps, IDEs).
 */
const KNOWN_WRITABLE_EDITORS = pattern([
  ...CODE_EDITORS,
  'notepad++', 'winword', 'powerpnt', 'onenote', 'wps', 'et', 'wpp', 'soffice',
  'whatsapp', 'whatsapp.root', 'weixin', 'wechat', 'dingtalk', 'telegram', 'slack', 'discord',
  'notion', 'obsidian', 'teams', 'ms-teams', 'olk', 'outlook', 'figma', 'emeditor', 'typora', 'logseq',
]);

const BROWSERS = pattern(['chrome', 'msedge', 'firefox', 'brave', 'vivaldi', 'opera', 'arc', 'comet', 'zen']);

const CANVAS_WEB_EDITOR_TITLE = /(?:google docs|google sheets|google slides|figma|canva|overleaf|notion|miro|excalidraw|腾讯文档|microsoft word|word online|powerpoint online|excel online|office online|onenote)/i;

export const isCanvasWebEditorTitle = (title: string) => CANVAS_WEB_EDITOR_TITLE.test(title);

export type CopyKeys = 'ctrl+c' | 'ctrl+insert' | 'ctrl+shift+c';
export type CopiedTextKind = 'selection' | 'implicit-line' | 'object' | 'plain' | 'unknown';
export interface CopiedSelection { text: string; readOnly?: boolean }

export function classifyZedCopy(metadata: string | null | undefined): CopiedTextKind {
  if (metadata === null) return 'plain';
  if (!metadata) return 'unknown';
  try {
    const ranges: unknown = JSON.parse(metadata);
    if (!Array.isArray(ranges) || !ranges.length || !ranges.every(
      (range) => range && typeof range.is_entire_line === 'boolean',
    )) return 'unknown';
    return ranges.some((range) => range.is_entire_line) ? 'implicit-line' : 'selection';
  } catch {
    return 'unknown';
  }
}

export function classifyVsCodeCopy(metadata: string | null | undefined): CopiedTextKind {
  if (metadata === null) return 'plain';
  if (!metadata) return 'unknown';
  const match = metadata.match(/isFromEmptySelection["']?\s*:\s*(true|false)/i);
  if (!match) return 'unknown';
  return match[1].toLowerCase() === 'true' ? 'implicit-line' : 'selection';
}

export function classifyPowerPointCopy(formats: readonly string[]): CopiedTextKind {
  return formats.some(
    (fmt) => fmt === 'PowerPoint 12.0 Internal Slides' || fmt === 'PowerPoint 12.0 Internal Shapes',
  ) ? 'object' : 'plain';
}

export interface CopyPlan {
  keys: CopyKeys;
  /** Optional second shortcut when UIA confirms focus is outside a terminal (e.g. IDE chat webview). */
  fallbackKeys?: CopyKeys;
  /** A copy that is one whole line with its line break is the editor's line copy, not a selection. */
  dropLineCopy: boolean;
}

export const isExcel = (processName: string) => /^excel(?:\.exe)?$/i.test(processName);

/** How to copy the selection in this app, or undefined when it must not be copied from. */
export function copyPlanFor(
  processName: string,
  excelInCellEdit = false,
  allowCtrlCFallback = false,
): CopyPlan | undefined {
  const name = processName.replace(/\.exe$/i, '');
  if (excelInCellEdit && isExcel(name)) return { keys: 'ctrl+c', dropLineCopy: false };
  if (!name || NEVER_COPY.test(name)) return undefined;
  if (SHIFT_C_TERMINAL_COPY.test(name)) return { keys: 'ctrl+shift+c', dropLineCopy: false };
  if (COPY_WITH_INSERT.test(name)) {
    const fallbackKeys = allowCtrlCFallback && COPIES_LINE.test(name) && !/^zed$/i.test(name)
      ? 'ctrl+c'
      : undefined;
    return {
      keys: 'ctrl+insert',
      ...(fallbackKeys ? { fallbackKeys } : {}),
      dropLineCopy: COPIES_LINE.test(name),
    };
  }
  return { keys: 'ctrl+c', dropLineCopy: false };
}

export const mayCopySelection = (processName: string) => !!copyPlanFor(processName);

/** A Copy-backed rewrite needs an allowed target even when its editor is opaque to UIA. */
export function canReplaceCopiedSelection(
  processName: string,
  writableField: boolean | undefined,
  excelInCellEdit = false,
  readOnlyDocument = false,
  windowTitle = '',
): boolean {
  const name = processName.replace(/\.exe$/i, '');
  if (!name || TERMINAL_COPY.test(name) || !copyPlanFor(name, excelInCellEdit)) return false;
  if (writableField === false) return false;
  if (readOnlyDocument) {
    return KNOWN_WRITABLE_EDITORS.test(name)
      || (BROWSERS.test(name) && isCanvasWebEditorTitle(windowTitle));
  }
  return true;
}

/** One line ending in its line break: what an editor copies when nothing is selected. */
export const isLineCopy = (text: string) => /^[^\r\n]*\r?\n$/.test(text);

export interface CopyDeps {
  foregroundWindow: () => unknown;
  modifiersDown: () => boolean;
  clipboardSequence: () => number;
  sendCopy: (keys: CopyKeys, sequence: number) => boolean | void;
  readCopied: () => Promise<string>;
  readCopiedKind?: () => Promise<CopiedTextKind>;
  /** Saves the user's clipboard and returns how to put it back once the copy has been read. */
  saveClipboard: () => Promise<(copied: string) => Promise<void>>;
  wait: (ms: number) => Promise<void>;
}

async function trySendAndWait(
  window: unknown,
  deps: CopyDeps,
  keys: CopyKeys,
  timeoutMs: number,
): Promise<boolean> {
  if (deps.foregroundWindow() !== window || deps.modifiersDown()) return false;
  const before = deps.clipboardSequence();
  if (deps.sendCopy(keys, before) === false) return false;
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    await deps.wait(25);
    if (deps.clipboardSequence() !== before) return true;
  }
  return false;
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

  let changed = await trySendAndWait(window, deps, plan.keys, plan.fallbackKeys ? 280 : 500);
  if (!changed && plan.fallbackKeys) {
    changed = await trySendAndWait(window, deps, plan.fallbackKeys, 350);
  }
  if (!changed) return undefined;

  // Some apps write the clipboard in steps; let them finish.
  await deps.wait(30);
  const copiedSequence = deps.clipboardSequence();
  const text = await deps.readCopied();
  const kind = await deps.readCopiedKind?.();
  if (deps.clipboardSequence() !== copiedSequence) return undefined;
  await restore(text);
  if (
    !text.trim()
    || kind === 'implicit-line'
    || kind === 'object'
    || (plan.dropLineCopy && (!kind || kind === 'unknown') && isLineCopy(text))
  ) {
    return undefined;
  }
  return text;
}
