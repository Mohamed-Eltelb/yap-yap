import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiohookKey as Key } from 'uiohook-napi';
import { ShortcutFlow, type AppStatus, type FlowOutput } from '../../electron/shortcutFlow';
import { startsShortcut, swallowedKeys } from '../../electron/shortcutMatch';

function setup(status: AppStatus = 'idle') {
  const outputs: FlowOutput[] = [];
  const flow = new ShortcutFlow({ holdMs: 1000, appStatus: () => status, emit: (out) => outputs.push(out) });
  return { flow, outputs };
}

describe('Shortcut flow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arms on press and starts the matched shortcut on release', () => {
    const { flow, outputs } = setup();
    flow.keyDown(true, 0);
    flow.allReleased();
    expect(outputs).toEqual([{ type: 'armed' }, { type: 'start', binding: 0 }]);
  });

  it('starts the chord held at release', () => {
    const { flow, outputs } = setup();
    flow.keyDown(true, 0);
    flow.keyDown(true, 1);
    flow.allReleased();
    expect(outputs.at(-1)).toEqual({ type: 'start', binding: 1 });
  });

  it('shows the list after holding 1 second', () => {
    const { flow, outputs } = setup();
    flow.keyDown(true, 0);
    vi.advanceTimersByTime(999);
    expect(outputs).toEqual([{ type: 'armed' }]);
    vi.advanceTimersByTime(1);
    expect(outputs).toEqual([{ type: 'armed' }, { type: 'list' }]);
  });

  it('ignores keys and records nothing once the list shows', () => {
    const { flow, outputs } = setup();
    flow.keyDown(true, 0);
    vi.advanceTimersByTime(1000);
    flow.keyDown(true, 1);
    flow.allReleased();
    expect(outputs).toEqual([{ type: 'armed' }, { type: 'list' }, { type: 'closed' }]);
  });

  it('closes when the keys match no shortcut', () => {
    const { flow, outputs } = setup();
    flow.keyDown(true, 0);
    flow.keyDown(false, undefined);
    flow.allReleased();
    expect(outputs).toEqual([{ type: 'armed' }, { type: 'closed' }]);
  });

  it('closes as soon as the keys can no longer become a shortcut', () => {
    const { flow, outputs } = setup();
    flow.keyDown(true, 0);
    flow.keyDown(false, undefined);
    vi.advanceTimersByTime(1000);
    flow.allReleased();
    expect(outputs).toEqual([{ type: 'armed' }, { type: 'closed' }]);
  });

  it('stops on press and ignores that release', () => {
    const { flow, outputs } = setup('recording');
    flow.keyDown(true, 0);
    flow.allReleased();
    vi.advanceTimersByTime(1000);
    expect(outputs).toEqual([{ type: 'stop' }]);
  });

  it('shows the busy notice instead of starting while processing', () => {
    const { flow, outputs } = setup('processing');
    flow.keyDown(true, 0);
    flow.allReleased();
    expect(outputs).toEqual([{ type: 'busy' }]);
  });

  it('does nothing for keys that start no shortcut', () => {
    const { flow, outputs } = setup();
    flow.keyDown(false, undefined);
    flow.allReleased();
    expect(outputs).toEqual([]);
  });

  it('closes an open placeholder on reset', () => {
    const { flow, outputs } = setup();
    flow.keyDown(true, 0);
    flow.reset();
    vi.advanceTimersByTime(1000);
    expect(outputs).toEqual([{ type: 'armed' }, { type: 'closed' }]);
  });
});

describe('Shortcut prefixes', () => {
  const bindings = [{ keys: [[Key.AltRight]] }, { keys: [[Key.AltRight], [Key.ShiftRight]] }];

  it('starts a shortcut on a prefix of a chord', () => {
    expect(startsShortcut(bindings, new Map([[Key.AltRight, 1]]), true)).toBe(true);
    expect(startsShortcut(bindings, new Map([[Key.AltRight, 1], [Key.ShiftRight, 2]]), true)).toBe(true);
  });

  it('does not start a shortcut for other keys', () => {
    expect(startsShortcut(bindings, new Map([[Key.Ctrl, 1]]), true)).toBe(false);
    expect(startsShortcut(bindings, new Map([[Key.AltRight, 1], [Key.X, 2]]), true)).toBe(false);
  });

  it('does not start a shortcut on its second key alone', () => {
    const chords = [{ keys: [[Key.AltRight], [Key.ShiftRight]] }, { keys: [[Key.AltRight], [Key.Space]] }];
    expect(startsShortcut(chords, new Map([[Key.Space, 1]]), true)).toBe(false);
    expect(startsShortcut(chords, new Map([[Key.ShiftRight, 1]]), true)).toBe(false);
    expect(startsShortcut(chords, new Map([[Key.AltRight, 1], [Key.Space, 2]]), true)).toBe(true);
  });

  it('starts a shortcut on an AltGr press', () => {
    const altGr = new Map([[Key.Ctrl, 100], [Key.AltRight, 105]]);
    expect(startsShortcut(bindings, altGr, true)).toBe(true);
    expect(startsShortcut(bindings, altGr, false)).toBe(false);
  });
});

describe('Keys the Windows hook swallows', () => {
  it('swallows Right Alt and its chord keys', () => {
    const bindings = [{ keys: [[Key.AltRight]] }, { keys: [[Key.AltRight], [Key.ShiftRight]] }, { keys: [[Key.AltRight], [Key.Space]] }];
    expect(swallowedKeys(bindings)).toEqual({ leads: [3640], chords: [54, 57] });
  });

  it('swallows nothing when no shortcut starts with Right Alt', () => {
    expect(swallowedKeys([{ keys: [[Key.Ctrl], [Key.Shift]] }])).toEqual({ leads: [], chords: [] });
  });
});
