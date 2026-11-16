export interface RecorderSession {
  stop: () => Promise<{
    blob: Blob;
    durationMs: number;
    dataUrl: string;
    mimeType: string;
    /** False when the microphone never picked up a voice; undefined when it could not tell. */
    heardSpeech?: boolean;
  }>;
  cancel: () => void;
}

// A frame counts as voice when the waveform swings this far from silence (0–128).
const VOICE_PEAK = 8;
// Background windows can pause the level meter, so it only judges after enough frames.
const FRAMES_TO_JUDGE = 30;

/** Whether a recording held a voice, from how many sampled frames were loud. */
export function heardSpeech(loudFrames: number, frames: number): boolean | undefined {
  if (loudFrames >= 3) return true;
  return frames < FRAMES_TO_JUDGE ? undefined : false;
}

export async function startAudioRecording(
  deviceId: string | undefined,
  onLevels: (levels: number[]) => void
): Promise<RecorderSession> {
  const defaultAudioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
  };

  let stream: MediaStream;
  if (deviceId && deviceId !== 'default') {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...defaultAudioConstraints, deviceId: { exact: deviceId } },
      });
    } catch {
      // Fallback to default device if stored device was unplugged
      stream = await navigator.mediaDevices.getUserMedia({
        audio: defaultAudioConstraints,
      });
    }
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: defaultAudioConstraints,
    });
  }

  const preferredMimes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  const mimeType = preferredMimes.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // Analyser for live waveform bars
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 64;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const waveform = new Uint8Array(analyser.fftSize);
  let frames = 0;
  let loudFrames = 0;
  let rafId = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getByteFrequencyData(dataArray);
    analyser.getByteTimeDomainData(waveform);
    let peak = 0;
    for (const sample of waveform) peak = Math.max(peak, Math.abs(sample - 128));
    frames += 1;
    if (peak >= VOICE_PEAK) loudFrames += 1;
    const barCount = 20;
    const levels: number[] = [];
    const step = Math.max(1, Math.floor(dataArray.length / barCount));
    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i * step] ?? 0;
      levels.push(Math.min(1, Math.max(0.08, val / 200)));
    }
    onLevels(levels);
    rafId = requestAnimationFrame(tick);
  };

  const startTime = Date.now();
  recorder.start(100);
  rafId = requestAnimationFrame(tick);

  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(rafId);
    stream.getTracks().forEach((t) => t.stop());
    void audioCtx.close().catch(() => {});
  };

  return {
    stop: () =>
      new Promise((resolve, reject) => {
        const finish = async () => {
          cleanup();
          const durationMs = Math.max(400, Date.now() - startTime);
          const actualMime = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: actualMime });
          try {
            const dataUrl = await blobToDataUrl(blob);
            resolve({ blob, durationMs, dataUrl, mimeType: actualMime, heardSpeech: heardSpeech(loudFrames, frames) });
          } catch (err) {
            reject(err);
          }
        };
        recorder.onerror = () => {
          cleanup();
          reject(new Error('Audio recording failed'));
        };
        recorder.onstop = finish;
        // A recorder that already stopped on its own (the microphone went away) never fires
        // onstop again, so hand back what was captured instead of waiting forever.
        if (recorder.state !== 'inactive') recorder.stop();
        else void finish();
      }),
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // ignore
      }
      cleanup();
    },
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
