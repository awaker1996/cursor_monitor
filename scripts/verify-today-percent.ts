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
    todayTokens: 0,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  });
  assert('complete zero usage returns 0%', result === 0);
}

// Historical cost missing: cycle cost ~= today cost but tokens differ
{
  const result = todayUsedPercent({
    todayCostCents: 1000,
    cycleCostCents: 1000,
    todayTokens: 5000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  });
  assert('cost-missing falls back to token share', approx(result, 4.25));
  assert('never exceeds cycle', result !== null && result <= CYCLE);
}

// Cost exceeds token share by >5% (user report: ~22% cost vs <1% tokens)
{
  const result = todayUsedPercent({
    todayCostCents: 800,
    cycleCostCents: 1000,
    todayTokens: 10000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  });
  assert('cost-divergence uses conservative token share', approx(result, 8.5));
}

// Same shape as screenshot: cycle Other Models 100%, tiny today tokens
{
  const result = todayUsedPercent({
    todayCostCents: 2218,
    cycleCostCents: 10000,
    todayTokens: 641_900,
    cycleTokens: 98_700_000,
    cyclePercent: 100,
    todayComplete: true,
    cycleCostReliable: true,
  });
  assert(
    'screenshot-like Other Models uses token share',
    approx(result, (641_900 / 98_700_000) * 100),
    `got ${result}`,
  );
}

// Cost within threshold of token share (cost not inflated)
{
  const result = todayUsedPercent({
    todayCostCents: 200,
    cycleCostCents: 1000,
    todayTokens: 10000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  });
  assert('aligned shares prefer cost', approx(result, 8.5));
}

// Incomplete today events return null
{
  const result = todayUsedPercent({
    todayCostCents: 200,
    cycleCostCents: 1000,
    todayTokens: 10000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
    todayComplete: false,
    cycleCostReliable: true,
  });
  assert('incomplete today returns null', result === null);
}

// Unreliable cycle cost with tokens still yields token-based percent
{
  const result = todayUsedPercent({
    todayCostCents: 200,
    cycleCostCents: 1000,
    todayTokens: 10000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: false,
  });
  assert('unreliable cycle cost falls back to tokens', approx(result, 8.5));
}

// Paginated incomplete cycle: skip inflated token share
{
  const inflated = todayUsedPercent({
    todayCostCents: 500,
    cycleCostCents: 2000,
    todayTokens: 8000,
    cycleTokens: 10000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
    cycleEventsIncomplete: true,
  });
  assert('incomplete cycle uses cost only', approx(inflated, 10.625));

  const tokenOnly = todayUsedPercent({
    todayCostCents: 0,
    cycleCostCents: 0,
    todayTokens: 8000,
    cycleTokens: 10000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: false,
    cycleEventsIncomplete: true,
  });
  assert('incomplete cycle without cost returns null', tokenOnly === null);
}

// Today tokens exceed cycle tokens (truncated cycle aggregate)
{
  const result = todayUsedPercent({
    todayCostCents: 300,
    cycleCostCents: 1000,
    todayTokens: 12000,
    cycleTokens: 8000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  });
  assert('token set invalid falls back to cost', approx(result, 12.75));
}

// Idempotent / stable across runs (no cost↔token flip-flop)
{
  const input = {
    todayCostCents: 800,
    cycleCostCents: 1000,
    todayTokens: 10000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
    todayComplete: true,
    cycleCostReliable: true,
  };
  const runs = Array.from({ length: 5 }, () => todayUsedPercent(input));
  assert('divergence path is stable across runs', runs.every((value) => value === runs[0]));
  assert('idempotent', runs[0] === todayUsedPercent(input));
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
            // Match event token sum (1500 + 13500) so cost/token denominators align.
            inputTokens: '15000',
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
  // Cost share 500/2000=25% → 7.5%; token share 1500/15000=10% → 3%.
  // Divergence 15% ≥ 5% → prefer token share 3%.
  assert(
    'integration falls back when cost exceeds token share',
    approx(apiToday, 3),
    `got ${apiToday}`,
  );
  assert('integration today <= cycle api', apiToday !== null && apiCycle !== null && apiToday <= apiCycle);
}

