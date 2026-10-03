import type {
  AppSettings,
  PollerState,
  TestConnectionResult,
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
    getSnapshot: async () => null,
    getPollerState: async (): Promise<PollerState> => ({
      status: 'idle',
      fetching: false,
      activeProvider: 'official',
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
  };

  window.electronAPI = api;
}
