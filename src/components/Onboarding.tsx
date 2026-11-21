import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Mic } from 'lucide-react';
import { PROVIDER_CATALOG, isProviderConfigured } from '../services/providers/catalog';
import { STYLE_PRESETS } from '../services/personalization';
import type { PersistedAppState } from '../services/storage';
import type { ProviderConfig, ProviderId, SettingsState } from '../types/app';
import { parseDictionaryImportText, type ImportedWord } from './DictionaryView';
import { MicrophoneDialog, useMicrophones } from './MicrophoneDialog';
import { ProviderSettings } from './ProviderSettings';
import { StartingStylesDialog } from './StartingStylesDialog';
import './Onboarding.css';

const STEPS = ['welcome', 'provider', 'microphone', 'try', 'writing', 'done'] as const;
type Step = (typeof STEPS)[number];

const LEVELS = [
  { id: 'none', label: 'None', detail: 'Exactly what you said.' },
  { id: 'light', label: 'Light', detail: 'Removes filler words and fixes punctuation. Keeps your wording.' },
  { id: 'medium', label: 'Medium', detail: 'Also tightens wording for clarity.' },
] as const;

interface Props {
  state: Pick<PersistedAppState, 'settings' | 'providers'>;
  /** The text of the newest dictation, so the Try step can show the first one. */
  latestDictation?: string;
  onUpdateSettings: (patch: Partial<SettingsState>) => void;
  onUpdateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  onRemoveProvider: (id: ProviderId) => void;
  onImportDictionary: (words: ImportedWord[]) => void;
  /** Finished or skipped. */
  onFinish: () => void;
}

/** "Right Alt + Space" for a saved shortcut. */
export function shortcutLabel(combos: string[][] | undefined): string {
  return combos?.[0]?.join(' + ') || 'your shortcut';
}

/** First-run setup: from a fresh install to a working dictation. Every step can be skipped. */
export function Onboarding({ state, latestDictation, onUpdateSettings, onUpdateProvider, onRemoveProvider, onImportDictionary, onFinish }: Props) {
  const { settings, providers } = state;
  const [step, setStep] = useState<Step>('welcome');
  const index = STEPS.indexOf(step);
  const go = (offset: number) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, index + offset))]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [step]);

  const canDictate = Object.values(providers).some((p) => PROVIDER_CATALOG[p.id].supportsStt && isProviderConfigured(p));
  const blocked = step === 'provider' && !canDictate;

  return (
    <div className="yy-onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="yy-onboarding-card">
        <div className="yy-onboarding-top">
          <ol className="yy-onboarding-dots" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
            {STEPS.map((name, at) => <li key={name} data-state={at < index ? 'done' : at === index ? 'current' : undefined} />)}
          </ol>
          {step !== 'done' && <button type="button" className="yy-onboarding-skip" onClick={onFinish}>Skip setup</button>}
        </div>

        <div className="yy-onboarding-body">
          {step === 'welcome' && <Welcome heading={heading} onImport={onImportDictionary} />}
          {step === 'provider' && (
            <Section heading={heading} title="Connect a provider" lead="Groq is free to start and handles both transcription and cleanup. Get a key, paste it in, and you're set.">
              <a className="yy-onboarding-link" href={PROVIDER_CATALOG.groq.docsUrl} target="_blank" rel="noreferrer">
                Get a free Groq key <ArrowUpRight size={14} aria-hidden="true" />
              </a>
              <div className="yy-onboarding-providers">
                <ProviderSettings
                  providers={providers}
                  settings={settings}
                  startWith="groq"
                  onUpdateProvider={onUpdateProvider}
                  onRemoveProvider={onRemoveProvider}
                  onUpdateSettings={onUpdateSettings}
                />
              </div>
              <p role="status" className="yy-onboarding-status" data-ok={canDictate || undefined}>
                {canDictate ? <><Check size={14} aria-hidden="true" /> Connected. You can dictate now.</> : 'Add a key for a provider that can transcribe speech to continue.'}
              </p>
            </Section>
          )}
          {step === 'microphone' && <Microphone heading={heading} settings={settings} onUpdateSettings={onUpdateSettings} />}
          {step === 'try' && <TryIt heading={heading} settings={settings} canDictate={canDictate} latestDictation={latestDictation} />}
          {step === 'writing' && <Writing heading={heading} settings={settings} onUpdateSettings={onUpdateSettings} />}
          {step === 'done' && (
            <Section heading={heading} title="You're all set" lead="A few more things you can do:">
              <ul className="yy-onboarding-tips">
                <li><kbd>{shortcutLabel(settings.shortcuts.translate)}</kbd> translates what you say.</li>
                <li><kbd>{shortcutLabel(settings.shortcuts.ask)}</kbd> answers a question you ask out loud.</li>
                <li><strong>Snippets</strong> insert text you use often when you say its trigger.</li>
                <li><strong>Settings → Personalization</strong> shows what Yap Yap learns about your writing, and lets you correct it.</li>
              </ul>
            </Section>
          )}
        </div>

        <div className="yy-onboarding-actions">
          {index > 0 && step !== 'done' && <button type="button" className="yy-pref-button" onClick={() => go(-1)}>Back</button>}
          {step === 'done'
            ? <button type="button" className="yy-pref-button" data-primary onClick={onFinish}>Start dictating</button>
            : <button type="button" className="yy-pref-button" data-primary disabled={blocked} onClick={() => go(1)}>{step === 'welcome' ? 'Get started' : 'Continue'}</button>}
        </div>
      </div>
    </div>
  );
}

