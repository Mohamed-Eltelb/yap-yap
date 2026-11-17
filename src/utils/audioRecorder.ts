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

let rnnoiseWasm: Promise<ArrayBuffer> | undefined;

/**
 * Runs the microphone through RNNoise, which removes noises the browser's own filter
 * misses (voices, traffic, dogs). Returns undefined when it can't load, so the caller
 * records the plain microphone instead.
 */
async function rnnoiseStream(audioCtx: AudioContext, source: MediaStreamAudioSourceNode) {
  try {
    const { loadRnnoise, RnnoiseWorkletNode } = await import('@sapphi-red/web-noise-suppressor');
    // Inlined, because the packaged app loads from file://, where fetch can't read files.
    const [{ default: workletSource }, { default: wasmUrl }, { default: simdUrl }] = await Promise.all([
      import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?raw'),
      import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url&inline'),
      import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url&inline'),
    ]);
    rnnoiseWasm ??= loadRnnoise({ url: wasmUrl, simdUrl });
    const wasmBinary = await rnnoiseWasm;
    const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    try {
      await audioCtx.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
    const rnnoise = new RnnoiseWorkletNode(audioCtx, { wasmBinary, maxChannels: 1 });
    // RNNoise cleans only its first channel. Most microphones deliver two, which left the
    // second one silent: recordings played in the left ear only. Mixing the microphone
    // down to one channel first gives a mono recording that plays in both ears.
    rnnoise.channelCount = 1;
    rnnoise.channelCountMode = 'explicit';
    const output = audioCtx.createMediaStreamDestination();
    output.channelCount = 1;
    source.connect(rnnoise);
    rnnoise.connect(output);
    return { node: rnnoise as AudioNode, stream: output.stream };
  } catch (error) {
    rnnoiseWasm = undefined;
    console.warn('Strong noise reduction is unavailable; recording without it', error);
    return undefined;
  }
}

export async function startAudioRecording(
  deviceId: string | undefined,
  onLevels: (levels: number[]) => void,
  { strongNoiseReduction = false }: { strongNoiseReduction?: boolean } = {},
): Promise<RecorderSession> {
  const defaultAudioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    // RNNoise replaces the browser's filter; running both muffles the voice.
    noiseSuppression: !strongNoiseReduction,
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


  // Analyser for live waveform bars
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  // RNNoise works on 48 kHz audio.
  const audioCtx = strongNoiseReduction ? new AudioCtx({ sampleRate: 48000 }) : new AudioCtx();
  const source = audioCtx.createMediaStreamSource(stream);
  const filtered = strongNoiseReduction ? await rnnoiseStream(audioCtx, source) : undefined;
  const analyser = audioCtx.createAnalyser();
  // 256 points give ~190 Hz bins, so the bars can follow the voice range (up to ~4 kHz)
  // instead of mostly showing quiet high frequencies.
  analyser.fftSize = 256;
  // Little smoothing so the bars react at once, like a live meter.
  analyser.smoothingTimeConstant = 0.35;
  analyser.minDecibels = -85;
  analyser.maxDecibels = -25;
  (filtered?.node ?? source).connect(analyser);

  const recorded = filtered?.stream ?? stream;
  const recorder = mimeType
    ? new MediaRecorder(recorded, { mimeType })
    : new MediaRecorder(recorded);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const waveform = new Uint8Array(analyser.fftSize);
  let frames = 0;
  let loudFrames = 0;
  let timerId: ReturnType<typeof setInterval> | undefined;
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
    // Bins 1–20 cover roughly 190 Hz to 3.9 kHz, where speech carries its energy.
    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i + 1] ?? 0;
      levels.push(Math.min(1, Math.max(0.08, (val / 255) * 1.3)));
    }
    onLevels(levels);
  };

  const startTime = Date.now();
  recorder.start(100);
  // A timer, not requestAnimationFrame: animation frames nearly stop while the main
  // window is minimized or covered, and the HUD meter then crawls at about 1 FPS.
  timerId = setInterval(tick, 1000 / 60);

  const cleanup = () => {
    stopped = true;
    clearInterval(timerId);
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
