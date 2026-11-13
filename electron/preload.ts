import type { HudAction } from './hudActions';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('yapyap', {
  isElectron: true,
  platform: process.platform,
  checkForUpdate: () => ipcRenderer.invoke('app:check-for-update'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke('app:set-login-item', enabled),
  setSystemMute: (muted: boolean) => ipcRenderer.invoke('audio:set-mute', muted),
  updateShortcuts: (shortcuts: {
    dictate: string[][];
    translate: string[][];
    ask: string[][];
  }) => ipcRenderer.invoke('shortcuts:update', shortcuts),
  setShortcutEditorOpen: (open: boolean) => ipcRenderer.send('shortcuts:editor', open),
  preparePaste: () => ipcRenderer.send('clipboard:prepare-paste'),
  captureDictationContext: () => ipcRenderer.invoke('dictation:capture-context'),
  pasteText: (text: string) => ipcRenderer.invoke('clipboard:paste', text),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  toggleHud: (show: boolean, state?: unknown) =>
    ipcRenderer.send('hud:toggle', { show, state }),
  hudReady: () => ipcRenderer.send('hud:ready'),
  setHudIgnoreMouse: (ignore: boolean) => ipcRenderer.send('hud:ignore-mouse', ignore),
  sendHudAction: (action: HudAction) =>
    ipcRenderer.send('hud:action', action),
  onTriggerMode: (cb: (mode: 'dictate' | 'translate' | 'ask') => void) => {
    const handler = (_e: Electron.IpcRendererEvent, mode: 'dictate' | 'translate' | 'ask') =>
      cb(mode);
    ipcRenderer.on('trigger-mode', handler);
    return () => ipcRenderer.removeListener('trigger-mode', handler);
  },
  onHudState: (cb: (state: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: unknown) => cb(state);
    ipcRenderer.on('hud:state', handler);
    return () => ipcRenderer.removeListener('hud:state', handler);
  },
  onHudAction: (
    cb: (action: HudAction) => void
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      action: HudAction
    ) => cb(action);
    ipcRenderer.on('hud:action', handler);
    return () => ipcRenderer.removeListener('hud:action', handler);
  },
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data: Record<string, unknown>) => ipcRenderer.invoke('store:save', data),
  apiRequest: (req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyBase64?: string;
    bodyText?: string;
  }) => ipcRenderer.invoke('api:request', req),
  apiMultipart: (req: {
    url: string;
    headers: Record<string, string>;
    fileBase64: string;
    fileName: string;
    mimeType: string;
    fields: Record<string, string>;
  }) => ipcRenderer.invoke('api:multipart', req),
});
