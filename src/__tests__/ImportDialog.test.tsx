// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OtherAppData } from '../../electron/otherApps';
import { ImportDialog } from '../components/ImportDialog';
import { getInitialState } from '../services/storage';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
});
afterEach(cleanup);

const wispr: OtherAppData = {
  app: 'wispr-flow',
  name: 'Wispr Flow',
  words: [{ word: 'Supabase', manual: true }, { word: 'handoff', heardAs: 'hand of', manual: false }],
  snippets: [{ trigger: 'my sig', expansion: 'Best, Sam' }],
  history: [{ createdAt: '2026-11-16T13:44:31.370Z', mode: 'dictate', text: 'Hey Sam.', application: 'Discord' }],
  settings: { styles: { Messaging: 'casual' }, cleanup: 'light' },
  notes: [],
};
const typeless: OtherAppData = { ...wispr, app: 'typeless', name: 'Typeless', words: [], snippets: [], settings: {}, notes: ['Typeless keeps your dictionary in your account.'] };

function renderDialog(apps = [wispr, typeless]) {
  const initial = getInitialState();
  const handlers = {
    onImport: vi.fn(() => ({ words: 1, heardAs: 0, snippets: 1, history: 1, settings: 1 })),
    onUndo: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <ImportDialog
      apps={apps}
      state={{ ...initial, history: [], settings: { ...initial.settings, cleanupLevel: 'light', smartCleanup: true } }}
      defaultProvider="groq"
      {...handlers}
    />,
  );
  return handlers;
}

describe('Import dialog', () => {
  it('shows everything for review, lets the user untick items, and imports only what stays ticked', async () => {
    const { onImport } = renderDialog();
    const user = userEvent.setup();

    expect(screen.getByText('Replaces “hand of”')).toBeTruthy();
    expect(screen.getByText('Messaging: Casual')).toBeTruthy();
    // Cleanup is already Light, so there is nothing to change.
    expect((screen.getByRole('checkbox', { name: /AI cleanup: Light/ }) as HTMLInputElement).disabled).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: /Supabase/ }));
    await user.click(screen.getByRole('button', { name: 'Import' }));

    const [plan, selection] = onImport.mock.calls[0] as unknown as [{ app: string }, { words: string[]; snippets: string[]; history: boolean; styles: string[] }];
    expect(plan.app).toBe('wispr-flow');
    expect(selection).toMatchObject({ words: ['handoff'], snippets: ['my sig'], history: true, styles: ['Messaging'], cleanup: false });
    expect(screen.getByRole('status').textContent).toBe('Imported 1 word, 1 snippet, 1 History entry, and 1 setting.');
  });

  it('offers Undo after an import', async () => {
    const { onUndo } = renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('switches between the apps found and shows what can’t come over', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Typeless' }));
    expect(screen.getByRole('heading', { name: 'Import from Typeless' })).toBeTruthy();
    expect(screen.getByText('Typeless keeps your dictionary in your account.')).toBeTruthy();
    expect(screen.queryByText('Dictionary')).toBeNull();
  });

  it('says so when no other app is installed', () => {
    renderDialog([]);
    expect(screen.getByText(/didn’t find Wispr Flow or Typeless/)).toBeTruthy();
  });
});
