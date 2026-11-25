// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COPIED_MS, DictationHud } from '../components/DictationHud';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderAnswer(onCopyResult = vi.fn(), rewritePaste?: 'not-sent') {
  const noop = vi.fn();
  return render(
    <DictationHud hud={{ status: 'result', mode: 'ask', levels: [], rewritePaste, questionText: 'What time is it?', resultText: 'It is **noon**.' }}
      onStop={noop} onCancel={noop} onPause={noop} onResume={noop} onUndo={noop} onRetry={noop}
      onSelectTarget={noop} onEditTargets={noop} onCopyResult={onCopyResult} onDismissResult={noop} />,
  );
}

it('shows a check mark on the answer copy button after copying, then goes back', () => {
  const onCopyResult = vi.fn();
  const { getByRole } = renderAnswer(onCopyResult);
  const button = getByRole('button', { name: 'Copy answer' });
  fireEvent.click(button);
  expect(onCopyResult).toHaveBeenCalledWith('It is noon.');
  expect(getByRole('button', { name: 'Copied' })).toBe(button);
  expect(button.querySelector('.lucide-check')).not.toBeNull();
  act(() => { vi.advanceTimersByTime(COPIED_MS); });
  expect(getByRole('button', { name: 'Copy answer' })).toBe(button);
  expect(button.querySelector('.lucide-copy')).not.toBeNull();
});

it('marks only the copy button that was clicked', () => {
  const { getByRole } = renderAnswer();
  fireEvent.click(getByRole('button', { name: 'Copy question' }));
  expect(getByRole('button', { name: 'Copy answer' })).toBeTruthy();
  expect(getByRole('button', { name: 'Copied' })).toBeTruthy();
});

it('shows failed paste feedback and copies the rewrite verbatim', () => {
  const onCopyResult = vi.fn();
  const { getByRole } = renderAnswer(onCopyResult, 'not-sent');

  expect(getByRole('status').textContent).toContain('The rewrite could not be pasted.');
  fireEvent.click(getByRole('button', { name: 'Copy rewrite' }));
  expect(onCopyResult).toHaveBeenCalledWith('It is **noon**.');
});
