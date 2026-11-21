import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import loudness from 'loudness';

const run = promisify(execFile);
let restore: (() => Promise<void>) | undefined;
let pending = Promise.resolve();

async function muteOutput(): Promise<(() => Promise<void>) | undefined> {
  if (process.platform === 'linux') {
    const pactl = async (...args: string[]) => (await run('pactl', args, {
      timeout: 1500, env: { ...process.env, LC_ALL: 'C' },
    })).stdout.trim();
    let sink: string | undefined;
    try {
      sink = await pactl('get-default-sink');
    } catch {
      // ALSA-only desktops still use the existing mixer backend.
    }
    if (sink) {
      const state = await pactl('get-sink-mute', sink);
      if (state === 'Mute: yes') return;
      if (state !== 'Mute: no') throw new Error('Unknown output mute state');
      await pactl('set-sink-mute', sink, '1');
      return async () => { await pactl('set-sink-mute', sink, '0'); };
    }
  }
  if (await loudness.getMuted()) return;
  await loudness.setMuted(true);
  return () => loudness.setMuted(false);
}

export function setRecordingMute(muted: boolean): Promise<void> {
  const change = pending.then(async () => {
    if (muted && !restore) restore = await muteOutput();
    if (!muted && restore) {
      await restore();
      restore = undefined;
    }
  });
  pending = change.catch(() => {});
  return change;
}
