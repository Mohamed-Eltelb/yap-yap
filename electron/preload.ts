import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('yapyap', {
  isElectron: true,
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke('app:set-login-item', enabled),
  updateShortcuts: (shortcuts: {
    dictate: string[][];
    translate: string[][];
    ask: string[][];
  }) => ipcRenderer.invoke('shortcuts:update', shortcuts),
  pasteText: (text: string) => ipcRenderer.invoke('clipboard:paste', text),
  toggleHud: (show: boolean, state?: { mode: string; recording: boolean }) =>
    ipcRenderer.send('hud:toggle', { show, state }),
  sendHudState: (state: unknown) => ipcRenderer.send('hud:state', state),
  onTriggerMode: (cb: (mode: 'dictate' | 'translate' | 'ask') => void) => {
    const handler = (_e: Electron.IpcRendererEvent, mode: 'dictate' | 'translate' | 'ask') =>
      cb(mode);
    ipcRenderer.on('trigger-mode', handler);
    return () => ipcRenderer.removeListener('trigger-mode', handler);
  },
  onHudAction: (cb: (action: { type: string; mode?: 'dictate' | 'translate' | 'ask' }) => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      action: { type: string; mode?: 'dictate' | 'translate' | 'ask' }
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
});
