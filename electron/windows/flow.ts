import { BrowserWindow } from 'electron';
import path from 'path';
import { loadWindowIcon } from '../iconManager';
import type { AppSettings } from '../../src/shared/types';

let flowWindow: BrowserWindow | null = null;

export function createFlowWindow(isDev: boolean, settings?: AppSettings): BrowserWindow {
  if (flowWindow) {
    flowWindow.focus();
    return flowWindow;
  }

  const icon = settings ? loadWindowIcon(settings) : undefined;

  flowWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 640,
    minHeight: 400,
    title: 'Cursor Token Monitor - 流水',
    resizable: true,
    ...(icon && !icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    flowWindow.loadURL('http://localhost:5173/flow.html');
  } else {
    flowWindow.loadFile(path.join(__dirname, '../dist/flow.html'));
  }

  flowWindow.on('closed', () => {
    flowWindow = null;
  });

  return flowWindow;
}

export function getFlowWindow(): BrowserWindow | null {
  return flowWindow;
}

export function sendToFlow(channel: string, data: unknown): void {
  flowWindow?.webContents.send(channel, data);
}
