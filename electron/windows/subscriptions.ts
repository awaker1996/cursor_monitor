import { BrowserWindow } from 'electron';
import path from 'path';
import { loadWindowIcon } from '../iconManager';
import type { AppSettings } from '../../src/shared/types';
import { devServerUrl } from '../../src/shared/devServer';

let subscriptionsWindow: BrowserWindow | null = null;

export function createSubscriptionsWindow(isDev: boolean, settings?: AppSettings): BrowserWindow {
  if (subscriptionsWindow) {
    subscriptionsWindow.focus();
    return subscriptionsWindow;
  }

  const icon = settings ? loadWindowIcon(settings) : undefined;

  subscriptionsWindow = new BrowserWindow({
    width: 520,
    height: 600,
    minWidth: 420,
    minHeight: 480,
    title: 'Cursor Token Monitor - 其他订阅',
    resizable: true,
    ...(icon && !icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    subscriptionsWindow.loadURL(devServerUrl('/subscriptions.html'));
  } else {
    subscriptionsWindow.loadFile(path.join(__dirname, '../dist/subscriptions.html'));
  }

  subscriptionsWindow.on('closed', () => {
    subscriptionsWindow = null;
  });

  return subscriptionsWindow;
}

export function getSubscriptionsWindow(): BrowserWindow | null {
  return subscriptionsWindow;
}
