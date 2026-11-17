/** Measures how long a recording ran, leaving out the time it was paused. */
export function createRecordingClock(now: () => number = Date.now) {
  const startedAt = now();
  let pausedAt: number | undefined;
  let pausedTotal = 0;
  return {
    get paused() {
      return pausedAt !== undefined;
    },
    pause() {
      if (pausedAt === undefined) pausedAt = now();
    },
    resume() {
      if (pausedAt === undefined) return;
      pausedTotal += now() - pausedAt;
      pausedAt = undefined;
    },
    elapsed() {
      return (pausedAt ?? now()) - startedAt - pausedTotal;
    },
  };
}
