import { describe, expect, it, vi } from 'vitest';
import {
  canReplaceCopiedSelection,
  classifyZedCopy,
  copyPlanFor,
  copySelection,
  mayCopySelection,
  type CopyDeps,
} from '../../electron/selectionCopy';

/** A fake desktop: the clipboard, the window in front, and keys held for a while. */
function desktop({ selection = 'Picked text', heldFor = 0, window = 1, switchTo }: { selection?: string; heldFor?: number; window?: number; switchTo?: number } = {}) {
  let clock = 0;
  let sequence = 7;
  let clipboard = 'user clipboard';
  const restored: string[] = [];
  const deps: CopyDeps = {
    foregroundWindow: () => (switchTo !== undefined && clock > 0 ? switchTo : window),
    modifiersDown: () => clock < heldFor,
    clipboardSequence: () => sequence,
    sendCopy: vi.fn(() => {
      if (!selection) return;
      clipboard = selection;
      sequence += 1;
    }),
    readCopied: async () => clipboard,
    saveClipboard: async () => {
      const saved = clipboard;
      return async (copied, copiedSequence) => {
        if (clipboard === copied && sequence === copiedSequence) {
          clipboard = saved;
          restored.push(saved);
        }
      };
    },
    wait: async (ms) => {
      clock += ms;
    },
  };
  return { deps, restored, clipboard: () => clipboard };
}

