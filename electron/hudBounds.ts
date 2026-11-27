/** Just longer than the HUD pill's 0.2s animation, so a pill shrinking out is never cut off. */
export const HUD_SHRINK_DELAY_MS = 220;

export interface Size {
  width: number;
  height: number;
}

/**
 * The HUD window keeps one size for every screen, the size of the largest (an Ask answer).
 * Resizing a transparent window while it is on screen makes Windows flash the old frame,
 * so it is never resized there; the empty part lets clicks through to the app below.
 */
export const HUD_WINDOW_SIZE: Size = { width: 760, height: 660 };

/** The HUD window size, made to fit the work area. */
export function hudWindowSize(workArea: Size): Size {
  return {
    width: Math.min(HUD_WINDOW_SIZE.width, workArea.width),
    height: Math.min(HUD_WINDOW_SIZE.height, workArea.height - 12),
  };
}

/** Only a pill shrinks out when the HUD closes; other screens go at once. */
export function hudHideDelay(lastStatus: string | undefined): number {
  return lastStatus === 'armed' || lastStatus === 'recording' || lastStatus === 'processing' ? HUD_SHRINK_DELAY_MS : 0;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/**
 * Places the HUD window at the bottom center of the work area and remembers what it set.
 * At display scaling like 125%, Windows rounds some sizes and reports them back 1px off,
 * so comparing with the window's own bounds would move it again on every level update
 * and make it shake. Comparing with what was last set does not.
 */
export class HudPlacer {
  private applied: Rect | undefined;

  /** The size last set, if any. */
  get size(): Size | undefined {
    return this.applied && { width: this.applied.width, height: this.applied.height };
  }

  /** The bounds to set for this size, or nothing when they are already set. */
  place(workArea: Rect, size: Size): Rect | undefined {
    const next = {
      x: workArea.x + Math.round((workArea.width - size.width) / 2),
      y: workArea.y + workArea.height - size.height - 4,
      width: size.width,
      height: size.height,
    };
    const last = this.applied;
    if (last && last.x === next.x && last.y === next.y && last.width === next.width && last.height === next.height) {
      return undefined;
    }
    this.applied = next;
    return next;
  }

  /** The window was hidden or replaced, so its bounds are no longer known. */
  forget(): void {
    this.applied = undefined;
  }
}
