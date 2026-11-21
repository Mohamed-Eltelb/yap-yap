import { useEffect, useState, type ReactNode } from 'react';
import { Check, Laptop, Mic } from 'lucide-react';
import type { ProviderId } from '../types/app';
import { DictationHud, type HudState } from './DictationHud';
import { ProviderLogo } from './ProviderIcon';
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

/** A small chat app, where dictated text lands. */
export function ChatWindow({ app = 'Messages', draft, typing, caret = true }: { app?: string; draft?: ReactNode; typing?: boolean; caret?: boolean }) {
  return (
    <div className="yy-ob-window" aria-hidden="true">
      <div className="yy-ob-window-bar">
        <span /><span /><span />
        <strong>{app}</strong>
      </div>
      <div className="yy-ob-thread">
        <p className="yy-ob-bubble">Are you still coming tonight?</p>
        <p className="yy-ob-bubble">We're at the place on Main Street</p>
      </div>
      <div className="yy-ob-compose" data-typing={typing || undefined}>
        <span>{draft}</span>
        {caret && <i className="yy-ob-caret" />}
      </div>
    </div>
  );
}

const WELCOME_TEXT = 'Yes! Running about ten minutes late. Start without me.';

/** Welcome: the pill listens, thinks, and the words land in the chat. Plays in a slow loop. */
export function WelcomeScene() {
  const still = reducedMotion();
  const [phase, setPhase] = useState<'idle' | 'recording' | 'processing' | 'typed'>(still ? 'typed' : 'idle');
  const [shown, setShown] = useState(still ? WELCOME_TEXT.length : 0);
  const [round, setRound] = useState(0);
  const levels = useFakeLevels(phase === 'recording');
  useEffect(() => {
    if (still) return;
    const timers = [
      window.setTimeout(() => { setShown(0); setPhase('idle'); }, 0),
      window.setTimeout(() => setPhase('recording'), 700),
      window.setTimeout(() => setPhase('processing'), 3300),
      window.setTimeout(() => setPhase('typed'), 4300),
      window.setTimeout(() => setRound((n) => n + 1), 9500),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [still, round]);
  useEffect(() => {
    if (phase !== 'typed' || shown >= WELCOME_TEXT.length) return;
    const id = window.setTimeout(() => setShown((n) => Math.min(WELCOME_TEXT.length, n + 3)), 28);
    return () => window.clearTimeout(id);
  }, [phase, shown]);
  return (
    <div className="yy-ob-scene">
      <ChatWindow draft={WELCOME_TEXT.slice(0, shown)} typing={phase === 'typed'} />
      <StagePill status={phase === 'typed' ? 'idle' : phase === 'idle' ? 'armed' : phase} levels={levels} />
    </div>
  );
}

/** Connect: your voice goes from this computer straight to the provider you pick. */
export function ConnectScene({ provider, connected }: { provider: ProviderId; connected: boolean }) {
  return (
    <div className="yy-ob-scene">
      <div className="yy-ob-route" data-connected={connected || undefined} aria-hidden="true">
        <div className="yy-ob-node">
          <span className="yy-ob-node-icon"><Mic size={22} /></span>
          <strong>Your voice</strong>
        </div>
        <span className="yy-ob-line"><i /></span>
        <div className="yy-ob-node">
          <span className="yy-ob-node-icon"><Laptop size={22} /></span>
          <strong>Yap Yap</strong>
          <small>On this computer</small>
        </div>
        <span className="yy-ob-line"><i /></span>
        <div className="yy-ob-node">
          <span className="yy-ob-node-icon" data-provider>
            <ProviderLogo id={provider} size={26} />
            {connected && <span className="yy-ob-node-check"><Check size={12} strokeWidth={3} /></span>}
          </span>
          <strong>{provider === 'custom' ? 'Your provider' : PROVIDER_NAMES[provider] ?? provider}</strong>
          <small>Your key</small>
        </div>
      </div>
      <p className="yy-ob-caption">No Yap Yap servers in between. Your key stays on this device.</p>
    </div>
  );
}

const PROVIDER_NAMES: Partial<Record<ProviderId, string>> = {
  groq: 'Groq', openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Claude', deepgram: 'Deepgram', elevenlabs: 'ElevenLabs',
};

/** Microphone: the pill, large, following the voice. */
export function MicrophoneScene({ levels, live }: { levels: number[]; live: boolean }) {
  return (
    <div className="yy-ob-scene">
      <div className="yy-ob-pill-large">
        <StagePill status={live ? 'recording' : 'armed'} levels={levels} />
      </div>
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

/** Try it: the real pill follows the real dictation, and the result lands in the chat. */
export function TryScene({ keys, status, levels, result }: { keys: string[]; status: HudState['status']; levels: number[]; result?: string }) {
  const recording = status === 'recording';
  return (
    <div className="yy-ob-scene">
      <ChatWindow draft={result} caret={!result} />
      <StagePill status={recording || status === 'processing' ? status : 'armed'} levels={levels} />
      <div className="yy-ob-keyboard">
        <Keys keys={keys} pressed={recording} />
      </div>
    </div>
  );
}

/** How it writes: one spoken sentence, written the way the chosen level and style would. */
export function WritingScene({ spoken, written }: { spoken: string; written: string }) {
  return (
    <div className="yy-ob-scene yy-ob-writing">
      <div className="yy-ob-said">
        <span className="yy-ob-said-label"><Mic size={13} aria-hidden="true" /> You say</span>
        <p>“{spoken}”</p>
      </div>
      <ChatWindow draft={<span key={written} className="yy-ob-fade">{written}</span>} caret={false} />
    </div>
  );
}

/** Done: the three shortcuts to remember. */
export function DoneScene({ shortcuts }: { shortcuts: { label: string; keys: string[] }[] }) {
  return (
    <div className="yy-ob-scene">
      <div className="yy-ob-cheats">
        <span className="yy-ob-done-mark" aria-hidden="true"><YapLogo className="w-9 h-9" /></span>
        {shortcuts.map((shortcut) => (
          <div key={shortcut.label} className="yy-ob-cheat">
            <span>{shortcut.label}</span>
            <Keys keys={shortcut.keys} />
          </div>
        ))}
      </div>
    </div>
  );
}
