import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { SettingsStore } from '../src/settings/SettingsStore';
import { credentialVault } from '../src/security/CredentialVault';
import { ProviderManager } from '../src/core/providers/ProviderManager';
import { Poller } from '../src/core/poller';
import { SubscriptionManager } from '../src/core/subscriptions/SubscriptionManager';
import { SubscriptionCache } from '../src/core/subscriptions/SubscriptionCache';
import {
  createFloatingBallWindow,
  enforceFloatingBallWidth,
  getDefaultFloatingBallBounds,
  getFloatingBallWindow,
  sendToFloatingBall,
} from './windows/floatingBall';
import { createSettingsWindow } from './windows/settings';
import { createTray, destroyTray, updateTrayIcon, updateTrayToolTip, type SettingsTab } from './tray';
import {
  clearDockState,
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
  type UsageFlowFetchResult,
  type UsageFlowQuery,
} from '../src/shared/types';
import type {
  SubscriptionCredentialKind,
  SubscriptionProviderId,
  SubscriptionUsageQuery,
} from '../src/shared/subscriptionTypes';
import { createLogger } from '../src/utils/logger';
import { formatTrayTooltip } from '../src/shared/format';

const log = createLogger('Main');
const isDev = !app.isPackaged;

let settingsStore: SettingsStore;
let providerManager: ProviderManager;
let subscriptionManager: SubscriptionManager;
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

function refreshTrayTooltip(): void {
  updateTrayToolTip(formatTrayTooltip(providerManager.getLastSnapshot()));
}

function broadcastSnapshot(): void {
  const snapshot = providerManager.getLastSnapshot();
  if (snapshot) {
    sendToFloatingBall('snapshot-updated', snapshot);
  }
  refreshTrayTooltip();
}

function broadcastPollerState(): void {
  sendToFloatingBall('poller-state', poller.getState());
}

function broadcastDockState(edge: import('../src/shared/types').DockEdge | null): void {
  sendToFloatingBall('dock-state-changed', edge);
}

function resetFloatingBallVisibility(): void {
  let win = getFloatingBallWindow();
  if (!win || win.isDestroyed()) {
    win = createFloatingBallWindow(isDev);
  }
  clearDockState();
  if (!win || win.isDestroyed()) return;

  const bounds = getDefaultFloatingBallBounds();
  win.setBounds(bounds);
  enforceFloatingBallWidth(win);
  win.setIgnoreMouseEvents(false);
  broadcastDockState(null);

  if (!win.isVisible()) {
    win.show();
  }
}

function refreshAppIcons(): void {
  updateTrayIcon(loadTrayIcon(settingsStore.get()));
}

function applyOrbMode(_mode: 'collapsed' | 'hover' | 'expanded'): void {
  // Renderer owns expanded/collapsed visuals. Never resize here — legacy hover
  // mode used to call setBounds(280×200) and bounce width after a while.
  const win = getFloatingBallWindow();
  if (!win || win.isDestroyed() || getDockState().docked) return;
  enforceFloatingBallWidth(win);
}

export type ExpandedPanelLayout = 'overview' | 'included';

