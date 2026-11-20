import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Mic, MicOff, X } from 'lucide-react';
import { startMicrophoneTest } from '../utils/audioRecorder';
import { barHeight, bars, loudness } from './DictationHud';
import { SettingsSubdialog } from './SettingsSubdialog';

export interface MicrophoneOption {
  id: string;
  label: string;
}

type TestState = 'starting' | 'listening' | 'heard' | 'quiet' | 'missing' | 'error';

/** Loudness the voice must reach to count as clear. */
const CLEAR_LOUDNESS = 0.5;
/** Frames above that loudness a window needs, so one loud blip doesn't count as clear speech. */
const CLEAR_FRAMES = 5;
/** Speaking without ever passing this, for a whole window, counts as too quiet. */
const QUIET_LOUDNESS = 0.35;
/** Frames (at 60 a second) in each window the quiet check judges. */
const WINDOW_FRAMES = 72;
/** Frames of sound a window needs before it can call the voice too quiet. */
const QUIET_VOICE_FRAMES = 12;
/** Loudness that moves the bars visibly: a voice, even a far or soft one. Room noise stays below. */
const SOUND_LOUDNESS = 0.12;

const silence = () => Array<number>(20).fill(0);

/** The system default's name, from the label Windows and Chrome give it ("Default - Name"). */
export function defaultMicrophoneName(microphones: MicrophoneOption[]): string | undefined {
  const label = microphones.find((mic) => mic.id === 'default')?.label;
  return label?.replace(/^Default\s*-\s*/i, '') || undefined;
}

/**
 * Whether the saved microphone is missing from the list. Only known once the system names
 * its devices (after microphone access), since until then every device id is hidden.
 */
export function isMicrophoneMissing(value: string, microphones: MicrophoneOption[], devicesKnown: boolean): boolean {
  return devicesKnown && value !== 'default' && !microphones.some((mic) => mic.id === value);
}

/** Lists the microphones and shows the chosen one live in the dictation pill, so the user can test it. */
export function MicrophoneDialog({ microphones, devicesKnown, value, strongNoiseReduction, onChange, onListening, onClose }: {
  microphones: MicrophoneOption[];
  /** The system has named its devices, so a saved microphone missing from the list is really gone. */
  devicesKnown: boolean;
  value: string;
  /** Tests through the same noise filter dictation uses. */
  strongNoiseReduction: boolean;
  onChange: (microphoneId: string) => void;
  /** Called once a microphone opens, when the system starts giving out device names. */
  onListening?: () => void;
  onClose: () => void;
}) {
  const [levels, setLevels] = useState(silence);
  const [state, setState] = useState<TestState>('starting');
  const list = useRef<HTMLDivElement>(null);
  const missing = isMicrophoneMissing(value, microphones, devicesKnown);
  const defaultName = defaultMicrophoneName(microphones);
  const options: (MicrophoneOption & { hint?: string; missing?: boolean })[] = [
    { id: 'default', label: 'Auto-detect', hint: defaultName ? `Using ${defaultName}` : 'Follows your system default' },
    ...microphones.filter((mic) => mic.id !== 'default' && mic.id !== 'communications'),
    ...(missing ? [{ id: value, label: 'Saved microphone', hint: 'Not connected. Dictation uses Auto-detect for now.', missing: true }] : []),
  ];

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    setLevels(silence());
    setState(missing ? 'missing' : 'starting');
    if (missing) return;

    let frames = 0;
    let voiceFrames = 0;
    let clearFrames = 0;
    let loudest = 0;
    startMicrophoneTest(value, (next) => {
      setLevels(next);
      const loud = loudness(next);
      if (loud > CLEAR_LOUDNESS && ++clearFrames === CLEAR_FRAMES) setState('heard');
      frames += 1;
      if (loud > SOUND_LOUDNESS) voiceFrames += 1;
      loudest = Math.max(loudest, loud);
      if (frames < WINDOW_FRAMES) return;
      // Judge each stretch on its own, so moving closer clears the warning. A silent
      // stretch keeps the last verdict instead of asking the user to speak again.
      if (voiceFrames >= QUIET_VOICE_FRAMES && loudest < QUIET_LOUDNESS) setState('quiet');
      frames = 0;
      voiceFrames = 0;
      clearFrames = 0;
      loudest = 0;
    }, { strongNoiseReduction })
      .then((close) => {
        if (cancelled) {
          close();
          return;
        }
        stop = close;
        onListening?.();
        setState((current) => (current === 'starting' ? 'listening' : current));
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
      stop?.();
    };
    // Reopen only when the microphone or the filter changes.
  }, [value, missing, strongNoiseReduction]);

  const loud = Math.min(1, Math.max(0, loudness(levels)));
  const status = {
    starting: 'Warming up the mic…',
    listening: 'Start yapping…',
    heard: 'Loud and clear!',
    quiet: 'A bit quiet. Move closer or turn up the input volume.',
    missing: 'This microphone isn’t connected. Plug it in, or pick another one.',
    error: 'Can’t hear a thing. Check the mic is plugged in and Yap Yap is allowed to use it.',
  }[state];
  const failed = state === 'error' || state === 'missing';

  // Arrow keys move through the list and choose, like any group of radio buttons.
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((mic) => mic.id === value);
    const next = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: options.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = (next + options.length) % options.length;
    onChange(options[target].id);
    list.current?.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus();
  };

  return (
    <SettingsSubdialog
      title="Microphone"
      description="Choose the microphone Yap Yap listens to. Speak to try it before you dictate."
      onClose={onClose}
    >
      <div className="yy-language-body yy-mic-body">
        <div className="yy-mic-stage" data-state={state}>
          <div className="yy-hud" data-mode="dictate" aria-hidden="true" inert>
            <div className="yy-hud-pill" data-state={failed ? 'armed' : 'recording'}>
              {failed
                ? <MicOff size={15} />
                : <>
                  <button type="button" className="yy-hud-cancel" tabIndex={-1}><X size={16} /></button>
                  <div className="yy-hud-wave">
                    {bars.map((_, index) => (
                      <span key={index} style={{ height: `${barHeight(levels, index, loud)}px` }} />
                    ))}
                  </div>
                  <div className="yy-hud-actions">
                    <button type="button" className="yy-hud-confirm" tabIndex={-1}><Check size={17} /></button>
                  </div>
                </>}
            </div>
          </div>
          <p className="yy-mic-status" role="status">{status}</p>
        </div>

        <div ref={list} className="yy-mic-list" role="radiogroup" aria-label="Microphones" onKeyDown={onListKeyDown}>
          {options.map((mic) => {
            const selected = mic.id === value;
            return (
              <button
                key={mic.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className="yy-mic-row"
                data-missing={mic.missing || undefined}
                onClick={() => onChange(mic.id)}
              >
                <span className="yy-mic-icon">{mic.missing ? <MicOff size={15} /> : <Mic size={15} />}</span>
                <span className="yy-mic-text">
                  <span className="yy-mic-label">{mic.label}</span>
                  {mic.hint && <span className="yy-mic-hint">{mic.hint}</span>}
                </span>
                {selected && <Check size={16} className="yy-mic-check" />}
              </button>
            );
          })}
        </div>
      </div>
    </SettingsSubdialog>
  );
}