describe('Copying the selection', () => {
  it('allows Copy-backed rewrites in opaque editors and preserves the target restrictions', () => {
    expect(canReplaceCopiedSelection('CustomEditor.exe', undefined)).toBe(true);
    expect(canReplaceCopiedSelection('Zed.exe', undefined)).toBe(true);
    expect(canReplaceCopiedSelection('powerpnt.exe', undefined)).toBe(true);
    expect(canReplaceCopiedSelection('CustomEditor.exe', false)).toBe(false);
    expect(canReplaceCopiedSelection('WindowsTerminal.exe', undefined)).toBe(false);
    expect(canReplaceCopiedSelection('wt.exe', true)).toBe(false);
    expect(canReplaceCopiedSelection('warp.exe', undefined)).toBe(false);
    expect(canReplaceCopiedSelection('mintty.exe', undefined)).toBe(false);
    expect(canReplaceCopiedSelection('explorer.exe', undefined)).toBe(false);
    expect(canReplaceCopiedSelection('et.exe', undefined)).toBe(false);
    expect(canReplaceCopiedSelection('mstsc.exe', undefined)).toBe(false);
    expect(canReplaceCopiedSelection('WINWORD.EXE', true)).toBe(true);
  });

  it('treats any UIA-detected embedded terminal as non-replaceable and avoids Ctrl+C', () => {
    expect(canReplaceCopiedSelection('AnyUnknownApp.exe', true, false, true)).toBe(false);
    expect(canReplaceCopiedSelection('AnyUnknownApp.exe', undefined, false, true)).toBe(false);
    expect(copyPlanFor('AnyUnknownApp.exe', false, true, true)).toEqual({ keys: 'ctrl+insert', dropLineCopy: false });
    expect(copyPlanFor('Code.exe', false, true, true)).toEqual({ keys: 'ctrl+insert', dropLineCopy: false });
  });

  it('copies the selection and puts the user\'s clipboard back', async () => {
    const fake = desktop();
    expect(await copySelection(1, fake.deps)).toBe('Picked text');
    expect(fake.clipboard()).toBe('user clipboard');
  });

  it('waits for the shortcut keys to be released before pressing Ctrl+C', async () => {
    const fake = desktop({ heldFor: 300 });
    expect(await copySelection(1, fake.deps)).toBe('Picked text');
    expect(fake.deps.sendCopy).toHaveBeenCalledTimes(1);
  });

  it('gives up when keys stay held or the user moved to another window', async () => {
    const held = desktop({ heldFor: 10_000 });
    expect(await copySelection(1, held.deps, undefined, 1000)).toBeUndefined();
    expect(held.deps.sendCopy).not.toHaveBeenCalled();

    const moved = desktop({ heldFor: 100, switchTo: 2 });
    expect(await copySelection(1, moved.deps)).toBeUndefined();
    expect(moved.deps.sendCopy).not.toHaveBeenCalled();
  });

  it('does not send Copy if focus changes while saving the clipboard', async () => {
    const fake = desktop();
    let window = 1;
    fake.deps.foregroundWindow = () => window;
    fake.deps.saveClipboard = async () => {
      window = 2;
      return async () => undefined;
    };

    expect(await copySelection(1, fake.deps)).toBeUndefined();
    expect(fake.deps.sendCopy).not.toHaveBeenCalled();
  });

  it('stops when the native shortcut rejects the target or clipboard sequence', async () => {
    const fake = desktop();
    fake.deps.sendCopy = vi.fn(() => false);
    const readCopied = vi.spyOn(fake.deps, 'readCopied');

    expect(await copySelection(1, fake.deps)).toBeUndefined();
    expect(fake.deps.sendCopy).toHaveBeenCalledWith('ctrl+c', 7);
    expect(readCopied).not.toHaveBeenCalled();
  });

  it('finds nothing when the copy leaves the clipboard unchanged', async () => {
    const fake = desktop({ selection: '' });
    expect(await copySelection(1, fake.deps)).toBeUndefined();
    expect(fake.clipboard()).toBe('user clipboard');
  });

  it('uses explicit terminal and IDE copy shortcuts without misclassifying unrelated *64 apps', () => {
    for (const app of ['WindowsTerminal', 'powershell', 'mintty', 'Zed', 'Code', 'Cursor', 'idea64', 'pycharm64']) {
      expect(copyPlanFor(app)?.keys).toBe('ctrl+insert');
    }
    for (const app of ['wezterm-gui', 'alacritty', 'kitty', 'tabby', 'warp', 'hyper']) {
      expect(copyPlanFor(app)).toEqual({ keys: 'ctrl+shift+c', dropLineCopy: false });
    }
    for (const app of ['firefox', 'chrome', 'Discord', 'WINWORD', 'powerpnt', 'Notepad', 'obs64', 'totalcmd64']) {
      expect(copyPlanFor(app)).toEqual({ keys: 'ctrl+c', dropLineCopy: false });
    }
    for (const app of ['mstsc', 'AnyDesk', 'pythonw', 'EXCEL', 'et', 'explorer', 'putty', '']) {
      expect(mayCopySelection(app)).toBe(false);
    }
    expect(copyPlanFor('powershell')?.dropLineCopy).toBe(false);
    expect(copyPlanFor('Zed')?.dropLineCopy).toBe(true);
  });

  it('falls back from Ctrl+Insert to Ctrl+C in code editors only when allowed outside terminals', async () => {
    expect(copyPlanFor('Code', false, true)).toEqual({ keys: 'ctrl+insert', fallbackKeys: 'ctrl+c', dropLineCopy: true });
    expect(copyPlanFor('Code', false, false)).toEqual({ keys: 'ctrl+insert', dropLineCopy: true });
    expect(copyPlanFor('Zed', false, true)).toEqual({ keys: 'ctrl+insert', dropLineCopy: true });

    let seq = 1;
    let clip = 'old';
    const sendCopy = vi.fn((keys: string) => {
      if (keys === 'ctrl+c') {
        clip = 'From webview chat';
        seq += 1;
      }
    });
    const result = await copySelection(1, {
      foregroundWindow: () => 1,
      modifiersDown: () => false,
      clipboardSequence: () => seq,
      sendCopy,
      readCopied: async () => clip,
      saveClipboard: async () => async (copied) => {
        if (clip === copied) clip = 'old';
      },
      wait: async () => undefined,
    }, copyPlanFor('Code', false, true));

    expect(result).toBe('From webview chat');
    expect(sendCopy).toHaveBeenNthCalledWith(1, 'ctrl+insert', 1);
    expect(sendCopy).toHaveBeenNthCalledWith(2, 'ctrl+c', 1);
    expect(clip).toBe('old');
  });

  it('limits Excel Copy and replacement to the in-cell text editor', () => {
    expect(canReplaceCopiedSelection('EXCEL.EXE', undefined, true)).toBe(true);
    expect(canReplaceCopiedSelection('EXCEL.EXE', undefined)).toBe(false);
    expect(canReplaceCopiedSelection('EXCEL.EXE', false, true)).toBe(false);
    expect(copyPlanFor('EXCEL.EXE')).toBeUndefined();
    expect(copyPlanFor('EXCEL.EXE', true)).toEqual({ keys: 'ctrl+c', dropLineCopy: false });
  });

  it('distinguishes Zed highlights with a newline from implicit line copies', async () => {
    const plan = copyPlanFor('Zed');
    const fake = desktop({ selection: 'sample text\r\n' });
    fake.deps.readCopiedKind = async () => classifyZedCopy('[{"is_entire_line":false}]');
    expect(await copySelection(1, fake.deps, plan)).toBe('sample text\r\n');

    fake.deps.readCopiedKind = async () => classifyZedCopy('[{"is_entire_line":true}]');
    expect(await copySelection(1, fake.deps, plan)).toBeUndefined();

    fake.deps.readCopiedKind = async () => classifyZedCopy(null);
    expect(await copySelection(1, fake.deps, plan)).toBe('sample text\r\n');
  });

  it('drops implicit line copies when metadata is unknown, and honors explicit metadata kinds', async () => {
    const codePlan = copyPlanFor('Code');
    const unknownLine = desktop({ selection: 'const a = 1;\r\n' });
    unknownLine.deps.readCopiedKind = async () => 'unknown';
    expect(await copySelection(1, unknownLine.deps, codePlan)).toBeUndefined();

    const lineFake = desktop({ selection: 'const a = 1;\r\n' });
    lineFake.deps.readCopiedKind = async () => 'implicit-line';
    expect(await copySelection(1, lineFake.deps, codePlan)).toBeUndefined();

    const selFake = desktop({ selection: 'const a = 1;\r\n' });
    selFake.deps.readCopiedKind = async () => 'selection';
    expect(await copySelection(1, selFake.deps, codePlan)).toBe('const a = 1;\r\n');

    const pptFake = desktop({ selection: 'Slide Title' });
    pptFake.deps.readCopiedKind = async () => 'object';
    expect(await copySelection(1, pptFake.deps, copyPlanFor('powerpnt'))).toBeUndefined();
  });

  it('passes the captured clipboard sequence to the restore callback', async () => {
    const fake = desktop({ selection: 'Picked text' });
    const restoreSpy = vi.fn(async () => undefined);
    fake.deps.saveClipboard = async () => restoreSpy;
    expect(await copySelection(1, fake.deps)).toBe('Picked text');
    expect(restoreSpy).toHaveBeenCalledWith('Picked text', 8);
  });

  it('ignores the whole line an editor copies when nothing is selected', async () => {
    const plan = copyPlanFor('Zed');
    expect(await copySelection(1, desktop({ selection: 'const x = 1;\n' }).deps, plan)).toBeUndefined();
    expect(await copySelection(1, desktop({ selection: '[0] VITE v8.3.8 ready in 377 ms' }).deps, plan)).toBe('[0] VITE v8.3.8 ready in 377 ms');
    expect(await copySelection(1, desktop({ selection: 'a\nb\n' }).deps, plan)).toBe('a\nb\n');
    const fake = desktop();
    await copySelection(1, fake.deps, plan);
    expect(fake.deps.sendCopy).toHaveBeenCalledWith('ctrl+insert', 7);
  });
});
