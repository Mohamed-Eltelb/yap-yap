// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DictationHud, PILL_CLOSE_MS, type HudState } from '../components/DictationHud';

function Hud({ status }: { status: HudState['status'] }) {
  const noop = vi.fn();
  return (
    <DictationHud hud={{ status, mode: 'dictate', levels: [], resultText: 'Hi' }} onStop={noop} onCancel={noop}
      onUndo={noop} onRetry={noop} onSelectTarget={noop} onEditTargets={noop} onCopyResult={noop} onDismissResult={noop} />
  );
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const pillState = (container: HTMLElement) => container.querySelector('.yy-hud-pill')?.getAttribute('data-state');

it('shrinks the pill out before removing it', () => {
  const { container, rerender } = render(<Hud status="recording" />);
  rerender(<Hud status="idle" />);
  expect(pillState(container)).toBe('closing');
  act(() => { vi.advanceTimersByTime(PILL_CLOSE_MS); });
  expect(container.querySelector('.yy-hud-pill')).toBeNull();
});

it('returns to recording if it starts again while closing', () => {
  const { container, rerender } = render(<Hud status="recording" />);
  rerender(<Hud status="idle" />);
  rerender(<Hud status="recording" />);
  act(() => { vi.advanceTimersByTime(PILL_CLOSE_MS); });
  expect(pillState(container)).toBe('recording');
});

it('does not animate a pill out when going straight to a result', () => {
  const { container, rerender } = render(<Hud status="processing" />);
  rerender(<Hud status="result" />);
  expect(container.querySelector('.yy-hud-pill')).toBeNull();
});

it('drops the closing pill when another screen opens mid-close', () => {
  const { container, rerender } = render(<Hud status="recording" />);
  rerender(<Hud status="idle" />);
  rerender(<Hud status="result" />);
  act(() => { vi.advanceTimersByTime(PILL_CLOSE_MS); });
  expect(container.querySelector('.yy-hud-pill')).toBeNull();
});

it('keeps the same pill element while it shrinks out, so the shrink animates', () => {
  const { container, rerender } = render(<Hud status="processing" />);
  const pill = container.querySelector('.yy-hud-pill');
  rerender(<Hud status="idle" />);
  expect(container.querySelector('.yy-hud-pill')).toBe(pill);
});
