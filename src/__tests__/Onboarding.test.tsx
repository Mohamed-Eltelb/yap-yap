// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '../components/Onboarding';
import { getInitialState } from '../services/storage';

const micTest = vi.hoisted(() => ({ onLevels: undefined as ((levels: number[]) => void) | undefined }));
vi.mock('../utils/audioRecorder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/audioRecorder')>()),
  startMicrophoneTest: vi.fn(async (_id: string | undefined, onLevels: (levels: number[]) => void) => {
    micTest.onLevels = onLevels;
    return () => undefined;
  }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
  HTMLElement.prototype.showPopover = function showPopover() {};
  HTMLElement.prototype.hidePopover = function hidePopover() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  document.elementFromPoint = () => null;
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

/** A provider in the list on the left, not the chooser on the right. */
const providerRow = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Provider' })).getByRole('radio', { name });

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
    expect(providerRow(/Groq/).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Verify & add' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(<Onboarding state={withGroqKey()} onUpdateSettings={vi.fn()} onUpdateProvider={vi.fn()} onRemoveProvider={vi.fn()} onImportDictionary={vi.fn()} onFinish={onFinish} />);
    expect(providerRow(/Groq/).textContent).toContain('Connected');
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens a connected provider to its settings when clicked', async () => {
    const user = userEvent.setup();
    render(<Onboarding state={withGroqKey()} onUpdateSettings={vi.fn()} onUpdateProvider={vi.fn()} onRemoveProvider={vi.fn()} onImportDictionary={vi.fn()} onFinish={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.queryByRole('button', { name: 'Remove provider' })).toBeNull();

    await user.click(providerRow(/Groq/));
    expect(screen.getByRole('button', { name: 'Remove provider' })).toBeTruthy();
    await user.click(providerRow(/Groq/));
    expect(screen.queryByRole('button', { name: 'Remove provider' })).toBeNull();
  });

  it('closes the provider row after removing it, without showing the full provider settings', async () => {
    const user = userEvent.setup();
    const onRemoveProvider = vi.fn();
    render(<Onboarding state={withGroqKey()} onUpdateSettings={vi.fn()} onUpdateProvider={vi.fn()} onRemoveProvider={onRemoveProvider} onImportDictionary={vi.fn()} onFinish={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Get started' }));
    await user.click(providerRow(/Groq/));
    await user.click(screen.getByRole('button', { name: 'Remove provider' }));
    for (const confirm of screen.queryAllByRole('button', { name: /^Remove$/ })) await user.click(confirm);

    expect(onRemoveProvider).toHaveBeenCalledWith('groq');
    expect(screen.queryByText('Connected providers')).toBeNull();
    expect(providerRow(/Groq/).getAttribute('aria-expanded')).toBe('false');
  });

  it('chooses which connected provider does dictation and AI', async () => {
    const user = userEvent.setup();
    const onUpdateSettings = vi.fn();
    const base = withGroqKey();
    const state = { ...base, providers: { ...base.providers, deepgram: { ...base.providers.deepgram, apiKey: 'dg_test' } } };
    render(<Onboarding state={state} onUpdateSettings={onUpdateSettings} onUpdateProvider={vi.fn()} onRemoveProvider={vi.fn()} onImportDictionary={vi.fn()} onFinish={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Get started' }));

    const menuOf = (name: string) => {
      const trigger = screen.getByRole('combobox', { name });
      return { trigger, list: within(document.getElementById(trigger.getAttribute('aria-controls')!)!) };
    };
    const dictation = menuOf('Dictation provider');
    await user.click(dictation.trigger);
    await user.click(dictation.list.getByRole('option', { name: /Deepgram/, hidden: true }));
    expect(onUpdateSettings).toHaveBeenCalledWith({ activeSttProvider: 'deepgram' });
    expect(menuOf('AI provider').list.queryByRole('option', { name: /Deepgram/, hidden: true })).toBeNull();
  });

  it('says when the microphone test hears nothing, without blocking Continue', async () => {
    vi.useFakeTimers();
    try {
      render(<Onboarding state={withGroqKey()} onUpdateSettings={vi.fn()} onUpdateProvider={vi.fn()} onRemoveProvider={vi.fn()} onImportDictionary={vi.fn()} onFinish={vi.fn()} />);
      for (const name of ['Get started', 'Continue']) fireEvent.click(screen.getByRole('button', { name }));
      await act(async () => {});
      expect(screen.getByRole('heading', { name: 'Say something' })).toBeTruthy();
      expect(screen.getByText('Listening…')).toBeTruthy();

      await act(async () => { vi.advanceTimersByTime(6000); });
      expect(screen.getByText(/Nothing heard yet/)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);

      act(() => micTest.onLevels?.(Array(20).fill(0.9)));
      expect(screen.getByText('Yap Yap hears you.')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows only a dictation made on the Try step', async () => {
    const state = withGroqKey();
    const handlers = { onUpdateSettings: vi.fn(), onUpdateProvider: vi.fn(), onRemoveProvider: vi.fn(), onImportDictionary: vi.fn(), onFinish: vi.fn() };
    const user = userEvent.setup();
    const view = render(<Onboarding state={state} latestDictation={{ id: 'a', text: 'Old dictation.' }} {...handlers} />);
    for (const name of ['Get started', 'Continue', 'Continue']) await user.click(screen.getByRole('button', { name }));

    expect(screen.getByRole('heading', { name: 'Try it for real' })).toBeTruthy();
    expect(screen.getAllByText('Right Alt').length).toBeGreaterThan(0);
    expect(screen.queryByText('Old dictation.')).toBeNull();

    view.rerender(<Onboarding state={state} latestDictation={{ id: 'b', text: 'Hello from Yap Yap.' }} {...handlers} />);
    expect(screen.getByText('Hello from Yap Yap.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText('Hello from Yap Yap.')).toBeNull();
    expect(screen.getByText('Try saying')).toBeTruthy();
  });

  it('shows a new dictation even when it says the same as the last one', async () => {
    const state = withGroqKey();
    const handlers = { onUpdateSettings: vi.fn(), onUpdateProvider: vi.fn(), onRemoveProvider: vi.fn(), onImportDictionary: vi.fn(), onFinish: vi.fn() };
    const user = userEvent.setup();
    const view = render(<Onboarding state={state} latestDictation={{ id: 'a', text: 'Same words.' }} {...handlers} />);
    for (const name of ['Get started', 'Continue', 'Continue']) await user.click(screen.getByRole('button', { name }));
    expect(screen.queryByText('Same words.')).toBeNull();

    view.rerender(<Onboarding state={state} latestDictation={{ id: 'b', text: 'Same words.' }} {...handlers} />);
    expect(screen.getByText('Same words.')).toBeTruthy();
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
