import { expect, it, vi } from 'vitest';
import { createHudMouseGate } from '../utils/hudMouseGate';

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
