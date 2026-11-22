import { useEffect, useState, type CSSProperties } from 'react';
import { Check, MicOff } from 'lucide-react';
import type { ProviderId } from '../types/app';
import { DictationHud, type HudState } from './DictationHud';
import { ProviderLogo } from './ProviderIcon';

const ignore = () => undefined;

/** The real dictation pill, drawn in place instead of floating at the bottom of the screen. */
export function StagePill({ status, levels }: { status: HudState['status']; levels: number[] }) {
  return (
    <div className="yy-ob-pill" aria-hidden="true" inert>
      <DictationHud
        hud={{ status, mode: 'dictate', levels }}
        onStop={ignore}
        onCancel={ignore}
        onPause={ignore}
        onResume={ignore}
        onUndo={ignore}
        onRetry={ignore}
        onSelectTarget={ignore}
        onEditTargets={ignore}
        onCopyResult={ignore}
        onDismissResult={ignore}
      />
    </div>
  );
}

/** Speech-like bar levels, for the pill when nobody is talking. */
function useFakeLevels(active: boolean): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(20).fill(0.12));
  useEffect(() => {
    if (!active) return;
    let t = 0;
    const id = window.setInterval(() => {
      t += 1;
      setLevels(Array.from({ length: 20 }, (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(t / 3 + i / 2.2)) * (0.6 + 0.4 * Math.sin(t / 7))));
    }, 70);
    return () => window.clearInterval(id);
  }, [active]);
  return levels;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** What you say, word by word: filler is struck out, the rest is tidied. */
const SPOKEN_WORDS: { said: string; written?: string; drop?: boolean }[] = [
  { said: 'um', drop: true },
  { said: 'so', drop: true },
  { said: 'i’m', written: 'I’m' },
  { said: 'uh', drop: true },
  { said: 'running' },
  { said: 'like', drop: true },
  { said: 'ten' },
  { said: 'minutes' },
  { said: 'late', written: 'late.' },
  { said: 'you', drop: true },
  { said: 'know', drop: true },
  { said: 'start', written: 'Start' },
  { said: 'without' },
  { said: 'me', written: 'me.' },
];
const WORD_MS = 230;

type WelcomePhase = 'armed' | 'recording' | 'processing' | 'written';

