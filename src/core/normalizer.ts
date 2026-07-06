import type {
  DataSource,
  RawCookieCombinedResponse,
  RawCookieResponse,
  RawOfficialResponse,
  RawUsageEvent,
  RawUsageEventsResponse,
  TokenQuota,
  TokenSnapshot,
  UsageMetrics,
} from '../shared/types';

export { formatTokenCount, formatPercent, totalRemaining } from '../shared/format';

function toQuota(
  remaining?: number | null,
  limit?: number | null,
  resetAt?: string | null,
): TokenQuota {
  return {
    remaining: remaining ?? null,
    limit: limit ?? null,
    resetAt: resetAt ?? null,
  };
}

function isEmptyQuota(quota: TokenQuota): boolean {
  return quota.remaining === null && quota.limit === null;
}

function asNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function parseMoneyToCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value * 100;
  const text = String(value).trim();
  if (!text || text === '-' || /^included$/i.test(text)) return null;
  const numeric = Number(text.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return numeric * 100;
}

function eventCostCents(event: RawUsageEvent): number | null {
  const tokenUsage = event.tokenUsage ?? {};
  const direct = firstFiniteNumber(
    event.chargedCents,
    tokenUsage.chargedCents,
    tokenUsage.totalCents,
    event.totalCents,
    event.costCents,
  );
  if (direct !== null && direct > 0) return direct;

  const usageBased = parseMoneyToCents(event.usageBasedCosts ?? event.cost ?? event.costDisplay);
  if (usageBased !== null && usageBased > 0) return usageBased;

  const requestsCosts = firstFiniteNumber(event.requestsCosts, event.requestCosts);
  if (requestsCosts !== null && requestsCosts > 0) return requestsCosts * 100;

  const tokenFee = firstFiniteNumber(event.cursorTokenFee);
  if (tokenFee !== null && tokenFee > 0) return tokenFee;

  return null;
}

function quotaFromPercent(
  percentUsed: number | null | undefined,
  limit: number | null,
  resetAt?: string | null,
): TokenQuota {
  if (percentUsed === null || percentUsed === undefined || limit === null) {
    return toQuota(null, null, resetAt);
  }
  const used = Math.round((limit * percentUsed) / 100);
  return toQuota(Math.max(limit - used, 0), limit, resetAt);
}

function usedFromPercent(percentUsed: number | null | undefined, limit: number | null): number | null {
  if (percentUsed === null || percentUsed === undefined || limit === null) return null;
  return Math.round((limit * percentUsed) / 100);
}

function percentFromUsed(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || limit === 0) return null;
  return (used / limit) * 100;
}

function isAutoModel(model: string | undefined): boolean {
  if (!model) return false;
  const normalized = model.toLowerCase();
  return (
    normalized.includes('composer') ||
    normalized.includes('auto') ||
    normalized.includes('cursor-small') ||
    normalized.includes('default')
  );
}

function eventTokens(event: RawUsageEvent): number {
  const usage = event.tokenUsage;
  if (!usage) return 0;
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  );
}

function todayUsedPercent(
  todayCostCents: number,
  cycleCostCents: number,
  todayTokens: number,
  cycleTokens: number,
  cyclePercent: number | null,
): number | null {
  if (cyclePercent === null) return null;

  const costBased =
    cycleCostCents > 0 && todayCostCents > 0
      ? (todayCostCents / cycleCostCents) * cyclePercent
      : null;
  const tokenBased =
    cycleTokens > 0 && todayTokens > 0 ? (todayTokens / cycleTokens) * cyclePercent : null;

  // Dashboard usage events occasionally miss historical cost fields.
  // In that case, cost-based derivation collapses to "today == cycle" even
  // when cycle token volume is clearly larger than today's token volume.
  if (costBased !== null && tokenBased !== null) {
    const costShare = todayCostCents / cycleCostCents;
    const tokenShare = todayTokens / cycleTokens;
    const suspiciousCostShare =
      costShare >= 0.999 &&
      tokenShare < 0.999 &&
      cycleTokens - todayTokens >= 1000;
    const picked = suspiciousCostShare ? tokenBased : costBased;
    return Math.max(0, Math.min(cyclePercent, picked));
  }

  if (costBased !== null) return Math.max(0, Math.min(cyclePercent, costBased));
  if (tokenBased !== null) return Math.max(0, Math.min(cyclePercent, tokenBased));

  return null;
}

interface TokenAggregate {
  apiTokens: number;
  autoTokens: number;
  apiCycleCostCents: number;
  autoCycleCostCents: number;
  apiTodayTokens: number;
  autoTodayTokens: number;
  apiTodayCostCents: number;
  autoTodayCostCents: number;
}

