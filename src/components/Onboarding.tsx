import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Mic, RotateCcw } from 'lucide-react';
import { PROVIDER_CATALOG, PROVIDER_ORDER, isProviderConfigured } from '../services/providers/catalog';
import { STYLE_PRESETS } from '../services/personalization';
import type { PersistedAppState } from '../services/storage';
import { startMicrophoneTest } from '../utils/audioRecorder';
import type { ProviderConfig, ProviderId, SettingsState } from '../types/app';
import { loudness, type HudState } from './DictationHud';
import { parseDictionaryImportText, type ImportedWord } from './DictionaryView';
import { useMicrophones } from './MicrophoneDialog';
import { ConnectScene, DoneScene, Keys, MicrophoneScene, TryScene, WelcomeScene, WritingScene } from './OnboardingStage';
import { ProviderLogo } from './ProviderIcon';
import { ProviderSettings } from './ProviderSettings';
import { SelectMenu } from './SelectMenu';
import { StartingStylesDialog } from './StartingStylesDialog';
import { Toggle } from './Toggle';
import { WindowControls, YapLogo } from './YapLogo';
import './Onboarding.css';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'provider', label: 'Connect' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'try', label: 'Try it' },
  { id: 'writing', label: 'Style' },
  { id: 'done', label: 'Done' },
] as const;
type Step = (typeof STEPS)[number]['id'];

const LEVELS = [
  { id: 'none', label: 'None', detail: 'Exactly what you said' },
  { id: 'light', label: 'Light', detail: 'Drops filler words, fixes punctuation' },
  { id: 'medium', label: 'Medium', detail: 'Also tightens the wording' },
] as const;
type Level = (typeof LEVELS)[number]['id'];

const STYLES = [{ id: '', label: 'Learn from me' }, ...STYLE_PRESETS.map(({ id, label }) => ({ id, label }))];

/** The spoken sentence for the preview, word by word, with the level that removes each word. */
const SPOKEN: { word: string; dropAt?: Exclude<Level, 'none'> }[] = [
  ...'um so'.split(' ').map((word) => ({ word, dropAt: 'light' as const })),
  { word: 'hey' }, { word: 'sam' }, { word: 'I’m' },
  { word: 'uh', dropAt: 'light' }, { word: 'running' },
  { word: 'like', dropAt: 'light' }, { word: 'twenty', dropAt: 'light' }, { word: 'no', dropAt: 'light' },
  { word: 'thirty' }, { word: 'minutes' }, { word: 'late' }, { word: 'so' },
  { word: 'you', dropAt: 'light' }, { word: 'know', dropAt: 'light' },
  { word: 'maybe', dropAt: 'medium' }, { word: 'just', dropAt: 'medium' },
  { word: 'start' }, { word: 'without' }, { word: 'me' }, { word: 'and' }, { word: 'I’ll' }, { word: 'catch' }, { word: 'up' },
];
/** What each level and style turns the spoken sentence into, for the preview. */
const WRITTEN: Record<Exclude<Level, 'none'>, Record<string, string>> = {
  light: {
    '': 'Hey Sam, I’m running thirty minutes late, so maybe just start without me and I’ll catch up.',
    formal: 'Hey Sam. I’m running thirty minutes late, so maybe just start without me and I’ll catch up.',
    casual: 'Hey Sam, I’m running thirty minutes late, so maybe just start without me and I’ll catch up',
    'very-casual': 'hey sam i’m running thirty minutes late so maybe just start without me and i’ll catch up',
  },
  medium: {
    '': 'Hi Sam, I’m running thirty minutes late, so start without me and I’ll catch up.',
    formal: 'Hi Sam. I’m running thirty minutes late. Please start without me, and I’ll catch up.',
    casual: 'Hey Sam, running thirty minutes late, so start without me and I’ll catch up',
    'very-casual': 'hey sam running thirty minutes late so start without me, i’ll catch up',
  },
};

