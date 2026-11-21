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
  notes: ['Yap Yap uses your personal style for all messaging.'],
};
const typeless: OtherAppData = {
  ...wispr, app: 'typeless', name: 'Typeless', words: [], snippets: [], settings: {},
  notes: ['Typeless keeps your dictionary in your account, not on this computer.'],
};

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
  it('summarizes each kind of data and says exactly what will import', () => {
    renderDialog();
    expect(screen.getByText('2 new words.')).toBeTruthy();
    expect(screen.getByText('Messaging casual')).toBeTruthy();
    expect(screen.getByText('Yap Yap uses your personal style for all messaging.')).toBeTruthy();
    expect(screen.getByText('Imports 2 words, 1 snippet, 1 setting, and 1 History entry.')).toBeTruthy();
  });

  it('switches a kind of data off, or one item at a time after review', async () => {
    const { onImport } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('switch', { name: 'Import snippets' }));
    await user.click(screen.getAllByRole('button', { name: 'Review' })[0]);
    await user.click(screen.getByRole('checkbox', { name: /Supabase/ }));
    expect(screen.getByText('1 of 2 new words.')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /handoff.*Fixes “hand of”/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Import' }));
    const [plan, selection] = onImport.mock.calls[0] as unknown as [{ app: string }, object];
    expect(plan.app).toBe('wispr-flow');
    expect(selection).toMatchObject({ words: ['handoff'], snippets: [], history: true, styles: ['Messaging'], cleanup: false });
  });

  it('shows what was imported and offers Undo', async () => {
    const { onUndo } = renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByRole('heading', { name: 'Imported from Wispr Flow' })).toBeTruthy();
    expect(screen.getByText('1 snippet ready to say')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('switches between the apps found and says what can’t come over', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Typeless' }));
    expect(screen.getByText('Typeless keeps your dictionary in your account, not on this computer.')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Import dictionary' })).toBeNull();
    expect(screen.getByText('Imports 1 History entry.')).toBeTruthy();
  });

  it('says so when no other app is installed', () => {
    renderDialog([]);
    expect(screen.getByText(/Neither app is on this computer/)).toBeTruthy();
  });
});
