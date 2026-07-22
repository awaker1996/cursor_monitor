/**
 * Analyze last-day usage events: kind / tokens / maxMode distribution.
 * Run: set WORKOS_COOKIE=... && npx tsx scripts/analyze-usage-flow-kinds.ts
 */
import type { RawUsageEvent } from '../src/shared/types';
import { resolveUsageFlowPreset } from '../src/shared/usageFlowDates';
import {
  isMaxModeEvent,
  resolveUsageFlowType,
  sumEventTokens,
} from '../src/shared/usageFlowFormat';

const cookie = process.env.WORKOS_COOKIE?.trim();
if (!cookie) {
  console.error('Set WORKOS_COOKIE to your WorkosCursorSessionToken value.');
  process.exit(1);
}

const ENDPOINT = 'https://cursor.com/api/dashboard/get-filtered-usage-events';

async function fetchPage(
  startDateMs: number,
  endDateMs: number,
  page: number,
  pageSize: number,
): Promise<{ events: RawUsageEvent[]; total?: number }> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: `WorkosCursorSessionToken=${cookie}`,
      Origin: 'https://cursor.com',
      Referer: 'https://cursor.com/dashboard/usage',
      'User-Agent': 'CursorTokenMonitor/1.0',
    },
    body: JSON.stringify({
      teamId: 0,
      startDate: String(startDateMs),
      endDate: String(endDateMs),
      page,
      pageSize,
    }),
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    usageEventsDisplay?: RawUsageEvent[];
    totalUsageEventsCount?: number;
  };

  return {
    events: payload.usageEventsDisplay ?? [],
    total: payload.totalUsageEventsCount,
  };
}

async function main(): Promise<void> {
  const range = resolveUsageFlowPreset('1d');
  const pageSize = 100;
  const maxPages = 5;
  const events: RawUsageEvent[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await fetchPage(range.startDateMs, range.endDateMs, page, pageSize);
    events.push(...batch.events);
    if (batch.events.length < pageSize) break;
  }

  console.log(`Fetched ${events.length} events (${range.label})\n`);

  const kindStats = new Map<string, number>();
  const typeStats = new Map<string, number>();
  let zeroTokenIncludedKind = 0;
  let maxModeCount = 0;

  for (const event of events) {
    const kind = String(event.kind ?? '(empty)');
    const tokens = sumEventTokens(event);
    const type = resolveUsageFlowType(event, tokens);

    kindStats.set(kind, (kindStats.get(kind) ?? 0) + 1);
    typeStats.set(type, (typeStats.get(type) ?? 0) + 1);

    if (tokens <= 0 && /INCLUDED/i.test(kind)) zeroTokenIncludedKind += 1;
    if (isMaxModeEvent(event)) maxModeCount += 1;
  }

  console.log('--- kind (raw API) ---');
  for (const [kind, count] of [...kindStats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${count}\t${kind}`);
  }

  console.log('\n--- resolved Type ---');
  for (const [type, count] of [...typeStats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${count}\t${type}`);
  }

  console.log(`\nmaxMode events: ${maxModeCount}`);
  console.log(`zero-token rows with INCLUDED kind: ${zeroTokenIncludedKind}`);

  console.log('\n--- sample maxMode rows ---');
  for (const event of events.filter((e) => isMaxModeEvent(e)).slice(0, 5)) {
    console.log({
      model: event.model,
      kind: event.kind,
      tokens: sumEventTokens(event),
      type: resolveUsageFlowType(event, sumEventTokens(event)),
    });
  }

  console.log('\n--- sample zero-token rows ---');
  for (const event of events.filter((e) => sumEventTokens(e) <= 0).slice(0, 5)) {
    console.log({
      model: event.model,
      kind: event.kind,
      type: resolveUsageFlowType(event, 0),
      maxMode: isMaxModeEvent(event),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
