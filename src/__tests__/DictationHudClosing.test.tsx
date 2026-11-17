// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DictationHud, PILL_CLOSE_MS, THINKING_WORD_MS, type HudState } from '../components/DictationHud';

function Hud({ status }: { status: HudState['status'] }) {
  const noop = vi.fn();
  return (
    <DictationHud hud={{ status, mode: 'dictate', levels: [], resultText: 'Hi' }} onStop={noop} onCancel={noop} onPause={noop} onResume={noop}
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

it('keeps the Thinking pill in place when the still-processing notice appears', () => {
  const noop = vi.fn();
  const props = { onStop: noop, onCancel: noop, onPause: noop, onResume: noop, onUndo: noop, onRetry: noop, onSelectTarget: noop,
    onEditTargets: noop, onCopyResult: noop, onDismissResult: noop };
  const { container, rerender } = render(<DictationHud hud={{ status: 'processing', mode: 'dictate', levels: [] }} {...props} />);
  const pill = container.querySelector('.yy-hud-pill');
  rerender(<DictationHud hud={{ status: 'processing', mode: 'dictate', levels: [], busyNotice: true }} {...props} />);
  expect(container.querySelector('.yy-hud-busy')).not.toBeNull();
  expect(container.querySelector('.yy-hud-pill')).toBe(pill);
});

it('dismisses Transcript cancelled once its countdown has faded it out', () => {
  const onDismiss = vi.fn();
  const noop = vi.fn();
  const { container } = render(
    <DictationHud hud={{ status: 'cancelled', mode: 'dictate', levels: [] }} onStop={noop} onCancel={noop} onPause={noop} onResume={noop} onUndo={noop}
      onRetry={noop} onSelectTarget={noop} onEditTargets={noop} onCopyResult={noop} onDismissResult={onDismiss} />,
  );
  const notice = container.querySelector('.yy-hud-cancelled')!;
  // jsdom has no AnimationEvent, so React listens for the prefixed name there and the
  // animation name is set by hand.
  const animationEnd = (animationName: string) => act(() => {
    notice.dispatchEvent(Object.assign(new Event('webkitAnimationEnd', { bubbles: true }), { animationName }));
  });
  animationEnd('yy-hud-rise');
  expect(onDismiss).not.toHaveBeenCalled();
  animationEnd('yy-hud-notice-out');
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('pauses and resumes from the pill buttons', () => {
  const onPause = vi.fn();
  const onResume = vi.fn();
  const noop = vi.fn();
  const props = { onStop: noop, onCancel: noop, onPause, onResume, onUndo: noop, onRetry: noop,
    onSelectTarget: noop, onEditTargets: noop, onCopyResult: noop, onDismissResult: noop };
  const { getByLabelText, rerender } = render(<DictationHud hud={{ status: 'recording', mode: 'dictate', levels: [] }} {...props} />);
  act(() => { getByLabelText('Pause recording').click(); });
  expect(onPause).toHaveBeenCalledTimes(1);
  rerender(<DictationHud hud={{ status: 'recording', mode: 'dictate', levels: [], paused: true }} {...props} />);
  act(() => { getByLabelText('Resume recording').click(); });
  expect(onResume).toHaveBeenCalledTimes(1);
});

const label = (container: HTMLElement) => container.querySelector('.yy-hud-pill-label')?.textContent;

it('starts on Thinking and moves through other words while processing', () => {
  const { container } = render(<Hud status="processing" />);
  expect(label(container)).toBe('Thinking');
  const seen = new Set<string>();
  let last = 'Thinking';
  for (let i = 0; i < 6; i += 1) {
    act(() => { vi.advanceTimersByTime(THINKING_WORD_MS); });
    const word = label(container)!;
    expect(word).not.toBe(last);
    seen.add(word);
    last = word;
  }
  expect(seen.size).toBeGreaterThan(2);
});

it('starts on Thinking again for the next dictation', () => {
  const { container, rerender } = render(<Hud status="processing" />);
  act(() => { vi.advanceTimersByTime(THINKING_WORD_MS * 2); });
  rerender(<Hud status="recording" />);
  rerender(<Hud status="processing" />);
  expect(label(container)).toBe('Thinking');
});
