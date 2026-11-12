import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from 'electron';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let hudWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const isDev = !app.isPackaged;

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'yapyap-store.json');
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links (API key portals, Share on X, etc.) in the user's default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createHudWindow(): void {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const hudWidth = 420;
  const hudHeight = 220;

  hudWindow = new BrowserWindow({
    width: hudWidth,
    height: hudHeight,
    x: Math.round((width - hudWidth) / 2),
    y: height - hudHeight - 18,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    void hudWindow.loadURL('http://localhost:5173/#/hud');
  } else {
    void hudWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: '/hud',
    });
  }

  hudWindow.on('closed', () => {
    hudWindow = null;
  });
}

function createTray(): void {
  try {
    const emptyPng =
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWElEQVQ4T2NkoBAwUqifAW8AmqH4DcBpwH88BrAgGwDmwMUBiO0F4iYgdqRmAFwQ6wYgNkI2AK4JbAAzEPsCMQeRGYAWwL+Q4wAYG5nGgGYA3K+4xQEA1i4OE1h3/xAAAAAASUVORK5CYII=';
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${emptyPng}`);
    tray = new Tray(icon);
    tray.setToolTip('Yap Yap — Speak, don’t type');
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Yap Yap',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Dictate',
        click: () => mainWindow?.webContents.send('trigger-mode', 'dictate'),
      },
      {
        label: 'Translate',
        click: () => mainWindow?.webContents.send('trigger-mode', 'translate'),
      },
      {
        label: 'Ask anything',
        click: () => mainWindow?.webContents.send('trigger-mode', 'ask'),
      },
      { type: 'separator' },
      {
        label: 'Quit Yap Yap',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } catch {
    // Tray may not be available in headless Linux
  }
}

function toElectronAccelerator(keys: string[]): string | null {
  if (!keys || keys.length === 0) return null;
  const mapKey = (k: string): string => {
    const norm = k.trim();
    if (norm === 'Right Alt' || norm === 'Left Alt' || norm === 'Alt') return 'Alt';
    if (norm === 'Right Shift' || norm === 'Left Shift' || norm === 'Shift') return 'Shift';
    if (norm === 'Right Ctrl' || norm === 'Left Ctrl' || norm === 'Ctrl' || norm === 'Control')
      return 'CommandOrControl';
    if (norm === 'Cmd' || norm === 'Meta' || norm === 'Command') return 'Super';
    if (norm === ' ') return 'Space';
    return norm;
  };

  const mapped = keys.map(mapKey);
  const modifiers = new Set(['Alt', 'Shift', 'CommandOrControl', 'Super']);
  const hasNonModifier = mapped.some((m) => !modifiers.has(m));
  if (!hasNonModifier) {
    return null;
  }
  return Array.from(new Set(mapped)).join('+');
}

function registerAppShortcuts(shortcuts: {
  dictate: string[][];
  translate: string[][];
  ask: string[][];
}): void {
  globalShortcut.unregisterAll();

  const registerGroup = (combos: string[][], mode: 'dictate' | 'translate' | 'ask') => {
    for (const combo of combos) {
      const accel = toElectronAccelerator(combo);
      if (!accel) continue;
      try {
        globalShortcut.register(accel, () => {
          mainWindow?.webContents.send('trigger-mode', mode);
        });
      } catch {
        // Ignore invalid/taken accelerator
      }
    }
  };

  registerGroup(shortcuts.dictate, 'dictate');
  registerGroup(shortcuts.translate, 'translate');
  registerGroup(shortcuts.ask, 'ask');
}

function simulatePaste(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      exec(
        'osascript -e \'tell application "System Events" to keystroke "v" using command down\'',
        (err) => resolve(!err)
      );
    } else if (process.platform === 'win32') {
      exec(
        'powershell -NoProfile -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^v\')"',
        (err) => resolve(!err)
      );
    } else {
      exec('xdotool key --clearmodifiers ctrl+v', (err) => resolve(!err));
    }
  });
}

app.whenReady().then(() => {
  createMainWindow();
  createHudWindow();
  createTray();

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => {
    if (tray) mainWindow?.hide();
    else mainWindow?.close();
  });

  ipcMain.handle('app:set-login-item', (_e, enabled: boolean) => {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled });
    } catch {
      // Ignore on unsupported Linux environments
    }
  });

  ipcMain.handle('audio:set-mute', (_e, muted: boolean) => {
    try {
      mainWindow?.webContents.setAudioMuted(muted);
    } catch {
      // Ignore
    }
  });

  ipcMain.handle('shortcuts:update', (_e, shortcuts) => {
    registerAppShortcuts(shortcuts);
  });

  ipcMain.handle('clipboard:paste', async (_e, text: string) => {
    clipboard.writeText(text);
    return simulatePaste();
  });

  ipcMain.on('hud:toggle', (_e, payload: { show: boolean; state?: unknown }) => {
    if (!hudWindow) createHudWindow();
    if (!hudWindow) return;
    if (payload.show) {
      if (!mainWindow?.isFocused() || !mainWindow?.isVisible()) {
        hudWindow.showInactive();
      }
      if (payload.state) hudWindow.webContents.send('hud:state', payload.state);
    } else {
      hudWindow.hide();
    }
  });

  ipcMain.on('hud:state', (_e, state) => {
    hudWindow?.webContents.send('hud:state', state);
  });

  ipcMain.on('hud:action', (_e, action) => {
    mainWindow?.webContents.send('hud:action', action);
  });

  ipcMain.handle('store:load', () => {
    try {
      const p = getStorePath();
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('store:save', (_e, data) => {
    try {
      const p = getStorePath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Ignore write error
    }
  });

  ipcMain.handle(
    'api:request',
    async (
      _e,
      req: {
        url: string;
        method: string;
        headers: Record<string, string>;
        bodyBase64?: string;
        bodyText?: string;
      }
    ) => {
      let body: BodyInit | undefined;
      if (req.bodyBase64) {
        body = Buffer.from(req.bodyBase64, 'base64');
      } else if (req.bodyText !== undefined) {
        body = req.bodyText;
      }

      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    }
  );

  ipcMain.handle(
    'api:multipart',
    async (
      _e,
      req: {
        url: string;
        headers: Record<string, string>;
        fileBase64: string;
        fileName: string;
        mimeType: string;
        fields: Record<string, string>;
      }
    ) => {
      const form = new FormData();
      const buffer = Buffer.from(req.fileBase64, 'base64');
      const blob = new Blob([buffer], { type: req.mimeType });
      form.append('file', blob, req.fileName);
      for (const [k, v] of Object.entries(req.fields)) {
        form.append(k, v);
      }

      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: form,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    }
  );
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
