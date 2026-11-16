// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { SpokenLanguagesDialog } from '../components/LanguageSettingsDialogs';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
});
afterEach(cleanup);

it('picks one or more languages, and auto-detect clears them', () => {
  const onChange = vi.fn();
  const { rerender } = render(<SpokenLanguagesDialog languages={[]} onChange={onChange} onClose={vi.fn()} />);
  expect(screen.getByRole('checkbox', { name: 'Auto-detect' })).toHaveProperty('checked', true);

  fireEvent.click(screen.getByRole('checkbox', { name: /^Arabic/ }));
  expect(onChange).toHaveBeenLastCalledWith(['Arabic']);

  rerender(<SpokenLanguagesDialog languages={['Arabic']} onChange={onChange} onClose={vi.fn()} />);
  expect(screen.getByRole('checkbox', { name: 'Auto-detect' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('checkbox', { name: /^English/ }));
  expect(onChange).toHaveBeenLastCalledWith(['Arabic', 'English']);

  fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-detect' }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});
