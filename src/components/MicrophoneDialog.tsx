import { useEffect, useState } from 'react';
import { Check, Mic, MicOff } from 'lucide-react';
import { SettingsSubdialog } from './SettingsSubdialog';

export interface MicrophoneOption {
  id: string;
  label: string;
}

const WAVE_BARS = 34;
const SAMPLE_MS = 45;
const silentWave = () => Array<number>(WAVE_BARS).fill(0);

type TestState = 'starting' | 'listening' | 'heard' | 'error';

/** Lists the microphones and draws the chosen one's voice live, so the user can test it. */
export function MicrophoneDialog({ microphones, value, onChange, onListening, onClose }: {
  microphones: MicrophoneOption[];
  value: string;
  onChange: (microphoneId: string) => void;
  /** Called once a microphone opens, when the system starts giving out device names. */
  onListening?: () => void;
  onClose: () => void;
}) {
  const [wave, setWave] = useState(silentWave);
  const [state, setState] = useState<TestState>('starting');
  const options: (MicrophoneOption & { hint?: string })[] = [
    { id: 'default', label: 'Auto-detect', hint: 'Follows your system default' },
    ...microphones.filter((mic) => mic.id !== 'default' && mic.id !== 'communications'),
  ];

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    setWave(silentWave());
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
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let peak = 0;
        let last = performance.now();
        let heard = false;
        const tick = (now: number) => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          // Speech sits around 0.02–0.2 RMS; a square root spreads it across the bar height.
          peak = Math.max(peak, Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length) / 0.22)));
          if (now - last >= SAMPLE_MS) {
            const level = peak < 0.12 ? 0 : peak;
            setWave((bars) => [...bars.slice(1), level]);
            if (!heard && level > 0.3) {
              heard = true;
              setState('heard');
            }
            peak = 0;
            last = now;
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
    // Reopen only when the chosen microphone changes.
  }, [value]);

  const status = {
    starting: 'Opening microphone…',
    listening: 'Say something to test it',
    heard: 'Sounds good — Yap Yap can hear you',
    error: 'Can’t open this microphone. Check that it’s plugged in and allowed.',
  }[state];

  return (
    <SettingsSubdialog
      title="Microphone"
      description="Choose the microphone Yap Yap listens to, then speak to check it picks up your voice."
      onClose={onClose}
    >
      <div className="yy-language-body yy-mic-body">
        <div className="yy-mic-stage" data-state={state}>
          <div className="yy-mic-pill" aria-hidden="true">
            {state === 'error'
              ? <MicOff size={16} />
              : wave.map((level, i) => (
                <span key={i} style={{ height: `${Math.max(3, Math.round(level * 26))}px` }} />
              ))}
          </div>
          <p className="yy-mic-status" role="status">
            <span className="yy-mic-dot" />
            {status}
          </p>
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
