// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HISTORY_PAGE_SIZE, HistoryView } from '../components/HistoryView';
import type { HistoryItem } from '../types/app';

const noop = () => {};
const view = (history: HistoryItem[], onRetryItem = noop) => (
  <HistoryView history={history} retention="forever" onChangeRetention={noop} onCopyText={noop} onToggleFlag={noop}
    onEditItem={noop} onRetryItem={onRetryItem} onDownloadAudio={noop} onDeleteItem={noop} onClearAll={noop}
    onExportJson={noop} onImportJson={noop} />
);
const dictation = (over: Partial<HistoryItem>) =>
  ({ id: 'h-1', text: 'Hello there', mode: 'dictate', createdAt: new Date().toISOString(), durationMs: 2000, ...over }) as HistoryItem;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('plays a recording kept in the desktop store, fetching it on demand', async () => {
  const loadAudio = vi.fn(async () => 'data:audio/webm;base64,AAA');
  vi.stubGlobal('yapyap', { loadAudio });
  const play = vi.fn(async () => undefined);
  vi.stubGlobal('Audio', vi.fn(function (this: { play: typeof play; pause: () => void }, src: string) { this.play = play; this.pause = () => {}; void src; }));
  render(view([dictation({ audioSaved: true })]));
  await act(async () => { fireEvent.click(screen.getByLabelText('Play audio')); });
  expect(loadAudio).toHaveBeenCalledWith('h-1');
  expect(vi.mocked(Audio)).toHaveBeenCalledWith('data:audio/webm;base64,AAA');
  expect(play).toHaveBeenCalled();
});

it('offers Retry for a cancelled dictation whose recording is in the desktop store', () => {
  const onRetry = vi.fn();
  render(view([dictation({ text: '', outcome: 'cancelled', audioSaved: true })], onRetry));
  fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
  expect(onRetry).toHaveBeenCalled();
});

it('shows history a page at a time, loading the next page when the end scrolls into view', () => {
  let fire: (visible: boolean) => void = () => {};
  vi.stubGlobal('IntersectionObserver', vi.fn(function (this: object, cb: (e: { isIntersecting: boolean }[]) => void) {
    fire = (visible) => act(() => cb([{ isIntersecting: visible }]));
    Object.assign(this, { observe: () => {}, disconnect: () => {} });
  }));
  const items = Array.from({ length: HISTORY_PAGE_SIZE * 2 + 5 }, (_, i) =>
    dictation({ id: `h-${i}`, text: `Entry ${i}` }));
  render(view(items));
  expect(screen.getAllByText(/^Entry \d+$/)).toHaveLength(HISTORY_PAGE_SIZE);
  fire(true);
  expect(screen.getAllByText(/^Entry \d+$/)).toHaveLength(HISTORY_PAGE_SIZE * 2);
  fire(true);
  expect(screen.getAllByText(/^Entry \d+$/)).toHaveLength(items.length);
  expect(screen.queryByText(/Loading older history/)).toBeNull();
});
