import type { UsageFlowPreset } from './usageFlowDates';

export type DataSource = 'official' | 'cookie';

export interface TokenQuota {
  remaining: number | null;
  limit: number | null;
  resetAt?: string | null;
}

export type OrbWindowMode = 'collapsed' | 'hover' | 'expanded';

export type DockEdge = 'left' | 'right' | 'top' | 'bottom';

export interface ModelUsageItem {
  model: string;
  tokens: number;
  usagePercent: number | null;
}

export interface IncludedUsageCategory {
  key: 'api' | 'firstParty';
  label: string;
  totalTokens: number | null;
  usagePercent: number | null;
  models: ModelUsageItem[];
}

export interface IncludedUsageBreakdown {
  available: boolean;
  incomplete?: boolean;
  categories: IncludedUsageCategory[];
}

export interface UsageFlowEntry {
  timestamp: string;
  date: string;
  type: string;
  model: string;
  modelMax?: boolean;
  tokens: string;
  cost: string;
  /** 数据来源平台 */
  platform?: string;
}

export interface UsageFlowDisplay {
  available: boolean;
  incomplete?: boolean;
  totalCount?: number;
  page: number;
  pageSize: number;
  totalPages: number;
  dateRangeLabel?: string;
  billingPeriod?: { start: string | null; end: string | null };
  entries: UsageFlowEntry[];
}

export interface UsageFlowQuery {
  startDateMs: number;
  endDateMs: number;
  page: number;
  pageSize?: number;
  /** 订阅平台筛选，默认 cursor */
  platform?: FlowPlatform;
  /** 日期预设，随缓存一并保存以恢复上次视图。 */
  preset?: UsageFlowPreset;
}

/** 流水支持的平台 */
export type FlowPlatform = 'cursor' | 'commandcode' | 'deepseek';

export interface UsageFlowFetchResult {
  success: boolean;
  message?: string;
  hasCookie: boolean;
  data?: UsageFlowDisplay | null;
}

/** 主进程内存缓存的单平台流水视图：查询条件 + 上次成功结果，供重新进入页面时回填。 */
export interface UsageFlowCacheEntry {
  platform: FlowPlatform;
  startDateMs: number;
  endDateMs: number;
  dateRangeLabel: string;
  preset: UsageFlowPreset;
  page: number;
  pageSize: number;
  result: UsageFlowFetchResult;
  fetchedAt: string;
}

export interface UsageFlowCacheSnapshot {
  lastPlatform: FlowPlatform | null;
  entries: Partial<Record<FlowPlatform, UsageFlowCacheEntry>>;
}

export interface UsageMetrics {
  totalUsedPercent: number | null;
  apiUsedPercent: number | null;
  autoUsedPercent: number | null;
  apiTodayUsedPercent: number | null;
  autoTodayUsedPercent: number | null;
  totalUsed?: number | null;
  apiUsed?: number | null;
  autoUsed?: number | null;
  apiTodayUsed?: number | null;
  autoTodayUsed?: number | null;
  planLimit?: number | null;
  totalTokens?: number | null;
  apiTokens?: number | null;
  autoTokens?: number | null;
  apiTodayTokens?: number | null;
  autoTodayTokens?: number | null;
}

export interface TokenSnapshot {
  source: DataSource;
  auto: TokenQuota;
  api: TokenQuota;
  metrics: UsageMetrics;
  includedUsage?: IncludedUsageBreakdown | null;
  billingCycleStart?: string | null;
  billingCycleEnd?: string | null;
  fetchedAt: string;
  stale: boolean;
  rawVersion: string;
}

export interface ProviderHealth {
  name: string;
  available: boolean;
  consecutiveFailures: number;
  lastError?: string;
  lastSuccessAt?: string;
}

export interface PollerState {
  status: 'idle' | 'running' | 'backoff' | 'paused';
  fetching: boolean;
  activeProvider: DataSource;
  failureCount: number;
  nextRefreshAt?: string;
  backoffMs?: number;
  lastError?: string;
}

