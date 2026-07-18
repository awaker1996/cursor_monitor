import type { TokenSnapshot, UsageMetrics } from '../shared/types';

function isSameLocalDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function isSameBillingCycle(a: TokenSnapshot, b: TokenSnapshot): boolean {
  return a.billingCycleStart === b.billingCycleStart && a.billingCycleEnd === b.billingCycleEnd;
}

function hasTodayMetricValue(metrics: UsageMetrics): boolean {
  return (
    metrics.apiTodayUsedPercent !== null ||
    metrics.autoTodayUsedPercent !== null ||
    metrics.apiTodayTokens !== null ||
    metrics.autoTodayTokens !== null
  );
}

function mergeTodayField<T>(next: T | null | undefined, previous: T | null | undefined): T | null {
  if (next !== null && next !== undefined) return next;
  if (previous !== null && previous !== undefined) return previous;
  return null;
}

/** Reject snapshots that cannot drive the primary dashboard/orb percent. */
export function isEmptyUsageSnapshot(snapshot: TokenSnapshot): boolean {
  const hasPrimaryPercent = snapshot.metrics.totalUsedPercent !== null;
  const hasQuota =
    snapshot.auto.remaining !== null ||
    snapshot.auto.limit !== null ||
    snapshot.api.remaining !== null ||
    snapshot.api.limit !== null;

  return !hasPrimaryPercent && !hasQuota;
}

/**
 * When a refresh cannot derive reliable today metrics, keep the last trusted
 * values from the same billing cycle and local day instead of showing `--`.
 */
export function mergeTodayMetricsFromCache(
  next: TokenSnapshot,
  previous: TokenSnapshot | null | undefined,
): TokenSnapshot {
  if (!previous || !hasTodayMetricValue(previous.metrics)) return next;
  if (!isSameBillingCycle(next, previous)) return next;
  if (!isSameLocalDay(next.fetchedAt, previous.fetchedAt)) return next;

  const usesCachedValue =
    (next.metrics.apiTodayUsedPercent == null &&
      previous.metrics.apiTodayUsedPercent != null) ||
    (next.metrics.autoTodayUsedPercent == null &&
      previous.metrics.autoTodayUsedPercent != null) ||
    (next.metrics.apiTodayTokens == null && previous.metrics.apiTodayTokens != null) ||
    (next.metrics.autoTodayTokens == null && previous.metrics.autoTodayTokens != null) ||
    (next.metrics.apiTodayUsed == null && previous.metrics.apiTodayUsed != null) ||
    (next.metrics.autoTodayUsed == null && previous.metrics.autoTodayUsed != null);
  if (!usesCachedValue) return next;

  const metrics: UsageMetrics = {
    ...next.metrics,
    apiTodayUsedPercent: mergeTodayField(
      next.metrics.apiTodayUsedPercent,
      previous.metrics.apiTodayUsedPercent,
    ),
    autoTodayUsedPercent: mergeTodayField(
      next.metrics.autoTodayUsedPercent,
      previous.metrics.autoTodayUsedPercent,
    ),
    apiTodayTokens: mergeTodayField(next.metrics.apiTodayTokens, previous.metrics.apiTodayTokens),
    autoTodayTokens: mergeTodayField(next.metrics.autoTodayTokens, previous.metrics.autoTodayTokens),
    apiTodayUsed: mergeTodayField(next.metrics.apiTodayUsed, previous.metrics.apiTodayUsed),
    autoTodayUsed: mergeTodayField(next.metrics.autoTodayUsed, previous.metrics.autoTodayUsed),
  };

  return {
    ...next,
    metrics,
    stale: next.stale || usesCachedValue,
  };
}
