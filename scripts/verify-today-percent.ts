/**
 * Lightweight regression checks for todayUsedPercent / normalizeCookie / snapshot merge.
 * Run: npx tsx scripts/verify-today-percent.ts
 */
import { todayUsedPercent, normalizeCookie } from '../src/core/normalizer';
import { formatOrbSummary } from '../src/shared/format';
import { mergeCycleTokensFromCache, mergeTodayMetricsFromCache } from '../src/core/snapshotMerge';

const CYCLE = 42.5;

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
  console.log(`  ok ${name}`);
}

function approx(a: number | null, b: number, eps = 0.01): boolean {
  return a !== null && Math.abs(a - b) < eps;
}

console.log('todayUsedPercent scenarios');

// Complete zero usage returns 0%
{
  const result = todayUsedPercent({
    todayCostCents: 0,
    cycleCostCents: 1000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  });
  assert('complete zero usage returns 0%', result === 0);
}

// Cost share only
{
  const result = todayUsedPercent({
    todayCostCents: 200,
    cycleCostCents: 1000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  });
  assert('cost share only', approx(result, 8.5));
  assert('never exceeds cycle', result !== null && result <= CYCLE);
}

// Incomplete today events return null
{
  const result = todayUsedPercent({
    todayCostCents: 200,
    cycleCostCents: 1000,
    cyclePercent: CYCLE,
    todayComplete: false,
    cycleCostReliable: true,
  });
  assert('incomplete today returns null', result === null);
}

// Unreliable cycle cost returns null when today has usage
{
  const result = todayUsedPercent({
    todayCostCents: 200,
    cycleCostCents: 1000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: false,
  });
  assert('unreliable cycle cost returns null', result === null);
}

// Idempotent
{
  const input = {
    todayCostCents: 250,
    cycleCostCents: 1000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  };
  const a = todayUsedPercent(input);
  const b = todayUsedPercent(input);
  assert('idempotent', a === b);
}

// Same input never flips between cost/token paths (fixed cost-only)
{
  const input = {
    todayCostCents: 800,
    cycleCostCents: 1000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  };
  const runs = Array.from({ length: 5 }, () => todayUsedPercent(input));
  assert('fixed cost-only is stable across runs', runs.every((value) => value === runs[0]));
}

console.log('normalizeCookie integration');

{
  const snapshot = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: {
            limit: 100,
            apiPercentUsed: 30,
            autoPercentUsed: 12,
            totalPercentUsed: 42,
          },
        },
      },
      todayEvents: {
        eventsComplete: true,
        usageEventsDisplay: [
          {
            model: 'gpt-4',
            tokenUsage: { inputTokens: 1000, outputTokens: 500 },
            chargedCents: 500,
          },
        ],
      },
      cycleEvents: {
        totalUsageEventsCount: 2,
        eventsComplete: true,
        usageEventsDisplay: [
          {
            model: 'gpt-4',
            tokenUsage: { inputTokens: 1000, outputTokens: 500 },
            chargedCents: 500,
          },
          {
            model: 'gpt-4',
            tokenUsage: { inputTokens: 9000, outputTokens: 4500 },
            chargedCents: 1500,
          },
        ],
      },
      aggregatedUsage: {
        aggregations: [
          {
            modelIntent: 'gpt-4',
            inputTokens: '10000',
            totalCents: 2000,
            tier: 1,
          },
        ],
      },
    },
    new Date().toISOString(),
  );

  const apiToday = snapshot.metrics.apiTodayUsedPercent;
  const apiCycle = snapshot.metrics.apiUsedPercent;
  assert(
    'integration uses aggregated cycle cost',
    approx(apiToday, 7.5),
    `got ${apiToday}`,
  );
  assert('integration today <= cycle api', apiToday !== null && apiCycle !== null && apiToday <= apiCycle);
}

console.log('mergeTodayMetricsFromCache');

