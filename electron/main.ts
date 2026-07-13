import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { SettingsStore } from '../src/settings/SettingsStore';
import { credentialVault } from '../src/security/CredentialVault';
import { ProviderManager } from '../src/core/providers/ProviderManager';
import { Poller } from '../src/core/poller';
import { createFloatingBallWindow, getFloatingBallWindow, sendToFloatingBall } from './windows/floatingBall';
import { createSettingsWindow } from './windows/settings';
import { createTray, destroyTray, updateTrayIcon } from './tray';
import {
  getDockState,
  handleMoveWhileDocked,
  tryDockWindow,
  undockWindow,
} from './floatingBallDock';
import {
  clearCustomIconFile,
  getIconPreviewDataUrl,
  loadTrayIcon,
  saveCustomIcon,
} from './iconManager';
import {
  REFRESH_INTERVAL_MAX,
  REFRESH_INTERVAL_MIN,
  type AppSettings,
  type TestConnectionResult,
} from '../src/shared/types';
import { createLogger } from '../src/utils/logger';

const log = createLogger('Main');
const isDev = !app.isPackaged;

let settingsStore: SettingsStore;
let providerManager: ProviderManager;
let poller: Poller;
let isPaused = false;

function isDirectoryWritable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * On Windows, Electron derives `userData` as `path.join(cache, appName)`.
 * Setting `cache` alone therefore relocates settings/snapshot into
 * `runtime/Cache/<appName>/`, which breaks persistence and can leave the UI
 * on empty/stale metrics. Always pin `userData` to the canonical appData root.
 */
function resolveCanonicalUserDataPath(): string {
  return path.join(app.getPath('appData'), app.getName());
}

function hasUsableCachedMetrics(snapshotPath: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as {
      metrics?: { totalUsedPercent?: number | null };
      auto?: { remaining?: number | null; limit?: number | null };
      api?: { remaining?: number | null; limit?: number | null };
    };
    const percent = raw.metrics?.totalUsedPercent;
    if (typeof percent === 'number' && Number.isFinite(percent)) return true;
    const hasQuota =
      raw.auto?.remaining != null ||
      raw.auto?.limit != null ||
      raw.api?.remaining != null ||
      raw.api?.limit != null;
    return hasQuota;
  } catch {
    return false;
  }
}

function migrateMisplacedUserData(canonicalUserData: string): void {
  const misplaced = path.join(canonicalUserData, 'runtime', 'Cache', app.getName());
  if (!fs.existsSync(misplaced)) return;
  if (path.resolve(misplaced) === path.resolve(canonicalUserData)) return;

  fs.mkdirSync(canonicalUserData, { recursive: true });
  const filesToMigrate = ['settings.json', 'snapshot-cache.json', 'custom-icon.png', '.credential'];

  for (const fileName of filesToMigrate) {
    const src = path.join(misplaced, fileName);
    const dest = path.join(canonicalUserData, fileName);
    if (!fs.existsSync(src)) continue;

    if (fileName === 'snapshot-cache.json') {
      const srcUsable = hasUsableCachedMetrics(src);
      const destUsable = fs.existsSync(dest) && hasUsableCachedMetrics(dest);
      if (destUsable && !srcUsable) continue;
      if (!srcUsable && !destUsable && fs.existsSync(dest)) continue;
    } else if (fs.existsSync(dest)) {
      const srcMtime = fs.statSync(src).mtimeMs;
      const destMtime = fs.statSync(dest).mtimeMs;
      if (destMtime >= srcMtime) continue;
    }

    fs.copyFileSync(src, dest);
    log.info('Migrated userData file from misplaced cache path', { fileName, from: src, to: dest });
  }
}

function configureChromiumCachePaths(): void {
  try {
    // Put Chromium session/cache data into an explicitly writable location.
    // This avoids cache migration failures when the old cache dir is read-only.
    const canonicalUserData = resolveCanonicalUserDataPath();
    app.setPath('userData', canonicalUserData);
    migrateMisplacedUserData(canonicalUserData);

    const runtimeRoot = path.join(canonicalUserData, 'runtime');
    const sessionDataPath = path.join(runtimeRoot, 'session-data');
    const diskCachePath = path.join(runtimeRoot, 'Cache');
    const gpuCachePath = path.join(runtimeRoot, 'GPUCache');
    const legacyCachePath = path.join(canonicalUserData, 'Cache');

    fs.mkdirSync(sessionDataPath, { recursive: true });
    fs.mkdirSync(diskCachePath, { recursive: true });
    fs.mkdirSync(gpuCachePath, { recursive: true });

    app.setPath('sessionData', sessionDataPath);
    app.setPath('cache', diskCachePath);
    // Re-pin after cache changes — Windows Electron remaps userData with cache.
    app.setPath('userData', canonicalUserData);
    app.commandLine.appendSwitch('disk-cache-dir', diskCachePath);
    app.commandLine.appendSwitch('gpu-shader-disk-cache-dir', gpuCachePath);

    if (fs.existsSync(legacyCachePath) && !isDirectoryWritable(legacyCachePath)) {
      log.warn('Legacy cache directory is not writable; using runtime cache only', {
        legacyCachePath,
        diskCachePath,
      });
    }

    if (isDev) {
      app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
      app.commandLine.appendSwitch('disable-http-cache');
    }
  } catch (error) {
    log.warn('Failed to configure Chromium cache paths', { error });
  }
}