function aggregateTokenEvents(
  cycleEvents: RawUsageEventsResponse | null | undefined,
  todayEvents: RawUsageEventsResponse | null | undefined,
  apiUsedPercent: number | null,
  autoUsedPercent: number | null,
): Pick<
  UsageMetrics,
  | 'totalTokens'
  | 'apiTokens'
  | 'autoTokens'
  | 'apiTodayTokens'
  | 'autoTodayTokens'
  | 'apiTodayUsedPercent'
  | 'autoTodayUsedPercent'
  | 'apiTodayUsed'
  | 'autoTodayUsed'
> {
  const result: TokenAggregate = {
    apiTokens: 0,
    autoTokens: 0,
    apiCycleCostCents: 0,
    autoCycleCostCents: 0,
    apiTodayTokens: 0,
    autoTodayTokens: 0,
    apiTodayCostCents: 0,
    autoTodayCostCents: 0,
  };

  for (const event of cycleEvents?.usageEventsDisplay ?? []) {
    const tokens = eventTokens(event);
    const costCents = eventCostCents(event) ?? 0;
    if (isAutoModel(event.model)) {
      if (tokens > 0) result.autoTokens += tokens;
      if (costCents > 0) result.autoCycleCostCents += costCents;
    } else {
      if (tokens > 0) result.apiTokens += tokens;
      if (costCents > 0) result.apiCycleCostCents += costCents;
    }
  }

  for (const event of todayEvents?.usageEventsDisplay ?? []) {
    const tokens = eventTokens(event);
    const costCents = eventCostCents(event) ?? 0;
    if (isAutoModel(event.model)) {
      result.autoTodayTokens += tokens;
      if (costCents > 0) result.autoTodayCostCents += costCents;
    } else {
      result.apiTodayTokens += tokens;
      if (costCents > 0) result.apiTodayCostCents += costCents;
    }
  }

  return {
    totalTokens:
      result.apiTokens + result.autoTokens > 0 ? result.apiTokens + result.autoTokens : null,
    apiTokens: result.apiTokens > 0 ? result.apiTokens : null,
    autoTokens: result.autoTokens > 0 ? result.autoTokens : null,
    apiTodayTokens: result.apiTodayTokens > 0 ? result.apiTodayTokens : null,
    autoTodayTokens: result.autoTodayTokens > 0 ? result.autoTodayTokens : null,
    apiTodayUsed:
      result.apiTodayCostCents > 0 ? result.apiTodayCostCents / 100 : null,
    autoTodayUsed:
      result.autoTodayCostCents > 0 ? result.autoTodayCostCents / 100 : null,
    apiTodayUsedPercent: todayUsedPercent(
      result.apiTodayCostCents,
      result.apiCycleCostCents,
      result.apiTodayTokens,
      result.apiTokens,
      apiUsedPercent,
    ),
    autoTodayUsedPercent: todayUsedPercent(
      result.autoTodayCostCents,
      result.autoCycleCostCents,
      result.autoTodayTokens,
      result.autoTokens,
      autoUsedPercent,
    ),
  };
}

function buildMetricsFromPlan(
  plan: NonNullable<NonNullable<RawCookieResponse['individualUsage']>['plan']>,
  cycleEvents?: RawUsageEventsResponse | null,
  todayEvents?: RawUsageEventsResponse | null,
): UsageMetrics {
  const limit = asNumber(plan?.limit);
  const totalUsedPercent = asNumber(plan?.totalPercentUsed);
  const apiUsedPercent = asNumber(plan?.apiPercentUsed);
  const autoUsedPercent = asNumber(plan?.autoPercentUsed);
  const tokenMetrics = aggregateTokenEvents(
    cycleEvents,
    todayEvents,
    apiUsedPercent,
    autoUsedPercent,
  );

  return {
    totalUsedPercent,
    apiUsedPercent,
    autoUsedPercent,
    totalUsed: usedFromPercent(totalUsedPercent, limit),
    apiUsed: usedFromPercent(apiUsedPercent, limit),
    autoUsed: usedFromPercent(autoUsedPercent, limit),
    planLimit: limit,
    ...tokenMetrics,
  };
}

