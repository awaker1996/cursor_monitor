/**
 * Regression checks for Included Usage model aggregation.
 * Run: npx tsx scripts/verify-included-usage.ts
 */
import {
  aggregateIncludedUsageByModel,
  aggregateIncludedUsageFromAggregations,
  normalizeCookie,
  resolveIncludedUsage,
} from '../src/core/normalizer';
import {
  buildIncludedUsageDisplay,
  formatIncludedUsageTokens,
} from '../src/shared/format';

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
  console.log(`  ok ${name}`);
}

function approx(a: number | null, b: number, eps = 0.01): boolean {
  return a !== null && Math.abs(a - b) < eps;
}

console.log('formatIncludedUsageTokens');

assert('亿', formatIncludedUsageTokens(320_000_000) === '3.2亿');
assert('万', formatIncludedUsageTokens(69_474_000) === '6947.4万');
assert('small', formatIncludedUsageTokens(500) === '500');
assert('null', formatIncludedUsageTokens(null) === '--');

console.log('aggregateIncludedUsageByModel');

{
  const result = aggregateIncludedUsageByModel(
    {
      usageEventsDisplay: [
        {
          model: 'gpt-5.3-codex',
          tokenUsage: { inputTokens: 1_000_000, outputTokens: 500_000 },
          chargedCents: 600,
        },
        {
          model: 'gpt-5.5-medium',
          tokenUsage: { inputTokens: 2_000_000, outputTokens: 1_000_000 },
          chargedCents: 400,
        },
        {
          model: 'composer-2.5-fast',
          tokenUsage: { inputTokens: 5_000_000, outputTokens: 2_000_000 },
          chargedCents: 300,
        },
        {
          model: 'grok-4.5-fast-xhigh',
          tokenUsage: { inputTokens: 1_000_000, outputTokens: 200_000 },
          chargedCents: 100,
        },
      ],
    },
    52.8,
    50.5,
  );

  assert('available', result.available === true);
  assert('two categories', result.categories.length === 2);

  const api = result.categories.find((c) => c.key === 'api');
  const firstParty = result.categories.find((c) => c.key === 'firstParty');

  assert('api category exists', api !== undefined);
  assert('first-party category exists', firstParty !== undefined);
  assert('api two models', api?.models.length === 2);
  assert('first-party two models', firstParty?.models.length === 2);
  assert(
    'grok in first-party',
    firstParty?.models.some((m) => m.model === 'grok-4.5-fast-xhigh') === true,
  );
  assert(
    'composer in first-party',
    firstParty?.models.some((m) => m.model === 'composer-2.5-fast') === true,
  );

  const topApi = api?.models[0];
  assert(
    'api sorted by usage percent',
    topApi?.model === 'gpt-5.3-codex' && approx(topApi.usagePercent, 31.68),
    `got ${topApi?.model} ${topApi?.usagePercent}`,
  );

  const grok = firstParty?.models.find((m) => m.model === 'grok-4.5-fast-xhigh');
  assert('grok usage percent', approx(grok?.usagePercent ?? null, 12.63));
}

console.log('aggregateIncludedUsageFromAggregations');

{
  const result = aggregateIncludedUsageFromAggregations(
    {
      aggregations: [
        {
          modelIntent: 'gpt-5.5-medium',
          inputTokens: '10000000',
          outputTokens: '7185000',
          cacheReadTokens: '0',
          totalCents: 2060,
          tier: 1,
        },
        {
          modelIntent: 'gpt-5.3-codex',
          inputTokens: '20000000',
          outputTokens: '7968000',
          totalCents: 1000,
          tier: 1,
        },
        {
          modelIntent: 'composer-2.5-fast',
          inputTokens: '80000000',
          outputTokens: '80000000',
          cacheReadTokens: '0',
          totalCents: 3500,
          tier: 2,
        },
        {
          modelIntent: 'auto',
          inputTokens: '70000000',
          outputTokens: '70000000',
          totalCents: 1310,
          tier: 2,
        },
        {
          modelIntent: 'deepseek-v4-flash',
          inputTokens: '3917000',
          outputTokens: '0',
          totalCents: 0,
          tier: 1,
        },
      ],
    },
    52.8,
    51.0,
  );

  assert('aggregated available', result.available === true);
  assert('aggregated not incomplete', result.incomplete !== true);

  const api = result.categories.find((c) => c.key === 'api');
  const firstParty = result.categories.find((c) => c.key === 'firstParty');

  assert('aggregated api models', (api?.models.length ?? 0) === 3);
  assert('aggregated first-party models', (firstParty?.models.length ?? 0) === 2);
  assert('aggregated api category percent', approx(api?.usagePercent ?? null, 52.8));
  assert('aggregated first-party percent', approx(firstParty?.usagePercent ?? null, 51.0));
  assert(
    'tier 2 composer in first-party',
    firstParty?.models.some((m) => m.model === 'composer-2.5-fast') === true,
  );
  assert(
    'tier 1 deepseek in api',
    api?.models.some((m) => m.model === 'deepseek-v4-flash') === true,
  );

  const deepseek = api?.models.find((m) => m.model === 'deepseek-v4-flash');
  assert(
    'byok deepseek usage is 0',
    deepseek?.usagePercent === 0,
    `got ${deepseek?.usagePercent}`,
  );
  assert('byok deepseek keeps tokens', (deepseek?.tokens ?? 0) === 3_917_000);

  const topApi = api?.models[0];
  assert(
    'aggregated cost share',
    topApi?.model === 'gpt-5.5-medium' && approx(topApi.usagePercent, 35.55),
    `got ${topApi?.model} ${topApi?.usagePercent}`,
  );
}