configureChromiumCachePaths();

function validateInterval(sec: number): string | null {
  if (!Number.isInteger(sec)) return '刷新间隔必须是整数';
  if (sec < REFRESH_INTERVAL_MIN || sec > REFRESH_INTERVAL_MAX) {
    return `刷新间隔必须在 ${REFRESH_INTERVAL_MIN}-${REFRESH_INTERVAL_MAX} 秒之间`;
  }
  return null;
}

function broadcastSnapshot(): void {
  const snapshot = providerManager.getLastSnapshot();
  if (snapshot) {
    sendToFloatingBall('snapshot-updated', snapshot);
  }
}

function broadcastPollerState(): void {
  sendToFloatingBall('poller-state', poller.getState());
}

function broadcastDockState(edge: import('../src/shared/types').DockEdge | null): void {
  sendToFloatingBall('dock-state-changed', edge);
}

function refreshAppIcons(): void {
  updateTrayIcon(loadTrayIcon(settingsStore.get()));
}

function applyOrbMode(mode: 'collapsed' | 'hover' | 'expanded'): void {
  const win = getFloatingBallWindow();
  if (!win || win.isDestroyed()) return;
  if (getDockState().docked) return;
  const sizes: Record<'collapsed' | 'hover' | 'expanded', [number, number]> = {
    collapsed: [80, 80],
    hover: [280, 200],
    expanded: [300, 448],
  };
  const [width, height] = sizes[mode] ?? sizes.collapsed;
  resizeFloatingBallWindow(win, width, height);
}
function resizeFloatingBallWindow(win: BrowserWindow, width: number, height: number): void {
  const bounds = win.getBounds();
  if (bounds.width === width && bounds.height === height) return;

  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const nextX = Math.min(
    Math.max(bounds.x + bounds.width - width, workArea.x),
    workArea.x + workArea.width - width,
  );
  const nextY = Math.min(
    Math.max(bounds.y + bounds.height - height, workArea.y),
    workArea.y + workArea.height - height,
  );

  win.setBounds({
    x: Math.round(nextX),
    y: Math.round(nextY),
    width,
    height,
  });
}

