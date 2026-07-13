/**
 * Lightweight regression checks for todayUsedPercent / normalizeCookie.
 * Run: npx tsx scripts/verify-today-percent.ts
 */
import { todayUsedPercent, normalizeCookie } from '../src/core/normalizer';
import { formatOrbSummary } from '../src/shared/format';

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

// Historical cost missing: cycle cost ~= today cost but tokens differ
{
  const result = todayUsedPercent({
    todayCostCents: 1000,
    cycleCostCents: 1000,
    todayTokens: 5000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
  });
  assert('cost-missing falls back to token share', approx(result, 4.25));
  assert('never exceeds cycle', result !== null && result <= CYCLE);
}

// Cost exceeds token share by >5%
{
  const result = todayUsedPercent({
    todayCostCents: 800,
    cycleCostCents: 1000,
    todayTokens: 10000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
  });
  assert('cost-divergence uses conservative token share', approx(result, 8.5));
}

// Cost within threshold of token share (cost not inflated)
{
  const result = todayUsedPercent({
    todayCostCents: 200,
    cycleCostCents: 1000,
    todayTokens: 10000,
    cycleTokens: 50000,
    cyclePercent: CYCLE,
  });
  assert('aligned shares prefer cost', approx(result, 8.5));
}

// Paginated incomplete cycle: skip inflated token share
{
  const inflated = todayUsedPercent({
    todayCostCents: 500,
    cycleCostCents: 2000,
    todayTokens: 8000,
    cycleTokens: 10000,
    cyclePercent: CYCLE,
    cycleEventsIncomplete: true,
  });
  assert('incomplete cycle uses cost only', approx(inflated, 10.625));

  const tokenOnly = todayUsedPercent({
    todayCostCents: 0,
    cycleCostCents: 0,
    todayTokens: 8000,
    cycleTokens: 10000,
    cyclePercent: CYCLE,
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
  });
  assert('token set invalid falls back to cost', approx(result, 12.75));
}

// Idempotent
{
  const input = {
    todayCostCents: 250,
    cycleCostCents: 1000,
    todayTokens: 3000,
    cycleTokens: 20000,
    cyclePercent: CYCLE,
  };
  const a = todayUsedPercent(input);
  const b = todayUsedPercent(input);
  assert('idempotent', a === b);
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
        usageEventsDisplay: [
          {
            model: 'gpt-4',
            tokenUsage: { inputTokens: 1000, outputTokens: 500 },
            chargedCents: 500,
          },
        ],
      },
      cycleEvents: {
        totalUsageEventsCount: 500,
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
    },
    new Date().toISOString(),
  );

  const apiToday = snapshot.metrics.apiTodayUsedPercent;
  const apiCycle = snapshot.metrics.apiUsedPercent;
  assert('integration today <= cycle api', apiToday !== null && apiCycle !== null && apiToday <= apiCycle);
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
