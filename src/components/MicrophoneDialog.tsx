import { useEffect, useState } from 'react';
import { Check, Mic, X } from 'lucide-react';
import { barHeight, bars, loudness } from './DictationHud';
import { SettingsSubdialog } from './SettingsSubdialog';

export interface MicrophoneOption {
  id: string;
  label: string;
}

type TestState = 'starting' | 'listening' | 'heard' | 'error';

const silence = () => Array<number>(20).fill(0);

/** Lists the microphones and shows the chosen one live in the dictation pill, so the user can test it. */
export function MicrophoneDialog({ microphones, value, onChange, onListening, onClose }: {
  microphones: MicrophoneOption[];
  value: string;
  onChange: (microphoneId: string) => void;
  /** Called once a microphone opens, when the system starts giving out device names. */
  onListening?: () => void;
  onClose: () => void;
}) {
  const [levels, setLevels] = useState(silence);
  const [state, setState] = useState<TestState>('starting');
  const options: (MicrophoneOption & { hint?: string })[] = [
    { id: 'default', label: 'Auto-detect', hint: 'Follows your system default' },
    ...microphones.filter((mic) => mic.id !== 'default' && mic.id !== 'communications'),
  ];

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    setLevels(silence());
    setState('starting');

    const constraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
        const opened = await navigator.mediaDevices.getUserMedia({
          audio: value === 'default' ? constraints : { ...constraints, deviceId: { exact: value } },
        });
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        onListening?.();
        setState('listening');
        // The same analysis the recorder runs, so the bars move exactly as they will while dictating.
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.35;
        analyser.minDecibels = -72;
        analyser.maxDecibels = -25;
        context.createMediaStreamSource(stream).connect(analyser);
        const bins = new Uint8Array(analyser.frequencyBinCount);
        let heard = false;
        timer = setInterval(() => {
          analyser.getByteFrequencyData(bins);
          const next = Array.from({ length: 20 }, (_, i) => Math.min(1, ((bins[i + 1] ?? 0) / 255) * 1.3));
          setLevels(next);
          if (!heard && loudness(next) > 0.45) {
            heard = true;
            setState('heard');
          }
        }, 1000 / 60);
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
    // Reopen only when the chosen microphone changes.
  }, [value]);

  const loud = Math.min(1, Math.max(0, loudness(levels)));
  const status = {
    starting: 'Opening the microphone…',
    listening: 'Say something. The bars move when it hears you.',
    heard: 'Yap Yap hears this microphone.',
    error: 'This microphone didn’t open. Check that it’s plugged in and Yap Yap is allowed to use it.',
  }[state];

  return (
    <SettingsSubdialog
      title="Microphone"
      description="Choose the microphone Yap Yap listens to. Speak to try it before you dictate."
      onClose={onClose}
    >
      <div className="yy-language-body yy-mic-body">
        <div className="yy-mic-stage" data-state={state}>
          <div className="yy-hud" data-mode="dictate" aria-hidden="true" inert>
            <div className="yy-hud-pill" data-state={state === 'error' ? 'armed' : 'recording'}>
              <button type="button" className="yy-hud-cancel" tabIndex={-1}><X size={16} /></button>
              <div className="yy-hud-wave">
                {bars.map((_, index) => (
                  <span key={index} style={{ height: `${barHeight(levels, index, loud)}px` }} />
                ))}
              </div>
              <div className="yy-hud-actions">
                <button type="button" className="yy-hud-confirm" tabIndex={-1}><Check size={17} /></button>
              </div>
            </div>
          </div>
          <p className="yy-mic-status" role="status">{status}</p>
        </div>

        <div className="yy-mic-list" role="radiogroup" aria-label="Microphones">
          {options.map((mic) => {
            const selected = mic.id === value;
            return (
              <button
                key={mic.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className="yy-mic-row"
                onClick={() => onChange(mic.id)}
              >
                <span className="yy-mic-icon"><Mic size={15} /></span>
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