{
  // Truncated cycle events + complete aggregated tokens (real Cookie path):
  // cost share looks like ~22%, but aggregated Other Models tokens say <1%.
  const snapshot = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: {
            limit: 100,
            apiPercentUsed: 100,
            autoPercentUsed: 86.96,
            totalPercentUsed: 88.54,
          },
        },
      },
      todayEvents: {
        eventsComplete: true,
        usageEventsDisplay: [
          {
            model: 'gpt-5.3-codex',
            tokenUsage: { inputTokens: 641_900, outputTokens: 0 },
            chargedCents: 2218,
          },
        ],
      },
      cycleEvents: {
        // Paginated sample only — not the full cycle.
        totalUsageEventsCount: 50_000,
        eventsComplete: false,
        usageEventsDisplay: [
          {
            model: 'gpt-5.3-codex',
            tokenUsage: { inputTokens: 2_900_000, outputTokens: 0 },
            chargedCents: 2218,
          },
        ],
      },
      aggregatedUsage: {
        aggregations: [
          {
            modelIntent: 'gpt-5.3-codex',
            inputTokens: '98700000',
            totalCents: 10000,
            tier: 1,
          },
          {
            modelIntent: 'composer-2',
            inputTokens: '669800000',
            totalCents: 50000,
            tier: 2,
          },
        ],
      },
    },
    new Date().toISOString(),
  );

  const apiToday = snapshot.metrics.apiTodayUsedPercent;
  const expected = (641_900 / 98_700_000) * 100;
  assert(
    'truncated events still use aggregated token denominator',
    approx(apiToday, expected, 0.02),
    `got ${apiToday}, expected ~${expected}`,
  );
  assert(
    'display apiTokens come from aggregation',
    snapshot.metrics.apiTokens === 98_700_000,
    `got ${snapshot.metrics.apiTokens}`,
  );
}

{
  // Aligned cost/token: prefer cost share
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
            tokenUsage: { inputTokens: 2500, outputTokens: 0 },
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
            tokenUsage: { inputTokens: 2500, outputTokens: 0 },
            chargedCents: 500,
          },
          {
            model: 'gpt-4',
            tokenUsage: { inputTokens: 7500, outputTokens: 0 },
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
  // Cost 25% and token 25% aligned → 7.5%
  assert('integration prefers cost when aligned', approx(apiToday, 7.5), `got ${apiToday}`);
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
            tokenUsage: { inputTokens: 2500 },
            chargedCents: 500,
          },
        ],
      },
      cycleEvents: {
        totalUsageEventsCount: 1,
        eventsComplete: true,
        usageEventsDisplay: [
          {
            model: 'gpt-4',
            tokenUsage: { inputTokens: 10000 },
            chargedCents: 2000,
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

console.log('exclude grok-bot from today percent');

{
  const snapshot = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: {
            limit: 100,
            apiPercentUsed: 10,
            autoPercentUsed: 40,
            totalPercentUsed: 50,
          },
        },
      },
      aggregatedUsage: {
        aggregations: [
          {
            modelIntent: 'composer-2.5-fast',
            inputTokens: '8000',
            totalCents: 800,
            tier: 2,
          },
          {
            modelIntent: 'grok-bot-automation',
            inputTokens: '2000',
            totalCents: 200,
            tier: 2,
          },
          {
            modelIntent: 'grok-bot-default',
            inputTokens: '1000',
            totalCents: 100,
            tier: 2,
          },
        ],
      },
      todayEvents: {
        eventsComplete: true,
        usageEventsDisplay: [
          {
            model: 'composer-2.5-fast',
            tokenUsage: { inputTokens: 800 },
            chargedCents: 80,
          },
          {
            model: 'grok-bot-automation',
            tokenUsage: { inputTokens: 400 },
            chargedCents: 40,
          },
          {
            model: 'grok-bot-default',
            tokenUsage: { inputTokens: 200 },
            chargedCents: 20,
          },
        ],
      },
    },
    new Date().toISOString(),
  );

  // Cycle auto cost/tokens exclude bot → 800 cents / 8000 tokens.
  // Today exclude bot → 80 / 800. Share 0.1 × 40% = 4%.
  assert('cycle auto tokens exclude bot', snapshot.metrics.autoTokens === 8000);
  assert(
    'today auto percent excludes bot',
    approx(snapshot.metrics.autoTodayUsedPercent, 4),
  );
  assert(
    'cycle auto percent stays official API',
    approx(snapshot.metrics.autoUsedPercent, 40),
  );
}

console.log('\nAll today-percent checks passed.');
