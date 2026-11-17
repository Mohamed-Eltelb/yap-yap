// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnippetsView } from '../components/SnippetsView';
import type { Snippet } from '../types/app';

const link: Snippet = { id: 's-1', trigger: 'zoom link', expansion: 'https://zoom.us/j/1', createdAt: '2026-01-01T00:00:00.000Z' };

function renderView(snippets: Snippet[] = [link]) {
  const handlers = { onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
  render(<SnippetsView snippets={snippets} {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}

afterEach(cleanup);

describe('Snippets page', () => {
  it('adds a snippet whose text keeps its line breaks', async () => {
    const { onAdd, user } = renderView();
    await user.click(screen.getByRole('button', { name: 'New snippet' }));
    await user.type(screen.getByRole('textbox', { name: 'When you say' }), '  my   signature ');
    await user.type(screen.getByRole('textbox', { name: 'Insert' }), 'Best,{Enter}Sam');
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add snippet' }));
    expect(onAdd).toHaveBeenCalledWith('my signature', 'Best,\nSam');
  });

  it('asks for a phrase, the text, and a phrase no other snippet uses', async () => {
    const { onAdd, user } = renderView();
    await user.click(screen.getByRole('button', { name: 'New snippet' }));
    await user.type(screen.getByRole('textbox', { name: 'When you say' }), '!!!');
    await user.click(screen.getByRole('button', { name: 'Add snippet' }));
    expect(screen.getByRole('alert').textContent).toMatch(/letter or number/);

    await user.clear(screen.getByRole('textbox', { name: 'When you say' }));
    await user.type(screen.getByRole('textbox', { name: 'When you say' }), 'Zoom link!');
    await user.type(screen.getByRole('textbox', { name: 'Insert' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Add snippet' }));
    expect(screen.getByRole('alert').textContent).toMatch(/already uses this phrase/);

    await user.clear(screen.getByRole('textbox', { name: 'When you say' }));
    await user.type(screen.getByRole('textbox', { name: 'When you say' }), 'office address');
    await user.clear(screen.getByRole('textbox', { name: 'Insert' }));
    await user.click(screen.getByRole('button', { name: 'Add snippet' }));
    expect(screen.getByRole('alert').textContent).toMatch(/text to insert/);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('edits and deletes a snippet', async () => {
    const { onEdit, onDelete, user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Actions for zoom link' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const text = screen.getByRole('textbox', { name: 'Insert' });
    await user.clear(text);
    await user.type(text, 'https://zoom.us/j/2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('s-1', 'zoom link', 'https://zoom.us/j/2');

    await user.click(screen.getByRole('button', { name: 'Actions for zoom link' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('s-1');
  });
});