{
  const fetchedAt = new Date().toISOString();
  const previous = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: {
            limit: 100,
            apiPercentUsed: 30,
            autoPercentUsed: 12,
            totalPercentUsed: 42,
          },
        },
      },
      todayEvents: {
        eventsComplete: true,
        usageEventsDisplay: [
          {
            model: 'gpt-4',
            tokenUsage: { inputTokens: 1000 },
            chargedCents: 500,
          },
        ],
      },
      aggregatedUsage: {
        aggregations: [
          { modelIntent: 'gpt-4', inputTokens: '10000', totalCents: 2000, tier: 1 },
        ],
      },
    },
    fetchedAt,
  );

  const unreliable = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: {
            limit: 100,
            apiPercentUsed: 30,
            autoPercentUsed: 12,
            totalPercentUsed: 42,
          },
        },
      },
      todayEvents: {
        eventsComplete: false,
        usageEventsDisplay: [
          {
            model: 'gpt-4',
            tokenUsage: { inputTokens: 1000 },
            chargedCents: 500,
          },
        ],
      },
      aggregatedUsage: {
        aggregations: [
          { modelIntent: 'gpt-4', inputTokens: '10000', totalCents: 2000, tier: 1 },
        ],
      },
    },
    fetchedAt,
  );

  assert('unreliable refresh drops today percent', unreliable.metrics.apiTodayUsedPercent === null);

  const merged = mergeTodayMetricsFromCache(unreliable, previous);
  assert('merge restores today percent', merged.metrics.apiTodayUsedPercent !== null);
  assert('merge marks stale', merged.stale === true);

  const cachedBothBuckets = {
    ...previous,
    metrics: {
      ...previous.metrics,
      apiTodayUsedPercent: 7.5,
      autoTodayUsedPercent: 3.25,
      autoTodayTokens: 800,
    },
  };
  const partialRefresh = {
    ...unreliable,
    metrics: {
      ...unreliable.metrics,
      apiTodayUsedPercent: 8,
      autoTodayUsedPercent: null,
      autoTodayTokens: null,
    },
  };
  const partiallyMerged = mergeTodayMetricsFromCache(partialRefresh, cachedBothBuckets);
  assert(
    'partial merge keeps fresh API percent',
    partiallyMerged.metrics.apiTodayUsedPercent === 8,
  );
  assert(
    'partial merge restores First-party percent',
    partiallyMerged.metrics.autoTodayUsedPercent === 3.25,
  );
  assert(
    'partial merge restores First-party tokens',
    partiallyMerged.metrics.autoTodayTokens === 800,
  );
}

console.log('mergeCycleTokensFromCache');

{
  const fetchedAt = new Date().toISOString();
  const withDetail = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: { limit: 100, apiPercentUsed: 30, autoPercentUsed: 12, totalPercentUsed: 42 },
        },
      },
      aggregatedUsage: {
        aggregations: [
          { modelIntent: 'gpt-4', inputTokens: '10000', totalCents: 2000, tier: 1 },
          { modelIntent: 'composer-2.5-fast', inputTokens: '5000', totalCents: 500, tier: 2 },
        ],
      },
    },
    fetchedAt,
  );
  assert('previous has token detail', withDetail.metrics.totalTokens === 15000);

  // Refresh where events + aggregated both failed (network resets).
  const noDetail = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: { limit: 100, apiPercentUsed: 31, autoPercentUsed: 12, totalPercentUsed: 43 },
        },
      },
    },
    fetchedAt,
  );
  assert('failed refresh drops token detail', noDetail.metrics.totalTokens === null);

  const merged = mergeCycleTokensFromCache(noDetail, withDetail);
  assert('cycle merge restores totalTokens', merged.metrics.totalTokens === 15000);
  assert('cycle merge restores apiTokens', merged.metrics.apiTokens === 10000);
  assert('cycle merge restores autoTokens', merged.metrics.autoTokens === 5000);
  assert('cycle merge keeps fresh percent', approx(merged.metrics.totalUsedPercent, 43));
  assert('cycle merge marks stale', merged.stale === true);

  const otherCycle = {
    ...withDetail,
    billingCycleStart: '2026-06-01T00:00:00.000Z',
    billingCycleEnd: '2026-07-01T00:00:00.000Z',
  };
  const notMerged = mergeCycleTokensFromCache(noDetail, otherCycle);
  assert('different cycle not merged', notMerged.metrics.totalTokens === null);

  const fresh = mergeCycleTokensFromCache(withDetail, withDetail);
  assert('fresh detail untouched', fresh.stale === false && fresh.metrics.totalTokens === 15000);
}

console.log('orb summary');

{
  const snapshot = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: {
            limit: 100_000_000,
            apiPercentUsed: 4.56,
            autoPercentUsed: 1.09,
            totalPercentUsed: 5.35,
          },
        },
      },
    },
    new Date().toISOString(),
  );

  const orb = formatOrbSummary(snapshot);
  assert('orb remaining complements total used', approx(orb.percentValue, 94.65));
  assert('orb value rounds dashboard remaining', orb.value === '95%');
}

console.log('\nAll today-percent checks passed.');
