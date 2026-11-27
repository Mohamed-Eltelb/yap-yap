import { expect, it, vi } from 'vitest';
import { createHudHitRectReporter, createHudMouseGate } from '../utils/hudMouseGate';

it('takes the mouse only while it is over the HUD, asking once per change', () => {
  const send = vi.fn();
  const gate = createHudMouseGate(send);
  gate.move(true);
  gate.move(true);
  gate.move(false);
  gate.leave();
  expect(send.mock.calls).toEqual([[false], [true]]);
});

it('asks again after the HUD was hidden and shown, since Electron let the mouse through meanwhile', () => {
  const send = vi.fn();
  const gate = createHudMouseGate(send);
  gate.move(true);
  gate.reset();
  gate.move(true);
  expect(send.mock.calls).toEqual([[false], [false]]);
});

it('reports HUD hit rects only when they change and resends after reset', () => {
  const send = vi.fn();
  const reporter = createHudHitRectReporter(send);

  reporter.update([{ left: 10.4, top: 20.6, right: 200.2, bottom: 80.8 }]);
  // Same rounded rect does not resend IPC
  reporter.update([{ left: 10.1, top: 20.9, right: 200.4, bottom: 80.6 }]);
  // Zero-area rects are filtered out
  reporter.update([{ left: 50, top: 50, right: 50, bottom: 90 }]);
  // Reset forces the next update to send even if it matches the previous empty list
  reporter.reset();
  reporter.update([{ left: 10, top: 21, right: 200, bottom: 81 }]);

  expect(send.mock.calls).toEqual([
    [[{ left: 10, top: 21, right: 200, bottom: 81 }]],
    [[]],
    [[{ left: 10, top: 21, right: 200, bottom: 81 }]],
  ]);
});
