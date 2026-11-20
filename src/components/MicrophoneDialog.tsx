import { useEffect, useState } from 'react';
import { SettingsSubdialog } from './SettingsSubdialog';

export interface MicrophoneOption {
  id: string;
  label: string;
}

const METER_BARS = 24;

/** Lists the microphones and shows a live level for the chosen one, so the user can test it. */
export function MicrophoneDialog({ microphones, value, onChange, onListening, onClose }: {
  microphones: MicrophoneOption[];
  value: string;
  onChange: (microphoneId: string) => void;
  /** Called once a microphone opens, when the system starts giving out device names. */
  onListening?: () => void;
  onClose: () => void;
}) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState(false);
  const options: MicrophoneOption[] = [
    { id: 'default', label: 'Auto-detect (System Default)' },
    ...microphones.filter((mic) => mic.id !== 'default'),
  ];

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    setLevel(0);
    setError(null);
    setHeard(false);

    const constraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
    const open = (deviceId?: string) => navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { ...constraints, deviceId: { exact: deviceId } } : constraints,
    });

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
        const opened = await open(value === 'default' ? undefined : value);
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        onListening?.();
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let smoothed = 0;
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          const rms = Math.sqrt(sum / samples.length);
          // Speech sits around 0.02–0.2 RMS; a square root spreads it across the meter.
          const target = Math.min(1, Math.sqrt(rms / 0.25));
          smoothed = target > smoothed ? target : smoothed * 0.85 + target * 0.15;
          setLevel(smoothed);
          if (smoothed > 0.25) setHeard(true);
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!cancelled) setError('Could not open this microphone. Check that it is plugged in and that Yap Yap may use it.');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, [value]);

  const lit = Math.round(level * METER_BARS);

  return (
    <SettingsSubdialog
      title="Microphone"
      description="Choose the microphone Yap Yap listens to. Speak to test it: the bars move when it hears you."
      onClose={onClose}
    >
      <div className="yy-language-body yy-mic-body">
        <div className="yy-mic-list" role="radiogroup" aria-label="Microphones">
          {options.map((mic) => (
            <label className="yy-mic-row" key={mic.id}>
              <input
                type="radio"
                name="microphone"
                checked={mic.id === value}
                onChange={() => onChange(mic.id)}
              />
              <span className="yy-mic-label">{mic.label}</span>
            </label>
          ))}
        </div>
        <div className="yy-mic-test">
          <div
            className="yy-mic-meter"
            role="meter"
            aria-label="Microphone level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
          >
            {Array.from({ length: METER_BARS }, (_, i) => (
              <span key={i} data-lit={i < lit || undefined} />
            ))}
          </div>
          <p className="yy-mic-status" aria-live="polite" data-error={error ? true : undefined}>
            {error ?? (heard ? 'Working — Yap Yap can hear you.' : 'Say something to test this microphone…')}
          </p>
        </div>
      </div>
    </SettingsSubdialog>
  );
}
