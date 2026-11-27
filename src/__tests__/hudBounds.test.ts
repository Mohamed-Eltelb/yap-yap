import { expect, it } from 'vitest';
import { HUD_SHRINK_DELAY_MS, hudHideDelay, HudPlacer, hudWindowSize } from '../../electron/hudBounds';

it('uses one HUD window size for every screen, so it never resizes on screen', () => {
  expect(hudWindowSize({ width: 2048, height: 1104 })).toEqual({ width: 760, height: 660 });
});

it('fits the HUD window on a small screen', () => {
  expect(hudWindowSize({ width: 500, height: 300 })).toEqual({ width: 500, height: 288 });
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
