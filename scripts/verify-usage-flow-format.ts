/**
 * Verify usage flow field mapping against Cursor dashboard shapes.
 * Run: npx tsx scripts/verify-usage-flow-format.ts
 */
import { buildUsageFlowPage, buildUsageFlowPageFromEvents } from '../src/core/normalizer';
import {
  extractUsageEventTimestamp,
  formatUsageEventKind,
  formatUsageEventModelName,
  formatUsageFlowTokens,
  isMaxModeEvent,
  mapUsageFlowEntry,
  parseUsageEventTimestamp,
  resolveUsageFlowCost,
  resolveUsageFlowType,
} from '../src/shared/usageFlowFormat';
import { formatUsageFlowDate } from '../src/shared/format';

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  }
  console.log(`OK: ${name}`);
}

console.log('parseUsageEventTimestamp');

{
  const iso = parseUsageEventTimestamp('1750979225854');
  assert('epoch ms string parses', iso !== null);
  assert('epoch ms is valid date', iso !== null && !Number.isNaN(new Date(iso).getTime()));
}

console.log('\nresolveUsageFlowType');

assert(
  'included pro plus',
  resolveUsageFlowType({ kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS' }, 1000) === 'Included',
);
assert(
  'usage based',
  resolveUsageFlowType({ kind: 'USAGE_EVENT_KIND_USAGE_BASED' }, 1000) === 'Usage-based',
);
assert('explicit free', resolveUsageFlowType({ kind: 'USAGE_EVENT_KIND_FREE' }, 0) === 'Free');
assert(
  'zero tokens defaults free',
  resolveUsageFlowType({ kind: 'USAGE_EVENT_KIND_SOMETHING_ELSE' }, 0) === 'Free',
);
assert(
  'included kind with tokens stays included',
  resolveUsageFlowType({ kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS' }, 372_000) === 'Included',
);

console.log('\nformatUsageEventModelName / maxMode');

assert('default to auto', formatUsageEventModelName('default') === 'auto');
assert('maxMode detected', isMaxModeEvent({ maxMode: true }) === true);

console.log('\nformatUsageFlowTokens');

assert('zero tokens dash', formatUsageFlowTokens(0) === '-');

console.log('\nresolveUsageFlowCost');

assert(
  'free type',
  resolveUsageFlowCost({ kind: 'USAGE_EVENT_KIND_FREE' }, 'Free', 0) === 'Free',
);
assert(
  'included type',
  resolveUsageFlowCost({ kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS' }, 'Included', 202) ===
    'Included',
);

console.log('\nmapUsageFlowEntry max badge');

{
  const entry = mapUsageFlowEntry(
    {
      timestamp: '1750979225854',
      model: 'composer-2.5-fast',
      kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS',
      maxMode: true,
      tokenUsage: { inputTokens: 372_000 },
    },
    372_000,
    202,
    formatUsageFlowDate,
  );
  assert('max mode flag', entry.modelMax === true);
  assert('included type', entry.type === 'Included');
  assert('model name', entry.model === 'composer-2.5-fast');
}

console.log('\nbuildUsageFlowPageFromEvents pagination');

{
  const events = Array.from({ length: 34 }, (_, index) => ({
    timestamp: String(1_750_979_225_854 - index * 60_000),
    model: 'composer-2.5-fast',
    kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS',
    tokenUsage: { inputTokens: 1000 + index },
  }));

  const page1 = buildUsageFlowPageFromEvents(events, { page: 1, pageSize: 20 }, 34);
  assert('page1 count', page1.entries.length === 20, String(page1.entries.length));
  assert('page1 total', page1.totalCount === 34);
  assert('page1 pages', page1.totalPages === 2);

  const page2 = buildUsageFlowPageFromEvents(events, { page: 2, pageSize: 20 }, 34);
  assert('page2 count', page2.entries.length === 14, String(page2.entries.length));
  assert('page2 page index', page2.page === 2);
}

console.log('\nbuildUsageFlowPageFromEvents excludes grok-bot');

{
  const events = [
    ...Array.from({ length: 18 }, (_, index) => ({
      timestamp: String(1_750_979_225_854 - index * 60_000),
      model: 'composer-2.5-fast',
      kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS',
      tokenUsage: { inputTokens: 1000 + index },
    })),
    {
      timestamp: '1750979225000',
      model: 'grok-bot-automation',
      kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS',
      tokenUsage: { inputTokens: 50_000 },
    },
    {
      timestamp: '1750979224000',
      model: 'grok-bot-default',
      kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS',
      tokenUsage: { inputTokens: 30_000 },
    },
  ];

  const page1 = buildUsageFlowPageFromEvents(events, { page: 1, pageSize: 20 }, 20);
  assert('filtered total count', page1.totalCount === 18, String(page1.totalCount));
  assert('filtered page1 full', page1.entries.length === 18, String(page1.entries.length));
  assert(
    'no grok-bot on page',
    page1.entries.every(
      (e) => e.model !== 'grok-bot-automation' && e.model !== 'grok-bot-default',
    ),
  );
  assert('single page after filter', page1.totalPages === 1);

  const included = buildUsageFlowPageFromEvents(
    events,
    { page: 1, pageSize: 20 },
    20,
    { includeGrokBotUsage: true },
  );
  assert('include grok-bot total', included.totalCount === 20, String(included.totalCount));
  assert(
    'include grok-bot rows',
    included.entries.some((e) => e.model === 'grok-bot-automation'),
  );
}

console.log('\nbuildUsageFlowPage integration');

{
  const display = buildUsageFlowPage(
    {
      totalUsageEventsCount: 1,
      eventsComplete: true,
      usageEventsDisplay: [
        {
          timestamp: '1750979225854',
          model: 'default',
          kind: 'USAGE_EVENT_KIND_FREE',
        },
      ],
    },
    { page: 1, pageSize: 100 },
  );

  assert('free row model auto', display.entries[0]?.model === 'auto');
  assert('free row type', display.entries[0]?.type === 'Free');
  assert('free row cost', display.entries[0]?.cost === 'Free');
}

{
  const display = buildUsageFlowPage(
    {
      totalUsageEventsCount: 1,
      eventsComplete: true,
      usageEventsDisplay: [
        {
          timestamp: '1750979225854',
          model: 'composer-2.5-fast',
          kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS',
          maxMode: true,
          tokenUsage: { inputTokens: 372_000, outputTokens: 1000 },
        },
      ],
    },
    { page: 1, pageSize: 100 },
  );

  assert('included max row type', display.entries[0]?.type === 'Included');
  assert('included max row badge', display.entries[0]?.modelMax === true);
  assert('included max row tokens', display.entries[0]?.tokens === '37.3万');
}

console.log('\nextractUsageEventTimestamp');

assert(
  'extracts from event',
  extractUsageEventTimestamp({ timestamp: '1750979225854' }) !== null,
);

console.log('\nformatUsageEventKind legacy');

assert(
  'legacy kind helper',
  formatUsageEventKind('USAGE_EVENT_KIND_INCLUDED_IN_BUSINESS') === 'Included',
);

console.log('\nAll usage flow format checks passed.');
