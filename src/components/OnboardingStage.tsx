import { Fragment, useEffect, useState, type CSSProperties } from 'react';
import { MicOff } from 'lucide-react';
import type { ProviderId } from '../types/app';
import { DictationHud, type HudState } from './DictationHud';
import { ProviderLogo } from './ProviderIcon';
import { SelectMenu } from './SelectMenu';
import { YapLogo } from './YapLogo';

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

interface JobOption { id: ProviderId; name: string; model: string }
interface Job { title: string; detail: string; options: JobOption[]; value?: ProviderId; onChange: (id: ProviderId) => void }

/** Connect: pick which connected provider does each job. One compact card per job, however many are connected. */
export function ConnectScene({ jobs }: { jobs: Job[] }) {
  const card = (job: Job) => {
    const chosen = job.options.find((option) => option.id === job.value);
    return (
      <section key={job.title} className="yy-ob-choose">
        <div className="yy-ob-choose-head">
          <h3>{job.title}</h3>
          <small>{job.detail}</small>
        </div>
        {job.options.length ? (
          <>
            <SelectMenu
              label={`${job.title} provider`}
              value={job.value ?? job.options[0].id}
              options={job.options.map((option) => ({ value: option.id, label: option.name, icon: <ProviderLogo id={option.id} size={18} /> }))}
              onChange={job.onChange}
            />
            {chosen && <span className="yy-ob-choose-model">Model: {chosen.model}</span>}
          </>
        ) : (
          <p className="yy-ob-choose-empty">Connect a provider that can do this.</p>
        )}
      </section>
    );
  };
  return (
    <div className="yy-ob-scene yy-ob-chooser">
      {card(jobs[0])}
      {/* Yap Yap sits between the two: it gets the text from one provider and sends it to the other. */}
      <div className="yy-ob-hub" aria-hidden="true">
        <span className="yy-ob-hub-line"><i /></span>
        <span className="yy-ob-hub-node"><YapLogo className="w-6 h-6" /></span>
        <small>Yap Yap, on this computer</small>
        <span className="yy-ob-hub-line"><i /></span>
      </div>
      {card(jobs[1])}
      <p className="yy-ob-note">Your audio goes from this computer straight to these providers. Your keys stay on this device.</p>
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

/** Something to say that cleanup visibly changes: only “Wednesday at three” is kept. */
const TRY_EXAMPLE = 'Let’s meet on Tuesday, no wait, Wednesday at two, actually make it three.';

/** Try it: the shortcut, the real pill following the real dictation, and what it wrote. */
export function TryScene({ keys, status, levels, result }: { keys: string[]; status: HudState['status']; levels: number[]; result?: string }) {
  const recording = status === 'recording';
  return (
    <div className="yy-ob-scene">
      <div className="yy-ob-keyboard"><Keys keys={keys} pressed={recording} /></div>
      <StagePill status={recording || status === 'processing' ? status : 'armed'} levels={levels} />
      {result
        ? <p className="yy-ob-big-text">{result}</p>
        : (
          <div className="yy-ob-suggest">
            <span>Try saying</span>
            <p className="yy-ob-big-text" data-empty><i className="yy-ob-caret" />{TRY_EXAMPLE}</p>
          </div>
        )}
    </div>
  );
}

/** How it writes: what you said, with what cleanup removes struck out, and what Yap Yap writes. */
export function WritingScene({ spoken, written, choice }: { spoken: { word: string; struck: boolean }[]; written: string; choice: string }) {
  return (
    <div className="yy-ob-scene yy-ob-writing" aria-hidden="true">
      <div className="yy-ob-said">
        <span>You say</span>
        <p>
          {spoken.map(({ word, struck }, i) => (
            <Fragment key={i}>
              {i > 0 && ' '}
              <span className="yy-ob-said-word" data-struck={struck || undefined}>{word}</span>
            </Fragment>
          ))}
        </p>
      </div>
      <div className="yy-ob-said" data-written>
        <span className="yy-ob-said-head">Yap Yap writes <em key={choice} className="yy-ob-fade">{choice}</em></span>
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
