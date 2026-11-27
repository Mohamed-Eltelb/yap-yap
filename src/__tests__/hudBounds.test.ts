import { expect, it } from 'vitest';
import {
  cursorOverHud,
  HUD_SHRINK_DELAY_MS,
  hudHideDelay,
  HudPlacer,
  hudWindowSize,
  isAskAnswerHud,
} from '../../electron/hudBounds';

it('uses a compact HUD window size for the pill and grows only for the Ask answer card', () => {
  expect(hudWindowSize({ width: 2048, height: 1104 })).toEqual({ width: 500, height: 260 });
  expect(hudWindowSize({ width: 2048, height: 1104 }, false)).toEqual({ width: 500, height: 260 });
  expect(hudWindowSize({ width: 2048, height: 1104 }, true)).toEqual({ width: 760, height: 660 });
});

it('fits both compact and answer HUD sizes on a small screen', () => {
  expect(hudWindowSize({ width: 420, height: 240 })).toEqual({ width: 420, height: 228 });
  expect(hudWindowSize({ width: 500, height: 300 }, true)).toEqual({ width: 500, height: 288 });
});

it('detects Ask anything answer states that need the larger HUD window', () => {
  expect(isAskAnswerHud({ status: 'result', mode: 'ask' })).toBe(true);
  expect(isAskAnswerHud({ status: 'processing', mode: 'ask' })).toBe(false);
  expect(isAskAnswerHud({ status: 'recording', mode: 'ask' })).toBe(false);
  expect(isAskAnswerHud({ status: 'result', mode: 'dictate' })).toBe(false);
  expect(isAskAnswerHud({ status: 'error', mode: 'ask' })).toBe(false);
  expect(isAskAnswerHud(undefined)).toBe(false);
});

it('hit-tests screen cursor coordinates against window-relative HUD rects', () => {
  const win = { x: 644, y: 440, width: 760, height: 660 };
  const rects = [
    { left: 12, top: 290, right: 748, bottom: 650 },
    { left: 260, top: 150, right: 495, bottom: 276 },
  ];

  // Inside main HUD card
  expect(cursorOverHud({ x: 800, y: 800 }, win, rects)).toBe(true);
  // Inside secondary floating menu rect
  expect(cursorOverHud({ x: 950, y: 650 }, win, rects)).toBe(true);
  // Transparent margin inside the BrowserWindow but outside visible HUD rects
  expect(cursorOverHud({ x: 700, y: 500 }, win, rects)).toBe(false);
  // Outside window completely
  expect(cursorOverHud({ x: 100, y: 100 }, win, rects)).toBe(false);
  // Empty rects always pass clicks through
  expect(cursorOverHud({ x: 800, y: 800 }, win, [])).toBe(false);
});

it('waits before hiding only when a pill was showing', () => {
  expect(hudHideDelay('recording')).toBe(HUD_SHRINK_DELAY_MS);
  expect(hudHideDelay('processing')).toBe(HUD_SHRINK_DELAY_MS);
  expect(hudHideDelay('armed')).toBe(HUD_SHRINK_DELAY_MS);
  expect(hudHideDelay('result')).toBe(0);
  expect(hudHideDelay('cancelled')).toBe(0);
  expect(hudHideDelay(undefined)).toBe(0);
});

it('places the HUD at the bottom center of the work area', () => {
  const placer = new HudPlacer();
  expect(placer.place({ x: 0, y: 0, width: 2048, height: 1104 }, { width: 290, height: 215 }))
    .toEqual({ x: 879, y: 885, width: 290, height: 215 });
});

it('does not move the HUD again for the same size, whatever the window reports after DPI rounding', () => {
  const placer = new HudPlacer();
  const workArea = { x: 0, y: 0, width: 2048, height: 1104 };
  placer.place(workArea, { width: 290, height: 215 });
  expect(placer.place(workArea, { width: 290, height: 215 })).toBeUndefined();
  expect(placer.size).toEqual({ width: 290, height: 215 });
});

it('moves the HUD again after it was forgotten', () => {
  const placer = new HudPlacer();
  const workArea = { x: 0, y: 0, width: 2048, height: 1104 };
  placer.place(workArea, { width: 290, height: 215 });
  placer.forget();
  expect(placer.place(workArea, { width: 290, height: 215 })).toBeDefined();
});
