import { useEffect, useState } from 'react';
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

const WELCOME_TEXT = 'Running about ten minutes late. Start without me.';

/** Welcome: the pill listens, thinks, and the sentence is written out. Plays in a slow loop. */
export function WelcomeScene() {
  const still = reducedMotion();
  const [phase, setPhase] = useState<'armed' | 'recording' | 'processing' | 'typed'>(still ? 'typed' : 'armed');
  const [shown, setShown] = useState(still ? WELCOME_TEXT.length : 0);
  const [round, setRound] = useState(0);
  const levels = useFakeLevels(phase === 'recording');
  useEffect(() => {
    if (still) return;
    const timers = [
      window.setTimeout(() => { setShown(0); setPhase('armed'); }, 0),
      window.setTimeout(() => setPhase('recording'), 900),
      window.setTimeout(() => setPhase('processing'), 3600),
      window.setTimeout(() => setPhase('typed'), 4600),
      window.setTimeout(() => setRound((n) => n + 1), 10000),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [still, round]);
  useEffect(() => {
    if (phase !== 'typed' || shown >= WELCOME_TEXT.length) return;
    const id = window.setTimeout(() => setShown((n) => Math.min(WELCOME_TEXT.length, n + 2)), 30);
    return () => window.clearTimeout(id);
  }, [phase, shown]);
  return (
    <div className="yy-ob-scene" aria-hidden="true">
      <p className="yy-ob-big-text" data-empty={shown === 0 || undefined}>
        {WELCOME_TEXT.slice(0, shown)}<i className="yy-ob-caret" />
      </p>
      <StagePill status={phase === 'typed' ? 'armed' : phase} levels={levels} />
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

/** Try it: the shortcut, the real pill following the real dictation, and what it wrote. */
export function TryScene({ keys, status, levels, result }: { keys: string[]; status: HudState['status']; levels: number[]; result?: string }) {
  const recording = status === 'recording';
  return (
    <div className="yy-ob-scene">
      <div className="yy-ob-keyboard"><Keys keys={keys} pressed={recording} /></div>
      <StagePill status={recording || status === 'processing' ? status : 'armed'} levels={levels} />
      <p className="yy-ob-big-text" data-empty={!result || undefined}>{result ?? 'Your words appear here.'}</p>
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
