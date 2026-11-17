/** Just longer than the HUD pill's 0.2s animation, so a shrinking pill is never cut off. */
export const HUD_SHRINK_DELAY_MS = 220;

export interface Size {
  width: number;
  height: number;
}

/** The HUD window grows at once, but shrinks only after the pill has finished animating. */
export function hudResizeDelay(current: Size, next: Size): number {
  return next.width >= current.width && next.height >= current.height ? 0 : HUD_SHRINK_DELAY_MS;
}

export interface HudResizePlan {
  /** A shrink to this same size is already waiting: leave it running. */
  keepPending: boolean;
  /** The size to set right away. */
  now?: Size;
  /** The size to set once the pill has animated. */
  later?: Size;
}

/**
 * How to move the HUD window from its current size to the target. Audio levels resend
 * the same state many times a second, so a shrink already waiting for that size is kept
 * instead of being restarted, or it would never happen.
 */
export function planHudResize(current: Size, target: Size, pending: Size | undefined): HudResizePlan {
  if (pending && pending.width === target.width && pending.height === target.height) return { keepPending: true };
  if (hudResizeDelay(current, target) === 0) return { keepPending: false, now: target, later: undefined };
  return {
    keepPending: false,
    now: { width: Math.max(current.width, target.width), height: Math.max(current.height, target.height) },
    later: target,
  };
}

/** Only a pill shrinks out when the HUD closes; other screens go at once. */
export function hudHideDelay(lastStatus: string | undefined): number {
  return lastStatus === 'armed' || lastStatus === 'recording' || lastStatus === 'processing' ? HUD_SHRINK_DELAY_MS : 0;
}
