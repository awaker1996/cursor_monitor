import type { TokenSnapshot, UsageMetrics } from './types';

export function formatIncludedUsageTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '--';
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(Math.round(value));
}

export function formatUsageFlowDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const hour = pick('hour');
  const minute = pick('minute');

  if (!year || !month || !day) return '--';
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

export function formatBillingPeriodLabel(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Shanghai',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  const formatOne = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', opts);
  };
  const startLabel = formatOne(start);
  const endLabel = formatOne(end);
  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel ?? endLabel;
}

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

/** Official Cursor dashboard label for the Cursor-owned models usage pool (formerly First-party models / Auto + Composer). */
export const CURSOR_MODELS_LABEL = 'Cursor Models';

/** Official Cursor dashboard label for the non-Cursor models usage pool (formerly API). */
export const OTHER_MODELS_LABEL = 'Other Models';

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
  statusLevel: MetricStatusLevel;
  sourceLabel: string;
  updatedAt: string;
}

export interface BillingPeriodDisplay {
  start: string | null;
  end: string | null;
}

export interface IncludedUsageModelRow {
  model: string;
  tokens: string;
  usage: string;
}

export interface IncludedUsageCategoryRow {
  key: string;
  label: string;
  tokens: string;
  usage: string;
  models: IncludedUsageModelRow[];
}

export interface IncludedUsageDisplay {
  title: string;
  dateRange: string | null;
  columns: [string, string, string];
  categories: IncludedUsageCategoryRow[];
  showIncompleteHint: boolean;
}

function formatIncludedUsageDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const formatOne = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', opts);
  };
  const startLabel = formatOne(start);
  const endLabel = formatOne(end);
  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel ?? endLabel;
}

export function buildIncludedUsageDisplay(snapshot: TokenSnapshot | null): IncludedUsageDisplay | null {
  if (!snapshot) return null;
  const breakdown = snapshot.includedUsage;
  if (!breakdown?.available || breakdown.categories.length === 0) return null;

  return {
    title: 'Included Usage',
    dateRange: formatIncludedUsageDateRange(snapshot.billingCycleStart, snapshot.billingCycleEnd),
    columns: ['Item', 'Tokens', 'Usage'],
    categories: breakdown.categories.map((category) => ({
      key: category.key,
      label: category.label,
      tokens: formatIncludedUsageTokens(category.totalTokens),
      usage: formatUsedPercent(category.usagePercent),
      models: category.models.map((model) => ({
        model: model.model,
        tokens: formatIncludedUsageTokens(model.tokens),
        usage: formatUsedPercent(model.usagePercent),
      })),
    })),
    showIncompleteHint: breakdown.incomplete === true,
  };
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
  if (tokens == null) return undefined;
  if (tokens <= 0) return '0 tokens';
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
    buildMetricItem(
      'autoToday',
      `今日 ${CURSOR_MODELS_LABEL}`,
      m.autoTodayUsedPercent,
      m.autoTodayTokens,
      'auto',
    ),
    buildMetricItem('apiToday', `今日 ${OTHER_MODELS_LABEL}`, m.apiTodayUsedPercent, m.apiTodayTokens, 'api'),
    buildMetricItem(
      'auto',
      `周期 ${CURSOR_MODELS_LABEL}`,
      m.autoUsedPercent,
      m.autoTokens,
      'auto',
    ),
    buildMetricItem('api', `周期 ${OTHER_MODELS_LABEL}`, m.apiUsedPercent, m.apiTokens, 'api'),
  ];
}

export function buildDashboardSummary(snapshot: TokenSnapshot | null): DashboardSummary | null {
  if (!snapshot) return null;

  const percentValue = normalizePercentValue(snapshot.metrics.totalUsedPercent);
  return {
    totalPercent: formatUsedPercent(snapshot.metrics.totalUsedPercent),
    totalPercentValue: percentValue,
    totalTokens: formatTokenDetail(snapshot.metrics.totalTokens) ?? 'token 明细不可用',
    statusLevel: getPercentStatusLevel(snapshot.metrics.totalUsedPercent),
    sourceLabel: snapshot.source === 'official' ? '官方' : 'Cookie',
    updatedAt: new Date(snapshot.fetchedAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

export function computeRemainingPercentValue(
  remaining: number | null,
  limit: number | null,
): number | null {
  if (remaining === null || limit === null || limit === 0) return null;
  return normalizePercentValue((remaining / limit) * 100);
}

function computeRemainingPercentFromUsed(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return normalizePercentValue(100 - value);
}

/** 由「已用百分比」换算「剩余百分比」文本，与 formatUsedPercent 两位小数口径对齐。 */
export function formatRemainingFromUsedPercent(value: number | null | undefined): string {
  const remaining = computeRemainingPercentFromUsed(value);
  if (remaining === null) return '--';
  return `${remaining.toFixed(2)}%`;
}

function formatRemainingPercentValue(value: number | null): string {
  if (value === null) return '--';
  return `${Math.round(value)}%`;
}

/** Short label for collapsed floating ball: total remaining percent. */
export function formatOrbSummary(snapshot: TokenSnapshot | null): {
  label: string;
  value: string;
  percentValue: number | null;
} {
  if (!snapshot) {
    return {
      label: '余量',
      value: '--',
      percentValue: null,
    };
  }

  const dashboardRemaining = computeRemainingPercentFromUsed(snapshot.metrics.totalUsedPercent);
  if (dashboardRemaining !== null) {
    return {
      label: '余量',
      value: formatRemainingPercentValue(dashboardRemaining),
      percentValue: dashboardRemaining,
    };
  }

  const remaining = totalRemaining(snapshot);
  const limit = totalLimit(snapshot);
  return {
    label: '余量',
    value: formatPercent(remaining, limit),
    percentValue: computeRemainingPercentValue(remaining, limit),
  };
}

/**
 * Multi-line tray tooltip: one metric per line, with source and update time
 * sharing the last line. Model labels are padded so the metric lines end at
 * the same column.
 */
export function formatTrayTooltip(snapshot: TokenSnapshot | null): string {
  if (!snapshot) {
    return '暂无数据';
  }

  const m = snapshot.metrics;
  const sourceLabel = snapshot.source === 'official' ? '官方' : 'Cookie';
  const updatedAt = new Date(snapshot.fetchedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const modelsWidth = Math.max(CURSOR_MODELS_LABEL.length, OTHER_MODELS_LABEL.length);
  const cursorModels = CURSOR_MODELS_LABEL.padEnd(modelsWidth);
  const otherModels = OTHER_MODELS_LABEL.padEnd(modelsWidth);

  return [
    `总消耗 ${formatUsedPercent(m.totalUsedPercent ?? null)}`,
    `今日 ${cursorModels} ${formatUsedPercent(m.autoTodayUsedPercent ?? null)}`,
    `今日 ${otherModels} ${formatUsedPercent(m.apiTodayUsedPercent ?? null)}`,
    `周期 ${cursorModels} ${formatUsedPercent(m.autoUsedPercent ?? null)}`,
    `周期 ${otherModels} ${formatUsedPercent(m.apiUsedPercent ?? null)}`,
    `来源 ${sourceLabel}  更新 ${updatedAt}`,
  ].join('\n');
}
