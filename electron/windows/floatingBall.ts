import { BrowserWindow, screen } from 'electron';
import path from 'path';

let floatingBallWindow: BrowserWindow | null = null;

export const ORB_WINDOW_WIDTH = 300;
export const ORB_WINDOW_HEIGHT = 448;
const ORB_SCREEN_MARGIN = 20;

export function createFloatingBallWindow(isDev: boolean): BrowserWindow {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;

  floatingBallWindow = new BrowserWindow({
    width: ORB_WINDOW_WIDTH,
    height: ORB_WINDOW_HEIGHT,
    x: x + width - ORB_WINDOW_WIDTH - ORB_SCREEN_MARGIN,
    y: y + height - ORB_WINDOW_HEIGHT - ORB_SCREEN_MARGIN,
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