function setupIpc(): void {
  ipcMain.handle('get-snapshot', () => providerManager.getLastSnapshot());

  ipcMain.handle('get-poller-state', () => poller.getState());

  ipcMain.handle('get-settings', () => settingsStore.get());

  ipcMain.handle('update-settings', (_event, partial: Partial<AppSettings>) => {
    if (partial.refreshIntervalSec !== undefined) {
      const err = validateInterval(partial.refreshIntervalSec);
      if (err) throw new Error(err);
    }
    const settings = settingsStore.update(partial);
    poller.applySettingsChange();
    if (partial.edgeAutoDockEnabled === false) {
      const floatWin = getFloatingBallWindow();
      if (floatWin && !floatWin.isDestroyed() && getDockState().docked) {
        undockWindow(floatWin);
        broadcastDockState(null);
      }
    }
    refreshAppIcons();
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('settings-changed', settings);
    });
    return settings;
  });

  ipcMain.handle('save-cookie', async (_event, cookie: string) => {
    if (!cookie || !cookie.trim()) throw new Error('Cookie 不能为空');
    await credentialVault.saveCookie(cookie.trim());
    log.info('Cookie saved');
  });

  ipcMain.handle('clear-cookie', async () => {
    await credentialVault.clearCookie();
    log.info('Cookie cleared');
    return true;
  });

  ipcMain.handle('has-cookie', () => credentialVault.hasCookie());

  ipcMain.handle('test-connection', async (): Promise<TestConnectionResult> => {
    try {
      const hasCookie = await credentialVault.hasCookie();
      if (!hasCookie) {
        return { success: false, message: '请先配置 Cookie' };
      }
      const snapshot = await providerManager.testCookieConnection();
      broadcastSnapshot();
      return { success: true, message: '连接成功', snapshot };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
  });

  ipcMain.handle('manual-refresh', async () => {
    await poller.manualRefresh();
    broadcastSnapshot();
    broadcastPollerState();
  });

  ipcMain.handle('toggle-pause', () => {
    if (isPaused) {
      isPaused = false;
      settingsStore.update({ autoRefreshEnabled: true });
      poller.resume();
    } else {
      isPaused = true;
      settingsStore.update({ autoRefreshEnabled: false });
      poller.pause();
    }
    broadcastPollerState();
    return isPaused;
  });

  ipcMain.on('open-settings', () => {
    createSettingsWindow(isDev, settingsStore.get());
  });

  ipcMain.on('set-orb-mode', (_event, mode: 'collapsed' | 'hover' | 'expanded') => {
    applyOrbMode(mode);
  });

  ipcMain.handle('set-orb-mode-async', (_event, mode: 'collapsed' | 'hover' | 'expanded') => {
    applyOrbMode(mode);
  });

  // Backward compatibility for older renderer builds — window stays fixed size
  ipcMain.on('set-expanded', () => {});

  ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.handle('get-cursor-in-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    const point = screen.getCursorScreenPoint();
    const bounds = win.getContentBounds();
    return {
      x: point.x - bounds.x,
      y: point.y - bounds.y,
    };
  });

  ipcMain.on('move-window', (event, { dx, dy }: { dx: number; dy: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (getDockState().docked) {
      const undocked = handleMoveWhileDocked(win, dx, dy);
      if (undocked) broadcastDockState(null);
    }
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });

  ipcMain.on('finish-window-move', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const edge = tryDockWindow(win, settingsStore.get().edgeAutoDockEnabled);
    broadcastDockState(edge);
  });

  ipcMain.on('undock-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (getDockState().docked) {
      undockWindow(win);
      broadcastDockState(null);
    }
  });

  ipcMain.handle('get-icon-preview', () => getIconPreviewDataUrl(settingsStore.get()));

  ipcMain.handle('select-custom-icon', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择应用图标',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'ico', 'jpg', 'jpeg'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '未选择文件' };
    }
    const customIconPath = saveCustomIcon(result.filePaths[0]);
    const settings = settingsStore.update({ customIconPath });
    refreshAppIcons();
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('settings-changed', settings);
    });
    return { success: true, message: '图标已更新', preview: getIconPreviewDataUrl(settings) };
  });

  ipcMain.handle('clear-custom-icon', async () => {
    clearCustomIconFile();
    const settings = settingsStore.update({ customIconPath: null });
    refreshAppIcons();
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('settings-changed', settings);
    });
    return { success: true, preview: getIconPreviewDataUrl(settings) };
  });
}

function setupPollerEvents(): void {
  poller.onEvent((event) => {
    if (event.type === 'snapshot' && event.snapshot) {
      sendToFloatingBall('snapshot-updated', event.snapshot);
    }
    if (event.type === 'state' && event.state) {
      sendToFloatingBall('poller-state', event.state);
    }
    if (event.type === 'error' && event.error) {
      sendToFloatingBall('poller-state', poller.getState());
    }
  });
}

app.whenReady().then(async () => {
  credentialVault.setFallbackPath(app.getPath('userData'));
  settingsStore = new SettingsStore();
  providerManager = new ProviderManager(settingsStore);
  await providerManager.initialize();
  poller = new Poller(providerManager, settingsStore);

  setupIpc();
  setupPollerEvents();

  createFloatingBallWindow(isDev);
  broadcastSnapshot();

  createTray({
    getIcon: () => loadTrayIcon(settingsStore.get()),
    onRefresh: () => void poller.manualRefresh(),
    onTogglePause: () => {
      if (isPaused) {
        isPaused = false;
        settingsStore.update({ autoRefreshEnabled: true });
        poller.resume();
      } else {
        isPaused = true;
        settingsStore.update({ autoRefreshEnabled: false });
        poller.pause();
      }
      broadcastPollerState();
    },
    isPaused: () => isPaused || !settingsStore.get().autoRefreshEnabled,
    onOpenSettings: () => createSettingsWindow(isDev, settingsStore.get()),
    onQuit: () => app.quit(),
  });

  refreshAppIcons();

  isPaused = !settingsStore.get().autoRefreshEnabled;
  poller.start();

  log.info('Application started');
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
});

app.on('before-quit', () => {
  poller.destroy();
  providerManager.destroy();
  destroyTray();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createFloatingBallWindow(isDev);
  }
});
