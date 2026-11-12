let sharedCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedCtx) sharedCtx = new AudioCtx();
    if (sharedCtx.state === 'suspended') {
      void sharedCtx.resume();
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

export function playInteractionSound(type: 'start' | 'stop' | 'error', enabled = true): void {
  if (!enabled) return;
  const ctx = getAudioCtx();
  if (!ctx) return;

  const now = ctx.currentTime;

  const playTone = (freq: number, startOffset: number, duration: number, peakGain = 0.08) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + startOffset);
    gain.gain.setValueAtTime(0.0001, now + startOffset);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.02);
  };

  if (type === 'start') {
    playTone(587.33, 0, 0.09);
    playTone(880, 0.06, 0.12);
  } else if (type === 'stop') {
    playTone(880, 0, 0.08);
    playTone(659.25, 0.055, 0.12);
  } else {
    playTone(300, 0, 0.12, 0.07);
    playTone(220, 0.1, 0.18, 0.07);
  }
}
