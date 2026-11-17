import { expect, it } from 'vitest';
import { createRecordingClock } from '../utils/recordingClock';

it('leaves paused time out of the recording length', () => {
  let now = 1000;
  const clock = createRecordingClock(() => now);
  now = 3000;
  clock.pause();
  now = 10_000;
  clock.resume();
  now = 11_000;
  expect(clock.elapsed()).toBe(3000);
});

it('counts a recording stopped while paused up to the pause', () => {
  let now = 0;
  const clock = createRecordingClock(() => now);
  now = 2000;
  clock.pause();
  now = 9000;
  expect(clock.elapsed()).toBe(2000);
  expect(clock.paused).toBe(true);
});

it('ignores a second pause or a resume that was not paused', () => {
  let now = 0;
  const clock = createRecordingClock(() => now);
  clock.resume();
  now = 1000;
  clock.pause();
  now = 2000;
  clock.pause();
  now = 3000;
  clock.resume();
  now = 4000;
  expect(clock.elapsed()).toBe(2000);
});