/** Welcome: the words appear as they are said, then the pill thinks, strikes the filler, and tidies the rest. Loops. */
export function WelcomeScene() {
  const still = reducedMotion();
  const [phase, setPhase] = useState<WelcomePhase>(still ? 'written' : 'armed');
  const [heard, setHeard] = useState(still ? SPOKEN_WORDS.length : 0);
  const [round, setRound] = useState(0);
  const levels = useFakeLevels(phase === 'recording');
  useEffect(() => {
    if (still) return;
    const talk = 700;
    const thought = talk + SPOKEN_WORDS.length * WORD_MS + 300;
    const timers = [
      window.setTimeout(() => { setHeard(0); setPhase('armed'); }, 0),
      window.setTimeout(() => setPhase('recording'), talk),
      ...SPOKEN_WORDS.map((_, i) => window.setTimeout(() => setHeard(i + 1), talk + 150 + i * WORD_MS)),
      window.setTimeout(() => setPhase('processing'), thought),
      window.setTimeout(() => setPhase('written'), thought + 2300),
      window.setTimeout(() => setRound((n) => n + 1), thought + 7300),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [still, round]);
  let dropped = 0;
  return (
    <div className="yy-ob-scene" aria-hidden="true">
      <p className="yy-ob-big-text yy-ob-spoken" data-phase={phase}>
        {SPOKEN_WORDS.slice(0, heard).map((word, i) => (
          <span
            key={`${round}-${i}`}
            className="yy-ob-word"
            data-drop={word.drop || undefined}
            style={word.drop ? { '--strike-delay': `${(dropped++) * 180}ms` } as CSSProperties : undefined}
          >
            {phase === 'written' ? word.written ?? word.said : word.said}
          </span>
        ))}
        {phase !== 'written' && <i className="yy-ob-caret" />}
      </p>
      {/* Like the app: the pill closes once the text is written. */}
      <StagePill status={phase === 'written' ? 'idle' : phase} levels={levels} />
    </div>
  );
}

const PROVIDER_NAMES: Partial<Record<ProviderId, string>> = {
  groq: 'Groq', openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Claude', deepgram: 'Deepgram', elevenlabs: 'ElevenLabs',
};
const providerName = (id: ProviderId) => (id === 'custom' ? 'Your provider' : PROVIDER_NAMES[id] ?? id);

/** Connect: which provider does each job, and whether it is ready. */
export function ConnectScene({ jobs }: { jobs: { label: string; provider?: ProviderId; connected: boolean }[] }) {
  return (
    <div className="yy-ob-scene" aria-hidden="true">
      <dl className="yy-ob-jobs">
        {jobs.map((job) => (
          <div key={job.label} className="yy-ob-job" data-connected={job.connected || undefined}>
            <dt>{job.label}</dt>
            <dd>
              {job.provider ? <><ProviderLogo id={job.provider} size={22} /> {providerName(job.provider)}</> : 'Not set up'}
              <span className="yy-ob-job-state">{job.connected ? <><Check size={14} strokeWidth={2.5} /> Ready</> : 'Needs a key'}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Microphone: the pill, large, following the voice. */
export function MicrophoneScene({ levels, state, device }: { levels: number[]; state: 'off' | 'live' | 'blocked'; device: string }) {
  return (
    <div className="yy-ob-scene" aria-hidden="true">
      {state === 'blocked'
        ? <span className="yy-ob-pill-off"><MicOff size={34} /></span>
        : <div className="yy-ob-pill-large"><StagePill status={state === 'live' ? 'recording' : 'armed'} levels={levels} /></div>}
      <p className="yy-ob-device">{device}</p>
    </div>
  );
}

/** Keys drawn as keycaps, pressed while a dictation records. */
export function Keys({ keys, pressed = false }: { keys: string[]; pressed?: boolean }) {
  return (
    <span className="yy-ob-keys" data-pressed={pressed || undefined}>
      {keys.map((key, index) => (
        <span key={key} className="yy-ob-keys-group">
          {index > 0 && <span className="yy-ob-plus" aria-hidden="true">+</span>}
          <kbd>{key}</kbd>
        </span>
      ))}
    </span>
  );
}

/** Things to say that cleanup visibly changes, with what to look for. */
const TRY_EXAMPLES = [
  { say: 'Let’s meet on Tuesday, no wait, Wednesday at two, actually make it three.', change: 'Only “Wednesday at three” is kept.' },
  { say: 'Um, pick up some milk, oh never mind, and book the dentist for Monday.', change: 'The milk is dropped, and so is the “um”.' },
  { say: 'For the trip we need, uh, the tickets, the hotel and the car rental.', change: 'The filler goes and the list is tidied.' },
];

/** Try it: the shortcut, the real pill following the real dictation, and what it wrote. */
export function TryScene({ keys, status, levels, result }: { keys: string[]; status: HudState['status']; levels: number[]; result?: string }) {
  const recording = status === 'recording';
  const [example, setExample] = useState(0);
  const { say, change } = TRY_EXAMPLES[example];
  return (
    <div className="yy-ob-scene">
      <div className="yy-ob-keyboard"><Keys keys={keys} pressed={recording} /></div>
      <StagePill status={recording || status === 'processing' ? status : 'armed'} levels={levels} />
      {result
        ? <p className="yy-ob-big-text">{result}</p>
        : (
          <div className="yy-ob-suggest">
            <span>Try saying</span>
            <p key={example} className="yy-ob-big-text yy-ob-fade" data-empty>{say}</p>
            <small key={`c${example}`} className="yy-ob-fade">{change}</small>
            <button type="button" className="yy-ob-inline" onClick={() => setExample((n) => (n + 1) % TRY_EXAMPLES.length)}>Another example</button>
          </div>
        )}
    </div>
  );
}

/** How it writes: what you said, and what Yap Yap writes from it. */
export function WritingScene({ spoken, written }: { spoken: string; written: string }) {
  return (
    <div className="yy-ob-scene yy-ob-writing" aria-hidden="true">
      <div className="yy-ob-said">
        <span>You say</span>
        <p>{spoken}</p>
      </div>
      <div className="yy-ob-said" data-written>
        <span>Yap Yap writes</span>
        <p key={written} className="yy-ob-fade">{written}</p>
      </div>
    </div>
  );
}

/** Done: the three shortcuts to remember. */
export function DoneScene({ shortcuts }: { shortcuts: { label: string; keys: string[] }[] }) {
  return (
    <div className="yy-ob-scene" aria-hidden="true">
      <dl className="yy-ob-jobs">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.label} className="yy-ob-job">
            <dt>{shortcut.label}</dt>
            <dd><Keys keys={shortcut.keys} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
