import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HUD_EVENT_REFRESH_DELAY_MS, HUD_IDLE_REFRESH_MS, HudRefresher } from '../../electron/hudRefresh';

let idle = true;
let refresh: ReturnType<typeof vi.fn<(reason: string) => void>>;
let refresher: HudRefresher;

beforeEach(() => {
  vi.useFakeTimers();
  idle = true;
  refresh = vi.fn<(reason: string) => void>();
  refresher = new HudRefresher({ refresh, isIdle: () => idle });
});

afterEach(() => {
  refresher.dispose();
  vi.useRealTimers();
});

it('replaces the HUD window after it has sat idle for a while, and again after each idle stretch', () => {
  refresher.idle();
  vi.advanceTimersByTime(HUD_IDLE_REFRESH_MS - 1);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledWith('idle');
  vi.advanceTimersByTime(HUD_IDLE_REFRESH_MS);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('does not count time the HUD was on screen as idle', () => {
  refresher.idle();
  vi.advanceTimersByTime(HUD_IDLE_REFRESH_MS - 1000);
  refresher.busy();
  vi.advanceTimersByTime(HUD_IDLE_REFRESH_MS);
  expect(refresh).not.toHaveBeenCalled();
  refresher.idle();
  vi.advanceTimersByTime(HUD_IDLE_REFRESH_MS);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('folds a burst of display events into one replacement', () => {
  refresher.request('display-metrics-changed');
  vi.advanceTimersByTime(HUD_EVENT_REFRESH_DELAY_MS / 2);
  refresher.request('display-metrics-changed');
  refresher.request('unlock-screen');
  vi.advanceTimersByTime(HUD_EVENT_REFRESH_DELAY_MS);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledWith('unlock-screen');
});

it('waits until the HUD closes before replacing a window that is on screen', () => {
  idle = false;
  refresher.request('resume');
  vi.advanceTimersByTime(HUD_EVENT_REFRESH_DELAY_MS);
  expect(refresh).not.toHaveBeenCalled();
  idle = true;
  refresher.idle();
  expect(refresh).toHaveBeenCalledWith('resume');
  // The pending request is used up.
  refresher.busy();
  refresher.idle();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('restarts the idle wait after an event replaced the window', () => {
  refresher.idle();
  vi.advanceTimersByTime(HUD_IDLE_REFRESH_MS - 5000);
  refresher.request('resume');
  vi.advanceTimersByTime(HUD_EVENT_REFRESH_DELAY_MS);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(HUD_IDLE_REFRESH_MS - HUD_EVENT_REFRESH_DELAY_MS - 1);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(HUD_EVENT_REFRESH_DELAY_MS + 1);
  expect(refresh).toHaveBeenCalledTimes(2);
});
