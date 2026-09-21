import { BrowserWindow } from 'electron';
import path from 'path';
import { loadWindowIcon } from '../iconManager';
import type { SettingsTab } from '../tray';
import type { AppSettings } from '../../src/shared/types';
import { devServerUrl } from '../../src/shared/devServer';

let settingsWindow: BrowserWindow | null = null;

export function createSettingsWindow(isDev: boolean, settings?: AppSettings, tab?: SettingsTab): BrowserWindow {
  const hash = tab ? `#${tab}` : '';

  if (settingsWindow) {
    if (tab) {
      settingsWindow.webContents.executeJavaScript(`window.location.hash = '${tab}'`);
    }
    settingsWindow.focus();
    return settingsWindow;
  }

  const icon = settings ? loadWindowIcon(settings) : undefined;

  settingsWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 800,
    minHeight: 480,
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
    settingsWindow.loadURL(devServerUrl(`/settings.html${hash}`));
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/settings.html'), { hash });
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