function Section({ heading, title, lead, children }: { heading: React.RefObject<HTMLHeadingElement | null>; title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <section>
      <h2 id="onboarding-title" ref={heading} tabIndex={-1}>{title}</h2>
      <p className="yy-onboarding-lead">{lead}</p>
      {children}
    </section>
  );
}

function Welcome({ heading, onImport }: { heading: React.RefObject<HTMLHeadingElement | null>; onImport: (words: ImportedWord[]) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<number>();
  return (
    <Section heading={heading} title="Welcome to Yap Yap" lead="Talk anywhere you can type. Press a shortcut, speak, and clean text appears where your cursor is.">
      <div className="yy-onboarding-note">
        <h3>Why it asks for an API key</h3>
        <p>Yap Yap runs on an AI provider you choose. You bring your own key, so you pay the provider directly (Groq is free to start) and your audio goes only to them.</p>
      </div>
      <div className="yy-onboarding-note">
        <h3>Coming from Wispr Flow or Typeless?</h3>
        <p>Export your dictionary there as a CSV file and bring it along. Your words and replacements carry over.</p>
        <button type="button" className="yy-pref-button" onClick={() => file.current?.click()}>Import dictionary</button>
        <input
          ref={file}
          type="file"
          accept=".csv,.txt"
          hidden
          aria-label="Dictionary file"
          onChange={async (event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (!chosen) return;
            const words = parseDictionaryImportText(await chosen.text());
            onImport(words);
            setImported(words.length);
          }}
        />
        {imported !== undefined && (
          <p role="status" className="yy-onboarding-status" data-ok={imported > 0 || undefined}>
            {imported > 0 ? `Imported ${imported} ${imported === 1 ? 'entry' : 'entries'}.` : 'No words found in that file.'}
          </p>
        )}
      </div>
    </Section>
  );
}

function Microphone({ heading, settings, onUpdateSettings }: { heading: React.RefObject<HTMLHeadingElement | null>; settings: SettingsState; onUpdateSettings: Props['onUpdateSettings'] }) {
  const { microphones, known, refresh } = useMicrophones(true);
  const [testing, setTesting] = useState(false);
  const current = settings.microphoneId === 'default'
    ? 'Auto-detect (your system default)'
    : microphones.find((mic) => mic.id === settings.microphoneId)?.label ?? 'Saved microphone';
  return (
    <Section heading={heading} title="Check your microphone" lead="Pick the microphone you talk into and make sure Yap Yap hears you.">
      <div className="yy-onboarding-row">
        <Mic size={18} aria-hidden="true" />
        <span>{current}</span>
        <button type="button" className="yy-pref-button" onClick={() => setTesting(true)}>Test microphone</button>
      </div>
      {testing && (
        <MicrophoneDialog
          microphones={microphones}
          devicesKnown={known}
          value={settings.microphoneId}
          strongNoiseReduction={settings.strongNoiseReduction}
          onChange={(microphoneId) => onUpdateSettings({ microphoneId })}
          onListening={refresh}
          onClose={() => setTesting(false)}
        />
      )}
    </Section>
  );
}

function TryIt({ heading, settings, canDictate, latestDictation }: { heading: React.RefObject<HTMLHeadingElement | null>; settings: SettingsState; canDictate: boolean; latestDictation?: string }) {
  // Only a dictation made on this step counts, not one from before setup.
  const [before] = useState(latestDictation);
  const result = latestDictation !== before ? latestDictation : undefined;
  const key = shortcutLabel(settings.shortcuts.dictate);
  return (
    <Section heading={heading} title="Try it" lead={<>Press <kbd>{key}</kbd>, say a sentence, then press <kbd>{key}</kbd> again.</>}>
      <div className="yy-onboarding-try" data-done={result ? '' : undefined} aria-live="polite">
        {result
          ? <><span className="yy-onboarding-try-label"><Check size={14} aria-hidden="true" /> That's it</span><p>{result}</p></>
          : <p>{canDictate ? 'Your words will appear here.' : 'Connect a provider first, then come back to try it.'}</p>}
      </div>
      <p className="yy-onboarding-hint">In any other app, the text goes straight to where your cursor is. You can change the shortcut in Settings.</p>
    </Section>
  );
}

function Writing({ heading, settings, onUpdateSettings }: { heading: React.RefObject<HTMLHeadingElement | null>; settings: SettingsState; onUpdateSettings: Props['onUpdateSettings'] }) {
  const [stylesOpen, setStylesOpen] = useState(false);
  const level = settings.smartCleanup ? settings.cleanupLevel : 'none';
  const picked = Object.keys(settings.styleCorrections).length;
  const fallback = STYLE_PRESETS.find((preset) => preset.id === settings.defaultStyle);
  return (
    <Section heading={heading} title="How should it write?" lead="You can change both any time in Settings.">
      <h3 className="yy-onboarding-subhead">Cleanup</h3>
      <div className="yy-onboarding-levels" role="radiogroup" aria-label="Cleanup level">
        {LEVELS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={level === option.id}
            onClick={() => onUpdateSettings(option.id === 'none' ? { smartCleanup: false } : { smartCleanup: true, cleanupLevel: option.id })}
          >
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </button>
        ))}
      </div>
      <h3 className="yy-onboarding-subhead">Style</h3>
      <div className="yy-onboarding-row">
        <span>
          {picked > 0
            ? `You picked a style for ${picked} ${picked === 1 ? 'kind of place' : 'kinds of places'}.`
            : fallback ? `${fallback.label} everywhere, until Yap Yap learns more.` : 'Yap Yap learns how you write in each app.'}
        </span>
        <button type="button" className="yy-pref-button" onClick={() => setStylesOpen(true)}>Choose styles</button>
      </div>
      <p className="yy-onboarding-hint">Pick Formal, Casual or Very casual for emails, chats and more, or let Yap Yap learn from you.</p>
      {stylesOpen && (
        <StartingStylesDialog
          corrections={settings.styleCorrections}
          defaultStyle={settings.defaultStyle}
          active={settings.personalizationEnabled && settings.smartCleanup}
          onChange={(styleCorrections) => onUpdateSettings({ styleCorrections })}
          onDefaultChange={(defaultStyle) => onUpdateSettings({ defaultStyle })}
          onClose={() => setStylesOpen(false)}
        />
      )}
    </Section>
  );
}
