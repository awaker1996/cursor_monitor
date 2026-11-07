import type {
  AppSettings,
  PollerState,
  PowerMode,
  TestConnectionResult,
  TokenSnapshot,
} from '../shared/types';
import type {
  CommandCodeSubscriptionData,
  CursorSubscriptionData,
  DeepSeekSubscriptionData,
  DeepSeekUsageData,
  SubscriptionCacheSnapshot,
  SubscriptionProviderId,
  SubscriptionProviderMeta,
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
  customIconPath: null,
  uiStyle: 'aurora',
  uiStyleDayStartMin: 420,
  uiStyleDayEndMin: 1140,
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

/* ── 订阅演示数据（仅浏览器预览）──
   让 /settings.html 在纯浏览器里也能看到三张已配置的账户卡：卡片头部、
   指标条、展开明细都有真实形状可核对。Electron 里走 preload 注入的真实 API，
   这段不会被使用。 */

const isoDaysFromNow = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString();

const DEMO_CURSOR_DATA: CursorSubscriptionData = {
  providerId: 'cursor',
  cursorModelsUsedPercent: 63,
  otherModelsUsedPercent: 27,
  cursorModelsTodayUsedPercent: 42,
  otherModelsTodayUsedPercent: 18,
  totalUsedPercent: 63,
  billingCycleStart: isoDaysFromNow(-22),
  billingCycleEnd: isoDaysFromNow(8),
  cursorModels: [
    { model: 'composer-1', tokens: 21_600_000, usagePercent: 38.1 },
    { model: 'auto', tokens: 14_200_000, usagePercent: 24.9 },
  ],
  otherModels: [
    { model: 'gpt-5', tokens: 6_100_000, usagePercent: 13.2 },
    { model: 'claude-sonnet-4.5', tokens: 4_300_000, usagePercent: 9.4 },
    { model: 'gemini-2.5-pro', tokens: 2_000_000, usagePercent: 4.4 },
  ],
  source: 'cookie',
  hasCookie: true,
  membershipType: 'pro',
  grokBot: {
    usedPercent: 12.4,
    periodStart: isoDaysFromNow(-3),
    resetsAt: isoDaysFromNow(4),
    hasAvailableUsage: true,
    hasNonZeroIncludedLimit: true,
    onDemandEligible: true,
    planLabel: 'Grok Bot Plan',
    brand: 'cursor',
  },
};

const DEMO_COMMANDCODE_DATA: CommandCodeSubscriptionData = {
  providerId: 'commandcode',
  account: { login: 'demo-user', orgId: 'org_demo', keyName: 'preview-key' },
  credits: {
    monthlyCredits: 500,
    purchasedCredits: 40,
    freeCredits: 20,
    remainingCredits: 312,
  },
  plan: {
    planId: 'pro',
    status: 'active',
    currentPeriodStart: isoDaysFromNow(-22),
    currentPeriodEnd: isoDaysFromNow(8),
  },
  summary: {
    totalCost: 12.4,
    totalCount: 128,
    totalTokens: 8_400_000,
    monthlyCreditsUsed: 188,
    totalTokensIn: 6_400_000,
    totalTokensOut: 2_000_000,
    completedCount: 124,
    failedCount: 4,
    successRate: 96.9,
    averageCost: 0.097,
    periodBasis: 'billing-period',
  },
  limits: [
    { key: 'fiveHour', used: 12, cap: 60, resetAt: Math.floor(Date.now() / 1000) + 3 * 3600 },
    { key: 'weekly', used: 140, cap: 300, resetAt: Math.floor(Date.now() / 1000) + 4 * 86_400 },
    { key: 'monthly', used: 188, cap: 500, resetAt: Math.floor(Date.now() / 1000) + 8 * 86_400 },
  ],
  unavailable: [],
  credentialSource: 'manual',
};

const DEMO_DEEPSEEK_DATA: DeepSeekSubscriptionData = {
  providerId: 'deepseek',
  isAvailable: true,
  balances: [
    {
      currency: 'CNY',
      totalBalance: '128.42',
      grantedBalance: '20.00',
      toppedUpBalance: '108.42',
    },
  ],
};

const DEMO_DEEPSEEK_USAGE: DeepSeekUsageData = {
  providerId: 'deepseek',
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  models: [
    {
      model: 'deepseek-chat',
      cacheHitTokens: 4_200_000,
      cacheMissTokens: 1_800_000,
      responseTokens: 1_100_000,
      requests: 820,
      totalTokens: 7_100_000,
      cacheHitRatePercent: 70,
    },
    {
      model: 'deepseek-reasoner',
      cacheHitTokens: 1_500_000,
      cacheMissTokens: 900_000,
      responseTokens: 700_000,
      requests: 260,
      totalTokens: 3_100_000,
      cacheHitRatePercent: 62.5,
    },
  ],
  totalTokens: 10_200_000,
  totalRequests: 1080,
  totalResponseTokens: 1_800_000,
  cacheHitRatePercent: 68,
  zeroUsageModelCount: 1,
};

const DEMO_PROVIDERS: SubscriptionProviderMeta[] = [
  { id: 'cursor', label: 'Cursor', configured: true, usageSupported: false, usageConfigured: false },
  {
    id: 'commandcode',
    label: 'Command Code',
    configured: true,
    usageSupported: true,
    usageConfigured: true,
  },
  { id: 'deepseek', label: 'DeepSeek', configured: true, usageSupported: true, usageConfigured: true },
];

const DEMO_SUBSCRIPTIONS: SubscriptionCacheSnapshot = {
  cursor: {
    info: {
      success: true,
      providerId: 'cursor',
      fetchedAt: isoDaysFromNow(-0.004),
      data: DEMO_CURSOR_DATA,
    },
  },
  commandcode: {
    info: {
      success: true,
      providerId: 'commandcode',
      fetchedAt: isoDaysFromNow(-0.006),
      data: DEMO_COMMANDCODE_DATA,
    },
  },
  deepseek: {
    info: {
      success: true,
      providerId: 'deepseek',
      fetchedAt: isoDaysFromNow(-0.008),
      data: DEMO_DEEPSEEK_DATA,
    },
    usage: {
      success: true,
      providerId: 'deepseek',
      fetchedAt: isoDaysFromNow(-0.008),
      data: DEMO_DEEPSEEK_USAGE,
    },
  },
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
    setEffectiveUiStyle: () => undefined,
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
    listSubscriptionProviders: async () => DEMO_PROVIDERS,
    getCachedSubscriptions: async () => DEMO_SUBSCRIPTIONS,
    saveSubscriptionKey: async () => true,
    clearSubscriptionKey: async () => true,
    fetchSubscriptionInfo: async (providerId: SubscriptionProviderId) => ({
      success: true,
      providerId,
      fetchedAt: new Date().toISOString(),
      data:
        providerId === 'cursor'
          ? DEMO_CURSOR_DATA
          : providerId === 'commandcode'
            ? DEMO_COMMANDCODE_DATA
            : DEMO_DEEPSEEK_DATA,
    }),
    fetchSubscriptionUsage: async (
      providerId: SubscriptionProviderId,
      _query: SubscriptionUsageQuery,
    ) => ({
      success: true,
      providerId,
      fetchedAt: new Date().toISOString(),
      data: providerId === 'deepseek' ? DEMO_DEEPSEEK_USAGE : null,
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
    // 浏览器预览没有电源信息，按接电源处理（动效全开）
    getPowerMode: async () => 'ac' as PowerMode,
    onPowerMode: () => () => undefined,
  };

  window.electronAPI = api;
}
