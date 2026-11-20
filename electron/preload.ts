import type { HudAction, ShortcutPhase } from './hudActions';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('yapyap', {
  isElectron: true,
  platform: process.platform,
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    dismiss: () => ipcRenderer.invoke('update:dismiss'),
    onState: (cb: (state: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, state: unknown) => cb(state);
      ipcRenderer.on('update:state', handler);
      return () => ipcRenderer.removeListener('update:state', handler);
    },
  },
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  setAppearance: (appearance: 'light' | 'dark' | 'system') =>
    ipcRenderer.send('app:set-appearance', appearance),
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
  watchPasteCorrections: (text: string) => ipcRenderer.invoke('dictation:watch-corrections', text),
  pasteText: (text: string, keepOnClipboard?: boolean) => ipcRenderer.invoke('clipboard:paste', text, keepOnClipboard === true),
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
  onShortcutPhase: (cb: (phase: ShortcutPhase) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, phase: ShortcutPhase) => cb(phase);
    ipcRenderer.on('shortcut:phase', handler);
    return () => ipcRenderer.removeListener('shortcut:phase', handler);
  },
  onHudShown: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('hud:shown', handler);
    return () => ipcRenderer.removeListener('hud:shown', handler);
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
  loadAudio: (id: string) => ipcRenderer.invoke('store:load-audio', id) as Promise<string | null>,
  apiRequest: (req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyBase64?: string;
    bodyText?: string;
    timeoutMs?: number;
  }) => ipcRenderer.invoke('api:request', req),
  /** Sends a request whose reply arrives in pieces, passing each piece to `onChunk` as it comes. */
  apiStream: (
    req: { url: string; method: string; headers: Record<string, string>; bodyText?: string },
    onChunk: (text: string) => void
  ) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const handler = (_e: Electron.IpcRendererEvent, chunkId: string, text: string) => {
      if (chunkId === id) onChunk(text);
    };
    ipcRenderer.on('api:stream-chunk', handler);
    return (ipcRenderer.invoke('api:stream', { ...req, id }) as Promise<{ ok: boolean; status: number; text: string }>)
      .finally(() => ipcRenderer.removeListener('api:stream-chunk', handler));
  },
  apiMultipart: (req: {
    url: string;
    headers: Record<string, string>;
    fileBase64: string;
    fileName: string;
    mimeType: string;
    fields: Record<string, string | string[]>;
  }) => ipcRenderer.invoke('api:multipart', req),
});
