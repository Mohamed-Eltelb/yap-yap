import { describe, expect, it } from 'vitest';
import {
  LOGIN_HIDDEN_FLAG,
  launchedHiddenAtLogin,
  linuxAutostartCommand,
  loginItemSettings,
  shouldShowMainWindowOnSecondInstance,
} from '../../electron/loginLaunch';

describe('loginItemSettings', () => {
  it('registers Windows login startup with --hidden and clears it on disable', () => {
    expect(loginItemSettings('win32', true)).toEqual({
      openAtLogin: true,
      args: [LOGIN_HIDDEN_FLAG],
    });
    expect(loginItemSettings('win32', false)).toEqual({
      openAtLogin: false,
    });
  });

  it('registers macOS login startup and clears it on disable', () => {
    expect(loginItemSettings('darwin', true)).toEqual({
      openAtLogin: true,
    });
    expect(loginItemSettings('darwin', false)).toEqual({
      openAtLogin: false,
    });
  });
});

describe('linuxAutostartCommand', () => {
  it('appends --hidden to the executable command', () => {
    expect(linuxAutostartCommand('/apps/Yap-Yap.AppImage')).toEqual([
      '/apps/Yap-Yap.AppImage',
      LOGIN_HIDDEN_FLAG,
    ]);
  });
});

describe('launchedHiddenAtLogin', () => {
  it('detects --hidden flag on Windows, Linux, and macOS', () => {
    expect(launchedHiddenAtLogin({ platform: 'win32', argv: ['Yap Yap.exe', '--hidden'] })).toBe(true);
    expect(launchedHiddenAtLogin({ platform: 'linux', argv: ['Yap-Yap.AppImage', '--hidden'] })).toBe(true);
    expect(launchedHiddenAtLogin({ platform: 'darwin', argv: ['Yap Yap', '--hidden'] })).toBe(true);
    expect(launchedHiddenAtLogin({ platform: 'win32', argv: ['Yap Yap.exe'] })).toBe(false);
    expect(launchedHiddenAtLogin({ platform: 'linux', argv: ['Yap-Yap.AppImage'] })).toBe(false);
  });

  it('detects macOS login launch via wasOpenedAtLogin', () => {
    expect(launchedHiddenAtLogin({
      platform: 'darwin',
      argv: ['Yap Yap'],
      loginItem: { wasOpenedAtLogin: true },
    })).toBe(true);
    expect(launchedHiddenAtLogin({
      platform: 'darwin',
      argv: ['Yap Yap'],
      loginItem: { wasOpenedAtLogin: false },
    })).toBe(false);
  });

  it('does not treat macOS loginItem flags as hidden on Windows or Linux without --hidden', () => {
    expect(launchedHiddenAtLogin({
      platform: 'win32',
      argv: ['Yap Yap.exe'],
      loginItem: { wasOpenedAtLogin: true },
    })).toBe(false);
  });
});

describe('shouldShowMainWindowOnSecondInstance', () => {
  it('shows the window on normal manual relaunch and stays hidden if --hidden was passed', () => {
    expect(shouldShowMainWindowOnSecondInstance(['Yap Yap.exe'])).toBe(true);
    expect(shouldShowMainWindowOnSecondInstance(['Yap Yap.exe', '--hidden'])).toBe(false);
  });
});
