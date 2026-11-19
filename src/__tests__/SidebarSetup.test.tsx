// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Sidebar } from '../components/Sidebar';
import { getInitialState } from '../services/storage';
import type { ProviderConfig, ProviderId } from '../types/app';

const noop = () => {};
const card = (
  providers: Record<ProviderId, ProviderConfig>,
  over: { stt?: ProviderId; llm?: ProviderId | 'none'; cleanup?: boolean } = {},
  onUpdateSettings = noop as (patch: object) => void,
  onUpdateProvider = noop as (id: ProviderId, patch: object) => void,
) => {
  render(
    <Sidebar activeNav="home" onSelectNav={noop} onOpenModal={noop} onStartDictation={noop} appearance="light"
      onChangeAppearance={noop} providers={providers} activeSttProvider={over.stt ?? 'elevenlabs'}
      activeLlmProvider={over.llm ?? 'groq'} smartCleanup={over.cleanup ?? true} cleanupLevel="light"
      onUpdateSettings={onUpdateSettings} onUpdateProvider={onUpdateProvider} dismissedQuickCard
      onDismissQuickCard={noop} isRecording={false} />,
  );
};
const withKeys = (patch: Partial<Record<ProviderId, Partial<ProviderConfig>>> = {}) => {
  const { providers } = getInitialState();
  const next = { ...providers };
  next.elevenlabs = { ...next.elevenlabs, apiKey: 'k', sttModel: 'scribe_v3' };
  next.groq = { ...next.groq, apiKey: 'k', llmModel: 'openai/gpt-oss-20b' };
  for (const [id, p] of Object.entries(patch)) next[id as ProviderId] = { ...next[id as ProviderId], ...p };
  return next;
};

afterEach(cleanup);

it('shows the models each dictation runs with short names, and that the keys are ready', () => {
  card(withKeys());
  expect(screen.getByText('Scribe v3')).toBeTruthy();
  expect(screen.getByText('ElevenLabs')).toBeTruthy();
  expect(screen.getByText('gpt-oss-20b')).toBeTruthy();
  expect(screen.getByText('Groq · Light')).toBeTruthy();
  expect(screen.getByText('Ready')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /API key/ })).toBeNull();
});

it('says cleanup is off without asking for a cleanup key', () => {
  card(withKeys({ groq: { apiKey: '' } }), { cleanup: false });
  expect(screen.getByText('Cleanup off')).toBeTruthy();
  expect(screen.getByText('Ready')).toBeTruthy();
});

it('asks for a missing key and flags a key that failed its test', () => {
  card(withKeys({ elevenlabs: { apiKey: '' } }));
  expect(screen.getByText('Needs key')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add API key' })).toBeTruthy();
  cleanup();
  card(withKeys({ groq: { status: 'error', statusMessage: 'Invalid API key' } }));
  expect(screen.getByText('Key failed')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Fix API key' })).toBeTruthy();
});

it('switches the transcription model from the row without opening Settings', () => {
  const settings = vi.fn();
  const provider = vi.fn();
  card(withKeys(), {}, settings, provider);
  fireEvent.click(screen.getByRole('button', { name: /^Transcription: Scribe v3/ }));
  expect(screen.getByRole('radio', { name: 'Scribe v3' }).getAttribute('aria-checked')).toBe('true');
  // Groq has a key, so its speech models are offered too.
  fireEvent.click(screen.getByRole('radio', { name: 'whisper-large-v3-turbo' }));
  expect(provider).toHaveBeenCalledWith('groq', { sttModel: 'whisper-large-v3-turbo' });
  expect(settings).toHaveBeenCalledWith({ activeSttProvider: 'groq' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('changes the cleanup level from the cleanup row', () => {
  const settings = vi.fn();
  card(withKeys(), {}, settings);
  fireEvent.click(screen.getByRole('button', { name: /^Cleanup: gpt-oss-20b/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'None' }));
  expect(settings).toHaveBeenCalledWith({ smartCleanup: false });
  fireEvent.click(screen.getByRole('radio', { name: 'Medium' }));
  expect(settings).toHaveBeenCalledWith({ smartCleanup: true, cleanupLevel: 'medium', activeLlmProvider: 'groq' });
});
