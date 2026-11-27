export interface HudHitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The HUD window lets the mouse through to the app below, except while the pointer is over
 * the HUD itself. This tells Electron when to switch, only when it changes.
 */
export function createHudMouseGate(send: (ignore: boolean) => void) {
  let ignoring = true;
  const set = (ignore: boolean) => {
    if (ignore === ignoring) return;
    ignoring = ignore;
    send(ignore);
  };
  return {
    move: (overHud: boolean) => set(!overHud),
    leave: () => set(true),
    /** The HUD was shown again and Electron lets the mouse through, whatever was asked before. */
    reset: () => {
      ignoring = true;
    },
  };
}

/**
 * Deduplicates window-relative HUD bounding rects before sending them to Electron so main-process
 * cursor hit-testing always knows the exact clickable area without spamming IPC.
 */
export function createHudHitRectReporter(send: (rects: HudHitRect[]) => void) {
  let lastKey: string | undefined;
  return {
    update: (raw: readonly HudHitRect[]) => {
      const normalized: HudHitRect[] = [];
      for (const r of raw) {
        const left = Math.round(r.left);
        const top = Math.round(r.top);
        const right = Math.round(r.right);
        const bottom = Math.round(r.bottom);
        if (right > left && bottom > top) {
          normalized.push({ left, top, right, bottom });
        }
      }
      const key = normalized.map((r) => `${r.left},${r.top},${r.right},${r.bottom}`).join(';');
      if (key === lastKey) return;
      lastKey = key;
      send(normalized);
    },
    reset: () => {
      lastKey = undefined;
    },
  };
}
