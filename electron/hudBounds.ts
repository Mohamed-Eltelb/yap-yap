/** Just longer than the HUD pill's 0.2s animation, so a pill shrinking out is never cut off. */
export const HUD_SHRINK_DELAY_MS = 220;

export interface Size {
  width: number;
  height: number;
}

/**
 * Compact HUD window size for pills, shortcut list, translate menu, notices, and errors.
 * Keeping one compact size across all non-answer states avoids resize flicker during recording.
 */
export const HUD_WINDOW_SIZE: Size = { width: 500, height: 260 };

/** Larger HUD window size used only while showing an Ask anything answer/rewrite card. */
export const HUD_ANSWER_WINDOW_SIZE: Size = { width: 760, height: 660 };

/** A visible interactive HUD region in window-relative DIP coordinates. */
export interface HudHitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether a HUD state shows the Ask anything answer/rewrite card. */
export function isAskAnswerHud(state?: { status?: string; mode?: string }): boolean {
  return state?.status === 'result' && state?.mode === 'ask';
}

/** The HUD window size, made to fit the work area. */
export function hudWindowSize(workArea: Size, isAnswer = false): Size {
  const target = isAnswer ? HUD_ANSWER_WINDOW_SIZE : HUD_WINDOW_SIZE;
  return {
    width: Math.min(target.width, workArea.width),
    height: Math.min(target.height, workArea.height - 12),
  };
}

/** Whether a screen-space cursor point lies inside any visible HUD hit rect. */
export function cursorOverHud(
  cursor: { x: number; y: number },
  windowBounds: Rect,
  rects: readonly HudHitRect[],
  padding = 2,
): boolean {
  if (rects.length === 0) return false;
  const localX = cursor.x - windowBounds.x;
  const localY = cursor.y - windowBounds.y;
  return rects.some(
    (rect) => rect.right > rect.left
      && rect.bottom > rect.top
      && localX >= rect.left - padding
      && localX <= rect.right + padding
      && localY >= rect.top - padding
      && localY <= rect.bottom + padding,
  );
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
