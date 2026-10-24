/**
 * Regression checks for the "today" event window.
 *
 * The today window must never start before the billing cycle start: the quota
 * resets at the cycle boundary, so usage recorded before it belongs to the
 * previous cycle. Keeping it in "today" makes today a superset of the cycle,
 * which leaves today% without a denominator (null) and drops the collapsed
 * "今日 Cursor" chip entirely.
 *
 * Run: npx tsx scripts/verify-today-range.ts
 */
import {
  buildUsageEventsResponse,
  getTodayRangeMs,
} from '../src/core/providers/CookieProvider';
import { normalizeCookie } from '../src/core/normalizer';

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
  console.log(`  ok ${name}`);
}

/** Local midnight of the given instant (same rule as the implementation). */
function localMidnight(nowMs: number): number {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const NOW = new Date('2026-10-24T13:05:07.711Z').getTime();
const MIDNIGHT = localMidnight(NOW);

console.log('getTodayRangeMs');

{
  // Cycle starts later today → today starts at the cycle boundary.
  const cycleStart = MIDNIGHT + 3 * 60 * 60 * 1000;
  const range = getTodayRangeMs(
    { billingCycleStart: new Date(cycleStart).toISOString() },
    NOW,
  );
  assert('clips to cycle start', Number(range.startDate) === cycleStart, range.startDate);
  assert('ends at now', Number(range.endDate) === NOW, range.endDate);
}

{
  // Cycle started before today → today keeps the calendar-day start.
  const cycleStart = MIDNIGHT - 5 * 60 * 60 * 1000;
  const range = getTodayRangeMs(
    { billingCycleStart: new Date(cycleStart).toISOString() },
    NOW,
  );
  assert('keeps local midnight', Number(range.startDate) === MIDNIGHT, range.startDate);
}

{
  // Cycle starts exactly at midnight → unchanged.
  const range = getTodayRangeMs(
    { billingCycleStart: new Date(MIDNIGHT).toISOString() },
    NOW,
  );
  assert('midnight cycle keeps midnight', Number(range.startDate) === MIDNIGHT, range.startDate);
}

{
  // A future cycle start must not produce an inverted window.
  const cycleStart = NOW + 60 * 60 * 1000;
  const range = getTodayRangeMs(
    { billingCycleStart: new Date(cycleStart).toISOString() },
    NOW,
  );
  assert('future cycle ignored', Number(range.startDate) === MIDNIGHT, range.startDate);
  assert('window stays ordered', Number(range.startDate) < Number(range.endDate));
}

{
  const range = getTodayRangeMs({ billingCycleStart: null }, NOW);
  assert('missing cycle start falls back', Number(range.startDate) === MIDNIGHT, range.startDate);
}

{
  const range = getTodayRangeMs({ billingCycleStart: 'not-a-date' }, NOW);
  assert('invalid cycle start falls back', Number(range.startDate) === MIDNIGHT, range.startDate);
}

{
  const range = getTodayRangeMs({}, NOW);
  assert('absent field falls back', Number(range.startDate) === MIDNIGHT, range.startDate);
}

console.log('today window stays inside the billing cycle');

{
  // The cycle window runs [cycleStart, cycleEnd]; the today window must be a
  // subset of it, otherwise today% has no denominator to divide by.
  const cycleStart = MIDNIGHT + 3 * 60 * 60 * 1000;
  const cycleEnd = cycleStart + 30 * 24 * 60 * 60 * 1000;
  const range = getTodayRangeMs(
    { billingCycleStart: new Date(cycleStart).toISOString() },
    NOW,
  );
  const start = Number(range.startDate);
  const end = Number(range.endDate);
  assert('today starts no earlier than cycle', start >= cycleStart, `${start} < ${cycleStart}`);
  assert('today ends no later than cycle end', end <= cycleEnd, `${end} > ${cycleEnd}`);
}

console.log('today window never precedes the cycle boundary');

{
  // Sweep the whole day with a fixed cycle start: before the boundary the
  // window must stay at local midnight, from the boundary on it must be
  // pinned to the cycle start — never earlier than it.
  let clipped = 0;
  let before = 0;
  const cycleStart = MIDNIGHT + 3 * 60 * 60 * 1000;
  for (let hour = 0; hour < 24; hour += 1) {
    const now = MIDNIGHT + hour * 60 * 60 * 1000 + 30 * 60 * 1000;
    const range = getTodayRangeMs(
      { billingCycleStart: new Date(cycleStart).toISOString() },
      now,
    );
    const start = Number(range.startDate);
    if (now <= cycleStart) {
      assert(`hour ${hour}: before boundary keeps midnight`, start === MIDNIGHT, String(start));
      before += 1;
    } else {
      assert(
        `hour ${hour}: from boundary on pins cycle start`,
        start === cycleStart,
        `${start} != ${cycleStart}`,
      );
      clipped += 1;
    }
  }
  assert('sweep covered hours before the boundary', before > 0, String(before));
  assert('sweep covered hours after the boundary', clipped > 0, String(clipped));
}

console.log('empty today window: complete zero, not unknown');

{
  // 周期刚重置时，今日窗口（已裁剪到周期起点）可能合法为空。
  // 取数完整 = 今日确实为 0；取数失败 = 今日不可得。二者不可混同。
  const complete = buildUsageEventsResponse([], null, true);
  assert('empty complete sample is complete', complete.eventsComplete === true);
  assert('empty complete sample keeps empty list', (complete.usageEventsDisplay ?? []).length === 0);

  const failed = buildUsageEventsResponse([], null, false);
  assert('failed sample is incomplete', failed.eventsComplete === false);

  const snapshot = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-10-24T09:54:26.000Z',
        billingCycleEnd: '2026-11-24T09:54:26.000Z',
        individualUsage: {
          plan: { limit: 2000, used: 0, totalPercentUsed: 0, autoPercentUsed: 0, apiPercentUsed: 0 },
        },
      },
      todayEvents: complete,
      cycleEvents: complete,
    },
    new Date().toISOString(),
  );

  assert('empty today reports 0 tokens', snapshot.metrics.autoTodayTokens === 0, String(snapshot.metrics.autoTodayTokens));
  assert(
    'empty today reports 0 percent',
    snapshot.metrics.autoTodayUsedPercent === 0,
    String(snapshot.metrics.autoTodayUsedPercent),
  );

  const failedSnapshot = normalizeCookie(
    {
      summary: {
        billingCycleStart: '2026-10-24T09:54:26.000Z',
        billingCycleEnd: '2026-11-24T09:54:26.000Z',
        individualUsage: {
          plan: { limit: 2000, used: 0, totalPercentUsed: 0, autoPercentUsed: 0, apiPercentUsed: 0 },
        },
      },
      todayEvents: failed,
      cycleEvents: failed,
    },
    new Date().toISOString(),
  );

  assert(
    'failed today stays unknown',
    failedSnapshot.metrics.autoTodayUsedPercent === null,
    String(failedSnapshot.metrics.autoTodayUsedPercent),
  );
}

console.log('\nAll today-range checks passed.');