export interface AppSettings {
  autoRefreshEnabled: boolean;
  refreshIntervalSec: number;
  requestTimeoutSec: number;
  officialEndpoint: string;
  cookieEndpoint: string;
  failureThreshold: number;
  edgeAutoDockEnabled: boolean;
  customIconPath?: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoRefreshEnabled: true,
  refreshIntervalSec: 30,
  requestTimeoutSec: 10,
  officialEndpoint: 'https://www.cursor.com/api/usage',
  cookieEndpoint: 'https://cursor.com/api/usage-summary',
  failureThreshold: 3,
  edgeAutoDockEnabled: true,
  customIconPath: null,
};

export const REFRESH_INTERVAL_MIN = 30;
export const REFRESH_INTERVAL_MAX = 3600;

export const BACKOFF_SEQUENCE_MS = [30_000, 60_000, 120_000, 300_000];

export interface RawOfficialResponse {
  autoRemaining?: number | null;
  autoLimit?: number | null;
  autoResetAt?: string | null;
  apiRemaining?: number | null;
  apiLimit?: number | null;
  apiResetAt?: string | null;
  // Alternative nested shapes
  auto?: { remaining?: number; limit?: number; resetAt?: string };
  api?: { remaining?: number; limit?: number; resetAt?: string };
  usage?: {
    auto?: { remaining?: number; limit?: number; resetAt?: string };
    api?: { remaining?: number; limit?: number; resetAt?: string };
  };
}

export interface RawUsageEvent {
  timestamp?: string;
  model?: string;
  kind?: string;
  requestsCosts?: number;
  requestCosts?: number;
  usageBasedCosts?: string;
  chargedCents?: number;
  totalCents?: number;
  costCents?: number;
  cursorTokenFee?: number;
  cost?: string | number;
  costDisplay?: string;
  isChargeable?: boolean;
  isTokenBasedCall?: boolean;
  maxMode?: boolean;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalCents?: number;
    chargedCents?: number;
  };
}

export interface RawUsageEventsResponse {
  totalUsageEventsCount?: number;
  usageEventsDisplay?: RawUsageEvent[];
  /** False when pagination was truncated or the fetch aborted mid-stream. */
  eventsComplete?: boolean;
}

/** Per-model row from `get-aggregated-usage-events` (Billing Included Usage source). */
export interface RawAggregatedUsageItem {
  modelIntent?: string;
  inputTokens?: string | number;
  outputTokens?: string | number;
  cacheWriteTokens?: string | number;
  cacheReadTokens?: string | number;
  totalCents?: number | null;
  /** Cursor pricing pool: 1 ≈ Other Models (named models), 2 ≈ Cursor Models. */
  tier?: number | null;
}

export interface RawAggregatedUsageResponse {
  aggregations?: RawAggregatedUsageItem[];
  totalInputTokens?: string | number;
  totalOutputTokens?: string | number;
  totalCacheWriteTokens?: string | number;
  totalCacheReadTokens?: string | number;
  totalCostCents?: number | null;
}

export interface RawCookieCombinedResponse {
  summary: RawCookieResponse;
  todayEvents?: RawUsageEventsResponse | null;
  cycleEvents?: RawUsageEventsResponse | null;
  /** Prefer this for Included Usage; cycleEvents remain a fallback. */
  aggregatedUsage?: RawAggregatedUsageResponse | null;
}

export interface RawCookiePlanUsage {
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  autoPercentUsed?: number | null;
  apiPercentUsed?: number | null;
  totalPercentUsed?: number | null;
  breakdown?: {
    included?: number | null;
    bonus?: number | null;
    total?: number | null;
  };
}

export interface RawCookieResponse {
  billingCycleStart?: string | null;
  billingCycleEnd?: string | null;
  individualUsage?: {
    plan?: RawCookiePlanUsage;
    /** Enterprise/team individual allocation when `plan` is absent. */
    overall?: RawCookiePlanUsage;
  };
  usage?: {
    auto?: { left?: number; cap?: number; reset_time?: string };
    api?: { left?: number; cap?: number; reset_time?: string };
  };
  autoRemaining?: number | null;
  autoLimit?: number | null;
  autoResetAt?: string | null;
  apiRemaining?: number | null;
  apiLimit?: number | null;
  apiResetAt?: string | null;
}

export interface ProviderResult {
  raw: unknown;
  source: DataSource;
  rawVersion: string;
}

export interface TokenProvider {
  readonly name: DataSource;
  fetch(): Promise<ProviderResult>;
  isConfigured(): Promise<boolean>;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  durationMs?: number;
  snapshot?: TokenSnapshot;
}
