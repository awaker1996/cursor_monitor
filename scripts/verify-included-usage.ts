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

console.log('normalizeCookie empty-summary / token backfill');

{
  const emptyLikeUi = normalizeCookie(
    {
      summary: {},
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
    },
    new Date().toISOString(),
  );

  assert('empty summary is stale', emptyLikeUi.stale === true);
  assert('empty summary percent null', emptyLikeUi.metrics.totalUsedPercent === null);
  assert(
    'empty summary still backfills tokens from included usage',
    emptyLikeUi.metrics.totalTokens === 3_000_000,
  );
}

console.log('normalizeCookie overall allocation');

{
  const overall = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          overall: {
            used: 250,
            limit: 1000,
            remaining: 750,
          },
        },
      },
    },
    new Date().toISOString(),
  );

  assert('overall not stale', overall.stale === false);
  assert('overall total percent', approx(overall.metrics.totalUsedPercent, 25));
  assert('overall remaining', overall.auto.remaining === 750);
  assert('overall limit', overall.auto.limit === 1000);
}

console.log('normalizeCookie plan used/limit without percent fields');

{
  const planOnly = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-07-01T00:00:00.000Z',
        billingCycleEnd: '2026-08-01T00:00:00.000Z',
        individualUsage: {
          plan: {
            used: 40,
            limit: 100,
            remaining: 60,
          },
        },
      },
    },
    new Date().toISOString(),
  );

  assert('plan-only not stale', planOnly.stale === false);
  assert('plan-only derived percent', approx(planOnly.metrics.totalUsedPercent, 40));
}

console.log('exclude grok-bot from Included Usage');

{
  // composer 300 + bot 100 = 400 category cost; autoUsedPercent 50.
  // Without denom-including-bot, composer would get (300/300)*50 = 50%.
  // With bot kept in denom only: (300/400)*50 = 37.5%.
  const fromEvents = aggregateIncludedUsageByModel(
    {
      usageEventsDisplay: [
        {
          model: 'composer-2.5-fast',
          tokenUsage: { inputTokens: 3_000_000 },
          chargedCents: 300,
        },
        {
          model: 'grok-bot-automation',
          tokenUsage: { inputTokens: 1_000_000 },
          chargedCents: 100,
        },
        {
          model: 'grok-bot-default',
          tokenUsage: { inputTokens: 500_000 },
          chargedCents: 50,
        },
        {
          model: 'grok-4.5-fast-xhigh',
          tokenUsage: { inputTokens: 500_000 },
          chargedCents: 50,
        },
      ],
    },
    null,
    50,
  );

  const firstParty = fromEvents.categories.find((c) => c.key === 'firstParty');
  assert(
    'bot models omitted from list',
    firstParty?.models.every(
      (m) => m.model !== 'grok-bot-automation' && m.model !== 'grok-bot-default',
    ) === true,
  );
  assert(
    'ide grok kept',
    firstParty?.models.some((m) => m.model === 'grok-4.5-fast-xhigh') === true,
  );
  assert(
    'displayed tokens exclude bot',
    firstParty?.totalTokens === 3_500_000,
  );

  const composer = firstParty?.models.find((m) => m.model === 'composer-2.5-fast');
  // denom cost = 300+100+50+50 = 500; composer share = 300/500 * 50 = 30
  assert('composer does not absorb bot share', approx(composer?.usagePercent ?? null, 30));

  const fromAgg = aggregateIncludedUsageFromAggregations(
    {
      aggregations: [
        {
          modelIntent: 'composer-2.5-fast',
          inputTokens: '3000000',
          totalCents: 300,
          tier: 2,
        },
        {
          modelIntent: 'grok-bot-automation',
          inputTokens: '1000000',
          totalCents: 100,
          tier: 2,
        },
        {
          modelIntent: 'grok-bot-default',
          inputTokens: '500000',
          totalCents: 50,
          tier: 2,
        },
      ],
    },
    null,
    50,
  );
  const aggFp = fromAgg.categories.find((c) => c.key === 'firstParty');
  assert(
    'aggregated omits bot models',
    aggFp?.models.every(
      (m) => m.model !== 'grok-bot-automation' && m.model !== 'grok-bot-default',
    ) === true,
  );
  const aggComposer = aggFp?.models.find((m) => m.model === 'composer-2.5-fast');
  // denom = 450; 300/450 * 50 ≈ 33.33
  assert(
    'aggregated composer keeps bot gap',
    approx(aggComposer?.usagePercent ?? null, 33.33),
  );
  assert('category header keeps official percent', aggFp?.usagePercent === 50);
}

console.log('\nAll included-usage checks passed.');
