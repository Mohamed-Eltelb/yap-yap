// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Sidebar } from '../components/Sidebar';
import { getInitialState } from '../services/storage';
import type { ProviderConfig, ProviderId } from '../types/app';

const noop = () => {};
const card = (
  providers: Record<ProviderId, ProviderConfig>,
  over: { stt?: ProviderId; llm?: ProviderId | 'none'; cleanup?: boolean } = {},
) => {
  render(
    <Sidebar activeNav="home" onSelectNav={noop} onOpenModal={noop} onStartDictation={noop} appearance="light"
      onChangeAppearance={noop} providers={providers} activeSttProvider={over.stt ?? 'elevenlabs'}
      activeLlmProvider={over.llm ?? 'groq'} smartCleanup={over.cleanup ?? true} cleanupLevel="light" dismissedQuickCard
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
