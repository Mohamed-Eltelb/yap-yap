/**
 * On Windows the HUD window stays on screen, transparent, for as long as the app runs. After
 * hours of that its drawing surface can stop reaching the screen: the page keeps rendering, but
 * nothing shows, and moving, resizing or re-showing the window does not bring it back. A new
 * window always draws. So the HUD window is replaced, while nothing is showing, after events
 * that can break its surface (sleep, unlock, display changes, a GPU restart) and after every long
 * idle stretch, since the trigger is not always known.
 */

/** How long the HUD sits idle before its window is replaced anyway. */
export const HUD_IDLE_REFRESH_MS = 15 * 60_000;
/** Waits for a burst of display or power events to settle before replacing the window once. */
export const HUD_EVENT_REFRESH_DELAY_MS = 2000;

interface Options {
  /** Replaces the HUD window. Only called while `isIdle()`. */
  refresh(reason: string): void;
  /** Nothing is on the HUD and no pill is shrinking out. */
  isIdle(): boolean;
}

export class HudRefresher {
  private eventTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: string | undefined;

  constructor(private readonly options: Options) {}

  /** Something happened that can break the window's surface. */
  request(reason: string): void {
    clearTimeout(this.eventTimer);
    this.eventTimer = setTimeout(() => {
      this.eventTimer = undefined;
      this.fire(reason);
    }, HUD_EVENT_REFRESH_DELAY_MS);
  }

  /** The HUD emptied: replace the window now if that was waiting, and start the idle wait. */
  idle(): void {
    const reason = this.pending;
    if (reason) this.fire(reason);
    else this.restartIdleTimer();
  }

  /** The HUD is on screen, so this is not idle time. */
  busy(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  dispose(): void {
    clearTimeout(this.eventTimer);
    clearTimeout(this.idleTimer);
  }

  private fire(reason: string): void {
    if (!this.options.isIdle()) {
      this.pending = reason;
      return;
    }
    this.pending = undefined;
    this.options.refresh(reason);
    this.restartIdleTimer();
  }

  private restartIdleTimer(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.fire('idle');
    }, HUD_IDLE_REFRESH_MS);
  }
}
