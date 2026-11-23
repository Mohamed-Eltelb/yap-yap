import { describe, expect, it, vi } from 'vitest';
import { copySelection, mayCopySelection, type CopyDeps } from '../../electron/selectionCopy';

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
      return async (copied) => {
        if (clipboard === copied) {
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
    expect(await copySelection(1, held.deps, 1000)).toBeUndefined();
    expect(held.deps.sendCopy).not.toHaveBeenCalled();

    const moved = desktop({ heldFor: 100, switchTo: 2 });
    expect(await copySelection(1, moved.deps)).toBeUndefined();
    expect(moved.deps.sendCopy).not.toHaveBeenCalled();
  });

  it('finds nothing when the copy leaves the clipboard unchanged', async () => {
    const fake = desktop({ selection: '' });
    expect(await copySelection(1, fake.deps)).toBeUndefined();
    expect(fake.clipboard()).toBe('user clipboard');
  });

  it('never presses Ctrl+C in terminals or in editors that copy the whole line', () => {
    for (const app of ['WindowsTerminal', 'cmd', 'powershell', 'Code', 'Cursor', 'idea64', 'sublime_text', 'mstsc', 'AnyDesk', 'pythonw', 'EXCEL', 'explorer']) {
      expect(mayCopySelection(app)).toBe(false);
    }
    for (const app of ['firefox', 'chrome', 'Discord', 'WINWORD', 'Notepad']) {
      expect(mayCopySelection(app)).toBe(true);
    }
    expect(mayCopySelection('')).toBe(false);
  });
});
