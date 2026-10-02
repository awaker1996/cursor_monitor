import { BrowserWindow } from 'electron';
import path from 'path';
import { loadWindowIcon } from '../iconManager';
import type { AppSettings } from '../../src/shared/types';
import { devServerUrl } from '../../src/shared/devServer';

let settingsWindow: BrowserWindow | null = null;

export function createSettingsWindow(isDev: boolean, settings?: AppSettings): BrowserWindow {
  if (settingsWindow) {
    settingsWindow.focus();
    return settingsWindow;
  }

  const icon = settings ? loadWindowIcon(settings) : undefined;

  settingsWindow = new BrowserWindow({
    width: 840,
    height: 700,
    minWidth: 720,
    minHeight: 560,
    title: '设置界面',
    resizable: true,
    autoHideMenuBar: true,
    ...(icon && !icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    settingsWindow.loadURL(devServerUrl('/settings.html'));
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/settings.html'));
  }

  settingsWindow.setMenuBarVisibility(false);
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
