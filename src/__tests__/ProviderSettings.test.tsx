// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { ProviderSettings } from '../components/ProviderSettings';
import { createDefaultProviders } from '../services/providers/catalog';
import { getInitialState } from '../services/storage';

beforeAll(() => {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});
afterEach(cleanup);

const renderWith = (sttProvider: 'groq' | 'elevenlabs') => {
  const providers = createDefaultProviders();
  providers.groq.apiKey = 'key';
  providers.elevenlabs.apiKey = 'key';
  const { settings } = getInitialState();
  render(
    <ProviderSettings
      providers={providers}
      settings={{ ...settings, activeSttProvider: sttProvider }}
      onUpdateProvider={() => {}}
      onRemoveProvider={() => {}}
      onUpdateSettings={() => {}}
    />,
  );
};

it('warns that Whisper can mistake the language, only while a Whisper model dictates', () => {
  renderWith('groq');
  expect(screen.getByText('Whisper can mistake the language if you speak several')).toBeTruthy();
  cleanup();
  renderWith('elevenlabs');
  expect(screen.queryByText(/Whisper can mistake/)).toBeNull();
});
