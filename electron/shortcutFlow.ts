export type AppStatus = 'idle' | 'recording' | 'processing';
export type FlowOutput =
  | { type: 'armed' } | { type: 'list' } | { type: 'closed' }
  | { type: 'busy' } | { type: 'stop' } | { type: 'start'; binding: number };

type State = 'idle' | 'armed' | 'list' | 'ignoring';

/**
 * Decides what a hook shortcut press means: a press shows a placeholder, the
 * release starts the shortcut held, and a long hold shows the shortcut list
 * instead. While recording a press stops at once; while processing it only
 * tells the user to wait.
 */
export class ShortcutFlow {
  private state: State = 'idle';
  private match: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: {
    holdMs: number;
    appStatus: () => AppStatus;
    emit: (out: FlowOutput) => void;
  }) {}

  /** Called for the first press of a key only, never for its repeats. */
  keyDown(starts: boolean, match: number | undefined): void {
    if (this.state === 'armed') {
      // AltGr+Q types @ and Alt+Tab switches windows: close as soon as no shortcut fits.
      if (!starts) {
        this.clear();
        this.state = 'ignoring';
        this.options.emit({ type: 'closed' });
        return;
      }
      this.match = match;
      return;
    }
    if (this.state !== 'idle' || !starts) return;
    const status = this.options.appStatus();
    if (status === 'recording' || status === 'processing') {
      this.state = 'ignoring';
      this.options.emit({ type: status === 'recording' ? 'stop' : 'busy' });
      return;
    }
    this.state = 'armed';
    this.match = match;
    this.options.emit({ type: 'armed' });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.state !== 'armed') return;
      this.state = 'list';
      this.options.emit({ type: 'list' });
    }, this.options.holdMs);
  }

  allReleased(): void {
    const { state, match } = this;
    this.clear();
    if (state === 'armed') {
      this.options.emit(match === undefined ? { type: 'closed' } : { type: 'start', binding: match });
    } else if (state === 'list') {
      this.options.emit({ type: 'closed' });
    }
  }

  reset(): void {
    const open = this.state === 'armed' || this.state === 'list';
    this.clear();
    if (open) this.options.emit({ type: 'closed' });
  }

  private clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.state = 'idle';
    this.match = undefined;
  }
}
