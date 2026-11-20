/** What the app shows about updates: the sidebar card and Settings → About read this. */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; version: string }
  /** `install`: updates in place. `download`: saves the installer (macOS). `page`: only the releases page has it. */
  | { status: 'available'; version: string; method: 'install' | 'download' | 'page' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string; method: 'install' | 'download' }
  /** `version` is set when a download failed, so the card can offer to try again. */
  | { status: 'error'; message: string; version?: string };

type Installer = { name: string; url: string; digest: string; size: number };
type ReleaseCheck = { message: string; version?: string; installer?: Installer; url?: string };

export interface UpdateDeps {
  currentVersion: string;
  /** Windows and AppImage builds install in place with electron-updater. */
  inPlace: boolean;
  /** Resolves with the newer version, or undefined when up to date. */
  checkInPlace(): Promise<string | undefined>;
  downloadInPlace(onPercent: (percent: number) => void): Promise<void>;
  installInPlace(): void;
  checkRelease(): Promise<ReleaseCheck>;
  downloadInstaller(installer: Installer, onFraction: (fraction: number) => void): Promise<string>;
  revealFile(file: string): void;
  openUrl(url: string): void;
  readSkipped(): Promise<string>;
  writeSkipped(version: string): Promise<void>;
  onChange(state: UpdateState): void;
}

export class UpdateController {
  private current: UpdateState = { status: 'idle' };
  private pendingCheck?: Promise<UpdateState>;
  private installer?: Installer;
  private releaseUrl?: string;
  private savedFile?: string;

  constructor(private readonly deps: UpdateDeps) {}

  get state(): UpdateState {
    return this.current;
  }

  private set(state: UpdateState) {
    this.current = state;
    this.deps.onChange(state);
  }

  /** At startup a version the user put off stays quiet. A check from Settings always shows it. */
  check(atStartup = false): Promise<UpdateState> {
    const { status } = this.current;
    if (status === 'downloading' || status === 'ready') return Promise.resolve(this.current);
    return this.pendingCheck ??= this.runCheck(atStartup).finally(() => { this.pendingCheck = undefined; });
  }

  private async runCheck(atStartup: boolean): Promise<UpdateState> {
    if (!atStartup) this.set({ status: 'checking' });
    try {
      let next: UpdateState;
      if (this.deps.inPlace) {
        const version = await this.deps.checkInPlace();
        next = version
          ? { status: 'available', version, method: 'install' }
          : { status: 'up-to-date', version: this.deps.currentVersion };
      } else {
        const release = await this.deps.checkRelease();
        this.installer = release.installer;
        this.releaseUrl = release.url;
        next = !release.version
          ? { status: 'up-to-date', version: this.deps.currentVersion }
          : { status: 'available', version: release.version, method: release.installer ? 'download' : 'page' };
      }
      if (atStartup && (next.status !== 'available' || await this.deps.readSkipped() === next.version)) {
        this.set({ status: 'idle' });
      } else {
        this.set(next);
      }
    } catch {
      this.set(atStartup ? { status: 'idle' } : { status: 'error', message: 'Couldn’t check for updates. Try again later.' });
    }
    return this.current;
  }

  async download(): Promise<void> {
    const state = this.current;
    const version = state.status === 'available' || (state.status === 'error' && state.version) ? state.version : undefined;
    if (!version) return;
    if (state.status === 'available' && state.method === 'page') {
      if (this.releaseUrl) this.deps.openUrl(this.releaseUrl);
      return;
    }
    this.set({ status: 'downloading', version, percent: 0 });
    const progress = (percent: number) => {
      const rounded = Math.max(0, Math.min(100, Math.round(percent)));
      const now = this.current;
      if (now.status === 'downloading' && now.percent !== rounded) this.set({ ...now, percent: rounded });
    };
    try {
      if (this.deps.inPlace) {
        await this.deps.downloadInPlace(progress);
        this.set({ status: 'ready', version, method: 'install' });
      } else if (this.installer) {
        this.savedFile = await this.deps.downloadInstaller(this.installer, fraction => progress(fraction * 100));
        this.set({ status: 'ready', version, method: 'download' });
        this.deps.revealFile(this.savedFile);
      } else {
        throw new Error('No installer');
      }
    } catch {
      this.set({ status: 'error', version, message: 'The update couldn’t be downloaded. Check your connection and try again.' });
    }
  }

  /** Restarts into the update, or shows the saved installer. */
  install(): void {
    const state = this.current;
    if (state.status !== 'ready') return;
    if (state.method === 'install') this.deps.installInPlace();
    else if (this.savedFile) this.deps.revealFile(this.savedFile);
  }

  /** Later: hides the offer and keeps startup quiet about this version. */
  async dismiss(): Promise<void> {
    const state = this.current;
    if (state.status === 'available' || state.status === 'error') {
      if ('version' in state && state.version) await this.deps.writeSkipped(state.version).catch(() => undefined);
      this.set({ status: 'idle' });
    } else if (state.status === 'ready' && state.method === 'download') {
      this.set({ status: 'idle' });
    }
  }
}