function applyExpandedPanelLayout(_layout: ExpandedPanelLayout): void {
  // Overview and included share the same undocked capacity; no resize on tab switch.
  const win = getFloatingBallWindow();
  if (!win || win.isDestroyed() || getDockState().docked) return;
  enforceFloatingBallWidth(win);
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
    const startedAt = Date.now();
    try {
      const hasCookie = await credentialVault.hasCookie();
      if (!hasCookie) {
        return { success: false, message: '请先配置 Cookie', durationMs: Date.now() - startedAt };
      }
      const snapshot = await providerManager.testCookieConnection();
      broadcastSnapshot();
      return {
        success: true,
        message: 'Cookie 接口调用成功，已解析用量数据',
        durationMs: Date.now() - startedAt,
        snapshot,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message, durationMs: Date.now() - startedAt };
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

  ipcMain.on('open-flow', () => {
    createSettingsWindow(isDev, settingsStore.get(), 'flow');
  });

  ipcMain.on('open-subscriptions', () => {
    createSettingsWindow(isDev, settingsStore.get(), 'subscriptions');
  });

  ipcMain.handle('subscription-list-providers', () => subscriptionManager.listProviders());

  ipcMain.handle('subscription-get-cached', () => subscriptionManager.getCached());

  ipcMain.handle(
    'subscription-save-key',
    async (
      _event,
      providerId: SubscriptionProviderId,
      key: string,
      kind?: SubscriptionCredentialKind,
    ) => {
      if (!key || !key.trim()) throw new Error('凭据不能为空');
      await subscriptionManager.saveKey(providerId, key, kind ?? 'apiKey');
      return true;
    },
  );

  ipcMain.handle(
    'subscription-clear-key',
    async (_event, providerId: SubscriptionProviderId, kind?: SubscriptionCredentialKind) => {
      await subscriptionManager.clearKey(providerId, kind ?? 'apiKey');
      return true;
    },
  );

  ipcMain.handle('subscription-fetch-info', (_event, providerId: SubscriptionProviderId) =>
    subscriptionManager.fetchInfo(providerId),
  );

  ipcMain.handle(
    'subscription-fetch-usage',
    (_event, providerId: SubscriptionProviderId, query: SubscriptionUsageQuery) => {
      const month = Number.isInteger(query?.month) ? query.month : 0;
      const year = Number.isInteger(query?.year) ? query.year : 0;
      if (month < 1 || month > 12 || year < 2000 || year > 2100) {
        return { success: false, providerId, message: '无效的查询月份' };
      }
      return subscriptionManager.fetchUsage(providerId, { month, year });
    },
  );

  ipcMain.handle(
    'fetch-usage-flow',
    async (_event, query: UsageFlowQuery, dateRangeLabel?: string): Promise<UsageFlowFetchResult> => {
      if (!query || !Number.isFinite(query.startDateMs) || !Number.isFinite(query.endDateMs)) {
        return { success: false, hasCookie: false, message: '无效的日期范围' };
      }
      const page = Number.isFinite(query.page) && query.page >= 1 ? Math.floor(query.page) : 1;
      const pageSize =
        Number.isFinite(query.pageSize) && query.pageSize! >= 1
          ? Math.min(Math.floor(query.pageSize!), 100)
          : 100;
      return providerManager.fetchUsageFlow(
        {
          startDateMs: query.startDateMs,
          endDateMs: query.endDateMs,
          page,
          pageSize,
          platform: query.platform,
          preset: query.preset,
        },
        dateRangeLabel,
      );
    },
  );

  ipcMain.handle('flow-get-cached', () => providerManager.getCachedUsageFlow());

  ipcMain.on('set-orb-mode', (_event, mode: 'collapsed' | 'hover' | 'expanded') => {
    applyOrbMode(mode);
  });

  ipcMain.handle('set-orb-mode-async', (_event, mode: 'collapsed' | 'hover' | 'expanded') => {
    applyOrbMode(mode);
  });

  // Backward compatibility for older renderer builds — window stays fixed size
  ipcMain.on('set-expanded', () => {});

  ipcMain.on('set-expanded-panel-layout', (_event, layout: ExpandedPanelLayout) => {
    applyExpandedPanelLayout(layout);
  });

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
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;
    if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
      return null;
    }
    return { x, y };
  });

  ipcMain.on('move-window', (event, payload: {
    dx: number;
    dy: number;
    grabOffset?: { x: number; y: number };
  }) => {
    const { dx, dy, grabOffset } = payload;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (getDockState().docked) {
      const undocked = handleMoveWhileDocked(win, dx, dy, grabOffset);
      if (undocked) {
        broadcastDockState(null);
      }
      return;
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
      refreshTrayTooltip();
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
  subscriptionManager = new SubscriptionManager(
    settingsStore,
    new SubscriptionCache(),
    () => providerManager.getLastSnapshot(),
  );
  poller = new Poller(providerManager, settingsStore);

  setupIpc();
  setupPollerEvents();

  createFloatingBallWindow(isDev);
  broadcastSnapshot();

  createTray({
    getIcon: () => loadTrayIcon(settingsStore.get()),
    onOpenSettings: (tab?: SettingsTab) => createSettingsWindow(isDev, settingsStore.get(), tab),
    onResetFloatingBall: () => resetFloatingBallVisibility(),
    onQuit: () => app.quit(),
  });

  refreshTrayTooltip();

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
