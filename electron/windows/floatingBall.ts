import { BrowserWindow, screen } from 'electron';
import path from 'path';

let floatingBallWindow: BrowserWindow | null = null;

export function createFloatingBallWindow(isDev: boolean): BrowserWindow {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;

  floatingBallWindow = new BrowserWindow({
    width: 80,
    height: 80,
    x: x + width - 100,
    y: y + height - 100,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    floatingBallWindow.loadURL('http://localhost:5173/');
  } else {
    floatingBallWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  floatingBallWindow.once('ready-to-show', () => {
    floatingBallWindow?.show();
  });

  floatingBallWindow.on('close', (e) => {
    e.preventDefault();
    floatingBallWindow?.hide();
  });

  floatingBallWindow.on('closed', () => {
    floatingBallWindow = null;
  });

  return floatingBallWindow;
}

export function getFloatingBallWindow(): BrowserWindow | null {
  return floatingBallWindow;
}

export function sendToFloatingBall(channel: string, data: unknown): void {
  floatingBallWindow?.webContents.send(channel, data);
}
