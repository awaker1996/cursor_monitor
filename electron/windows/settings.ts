import { BrowserWindow } from 'electron';
import path from 'path';
import { loadWindowIcon } from '../iconManager';
import type { AppSettings } from '../../src/shared/types';

let settingsWindow: BrowserWindow | null = null;

export function createSettingsWindow(isDev: boolean, settings?: AppSettings): BrowserWindow {
  if (settingsWindow) {
    settingsWindow.focus();
    return settingsWindow;
  }

  const icon = settings ? loadWindowIcon(settings) : undefined;

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 480,
    minHeight: 480,
    title: 'Cursor Token Monitor - 设置',
    resizable: true,
    ...(icon && !icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    settingsWindow.loadURL('http://localhost:5173/settings.html');
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/settings.html'));
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}

export function sendToSettings(channel: string, data: unknown): void {
  settingsWindow?.webContents.send(channel, data);
}
