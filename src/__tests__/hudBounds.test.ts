import { expect, it } from 'vitest';
import { HUD_SHRINK_DELAY_MS, hudResizeDelay } from '../../electron/hudBounds';

it('grows the HUD window at once', () => {
  expect(hudResizeDelay({ width: 152, height: 56 }, { width: 360, height: 230 })).toBe(0);
});

it('waits for the pill animation before shrinking', () => {
  expect(hudResizeDelay({ width: 360, height: 220 }, { width: 152, height: 56 })).toBe(HUD_SHRINK_DELAY_MS);
});

it('waits when only one side shrinks', () => {
  expect(hudResizeDelay({ width: 290, height: 215 }, { width: 360, height: 170 })).toBe(HUD_SHRINK_DELAY_MS);
});
