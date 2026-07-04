import type { TokenSnapshot, UsageMetrics } from './types';

export function formatTokenCount(value: number | null): string {
  if (value === null || value === undefined) return '--';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function formatPercent(remaining: number | null, limit: number | null): string {
  if (remaining === null || limit === null || limit === 0) return '--';
  return `${Math.round((remaining / limit) * 100)}%`;
}

export function formatUsedPercent(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return `${value.toFixed(2)}%`;
}

export function totalRemaining(snapshot: TokenSnapshot | null): number | null {
  if (!snapshot) return null;
  const values = [snapshot.auto.remaining, snapshot.api.remaining].filter(
    (v): v is number => v !== null,
  );
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0);
}

export function totalLimit(snapshot: TokenSnapshot | null): number | null {
  if (!snapshot) return null;
  const values = [snapshot.auto.limit, snapshot.api.limit].filter(
    (v): v is number => v !== null,
  );
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0);
}

export type MetricStatusLevel = 'ok' | 'warn' | 'danger' | 'unknown';
export type MetricAccent = 'total' | 'api' | 'auto' | 'neutral';

/** Official Cursor dashboard label for auto/composer usage. */
export const AUTO_COMPOSER_LABEL = 'Auto + Composer';

export interface MetricDisplayItem {
  key: string;
  label: string;
  percent: string;
  percentValue: number | null;
  detail?: string;
  statusLevel: MetricStatusLevel;
  accent: MetricAccent;
}

export interface DashboardSummary {
  totalPercent: string;
  totalPercentValue: number | null;
  totalTokens: string;
  billingPeriod: BillingPeriodDisplay | null;
  statusLevel: MetricStatusLevel;
  sourceLabel: string;
  updatedAt: string;
}

export interface BillingPeriodDisplay {
  start: string | null;
  end: string | null;
}

function hasTimeComponent(iso: string): boolean {
  return /T\d{2}:\d{2}/.test(iso);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatBillingDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const datePart = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (!hasTimeComponent(iso)) return datePart;

  return `${datePart} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function buildBillingPeriodDisplay(
  start: string | null | undefined,
  end: string | null | undefined,
): BillingPeriodDisplay | null {
  const startLabel = formatBillingDate(start);
  const endLabel = formatBillingDate(end);
  if (!startLabel && !endLabel) return null;
  return { start: startLabel, end: endLabel };
}

function emptyMetrics(): UsageMetrics {
  return {
    totalUsedPercent: null,
    apiUsedPercent: null,
    autoUsedPercent: null,
    apiTodayUsedPercent: null,
    autoTodayUsedPercent: null,
    totalTokens: null,
    apiTokens: null,
    autoTokens: null,
    apiTodayTokens: null,
    autoTodayTokens: null,
  };
}

function normalizePercentValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const clamped = Math.max(0, Math.min(100, value));
  return Math.round(clamped * 100) / 100;
}

export function getPercentStatusLevel(percent: number | null): MetricStatusLevel {
  if (percent === null) return 'unknown';
  if (percent >= 85) return 'danger';
  if (percent >= 60) return 'warn';
  return 'ok';
}

function formatTokenDetail(tokens: number | null | undefined): string | undefined {
  if (tokens == null || tokens <= 0) return undefined;
  return `${formatTokenCount(tokens)} tokens`;
}

function buildMetricItem(
  key: string,
  label: string,
  percentRaw: number | null | undefined,
  tokens: number | null | undefined,
  accent: MetricAccent,
): MetricDisplayItem {
  const percentValue = normalizePercentValue(percentRaw);
  return {
    key,
    label,
    percent: formatUsedPercent(percentRaw ?? null),
    percentValue,
    detail: formatTokenDetail(tokens),
    statusLevel: getPercentStatusLevel(percentRaw ?? null),
    accent,
  };
}

export function buildMetricItems(metrics: UsageMetrics | undefined): MetricDisplayItem[] {
  const m = metrics ?? emptyMetrics();
  // 今日消耗优先展示；总消耗已在顶部 dashboard-summary 单独呈现，这里不再重复。
  return [
    buildMetricItem('apiToday', '今日 API', m.apiTodayUsedPercent, m.apiTodayTokens, 'api'),
    buildMetricItem(
      'autoToday',
      `今日 ${AUTO_COMPOSER_LABEL}`,
      m.autoTodayUsedPercent,
      m.autoTodayTokens,
      'auto',
    ),
    buildMetricItem('api', '周期 API', m.apiUsedPercent, m.apiTokens, 'api'),
    buildMetricItem(
      'auto',
      `周期 ${AUTO_COMPOSER_LABEL}`,
      m.autoUsedPercent,
      m.autoTokens,
      'auto',
    ),
  ];
}

export function buildDashboardSummary(snapshot: TokenSnapshot | null): DashboardSummary | null {
  if (!snapshot) return null;

  const percentValue = normalizePercentValue(snapshot.metrics.totalUsedPercent);
  return {
    totalPercent: formatUsedPercent(snapshot.metrics.totalUsedPercent),
    totalPercentValue: percentValue,
    totalTokens: formatTokenDetail(snapshot.metrics.totalTokens) ?? 'token 明细不可用',
    billingPeriod: buildBillingPeriodDisplay(snapshot.billingCycleStart, snapshot.billingCycleEnd),
    statusLevel: getPercentStatusLevel(snapshot.metrics.totalUsedPercent),
    sourceLabel: snapshot.source === 'official' ? '官方' : 'Cookie',
    updatedAt: new Date(snapshot.fetchedAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

/** Short label for collapsed floating ball: total used percent. */
export function formatOrbSummary(snapshot: TokenSnapshot | null): {
  label: string;
  value: string;
} {
  if (!snapshot) {
    return {
      label: '消耗',
      value: '--',
    };
  }

  return {
    label: '消耗',
    value: formatUsedPercent(snapshot.metrics.totalUsedPercent),
  };
}