console.log('default display name maps to auto');

{
  const result = aggregateIncludedUsageFromAggregations(
    {
      aggregations: [
        {
          modelIntent: 'default',
          inputTokens: '140000000',
          totalCents: 1310,
          tier: 2,
        },
        {
          modelIntent: 'composer-2.5-fast',
          inputTokens: '160000000',
          totalCents: 3500,
          tier: 2,
        },
      ],
    },
    null,
    51.0,
  );

  const firstParty = result.categories.find((c) => c.key === 'firstParty');
  assert(
    'default shown as auto',
    firstParty?.models.some((m) => m.model === 'auto') === true,
  );
  assert(
    'default label not kept',
    firstParty?.models.every((m) => m.model !== 'default') === true,
  );
}

console.log('resolveIncludedUsage prefers aggregated');

{
  const resolved = resolveIncludedUsage(
    {
      aggregations: [
        {
          modelIntent: 'composer-2.5-fast',
          inputTokens: '1000',
          totalCents: 10,
          tier: 2,
        },
      ],
    },
    {
      totalUsageEventsCount: 100,
      usageEventsDisplay: [
        {
          model: 'gpt-4',
          tokenUsage: { inputTokens: 100 },
          chargedCents: 1,
        },
      ],
    },
    10,
    20,
  );

  assert('prefers aggregated', resolved.available === true);
  assert('prefers aggregated not incomplete', resolved.incomplete !== true);
  assert(
    'prefers aggregated models',
    resolved.categories[0]?.models[0]?.model === 'composer-2.5-fast',
  );

  const fallback = resolveIncludedUsage(
    null,
    {
      totalUsageEventsCount: 100,
      usageEventsDisplay: [
        {
          model: 'gpt-4',
          tokenUsage: { inputTokens: 1000 },
          chargedCents: 50,
        },
      ],
    },
    10,
    5,
  );
  assert('fallback to events', fallback.available === true);
  assert('fallback incomplete', fallback.incomplete === true);
}

console.log('empty and incomplete');

{
  const empty = aggregateIncludedUsageByModel(null, 10, 20);
  assert('no events unavailable', empty.available === false);

  const incomplete = aggregateIncludedUsageByModel(
    {
      totalUsageEventsCount: 100,
      usageEventsDisplay: [
        {
          model: 'gpt-4',
          tokenUsage: { inputTokens: 1000 },
          chargedCents: 50,
        },
      ],
    },
    10,
    5,
  );
  assert('incomplete flag', incomplete.incomplete === true);
  assert('incomplete still available', incomplete.available === true);
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
            apiPercentUsed: 52.8,
            autoPercentUsed: 50.5,
            totalPercentUsed: 103.3,
          },
        },
      },
      aggregatedUsage: {
        aggregations: [
          {
            modelIntent: 'gpt-5.3-codex',
            inputTokens: '1000000',
            totalCents: 1000,
            tier: 1,
          },
          {
            modelIntent: 'composer-2.5-fast',
            inputTokens: '2000000',
            totalCents: 500,
            tier: 2,
          },
        ],
      },
      cycleEvents: {
        totalUsageEventsCount: 999,
        usageEventsDisplay: [
          {
            model: 'should-not-win',
            tokenUsage: { inputTokens: 1 },
            chargedCents: 1,
          },
        ],
      },
    },
    new Date().toISOString(),
  );

  assert('snapshot has includedUsage', snapshot.includedUsage?.available === true);
  assert('snapshot uses aggregated', snapshot.includedUsage?.incomplete !== true);
  assert(
    'snapshot prefers aggregated model',
    snapshot.includedUsage?.categories.some((c) =>
      c.models.some((m) => m.model === 'gpt-5.3-codex'),
    ) === true,
  );

  const display = buildIncludedUsageDisplay(snapshot);
  assert('display built', display !== null);
  assert('display title', display?.title === 'Included Usage');
  assert('display date range contains Jul', display?.dateRange?.includes('Jul') === true);
  assert('display categories', display?.categories.length === 2);
  assert('display no incomplete hint', display?.showIncompleteHint === false);
}

console.log('\nAll included-usage checks passed.');
