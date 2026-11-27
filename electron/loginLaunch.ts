import type { Settings } from 'electron';

/** CLI flag added to Windows and Linux login-item entries so login launches stay in the tray. */
export const LOGIN_HIDDEN_FLAG = '--hidden';

export interface LoginLaunchCheck {
  platform: NodeJS.Platform;
  argv: string[];
  loginItem?: {
    wasOpenedAtLogin?: boolean;
  };
}

/** Electron login-item settings for Windows and macOS so login startup stays tucked in the tray. */
export function loginItemSettings(platform: NodeJS.Platform, enabled: boolean): Settings {
  if (!enabled) return { openAtLogin: false };
  if (platform === 'win32') return { openAtLogin: true, args: [LOGIN_HIDDEN_FLAG] };
  return { openAtLogin: true };
}

/** Command array written to the Linux XDG autostart desktop entry. */
export function linuxAutostartCommand(executable: string): string[] {
  return [executable, LOGIN_HIDDEN_FLAG];
}

/** Whether the app was launched at OS login and should stay hidden in the tray. */
export function launchedHiddenAtLogin({ platform, argv, loginItem }: LoginLaunchCheck): boolean {
  if (argv.includes(LOGIN_HIDDEN_FLAG)) return true;
  if (platform === 'darwin') return loginItem?.wasOpenedAtLogin === true;
  return false;
}

/** Whether a second launch should reveal the main window (false only for duplicate --hidden runs). */
export function shouldShowMainWindowOnSecondInstance(argv: string[]): boolean {
  return !argv.includes(LOGIN_HIDDEN_FLAG);
}
