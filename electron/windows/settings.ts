import { BrowserWindow } from 'electron';
import os from 'os';
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
  // Mica 只在 Windows 11 (build 22000+) 可用；失败时静默回退纯色背景。
  const isWin11 =
    process.platform === 'win32' && Number(os.release().split('.')[2] ?? 0) >= 22000;

  settingsWindow = new BrowserWindow({
    width: 840,
    height: 700,
    minWidth: 720,
    minHeight: 560,
    title: '设置界面',
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#0b1026',
    backgroundMaterial: isWin11 ? 'mica' : undefined,
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