interface Props {
  state: Pick<PersistedAppState, 'settings' | 'providers'>;
  /** The text of the newest dictation, so the Try step can show the first one. */
  latestDictation?: { id: string; text: string };
  /** The live dictation, so the Try step can follow it. */
  hudStatus?: HudState['status'];
  hudLevels?: number[];
  /** The Try step opened or closed: it shows the dictation itself, so the app can hide the floating pill. */
  onTryStepChange?: (open: boolean) => void;
  onUpdateSettings: (patch: Partial<SettingsState>) => void;
  onUpdateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  onRemoveProvider: (id: ProviderId) => void;
  onImportDictionary: (words: ImportedWord[]) => void;
  /** Wispr Flow or Typeless installs found on this computer, which can be imported. */
  importApps?: { name: string }[];
  onOpenImport?: () => void;
  /** Finished or skipped. */
  onFinish: () => void;
}

/** "Right Alt" and "Space" for a saved shortcut. */
export function shortcutKeys(combos: string[][] | undefined): string[] {
  return combos?.[0]?.length ? combos[0] : ['Right Alt'];
}

/** First-run setup: from a fresh install to a working dictation, full window. Every step can be skipped. */
export function Onboarding(props: Props) {
  const { state, onFinish } = props;
  const { settings, providers } = state;
  const [step, setStep] = useState<Step>('welcome');
  const index = STEPS.findIndex((item) => item.id === step);
  const go = (to: number) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, to))].id);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), [step]);
  const { onTryStepChange } = props;
  useEffect(() => {
    if (step !== 'try') return;
    onTryStepChange?.(true);
    return () => onTryStepChange?.(false);
  }, [step, onTryStepChange]);

  const canDictate = Object.values(providers).some((p) => PROVIDER_CATALOG[p.id].supportsStt && isProviderConfigured(p));
  const [provider, setProvider] = useState<ProviderId>(() => PROVIDER_ORDER.find((id) => isProviderConfigured(providers[id])) ?? 'groq');
  const mic = useMicTest(settings, step === 'microphone');
  const dictateKeys = shortcutKeys(settings.shortcuts.dictate);
  // Compared by id: saying the same words twice is still a new dictation.
  const [before, setBefore] = useState(props.latestDictation?.id);
  const [replay, setReplay] = useState(0);
  const tried = props.latestDictation && props.latestDictation.id !== before ? props.latestDictation.text : undefined;
  const level: Level = settings.smartCleanup ? settings.cleanupLevel : 'none';
  const spoken = SPOKEN.map(({ word, dropAt }) => ({ word, struck: level === 'medium' ? !!dropAt : level === 'light' && dropAt === 'light' }));
  const written = level === 'none' ? SPOKEN.map(({ word }) => word).join(' ') : WRITTEN[level][settings.defaultStyle] ?? WRITTEN[level][''];
  const choice = level === 'none' ? 'No cleanup'
    : `${level === 'light' ? 'Light' : 'Medium'} · ${STYLES.find((style) => style.id === settings.defaultStyle)?.label ?? 'Learn from me'}`;

  const configured = (id: ProviderId | 'none') => id !== 'none' && isProviderConfigured(providers[id]);
  // Connected providers that can do each job, for the chooser on the right.
  const connectedIds = [...PROVIDER_ORDER, 'custom' as ProviderId].filter((id, i, all) => all.indexOf(id) === i && configured(id));
  const option = (id: ProviderId, model: string, models: { id: string; label: string }[]) => ({
    id, name: id === 'custom' ? providers[id].name : PROVIDER_CATALOG[id].name, model: models.find((m) => m.id === model)?.label ?? model,
  });
  const sttOptions = connectedIds.filter((id) => PROVIDER_CATALOG[id].supportsStt)
    .map((id) => option(id, providers[id].sttModel, PROVIDER_CATALOG[id].sttModels));
  const llmOptions = connectedIds.filter((id) => PROVIDER_CATALOG[id].supportsLlm)
    .map((id) => option(id, providers[id].llmModel, PROVIDER_CATALOG[id].llmModels));
  const deviceLabel = mic.microphones.find((m) => m.id === settings.microphoneId && m.id !== 'default')?.label ?? 'System default microphone';

  const scene: Record<Step, ReactNode> = {
    welcome: <WelcomeScene />,
    provider: (
      <ConnectScene jobs={[
        {
          title: 'Dictation', detail: 'Turns your voice into text.', options: sttOptions,
          value: sttOptions.find((o) => o.id === settings.activeSttProvider)?.id ?? sttOptions[0]?.id,
          onChange: (activeSttProvider) => props.onUpdateSettings({ activeSttProvider }),
        },
        {
          title: 'AI', detail: 'Cleanup, translation and Ask Anything.', options: llmOptions,
          value: llmOptions.find((o) => o.id === settings.activeLlmProvider)?.id ?? llmOptions[0]?.id,
          onChange: (activeLlmProvider) => props.onUpdateSettings({ activeLlmProvider }),
        },
      ]} />
    ),
    microphone: <MicrophoneScene levels={mic.levels} state={mic.state} device={deviceLabel} />,
    try: <TryScene keys={dictateKeys} status={props.hudStatus ?? 'idle'} levels={props.hudLevels ?? []} result={tried} />,
    writing: <WritingScene spoken={spoken} written={written} choice={choice} />,
    done: (
      <DoneScene shortcuts={[
        { label: 'Dictate', keys: dictateKeys },
        { label: 'Translate', keys: shortcutKeys(settings.shortcuts.translate) },
        { label: 'Ask anything', keys: shortcutKeys(settings.shortcuts.ask) },
      ]} />
    ),
  };

  // Start the picture on the right over: replay the demo, restart the mic test, or clear the try.
  const reset: Partial<Record<Step, { label: string; run: () => void }>> = {
    welcome: { label: 'Replay', run: () => setReplay((n) => n + 1) },
    microphone: { label: 'Restart the microphone test', run: () => void mic.start() },
    ...(tried ? { try: { label: 'Try again', run: () => { setBefore(props.latestDictation?.id); setReplay((n) => n + 1); } } } : {}),
  };

  return (
    <div className="yy-ob" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <header className="yy-ob-top app-drag">
        <span className="yy-ob-brand"><YapLogo className="w-[19px] h-[19px]" /> Yap Yap</span>
        <ol className="yy-ob-steps" aria-label="Setup steps">
          {STEPS.slice(0, -1).map((item, at) => (
            <li key={item.id} data-state={at < index ? 'done' : at === index ? 'current' : undefined} aria-current={at === index ? 'step' : undefined}>
              <span className="yy-ob-step-mark">{at < index ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : at + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>
        <div className="yy-ob-top-end app-no-drag">
          {step !== 'done' && <button type="button" className="yy-ob-skip" onClick={onFinish}>Skip setup</button>}
          <WindowControls />
        </div>
      </header>

      <main className="yy-ob-main">
        <section className="yy-ob-content" key={step}>
          <div className="yy-ob-copy">
            {step === 'welcome' && <WelcomeStep heading={heading} {...props} />}
            {step === 'provider' && <ProviderStep heading={heading} provider={provider} onPick={setProvider} canDictate={canDictate} {...props} />}
            {step === 'microphone' && <MicrophoneStep heading={heading} mic={mic} {...props} />}
            {step === 'try' && <TryStep heading={heading} keys={dictateKeys} tried={tried} canDictate={canDictate} />}
            {step === 'writing' && <WritingStep heading={heading} level={level} {...props} />}
            {step === 'done' && (
              <>
                <Intro heading={heading} title="You’re ready" lead="Yap Yap waits in the tray. Press your shortcut in any app to start." />
                <ul className="yy-ob-facts">
                  <li>
                    <strong>Snippets</strong>
                    <span>Save text you type often, like your email signature, and say its trigger to insert it.</span>
                  </li>
                  <li>
                    <strong>It learns how you write</strong>
                    <span>See what it learned, and correct it, in Settings under Personalization.</span>
                  </li>
                </ul>
                <div className="yy-ob-login">
                  <span>
                    <strong>Open Yap Yap when your computer starts</strong>
                    <small>So your shortcut works right after you sign in.</small>
                  </span>
                  <Toggle
                    label="Open Yap Yap when your computer starts"
                    checked={settings.launchAtLogin}
                    onChange={(launchAtLogin) => props.onUpdateSettings({ launchAtLogin })}
                  />
                </div>
              </>
            )}
          </div>
          <div className="yy-ob-actions">
            {index > 0 && step !== 'done' && <button type="button" className="yy-ob-back" onClick={() => go(index - 1)}>Back</button>}
            {step === 'done'
              ? <button type="button" className="yy-ob-next" onClick={onFinish}>Start dictating</button>
              : (
                <button type="button" className="yy-ob-next" disabled={step === 'provider' && !canDictate} onClick={() => go(index + 1)}>
                  {step === 'welcome' ? 'Get started' : 'Continue'}
                </button>
              )}
          </div>
        </section>
        <div className="yy-ob-stage" data-step={step}>
          <div key={`${step}-${replay}`} className="yy-ob-stage-scene">{scene[step]}</div>
          {reset[step] && (
            <button type="button" className="yy-ob-reset" aria-label={reset[step].label} title={reset[step].label} onClick={reset[step].run}>
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>;

function Intro({ heading, title, lead }: { heading: HeadingRef; title: string; lead: ReactNode }) {
  return (
    <>
      <h1 id="onboarding-title" ref={heading} tabIndex={-1} className="yy-ob-title">{title}</h1>
      <p className="yy-ob-lead">{lead}</p>
    </>
  );
}

function WelcomeStep({ heading, onImportDictionary, importApps = [], onOpenImport }: Props & { heading: HeadingRef }) {
  const file = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<number>();
  const apps = onOpenImport ? importApps : [];
  const names = new Intl.ListFormat('en', { type: 'disjunction' }).format(apps.map((app) => app.name));
  return (
    <>
      <Intro heading={heading} title="Talk. Yap Yap types." lead="Press a shortcut in any app, speak the way you talk, and clean text lands where your cursor is." />
      <ul className="yy-ob-facts">
        <li>
          <strong>You bring your own AI key.</strong>
          <span>You pay the provider directly, and Groq is free to start. Your audio goes only to them.</span>
        </li>
        <li>
          <strong>{apps.length ? `Coming from ${names}?` : 'Coming from Wispr Flow or Typeless?'}</strong>
          {apps.length ? (
            <span>Yap Yap found it on this computer. <button type="button" className="yy-ob-inline" onClick={onOpenImport}>Bring your dictionary and snippets over</button></span>
          ) : (
            <span>
              Export your dictionary there as a CSV file, then{' '}
              <button type="button" className="yy-ob-inline" onClick={() => file.current?.click()}>import it here</button>.
            </span>
          )}
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
              onImportDictionary(words);
              setImported(words.length);
            }}
          />
          {imported !== undefined && (
            <span role="status" className="yy-ob-status" data-ok={imported > 0 || undefined}>
              {imported > 0 ? `Imported ${imported} ${imported === 1 ? 'entry' : 'entries'}.` : 'No words found in that file.'}
            </span>
          )}
        </li>
      </ul>
    </>
  );
}

const LIST_PROVIDERS: ProviderId[] = ['groq', ...PROVIDER_ORDER.filter((id) => id !== 'groq' && id !== 'custom'), 'custom'];

/** What a provider can do for Yap Yap, in a few words. */
function providerRole(id: ProviderId): string {
  const { supportsStt, supportsLlm } = PROVIDER_CATALOG[id];
  const role = supportsStt && supportsLlm ? 'Speech to text and cleanup' : supportsStt ? 'Speech to text' : 'Cleanup';
  return role;
}

function ProviderStep({ heading, provider, onPick, canDictate, state, onUpdateProvider, onRemoveProvider, onUpdateSettings }: Props & {
  heading: HeadingRef; provider: ProviderId; onPick: (id: ProviderId) => void; canDictate: boolean;
}) {
  // A row opens to its key and settings; with a provider already working, all start closed.
  const [open, setOpen] = useState<ProviderId | undefined>(canDictate ? undefined : provider);
  const pick = (id: ProviderId) => {
    setOpen((current) => (current === id ? undefined : id));
    onPick(id);
  };
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Bring an opened row's form into view; it can open below the fold.
    if (open) list.current?.querySelector('[data-open]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);
  return (
    <>
      <Intro heading={heading} title="Connect your AI" lead="Yap Yap sends your voice straight to a provider you choose, with your own key." />
      <div ref={list} className="yy-ob-providers" role="radiogroup" aria-label="Provider">
        {LIST_PROVIDERS.map((id) => {
          const meta = PROVIDER_CATALOG[id];
          const connected = isProviderConfigured(state.providers[id]);
          const expanded = open === id;
          return (
            <div key={id} className="yy-ob-provider" data-open={expanded || undefined}>
              <button type="button" role="radio" aria-checked={provider === id} aria-expanded={expanded} className="yy-ob-provider-row" onClick={() => pick(id)}>
                <ProviderLogo id={id} size={20} />
                <span className="yy-ob-provider-name">
                  <strong>{id === 'custom' ? 'Custom' : meta.name.replace(/^(Google|Anthropic)\s+/, '')}{meta.freeOffer && <em className="yy-ob-tag">{meta.freeOffer}</em>}</strong>
                  <small>{providerRole(id)}</small>
                </span>
                {connected && <span className="yy-ob-provider-state"> Connected</span>}
              </button>
              {expanded && (
                <div className="yy-ob-form">
                  {!meta.supportsStt && <p className="yy-ob-form-note">{meta.name} can’t transcribe speech, so also connect one that can.</p>}
                  <ProviderSettings
                    key={id}
                    providers={state.providers}
                    settings={state.settings}
                    startWith={id}
                    onUpdateProvider={onUpdateProvider}
                    onRemoveProvider={onRemoveProvider}
                    onDone={() => setOpen(undefined)}
                    onUpdateSettings={onUpdateSettings}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p role="status" className="yy-ob-status">
        {canDictate ? '' : 'Add a key for a provider that can transcribe speech to continue.'}
      </p>
    </>
  );
}

type MicTest = ReturnType<typeof useMicTest>;

const QUIET_AFTER_MS = 6000;

/** A live microphone test while the step is open: levels, and whether a voice was heard. */
function useMicTest(settings: SettingsState, open: boolean) {
  const [state, setState] = useState<'off' | 'live' | 'blocked'>('off');
  const [levels, setLevels] = useState<number[]>(() => Array(20).fill(0.1));
  const [heard, setHeard] = useState(false);
  // Still nothing heard a few seconds after the test started: the wrong microphone, or a muted one.
  const [quiet, setQuiet] = useState(false);
  const stop = useRef<(() => void) | undefined>(undefined);
  const quietTimer = useRef<number | undefined>(undefined);
  const microphones = useMicrophones(open);
  const halt = () => { stop.current?.(); stop.current = undefined; window.clearTimeout(quietTimer.current); };
  const start = async (microphoneId = settings.microphoneId) => {
    halt();
    setHeard(false);
    setQuiet(false);
    try {
      stop.current = await startMicrophoneTest(microphoneId === 'default' ? undefined : microphoneId, (next) => {
        setLevels(next);
        if (loudness(next) > 0.35) setHeard(true);
      }, { strongNoiseReduction: settings.strongNoiseReduction });
      setState('live');
      quietTimer.current = window.setTimeout(() => setQuiet(true), QUIET_AFTER_MS);
      microphones.refresh();
    } catch {
      setState('blocked');
    }
  };
  useEffect(() => {
    // Opening the step starts listening, so the pill moves as soon as you speak.
    if (open) void start();
    else { halt(); setState('off'); setHeard(false); }
    return halt;
    // The test restarts on demand, not on every settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { state, levels, heard, quiet: quiet && !heard, start, microphones: microphones.microphones };
}

function MicrophoneStep({ heading, mic, state, onUpdateSettings }: Props & { heading: HeadingRef; mic: MicTest }) {
  const options = [
    { value: 'default', label: 'Auto-detect (system default)' },
    ...mic.microphones.filter((m) => m.id !== 'default').map((m) => ({ value: m.id, label: m.label })),
  ];
  return (
    <>
      <Intro heading={heading} title="Say something" lead="The pill should move with your voice. If it doesn’t, pick another microphone." />
      <div className="yy-ob-field">
        <SelectMenu
          label="Microphone"
          value={options.some((o) => o.value === state.settings.microphoneId) ? state.settings.microphoneId : 'default'}
          options={options}
          onChange={(microphoneId) => {
            onUpdateSettings({ microphoneId });
            if (mic.state === 'live') void mic.start(microphoneId);
          }}
        />
      </div>
      {mic.state !== 'live' && (
        <button type="button" className="yy-ob-secondary" onClick={() => void mic.start()}>
          <Mic size={15} aria-hidden="true" /> {mic.state === 'blocked' ? 'Try again' : 'Test my microphone'}
        </button>
      )}
      <p role="status" className="yy-ob-status" data-ok={mic.heard || undefined} data-error={mic.state === 'blocked' || undefined}>
        {mic.state === 'blocked'
          ? 'Yap Yap can’t use the microphone. Allow microphone access in your system settings, then try again.'
          : mic.heard ? 'Yap Yap hears you.'
            : mic.quiet ? 'Nothing heard yet. Check that the microphone isn’t muted, or pick another one above.'
              : mic.state === 'live' ? 'Listening…' : ''}
      </p>
    </>
  );
}

function TryStep({ heading, keys, tried, canDictate }: { heading: HeadingRef; keys: string[]; tried?: string; canDictate: boolean }) {
  return (
    <>
      <Intro heading={heading} title="Try it for real" lead={<>Press <Keys keys={keys} />, say a sentence, then press it again.</>} />
      <p role="status" className="yy-ob-status" data-ok={tried ? true : undefined}>
        {tried ? 'That’s it. Your words are on the right.' : canDictate ? 'Your words will appear on the right.' : 'Connect a provider first, then come back to try it.'}
      </p>
      <p className="yy-ob-hint">In other apps, the text goes straight to where your cursor is. You can change the shortcut in Settings.</p>
    </>
  );
}

function WritingStep({ heading, level, state, onUpdateSettings }: Props & { heading: HeadingRef; level: Level }) {
  const { settings } = state;
  const [perPlace, setPerPlace] = useState(false);
  const picked = Object.keys(settings.styleCorrections).length;
  return (
    <>
      <Intro heading={heading} title="Choose how it writes" lead="See the difference on the right. You can change this any time in Settings." />
      <h2 className="yy-ob-label">Cleanup</h2>
      <div className="yy-ob-levels" role="radiogroup" aria-label="Cleanup level">
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
      <h2 className="yy-ob-label">Style</h2>
      <div className="yy-ob-segments" role="radiogroup" aria-label="Style">
        {STYLES.map((style) => (
          <button key={style.id || 'learn'} type="button" role="radio" aria-checked={settings.defaultStyle === style.id} disabled={level === 'none'} onClick={() => onUpdateSettings({ defaultStyle: style.id })}>
            {style.label}
          </button>
        ))}
      </div>
      <p className="yy-ob-hint">
        {picked > 0 ? `You set a style for ${picked} ${picked === 1 ? 'kind of place' : 'kinds of places'}. ` : ''}
        <button type="button" className="yy-ob-inline" onClick={() => setPerPlace(true)}>Pick a style for emails, chats and more</button>
      </p>
      {perPlace && (
        <StartingStylesDialog
          corrections={settings.styleCorrections}
          defaultStyle={settings.defaultStyle}
          active={settings.personalizationEnabled && settings.smartCleanup}
          onChange={(styleCorrections) => onUpdateSettings({ styleCorrections })}
          onDefaultChange={(defaultStyle) => onUpdateSettings({ defaultStyle })}
          onClose={() => setPerPlace(false)}
        />
      )}
    </>
  );
}
