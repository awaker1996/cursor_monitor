import type {
  AppSettings,
  PollerState,
  TestConnectionResult,
  TokenSnapshot,
} from '../shared/types';
import type {
  SubscriptionCacheSnapshot,
  SubscriptionProviderId,
  SubscriptionUsageQuery,
} from '../shared/subscriptionTypes';
import type { ElectronAPI } from './vite-env';

/**
 * 仅用于纯浏览器开发预览（vite dev 下直接打开 /settings.html）。
 * Electron 运行时走 preload 注入的真实 API，此 mock 不会生效。
 */
const DEFAULT_SETTINGS: AppSettings = {
  autoRefreshEnabled: true,
  refreshIntervalSec: 30,
  requestTimeoutSec: 10,
  officialEndpoint: 'https://example.invalid/api/usage',
  cookieEndpoint: 'https://example.invalid/api/usage-summary',
  failureThreshold: 3,
  edgeAutoDockEnabled: true,
  includeGrokBotUsage: false,
  customIconPath: null,
  uiStyle: 'aurora',
};

/** 浏览器预览悬浮球时的示例数据（仅 mock，Electron 走真实快照）。 */
const DEMO_SNAPSHOT: TokenSnapshot = {
  source: 'cookie',
  auto: { remaining: 412, limit: 500, resetAt: null },
  api: { remaining: 36.5, limit: 50, resetAt: null },
  metrics: {
    totalUsedPercent: 63,
    apiUsedPercent: 27,
    autoUsedPercent: 63,
    apiTodayUsedPercent: 18,
    autoTodayUsedPercent: 42,
    totalUsed: 315,
    planLimit: 500,
    totalTokens: 48_200_000,
    apiTodayTokens: 3_400_000,
    autoTodayTokens: 8_900_000,
  },
  includedUsage: {
    available: true,
    categories: [
      {
        key: 'api',
        label: 'API 用量',
        totalTokens: 12_400_000,
        usagePercent: 27,
        models: [
          { model: 'gpt-5', tokens: 6_100_000, usagePercent: 13.2 },
          { model: 'claude-sonnet-4.5', tokens: 4_300_000, usagePercent: 9.4 },
          { model: 'claude-opus-4.1', tokens: 900_000, usagePercent: 2.1 },
          { model: 'gemini-2.5-pro', tokens: 2_000_000, usagePercent: 4.4 },
          { model: 'grok-4', tokens: 700_000, usagePercent: 1.6 },
          { model: 'deepseek-v3.2', tokens: 450_000, usagePercent: 0.9 },
        ],
      },
      {
        key: 'firstParty',
        label: 'Cursor 模型',
        totalTokens: 35_800_000,
        usagePercent: 63,
        models: [
          { model: 'composer-1', tokens: 21_600_000, usagePercent: 38.1 },
          { model: 'auto', tokens: 14_200_000, usagePercent: 24.9 },
        ],
      },
    ],
  },
  billingCycleStart: '2026-09-27',
  billingCycleEnd: '2026-10-27',
  membershipType: 'pro',
  fetchedAt: new Date().toISOString(),
  stale: false,
  rawVersion: 'mock',
};

const TEST_RESULT: TestConnectionResult = {
  success: true,
  message: '浏览器预览模式：跳过真实连接测试',
};

export function installBrowserMock(): void {
  if (typeof window === 'undefined' || window.electronAPI) return;

  const listeners = new Set<(s: AppSettings) => void>();
  let settings = { ...DEFAULT_SETTINGS };

  const api: ElectronAPI = {
    getSnapshot: async () => DEMO_SNAPSHOT,
    getPollerState: async (): Promise<PollerState> => ({
      status: 'running',
      fetching: false,
      activeProvider: 'cookie',
      failureCount: 0,
    }),
    getSettings: async () => settings,
    updateSettings: async (partial) => {
      settings = { ...settings, ...partial };
      listeners.forEach((fn) => fn(settings));
      return settings;
    },
    saveCookie: async () => undefined,
    clearCookie: async () => true,
    hasCookie: async () => false,
    testConnection: async () => TEST_RESULT,
    manualRefresh: async () => undefined,
    togglePause: async () => settings.autoRefreshEnabled,
    onSnapshot: () => () => undefined,
    onPollerState: () => () => undefined,
    onSettingsChanged: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    onDockStateChanged: () => () => undefined,
    openSettings: () => undefined,
    listSubscriptionProviders: async () => [
      {
        id: 'cursor',
        label: 'Cursor',
        configured: false,
        usageSupported: false,
        usageConfigured: false,
      },
    ],
    getCachedSubscriptions: async () => ({}) as SubscriptionCacheSnapshot,
    saveSubscriptionKey: async () => true,
    clearSubscriptionKey: async () => true,
    fetchSubscriptionInfo: async (providerId: SubscriptionProviderId) => ({
      success: false,
      providerId,
      message: '浏览器预览模式：无真实数据',
    }),
    fetchSubscriptionUsage: async (
      providerId: SubscriptionProviderId,
      _query: SubscriptionUsageQuery,
    ) => ({
      success: false,
      providerId,
      message: '浏览器预览模式：无真实数据',
    }),
    setOrbMode: () => undefined,
    setOrbModeAsync: async () => undefined,
    setExpanded: () => undefined,
    setExpandedPanelLayout: () => undefined,
    setIgnoreMouseEvents: () => undefined,
    getCursorInWindow: async () => null,
    moveWindow: () => undefined,
    finishWindowMove: () => undefined,
    undockWindow: () => undefined,
    getIconPreview: async () => null,
    selectCustomIcon: async () => ({
      success: true,
      message: '浏览器预览模式：仅演示',
    }),
    clearCustomIcon: async () => ({ success: true }),
    settingsWindowControl: () => undefined,
    settingsWindowIsMaximized: async () => false,
    onSettingsWindowMaximized: () => () => undefined,
  };

  window.electronAPI = api;
}