function buildMetricsFromQuotas(auto: TokenQuota, api: TokenQuota): UsageMetrics {
  const autoUsed =
    auto.limit !== null && auto.remaining !== null ? Math.max(auto.limit - auto.remaining, 0) : null;
  const apiUsed =
    api.limit !== null && api.remaining !== null ? Math.max(api.limit - api.remaining, 0) : null;
  const planLimit =
    auto.limit !== null && api.limit !== null
      ? Math.max(auto.limit, api.limit)
      : (auto.limit ?? api.limit);

  const autoUsedPercent = percentFromUsed(autoUsed, auto.limit);
  const apiUsedPercent = percentFromUsed(apiUsed, api.limit);
  const totalUsed =
    autoUsed !== null || apiUsed !== null ? (autoUsed ?? 0) + (apiUsed ?? 0) : null;
  const totalUsedPercent = percentFromUsed(totalUsed, planLimit);

  return {
    totalUsedPercent,
    apiUsedPercent,
    autoUsedPercent,
    apiTodayUsedPercent: null,
    autoTodayUsedPercent: null,
    totalUsed,
    apiUsed,
    autoUsed,
    planLimit,
    totalTokens: null,
    apiTokens: null,
    autoTokens: null,
    apiTodayTokens: null,
    autoTodayTokens: null,
  };
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

function unwrapCookieRaw(raw: unknown): {
  summary: RawCookieResponse;
  todayEvents?: RawUsageEventsResponse | null;
  cycleEvents?: RawUsageEventsResponse | null;
} {
  const combined = raw as RawCookieCombinedResponse & RawCookieResponse;
  if (combined.summary && typeof combined.summary === 'object') {
    return {
      summary: combined.summary,
      todayEvents: combined.todayEvents,
      cycleEvents: combined.cycleEvents,
    };
  }
  return { summary: combined };
}

export function normalizeOfficial(raw: unknown, fetchedAt: string): TokenSnapshot {
  const data = raw as RawOfficialResponse;

  let auto = toQuota(data.autoRemaining, data.autoLimit, data.autoResetAt);
  let api = toQuota(data.apiRemaining, data.apiLimit, data.apiResetAt);

  if (data.auto) {
    auto = toQuota(data.auto.remaining, data.auto.limit, data.auto.resetAt);
  }
  if (data.api) {
    api = toQuota(data.api.remaining, data.api.limit, data.api.resetAt);
  }
  if (data.usage?.auto) {
    auto = toQuota(
      data.usage.auto.remaining,
      data.usage.auto.limit,
      data.usage.auto.resetAt,
    );
  }
  if (data.usage?.api) {
    api = toQuota(data.usage.api.remaining, data.usage.api.limit, data.usage.api.resetAt);
  }

  const stale = isEmptyQuota(auto) && isEmptyQuota(api);
  const billingCycleEnd = auto.resetAt ?? api.resetAt ?? null;

  return {
    source: 'official',
    auto,
    api,
    metrics: stale ? emptyMetrics() : buildMetricsFromQuotas(auto, api),
    billingCycleStart: null,
    billingCycleEnd,
    fetchedAt,
    stale,
    rawVersion: 'official:v1',
  };
}

export function normalizeCookie(raw: unknown, fetchedAt: string): TokenSnapshot {
  const { summary: data, todayEvents, cycleEvents } = unwrapCookieRaw(raw);

  let auto = toQuota(data.autoRemaining, data.autoLimit, data.autoResetAt);
  let api = toQuota(data.apiRemaining, data.apiLimit, data.apiResetAt);
  const resetAt = data.billingCycleEnd ?? null;
  let metrics = emptyMetrics();

  if (data.usage?.auto) {
    auto = toQuota(data.usage.auto.left, data.usage.auto.cap, data.usage.auto.reset_time);
  }
  if (data.usage?.api) {
    api = toQuota(data.usage.api.left, data.usage.api.cap, data.usage.api.reset_time);
  }
  if (data.individualUsage?.plan) {
    const plan = data.individualUsage.plan;
    const limit = asNumber(plan.limit);
    const remaining = asNumber(plan.remaining);
    const autoPercentUsed = asNumber(plan.autoPercentUsed);
    const apiPercentUsed = asNumber(plan.apiPercentUsed);

    auto = quotaFromPercent(autoPercentUsed, limit, resetAt);
    api = quotaFromPercent(apiPercentUsed, limit, resetAt);

    if (isEmptyQuota(auto) && isEmptyQuota(api)) {
      auto = toQuota(remaining, limit, resetAt);
    }

    metrics = buildMetricsFromPlan(plan, cycleEvents, todayEvents);
  } else {
    metrics = buildMetricsFromQuotas(auto, api);
  }

  const stale = isEmptyQuota(auto) && isEmptyQuota(api) && metrics.totalUsedPercent === null;

  return {
    source: 'cookie',
    auto,
    api,
    metrics,
    billingCycleStart: data.billingCycleStart ?? null,
    billingCycleEnd: data.billingCycleEnd ?? resetAt,
    fetchedAt,
    stale,
    rawVersion: 'cookie:usage-summary',
  };
}

export function normalize(
  raw: unknown,
  source: DataSource,
  fetchedAt: string = new Date().toISOString(),
): TokenSnapshot {
  return source === 'official'
    ? normalizeOfficial(raw, fetchedAt)
    : normalizeCookie(raw, fetchedAt);
}
