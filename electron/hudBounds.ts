/** Just longer than the HUD pill's 0.2s animation, so a shrinking pill is never cut off. */
export const HUD_SHRINK_DELAY_MS = 220;

interface Size {
  width: number;
  height: number;
}

/** The HUD window grows at once, but shrinks only after the pill has finished animating. */
export function hudResizeDelay(current: Size, next: Size): number {
  return next.width >= current.width && next.height >= current.height ? 0 : HUD_SHRINK_DELAY_MS;
}
