/**
 * Recordings live as one file per dictation in the audio folder. Startup no longer reads
 * them: sending all of them at once froze the main process, and with it the HUD's
 * system-wide mouse hook, so the whole computer lagged until the app appeared.
 */

/** Marks each dictation whose recording is on disk, from one listing of the audio folder. */
export function markSavedAudio(history: Array<{ id?: unknown; audioDataUrl?: unknown; audioSaved?: boolean }>, files: Set<string>): void {
  for (const item of history) {
    if (typeof item.id === 'string' && !item.audioDataUrl && files.has(`${item.id}.txt`)) item.audioSaved = true;
  }
}

/** A dictation id that is safe to use as a file name in the audio folder. */
export function isAudioId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
}
