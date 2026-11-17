import { expect, it } from 'vitest';
import { HUD_SHRINK_DELAY_MS, hudHideDelay, HudPlacer, hudResizeDelay, planHudResize } from '../../electron/hudBounds';

it('grows the HUD window at once', () => {
  expect(hudResizeDelay({ width: 152, height: 56 }, { width: 360, height: 230 })).toBe(0);
});

it('waits for the pill animation before shrinking', () => {
  expect(hudResizeDelay({ width: 360, height: 220 }, { width: 152, height: 56 })).toBe(HUD_SHRINK_DELAY_MS);
});

it('waits when only one side shrinks', () => {
  expect(hudResizeDelay({ width: 290, height: 215 }, { width: 360, height: 170 })).toBe(HUD_SHRINK_DELAY_MS);
});

it('keeps a pending shrink when level updates ask for the same size', () => {
  const plan = planHudResize({ width: 620, height: 334 }, { width: 152, height: 56 }, { width: 152, height: 56 });
  expect(plan.keepPending).toBe(true);
});

it('grows at once with nothing left for later', () => {
  expect(planHudResize({ width: 152, height: 56 }, { width: 360, height: 230 }, undefined))
    .toEqual({ keepPending: false, now: { width: 360, height: 230 }, later: undefined });
});

it('holds the larger size now and shrinks later', () => {
  expect(planHudResize({ width: 290, height: 215 }, { width: 360, height: 170 }, undefined))
    .toEqual({ keepPending: false, now: { width: 360, height: 215 }, later: { width: 360, height: 170 } });
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
