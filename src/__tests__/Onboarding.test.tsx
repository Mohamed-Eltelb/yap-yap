// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '../components/Onboarding';
import { getInitialState } from '../services/storage';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
  HTMLElement.prototype.showPopover = function showPopover() {};
  HTMLElement.prototype.hidePopover = function hidePopover() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(props: Partial<Parameters<typeof Onboarding>[0]> = {}) {
  const handlers = {
    onUpdateSettings: vi.fn(), onUpdateProvider: vi.fn(), onRemoveProvider: vi.fn(), onImportDictionary: vi.fn(), onFinish: vi.fn(),
  };
  const state = getInitialState();
  const view = render(<Onboarding state={state} {...handlers} {...props} />);
  return { ...handlers, state, view, user: userEvent.setup() };
}

const withGroqKey = () => {
  const state = getInitialState();
  return { ...state, providers: { ...state.providers, groq: { ...state.providers.groq, apiKey: 'gsk_test' } } };
};

describe('First-run setup', () => {
  it('finishes when the user skips it', async () => {
    const { onFinish, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('opens on the Groq key form and waits for a working provider', async () => {
    const { user, view, onFinish } = setup();
    await user.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.getByRole('heading', { name: 'Connect your AI' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Groq/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Verify & add' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(<Onboarding state={withGroqKey()} onUpdateSettings={vi.fn()} onUpdateProvider={vi.fn()} onRemoveProvider={vi.fn()} onImportDictionary={vi.fn()} onFinish={onFinish} />);
    expect(screen.getByText('Groq is connected.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows only a dictation made on the Try step', async () => {
    const state = withGroqKey();
    const handlers = { onUpdateSettings: vi.fn(), onUpdateProvider: vi.fn(), onRemoveProvider: vi.fn(), onImportDictionary: vi.fn(), onFinish: vi.fn() };
    const user = userEvent.setup();
    const view = render(<Onboarding state={state} latestDictation="Old dictation." {...handlers} />);
    for (const name of ['Get started', 'Continue', 'Continue']) await user.click(screen.getByRole('button', { name }));

    expect(screen.getByRole('heading', { name: 'Try it for real' })).toBeTruthy();
    expect(screen.getAllByText('Right Alt').length).toBeGreaterThan(0);
    expect(screen.queryByText('Old dictation.')).toBeNull();

    view.rerender(<Onboarding state={state} latestDictation="Hello from Yap Yap." {...handlers} />);
    expect(screen.getByText('Hello from Yap Yap.')).toBeTruthy();
  });

  it('sets the cleanup level and finishes from the last step', async () => {
    const { onUpdateSettings, onFinish, user, view } = setup();
    view.rerender(<Onboarding state={withGroqKey()} onUpdateSettings={onUpdateSettings} onUpdateProvider={vi.fn()} onRemoveProvider={vi.fn()} onImportDictionary={vi.fn()} onFinish={onFinish} />);
    for (const name of ['Get started', 'Continue', 'Continue', 'Continue']) await user.click(screen.getByRole('button', { name }));

    await user.click(screen.getByRole('radio', { name: /Formal/ }));
    expect(onUpdateSettings).toHaveBeenCalledWith({ defaultStyle: 'formal' });
    await user.click(screen.getByRole('radio', { name: /Medium/ }));
    expect(onUpdateSettings).toHaveBeenCalledWith({ smartCleanup: true, cleanupLevel: 'medium' });
    await user.click(screen.getByRole('radio', { name: /None/ }));
    expect(onUpdateSettings).toHaveBeenCalledWith({ smartCleanup: false });

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('button', { name: 'Skip setup' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start dictating' }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('imports a dictionary from the welcome step', async () => {
    const { onImportDictionary } = setup();
    const file = new File(['handoff\nSupabase\n'], 'words.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Dictionary file'), { target: { files: [file] } });
    expect((await screen.findByRole('status')).textContent).toBe('Imported 2 entries.');
    expect(onImportDictionary).toHaveBeenCalledWith([expect.objectContaining({ word: 'handoff' }), expect.objectContaining({ word: 'Supabase' })]);
  });

  it('ignores Escape so setup is never dismissed by accident', () => {
    const { onFinish } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Talk. Yap Yap types.' })).toBeTruthy();
  });
});
