import { describe, expect, it, vi } from 'vitest';
import { copyPlanFor, copySelection, mayCopySelection, type CopyDeps } from '../../electron/selectionCopy';

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

  it('copies with Ctrl+Insert in terminals and code editors, and never in apps where copying is unsafe', () => {
    for (const app of ['WindowsTerminal', 'powershell', 'Zed', 'Code', 'Cursor', 'idea64']) {
      expect(copyPlanFor(app)?.keys).toBe('ctrl+insert');
    }
    for (const app of ['firefox', 'chrome', 'Discord', 'WINWORD', 'Notepad']) {
      expect(copyPlanFor(app)).toEqual({ keys: 'ctrl+c', dropLineCopy: false });
    }
    for (const app of ['mstsc', 'AnyDesk', 'pythonw', 'EXCEL', 'explorer', 'mintty', '']) {
      expect(mayCopySelection(app)).toBe(false);
    }
    expect(copyPlanFor('powershell')?.dropLineCopy).toBe(false);
    expect(copyPlanFor('Zed')?.dropLineCopy).toBe(true);
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
