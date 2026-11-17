// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DictionaryView } from '../components/DictionaryView';
import type { DictionaryEntry } from '../types/app';

const supabase: DictionaryEntry = { id: 'd-1', word: 'Supabase', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z', heardAs: 'super base' };

function renderView(entries: DictionaryEntry[] = [supabase]) {
  const handlers = { onAddWord: vi.fn(), onImportWords: vi.fn(), onEditWord: vi.fn(), onDeleteWords: vi.fn() };
  render(<DictionaryView entries={entries} {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}

afterEach(cleanup);

describe('Dictionary', () => {
  it('adds a plain word with the misspelling switch off', async () => {
    const { onAddWord, user } = renderView();
    await user.click(screen.getByRole('button', { name: 'New word' }));
    expect((screen.getByRole('switch', { name: 'Correct a misspelling' })).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Misspelling' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Word' }), 'Kubernetes');
    await user.click(screen.getByRole('button', { name: 'Add word' }));
    expect(onAddWord).toHaveBeenCalledWith('Kubernetes', 'manual', undefined);
  });

  it('adds a word with the spelling it replaces', async () => {
    const { onAddWord, user } = renderView();
    await user.click(screen.getByRole('button', { name: 'New word' }));
    await user.click(screen.getByRole('switch', { name: 'Correct a misspelling' }));
    await user.type(screen.getByRole('textbox', { name: 'Misspelling' }), '  hand  of ');
    await user.type(screen.getByRole('textbox', { name: 'Correct spelling' }), 'handoff');
    await user.click(screen.getByRole('button', { name: 'Add word' }));
    expect(onAddWord).toHaveBeenCalledWith('handoff', 'manual', 'hand of');
  });

  it('rejects a heard-as spelling that is the word itself or another entry\'s', async () => {
    const { onAddWord, user } = renderView();
    await user.click(screen.getByRole('button', { name: 'New word' }));
    await user.click(screen.getByRole('switch', { name: 'Correct a misspelling' }));
    await user.type(screen.getByRole('textbox', { name: 'Correct spelling' }), 'handoff');
    await user.click(screen.getByRole('button', { name: 'Add word' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Enter the misspelling/);

    const heard = screen.getByRole('textbox', { name: 'Misspelling' });
    await user.type(heard, 'Handoff');
    await user.click(screen.getByRole('button', { name: 'Add word' }));
    expect(screen.getByRole('alert').textContent).toMatch(/not the word itself/);

    await user.clear(heard);
    await user.type(heard, 'super base');
    await user.click(screen.getByRole('button', { name: 'Add word' }));
    expect(screen.getByRole('alert').textContent).toMatch(/already uses this spelling/);
    expect(onAddWord).not.toHaveBeenCalled();
  });

  it('edits and clears the spelling an existing word replaces', async () => {
    const { onEditWord, user } = renderView();
    expect(screen.getByText('super base')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Actions for Supabase' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const heard = screen.getByRole('textbox', { name: 'Misspelling' }) as HTMLInputElement;
    expect(heard.value).toBe('super base');
    await user.click(screen.getByRole('switch', { name: 'Correct a misspelling' }));
    expect(screen.queryByRole('textbox', { name: 'Misspelling' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEditWord).toHaveBeenCalledWith('d-1', 'Supabase', undefined);
  });
});
