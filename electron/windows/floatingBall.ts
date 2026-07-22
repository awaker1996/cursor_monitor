import { BrowserWindow, screen } from 'electron';
import path from 'path';

let floatingBallWindow: BrowserWindow | null = null;

/**
 * Single source of truth for floating-ball window width.
 * Dock / undock / expand must all use this — never diverge.
 */
export const ORB_PANEL_WIDTH = 300;

/** @deprecated use ORB_PANEL_WIDTH */
export const ORB_WINDOW_WIDTH = ORB_PANEL_WIDTH;

/** Undocked capacity — width locked; height is the tall undocked size. */
export const ORB_EXPANDED_WIDTH = ORB_PANEL_WIDTH;
export const ORB_EXPANDED_HEIGHT = 548;

/** Docked peek height only; width stays ORB_PANEL_WIDTH. */
export const ORB_WINDOW_HEIGHT = 448;

/** Visible orb diameter — must match `.floating-ball__orb` in styles.css */
export const ORB_VISUAL_SIZE = 56;

/** Half-hide offset when edge-docked (AssistiveTouch peek) */
export const ORB_DOCK_HIDE_OFFSET = ORB_VISUAL_SIZE / 2;

/** Hover slide-in offset (~12% of orb) */
export const ORB_DOCK_HOVER_OFFSET = Math.round(ORB_VISUAL_SIZE * 0.12);

/** `.floating-ball__orb-wrap` margin when undocked (top/right/bottom) */
export const ORB_WRAP_MARGIN = 22;

/** Inner panel width inside the 12px shell padding on each side. */
export const ORB_PANEL_CONTENT_WIDTH = ORB_PANEL_WIDTH - 24;

const ORB_SCREEN_MARGIN = 20;

function lockFloatingBallWidth(win: BrowserWindow): void {
  // Pin width so DPI / OS / legacy IPC cannot stretch the window over time.
  win.setMinimumSize(ORB_PANEL_WIDTH, ORB_WINDOW_HEIGHT);
  win.setMaximumSize(ORB_PANEL_WIDTH, ORB_EXPANDED_HEIGHT);
}

export function enforceFloatingBallWidth(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  lockFloatingBallWidth(win);
  const bounds = win.getBounds();
  if (bounds.width === ORB_PANEL_WIDTH) return;
  win.setBounds({
    x: Math.round(bounds.x + bounds.width - ORB_PANEL_WIDTH),
    y: Math.round(bounds.y),
    width: ORB_PANEL_WIDTH,
    height: bounds.height,
  });
}

export function createFloatingBallWindow(isDev: boolean): BrowserWindow {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;

  floatingBallWindow = new BrowserWindow({
    width: ORB_EXPANDED_WIDTH,
    height: ORB_EXPANDED_HEIGHT,
    x: x + width - ORB_EXPANDED_WIDTH - ORB_SCREEN_MARGIN,
    y: y + height - ORB_EXPANDED_HEIGHT - ORB_SCREEN_MARGIN,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  lockFloatingBallWidth(floatingBallWindow);

  floatingBallWindow.on('will-resize', (event, newBounds) => {
    if (newBounds.width !== ORB_PANEL_WIDTH) {
      event.preventDefault();
    }
  });

  floatingBallWindow.on('resized', () => {
    if (!floatingBallWindow || floatingBallWindow.isDestroyed()) return;
    enforceFloatingBallWidth(floatingBallWindow);
  });

  if (isDev) {
    floatingBallWindow.loadURL('http://localhost:5173/');
  } else {
    floatingBallWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  floatingBallWindow.once('ready-to-show', () => {
    if (!floatingBallWindow || floatingBallWindow.isDestroyed()) return;
    enforceFloatingBallWidth(floatingBallWindow);
    floatingBallWindow.show();
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
