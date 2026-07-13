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

export const REFRESH_INTERVAL_MIN = 10;
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
}

/** Per-model row from `get-aggregated-usage-events` (Billing Included Usage source). */
export interface RawAggregatedUsageItem {
  modelIntent?: string;
  inputTokens?: string | number;
  outputTokens?: string | number;
  cacheWriteTokens?: string | number;
  cacheReadTokens?: string | number;
  totalCents?: number | null;
  /** Cursor pricing pool: 1 ≈ API / named models, 2 ≈ First-party. */
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

export interface RawCookieResponse {
  billingCycleStart?: string | null;
  billingCycleEnd?: string | null;
  individualUsage?: {
    plan?: {
      used?: number | null;
      limit?: number | null;
      remaining?: number | null;
      autoPercentUsed?: number | null;
      apiPercentUsed?: number | null;
      totalPercentUsed?: number | null;
    };
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
  snapshot?: TokenSnapshot;
}
