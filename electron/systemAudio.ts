import loudness from 'loudness';

let restoreMute = false;
let pending = Promise.resolve();

export function setRecordingMute(muted: boolean): Promise<void> {
  const change = pending.then(async () => {
    if (muted && !restoreMute && !(await loudness.getMuted())) {
      await loudness.setMuted(true);
      restoreMute = true;
    } else if (!muted && restoreMute) {
      await loudness.setMuted(false);
      restoreMute = false;
    }
  });
  pending = change.catch(() => {});
  return change;
}
