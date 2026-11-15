// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../types/app';

const engine = vi.hoisted(() => ({
  proposeWritingPreferences: vi.fn(),
  suggestStyleUpdate: vi.fn(async () => undefined),
}));
vi.mock('../services/providers/engine', () => engine);

const { PersonalizationEditor } = await import('../components/PersonalizationEditor');

const provider = { id: 'groq', name: 'Groq', apiKey: 'test-key', llmModel: 'test-model' } as unknown as ProviderConfig;
const messaging = { category: 'Messaging', tone: 'Casual', phrasing: 'lowercase', count: 5, corrections: 0, examples: [] };

beforeAll(() => {
  // jsdom has no modal dialogs or popovers.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
  HTMLElement.prototype.showPopover = function showPopover() {};
  HTMLElement.prototype.hidePopover = function hidePopover() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  // jsdom has no layout. The menu checks its button is still on screen; it is.
  document.elementFromPoint = () => document.activeElement;
});
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network in tests'); }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderEditor(props: Partial<Parameters<typeof PersonalizationEditor>[0]> = {}) {
  const handlers = { ...{ onSave: vi.fn(), onClose: vi.fn(), onForgetStyle: vi.fn(() => ({ samples: {}, styleCorrections: {} })), onRestoreStyle: vi.fn(), onOpenProviders: vi.fn() }, ...props };
  render(
    <PersonalizationEditor
      preferences="Write numbers as digits"
      profiles={[messaging]}
      styleCorrections={{}}
      provider={provider}
      cleanupEnabled
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

async function ask(request: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: /add a rule/i }), request);
  await user.click(screen.getByRole('button', { name: 'Preview change' }));
  return user;
}

describe('Writing preferences editor', () => {
  it('shows a proposed rule for review and saves it', async () => {
    engine.proposeWritingPreferences.mockResolvedValue({
      rules: ['Write numbers as digits', 'Use British spelling'], styles: {}, unlearned: [], unplaced: [],
    });
    const { onSave } = renderEditor();
    const user = await ask('Use British spelling');

    expect(await screen.findByText('Review the change before saving.')).toBeTruthy();
    expect(engine.proposeWritingPreferences).toHaveBeenCalledWith(provider, expect.objectContaining({ rules: ['Write numbers as digits'] }), 'Use British spelling');
    expect(onSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ writingPreferences: 'Write numbers as digits\nUse British spelling', styleCorrections: {} });
    expect(screen.getByRole('status').textContent).toContain('Changes saved.');
  });

  it('keeps Save disabled until the user chooses where an unplaced rule applies', async () => {
    engine.proposeWritingPreferences.mockResolvedValue({
      rules: ['Write numbers as digits'], styles: {}, unlearned: [], unplaced: [{ text: 'No emoji', place: 'Figma' }],
    });
    const { onSave } = renderEditor();
    const user = await ask('No emoji in Figma');

    expect(await screen.findByText('Choose where each new rule applies.')).toBeTruthy();
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await user.click(screen.getByRole('combobox', { name: 'Where “No emoji” applies' }));
    await user.click(screen.getByRole('option', { name: 'Messaging', hidden: true }));
    expect(saveButton.disabled).toBe(false);

    await user.click(saveButton);
    expect(vi.mocked(onSave).mock.calls[0][0].writingPreferences.split('\n')).toEqual(['Write numbers as digits', expect.stringMatching(/No emoji/)]);
    expect(vi.mocked(onSave).mock.calls[0][0].writingPreferences).toContain('Messaging');
  });

  it('makes Escape discard a pending change before it closes the editor', async () => {
    engine.proposeWritingPreferences.mockResolvedValue({ rules: [], styles: {}, unlearned: [], unplaced: [] });
    const { onClose, onSave } = renderEditor();
    await ask('Remove all my rules');
    expect(await screen.findByText('This removes all your rules.')).toBeTruthy();

    const dialog = document.querySelector('dialog')!;
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a provider error and saves nothing', async () => {
    engine.proposeWritingPreferences.mockRejectedValue(new Error('Rate limit reached. Try again soon.'));
    const { onSave } = renderEditor();
    await ask('Use British spelling');

    expect((await screen.findByRole('alert')).textContent).toBe('Rate limit reached. Try again soon.');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('forgets a learned style and puts it back with Undo', async () => {
    const forgotten = { samples: { a: {} }, styleCorrections: {} };
    const { onForgetStyle, onRestoreStyle } = renderEditor({ onForgetStyle: vi.fn(() => forgotten) });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Forget what Yap Yap learned for Messaging' }));
    expect(onForgetStyle).toHaveBeenCalledWith('Messaging');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onRestoreStyle).toHaveBeenCalledWith(forgotten);
  });

  it('removes saved rules without a provider and offers to set one up', async () => {
    const { onSave, onOpenProviders } = renderEditor({ provider: undefined });
    const user = userEvent.setup();

    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Set up a provider' }));
    expect(onOpenProviders).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove rule: Write numbers as digits' }));
    expect(onSave).toHaveBeenCalledWith({ writingPreferences: '', styleCorrections: {} });
  });
});
