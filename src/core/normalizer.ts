import type {
  DataSource,
  IncludedUsageBreakdown,
  IncludedUsageCategory,
  ModelUsageItem,
  RawAggregatedUsageItem,
  RawAggregatedUsageResponse,
  RawCookieCombinedResponse,
  RawCookieResponse,
  RawOfficialResponse,
  RawUsageEvent,
  RawUsageEventsResponse,
  TokenQuota,
  TokenSnapshot,
  UsageFlowDisplay,
  UsageFlowEntry,
  UsageMetrics,
} from '../shared/types';
import { CURSOR_MODELS_LABEL, OTHER_MODELS_LABEL, formatUsageFlowDate } from '../shared/format';
import {
  extractUsageEventTimestamp,
  mapUsageFlowEntry,
} from '../shared/usageFlowFormat';

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

/** Grok Bot models that should not count toward local IDE usage stats. */
const EXCLUDED_GROK_BOT_MODELS = new Set(['grok-bot-automation', 'grok-bot-default']);

function isExcludedGrokBotModel(model: string | undefined): boolean {
  if (!model) return false;
  return EXCLUDED_GROK_BOT_MODELS.has(model.trim().toLowerCase());
}

function isAutoModel(model: string | undefined): boolean {
  if (!model) return false;
  const normalized = model.toLowerCase();
  return (
    normalized.includes('composer') ||
    normalized.includes('auto') ||
    normalized.includes('grok') ||
    normalized.includes('cursor-small') ||
    normalized.includes('default')
  );
}

/**
 * Prefer Cursor `tier` when present (1 ≈ Other Models, 2 ≈ Cursor Models);
 * otherwise fall back to model-name heuristics.
 */
function isFirstPartyAggregation(item: RawAggregatedUsageItem): boolean {
  const tier = asNumber(item.tier);
  if (tier === 2) return true;
  if (tier === 1) return false;
  return isAutoModel(item.modelIntent);
}

function aggregationTokens(item: RawAggregatedUsageItem): number {
  return (
    (asNumber(item.inputTokens) ?? 0) +
    (asNumber(item.outputTokens) ?? 0) +
    (asNumber(item.cacheReadTokens) ?? 0) +
    (asNumber(item.cacheWriteTokens) ?? 0)
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

/** Build per-event usage flow rows from a paginated events response. */
export function buildUsageFlowPage(
  eventsResponse: RawUsageEventsResponse | null | undefined,
  query: { page: number; pageSize: number; dateRangeLabel?: string },
): UsageFlowDisplay {
  const rawEvents = eventsResponse?.usageEventsDisplay ?? [];
  const events = filterExcludedGrokBotUsageEvents(rawEvents);
  const reportedTotal = resolveUsageFlowTotalCount(eventsResponse, rawEvents.length);
  const excludedOnPage = rawEvents.length - events.length;
  const totalCount = Math.max(0, reportedTotal - excludedOnPage);
  const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize));
  const page = clampUsageFlowPage(query.page, totalPages);

  if (events.length === 0) {
    return {
      available: false,
      incomplete: eventsResponse?.eventsComplete === false,
      totalCount,
      page,
      pageSize: query.pageSize,
      totalPages,
      dateRangeLabel: query.dateRangeLabel,
      entries: [],
    };
  }

  const entries = mapAndSortUsageFlowEntries(events);

  return {
    available: true,
    incomplete: eventsResponse?.eventsComplete === false,
    totalCount,
    page,
    pageSize: query.pageSize,
    totalPages,
    dateRangeLabel: query.dateRangeLabel,
    entries,
  };
}

/** Client-side slice after fetching full event list (avoids server page boundary gaps). */
export function buildUsageFlowPageFromEvents(
  allEvents: RawUsageEvent[],
  query: { page: number; pageSize: number; dateRangeLabel?: string },
  reportedTotal?: number,
): UsageFlowDisplay {
  const deduped = dedupeUsageFlowEvents(allEvents);
  const prepared = filterExcludedGrokBotUsageEvents(deduped);
  const totalCount = prepared.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize));
  const page = clampUsageFlowPage(query.page, totalPages);
  const start = (page - 1) * query.pageSize;
  const allEntries = mapAndSortUsageFlowEntries(prepared);
  const entries = allEntries.slice(start, start + query.pageSize);

  return {
    available: totalCount > 0,
    incomplete:
      reportedTotal && reportedTotal > 0 && deduped.length < reportedTotal ? true : undefined,
    totalCount,
    page,
    pageSize: query.pageSize,
    totalPages,
    dateRangeLabel: query.dateRangeLabel,
    entries,
  };
}

export function resolveUsageFlowTotalCount(
  eventsResponse: RawUsageEventsResponse | null | undefined,
  fallbackLength = 0,
): number {
  const reported = eventsResponse?.totalUsageEventsCount;
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) {
    return Math.floor(reported);
  }
  return fallbackLength;
}

function clampUsageFlowPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), totalPages);
}

function usageFlowEventKey(event: RawUsageEvent): string {
  const ts = extractUsageEventTimestamp(event) ?? '';
  const tokens = eventTokens(event);
  const kind = event.kind ?? '';
  const model = event.model ?? '';
  return `${ts}|${model}|${kind}|${tokens}`;
}

function dedupeUsageFlowEvents(events: RawUsageEvent[]): RawUsageEvent[] {
  const seen = new Set<string>();
  const out: RawUsageEvent[] = [];
  for (const event of events) {
    const key = usageFlowEventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function filterExcludedGrokBotUsageEvents(events: RawUsageEvent[]): RawUsageEvent[] {
  return events.filter((event) => !isExcludedGrokBotModel(event.model));
}

function mapAndSortUsageFlowEntries(events: RawUsageEvent[]): UsageFlowEntry[] {
  const entries: UsageFlowEntry[] = events.map((event) =>
    mapUsageFlowEntry(event, eventTokens(event), eventCostCents(event), formatUsageFlowDate),
  );

  entries.sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return b.timestamp.localeCompare(a.timestamp);
  });

  return entries;
}

/** Clamp a 0..1 share; guards bad denominators and partial aggregates. */
function clampShare(share: number): number {
  if (!Number.isFinite(share)) return 0;
  return Math.max(0, Math.min(1, share));
}

/** Ensure today percent never exceeds the authoritative cycle percent. */
function clampTodayPercent(value: number, cyclePercent: number): number {
  return Math.max(0, Math.min(cyclePercent, value));
}

/** When cost share exceeds token share by this much, prefer the conservative token share. */
const SHARE_DIVERGENCE_THRESHOLD = 0.05;

function isCycleEventsPaginatedIncomplete(
  cycleEvents: RawUsageEventsResponse | null | undefined,
): boolean {
  if (cycleEvents?.eventsComplete === false) return true;
  const fetched = cycleEvents?.usageEventsDisplay?.length ?? 0;
  const total = cycleEvents?.totalUsageEventsCount;
  if (fetched === 0) return false;
  if (total === null || total === undefined || !Number.isFinite(Number(total))) return false;
  return fetched < Number(total);
}

/**
 * Prefer cost share unless it looks inflated vs token volume
 * (missing historical cost fields, or expensive-model skew that would
 * make "今日" appear near the full cycle when tokens say otherwise).
 */
function pickTodayShare(
  costShare: number,
  tokenShare: number,
  cycleTokens: number,
  todayTokens: number,
): number {
  const suspiciousCostShare =
    costShare >= 0.999 &&
    tokenShare < 0.999 &&
    cycleTokens - todayTokens >= 1000;

  const costExceedsToken =
    costShare > tokenShare && costShare - tokenShare >= SHARE_DIVERGENCE_THRESHOLD;

  if (suspiciousCostShare || costExceedsToken) {
    return tokenShare;
  }

  return costShare;
}

export interface TodayUsedPercentInput {
  todayCostCents: number;
  cycleCostCents: number;
  todayTokens: number;
  cycleTokens: number;
  cyclePercent: number | null;
  todayComplete?: boolean;
  cycleCostReliable?: boolean;
  cycleEventsIncomplete?: boolean;
}

/**
 * Derive today's used percent from cost/token shares:
 * share * cyclePercent, preferring cost when aligned with tokens.
 * When cost share is significantly higher than token share (≥5%),
 * fall back to the more conservative token share.
 * Complete zero usage returns 0%.
 */
export function todayUsedPercent(input: TodayUsedPercentInput): number | null {
  const {
    todayCostCents,
    cycleCostCents,
    todayTokens,
    cycleTokens,
    cyclePercent,
    todayComplete = false,
    cycleCostReliable = false,
    cycleEventsIncomplete = false,
  } = input;

  if (cyclePercent === null) return null;
  if (!todayComplete) return null;

  const hasCost = cycleCostReliable && cycleCostCents > 0 && todayCostCents > 0;
  const hasTokens = cycleTokens > 0 && todayTokens > 0;
  const tokenSetInvalid = hasTokens && todayTokens > cycleTokens;
  const tokenDenominatorUnreliable = cycleEventsIncomplete || tokenSetInvalid;

  const costShare = hasCost ? clampShare(todayCostCents / cycleCostCents) : null;
  const tokenShare =
    hasTokens && !tokenDenominatorUnreliable ? clampShare(todayTokens / cycleTokens) : null;

  const costBased =
    costShare !== null ? clampTodayPercent(costShare * cyclePercent, cyclePercent) : null;
  const tokenBased =
    tokenShare !== null ? clampTodayPercent(tokenShare * cyclePercent, cyclePercent) : null;

  // Truncated cycle token totals would inflate token share — prefer cost.
  if (tokenDenominatorUnreliable) {
    if (costBased !== null) return costBased;
    if (todayCostCents <= 0 && todayTokens <= 0) return 0;
    return null;
  }

  if (costShare !== null && tokenShare !== null) {
    const pickedShare = pickTodayShare(costShare, tokenShare, cycleTokens, todayTokens);
    return clampTodayPercent(pickedShare * cyclePercent, cyclePercent);
  }

  if (costBased !== null) return costBased;
  if (tokenBased !== null) return tokenBased;

  if (todayCostCents <= 0 && todayTokens <= 0) return 0;
  return null;
}

interface BucketCycleCosts {
  apiCycleCostCents: number;
  autoCycleCostCents: number;
  reliable: boolean;
}

function sumAggregatedCycleCosts(
  aggregated: RawAggregatedUsageResponse | null | undefined,
): BucketCycleCosts | null {
  const rows = aggregated?.aggregations;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  let apiCycleCostCents = 0;
  let autoCycleCostCents = 0;
  for (const item of rows) {
    if (isExcludedGrokBotModel(item.modelIntent)) continue;
    const costCents = asNumber(item.totalCents) ?? 0;
    if (costCents <= 0) continue;
    if (isFirstPartyAggregation(item)) autoCycleCostCents += costCents;
    else apiCycleCostCents += costCents;
  }

  if (apiCycleCostCents <= 0 && autoCycleCostCents <= 0) return null;
  return { apiCycleCostCents, autoCycleCostCents, reliable: true };
}

function sumEventCycleCosts(
  cycleEvents: RawUsageEventsResponse | null | undefined,
): BucketCycleCosts | null {
  if (!cycleEvents || isCycleEventsPaginatedIncomplete(cycleEvents)) return null;

  let apiCycleCostCents = 0;
  let autoCycleCostCents = 0;
  for (const event of cycleEvents.usageEventsDisplay ?? []) {
    if (isExcludedGrokBotModel(event.model)) continue;
    const costCents = eventCostCents(event) ?? 0;
    if (costCents <= 0) continue;
    if (isAutoModel(event.model)) autoCycleCostCents += costCents;
    else apiCycleCostCents += costCents;
  }

  if (apiCycleCostCents <= 0 && autoCycleCostCents <= 0) return null;
  return { apiCycleCostCents, autoCycleCostCents, reliable: true };
}

function resolveCycleCosts(
  aggregatedUsage: RawAggregatedUsageResponse | null | undefined,
  cycleEvents: RawUsageEventsResponse | null | undefined,
): BucketCycleCosts | null {
  return sumAggregatedCycleCosts(aggregatedUsage) ?? sumEventCycleCosts(cycleEvents);
}

interface BucketCycleTokens {
  apiTokens: number;
  autoTokens: number;
  reliable: boolean;
}

/** Complete-cycle token totals from aggregated usage (no event pagination). */
function sumAggregatedCycleTokens(
  aggregated: RawAggregatedUsageResponse | null | undefined,
): BucketCycleTokens | null {
  const rows = aggregated?.aggregations;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  let apiTokens = 0;
  let autoTokens = 0;
  for (const item of rows) {
    if (isExcludedGrokBotModel(item.modelIntent)) continue;
    const tokens = aggregationTokens(item);
    if (tokens <= 0) continue;
    if (isFirstPartyAggregation(item)) autoTokens += tokens;
    else apiTokens += tokens;
  }

  if (apiTokens <= 0 && autoTokens <= 0) return null;
  return { apiTokens, autoTokens, reliable: true };
}

function sumEventCycleTokens(
  cycleEvents: RawUsageEventsResponse | null | undefined,
): BucketCycleTokens | null {
  if (!cycleEvents || isCycleEventsPaginatedIncomplete(cycleEvents)) return null;

  let apiTokens = 0;
  let autoTokens = 0;
  for (const event of cycleEvents.usageEventsDisplay ?? []) {
    if (isExcludedGrokBotModel(event.model)) continue;
    const tokens = eventTokens(event);
    if (tokens <= 0) continue;
    if (isAutoModel(event.model)) autoTokens += tokens;
    else apiTokens += tokens;
  }

  if (apiTokens <= 0 && autoTokens <= 0) return null;
  return { apiTokens, autoTokens, reliable: true };
}

function resolveCycleTokens(
  aggregatedUsage: RawAggregatedUsageResponse | null | undefined,
  cycleEvents: RawUsageEventsResponse | null | undefined,
): BucketCycleTokens | null {
  return sumAggregatedCycleTokens(aggregatedUsage) ?? sumEventCycleTokens(cycleEvents);
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
  aggregatedUsage: RawAggregatedUsageResponse | null | undefined,
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

  const cycleCosts = resolveCycleCosts(aggregatedUsage, cycleEvents);
  if (cycleCosts) {
    result.apiCycleCostCents = cycleCosts.apiCycleCostCents;
    result.autoCycleCostCents = cycleCosts.autoCycleCostCents;
  }

  // Prefer aggregated (or complete-event) cycle tokens so today% denominator
  // matches the token totals shown in the UI — not a truncated 15-page sample.
  const cycleTokens = resolveCycleTokens(aggregatedUsage, cycleEvents);
  if (cycleTokens) {
    result.apiTokens = cycleTokens.apiTokens;
    result.autoTokens = cycleTokens.autoTokens;
  } else {
    for (const event of cycleEvents?.usageEventsDisplay ?? []) {
      if (isExcludedGrokBotModel(event.model)) continue;
      const tokens = eventTokens(event);
      if (!cycleCosts) {
        const costCents = eventCostCents(event) ?? 0;
        if (isAutoModel(event.model)) {
          if (tokens > 0) result.autoTokens += tokens;
          if (costCents > 0) result.autoCycleCostCents += costCents;
        } else {
          if (tokens > 0) result.apiTokens += tokens;
          if (costCents > 0) result.apiCycleCostCents += costCents;
        }
        continue;
      }

      if (isAutoModel(event.model)) {
        if (tokens > 0) result.autoTokens += tokens;
      } else if (tokens > 0) {
        result.apiTokens += tokens;
      }
    }
  }

  for (const event of todayEvents?.usageEventsDisplay ?? []) {
    if (isExcludedGrokBotModel(event.model)) continue;
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

  const todayComplete = todayEvents?.eventsComplete === true;
  const cycleCostReliable = cycleCosts?.reliable === true;
  // Aggregated cycle tokens are complete; only treat event pagination as
  // unreliable when we had to fall back to (or lack) event totals.
  const cycleEventsIncomplete =
    cycleTokens?.reliable === true ? false : isCycleEventsPaginatedIncomplete(cycleEvents);

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
    apiTodayUsedPercent: todayUsedPercent({
      todayCostCents: result.apiTodayCostCents,
      cycleCostCents: result.apiCycleCostCents,
      todayTokens: result.apiTodayTokens,
      cycleTokens: result.apiTokens,
      cyclePercent: apiUsedPercent,
      todayComplete,
      cycleCostReliable,
      cycleEventsIncomplete,
    }),
    autoTodayUsedPercent: todayUsedPercent({
      todayCostCents: result.autoTodayCostCents,
      cycleCostCents: result.autoCycleCostCents,
      todayTokens: result.autoTodayTokens,
      cycleTokens: result.autoTokens,
      cyclePercent: autoUsedPercent,
      todayComplete,
      cycleCostReliable,
      cycleEventsIncomplete,
    }),
  };
}

interface ModelAggregate {
  tokens: number;
  costCents: number;
}

/**
 * Display name for Included Usage Item column.
 * Cursor Billing maps the first-party routing bucket `default` → `auto`.
 */
function normalizeModelName(model: string | undefined): string {
  const name = model?.trim();
  if (!name) return 'unknown';
  if (name.toLowerCase() === 'default') return 'auto';
  return name;
}

function clampUsagePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

/**
 * Allocate category plan usage% across models.
 * When the category has cost signal, only cost shares count — zero-cost rows
 * (BYOK / self-funded API keys, e.g. deepseek) stay at 0% like Cursor Billing.
 * Token share is only a fallback when no model has cost in the category.
 */
function modelUsagePercent(
  modelCost: number,
  modelTokens: number,
  categoryCost: number,
  categoryTokens: number,
  categoryUsedPercent: number | null,
): number | null {
  if (categoryUsedPercent === null) return null;

  if (categoryCost > 0) {
    if (modelCost <= 0) return 0;
    return clampUsagePercent(clampShare(modelCost / categoryCost) * categoryUsedPercent);
  }

  if (categoryTokens > 0 && modelTokens > 0) {
    return clampUsagePercent(clampShare(modelTokens / categoryTokens) * categoryUsedPercent);
  }

  return null;
}

function buildIncludedUsageCategory(
  key: 'api' | 'firstParty',
  label: string,
  models: Map<string, ModelAggregate>,
  categoryUsedPercent: number | null,
  /** Full-category denominators (may include excluded Grok Bot cost/tokens). */
  denominators?: { costCents: number; tokens: number },
): IncludedUsageCategory | null {
  if (models.size === 0) return null;

  let displayedCost = 0;
  let displayedTokens = 0;
  for (const agg of models.values()) {
    displayedCost += agg.costCents;
    displayedTokens += agg.tokens;
  }
  const allocCost = denominators?.costCents ?? displayedCost;
  const allocTokens = denominators?.tokens ?? displayedTokens;

  const modelItems: ModelUsageItem[] = [];
  for (const [model, agg] of models.entries()) {
    modelItems.push({
      model,
      tokens: agg.tokens,
      usagePercent: modelUsagePercent(
        agg.costCents,
        agg.tokens,
        allocCost,
        allocTokens,
        categoryUsedPercent,
      ),
    });
  }

  modelItems.sort((a, b) => {
    const aPct = a.usagePercent ?? -1;
    const bPct = b.usagePercent ?? -1;
    if (bPct !== aPct) return bPct - aPct;
    return b.tokens - a.tokens;
  });

  return {
    key,
    label,
    totalTokens: displayedTokens > 0 ? displayedTokens : null,
    usagePercent: categoryUsedPercent,
    models: modelItems,
  };
}

/** Aggregate cycle usage events by model for Included Usage display. */
export function aggregateIncludedUsageByModel(
  cycleEvents: RawUsageEventsResponse | null | undefined,
  apiUsedPercent: number | null,
  autoUsedPercent: number | null,
): IncludedUsageBreakdown {
  const apiModels = new Map<string, ModelAggregate>();
  const autoModels = new Map<string, ModelAggregate>();
  const apiDenom = { costCents: 0, tokens: 0 };
  const autoDenom = { costCents: 0, tokens: 0 };

  for (const event of cycleEvents?.usageEventsDisplay ?? []) {
    const tokens = eventTokens(event);
    const costCents = eventCostCents(event) ?? 0;
    if (tokens <= 0 && costCents <= 0) continue;

    const isAuto = isAutoModel(event.model);
    const denom = isAuto ? autoDenom : apiDenom;
    if (tokens > 0) denom.tokens += tokens;
    if (costCents > 0) denom.costCents += costCents;

    if (isExcludedGrokBotModel(event.model)) continue;

    const model = normalizeModelName(event.model);
    const bucket = isAuto ? autoModels : apiModels;
    const existing = bucket.get(model) ?? { tokens: 0, costCents: 0 };
    if (tokens > 0) existing.tokens += tokens;
    if (costCents > 0) existing.costCents += costCents;
    bucket.set(model, existing);
  }

  const hasEvents = (cycleEvents?.usageEventsDisplay?.length ?? 0) > 0;
  if (!hasEvents) {
    return { available: false, categories: [] };
  }

  const categories = [
    buildIncludedUsageCategory(
      'firstParty',
      CURSOR_MODELS_LABEL,
      autoModels,
      autoUsedPercent,
      autoDenom,
    ),
    buildIncludedUsageCategory('api', OTHER_MODELS_LABEL, apiModels, apiUsedPercent, apiDenom),
  ].filter((category): category is IncludedUsageCategory => category !== null);

  return {
    available: categories.length > 0,
    incomplete: isCycleEventsPaginatedIncomplete(cycleEvents) || undefined,
    categories,
  };
}

/**
 * Build Included Usage from `get-aggregated-usage-events`.
 * This matches Billing & Invoices (complete cycle, no event pagination).
 */
export function aggregateIncludedUsageFromAggregations(
  aggregated: RawAggregatedUsageResponse | null | undefined,
  apiUsedPercent: number | null,
  autoUsedPercent: number | null,
): IncludedUsageBreakdown {
  const rows = aggregated?.aggregations;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { available: false, categories: [] };
  }

  const apiModels = new Map<string, ModelAggregate>();
  const autoModels = new Map<string, ModelAggregate>();
  const apiDenom = { costCents: 0, tokens: 0 };
  const autoDenom = { costCents: 0, tokens: 0 };

  for (const item of rows) {
    const tokens = aggregationTokens(item);
    const costCents = asNumber(item.totalCents) ?? 0;
    if (tokens <= 0 && costCents <= 0) continue;

    const isAuto = isFirstPartyAggregation(item);
    const denom = isAuto ? autoDenom : apiDenom;
    if (tokens > 0) denom.tokens += tokens;
    if (costCents > 0) denom.costCents += costCents;

    if (isExcludedGrokBotModel(item.modelIntent)) continue;

    const model = normalizeModelName(item.modelIntent);
    const bucket = isAuto ? autoModels : apiModels;
    const existing = bucket.get(model) ?? { tokens: 0, costCents: 0 };
    if (tokens > 0) existing.tokens += tokens;
    if (costCents > 0) existing.costCents += costCents;
    bucket.set(model, existing);
  }

  const categories = [
    buildIncludedUsageCategory(
      'firstParty',
      CURSOR_MODELS_LABEL,
      autoModels,
      autoUsedPercent,
      autoDenom,
    ),
    buildIncludedUsageCategory('api', OTHER_MODELS_LABEL, apiModels, apiUsedPercent, apiDenom),
  ].filter((category): category is IncludedUsageCategory => category !== null);

  return {
    available: categories.length > 0,
    categories,
  };
}

/** Prefer aggregated API; fall back to paginated cycle events. */
export function resolveIncludedUsage(
  aggregated: RawAggregatedUsageResponse | null | undefined,
  cycleEvents: RawUsageEventsResponse | null | undefined,
  apiUsedPercent: number | null,
  autoUsedPercent: number | null,
): IncludedUsageBreakdown {
  const fromAggregated = aggregateIncludedUsageFromAggregations(
    aggregated,
    apiUsedPercent,
    autoUsedPercent,
  );
  if (fromAggregated.available) return fromAggregated;
  return aggregateIncludedUsageByModel(cycleEvents, apiUsedPercent, autoUsedPercent);
}

function buildMetricsFromPlan(
  plan: NonNullable<NonNullable<RawCookieResponse['individualUsage']>['plan']>,
  cycleEvents?: RawUsageEventsResponse | null,
  todayEvents?: RawUsageEventsResponse | null,
  aggregatedUsage?: RawAggregatedUsageResponse | null,
): UsageMetrics {
  const limit = asNumber(plan?.limit);
  const used = asNumber(plan?.used);
  let totalUsedPercent = asNumber(plan?.totalPercentUsed);
  let apiUsedPercent = asNumber(plan?.apiPercentUsed);
  let autoUsedPercent = asNumber(plan?.autoPercentUsed);

  // Some plan payloads omit percent fields but still provide used/limit.
  if (totalUsedPercent === null) {
    totalUsedPercent = percentFromUsed(used, limit);
  }

  const tokenMetrics = aggregateTokenEvents(
    cycleEvents,
    todayEvents,
    aggregatedUsage,
    apiUsedPercent,
    autoUsedPercent,
  );

  return {
    totalUsedPercent,
    apiUsedPercent,
    autoUsedPercent,
    totalUsed: used ?? usedFromPercent(totalUsedPercent, limit),
    apiUsed: usedFromPercent(apiUsedPercent, limit),
    autoUsed: usedFromPercent(autoUsedPercent, limit),
    planLimit: limit,
    ...tokenMetrics,
  };
}

function buildMetricsFromOverall(
  overall: NonNullable<NonNullable<RawCookieResponse['individualUsage']>['overall']>,
  cycleEvents?: RawUsageEventsResponse | null,
  todayEvents?: RawUsageEventsResponse | null,
  aggregatedUsage?: RawAggregatedUsageResponse | null,
): { auto: TokenQuota; api: TokenQuota; metrics: UsageMetrics } {
  const limit = asNumber(overall.limit);
  const used = asNumber(overall.used);
  const remaining =
    asNumber(overall.remaining) ??
    (limit !== null && used !== null ? Math.max(limit - used, 0) : null);
  const totalUsedPercent =
    asNumber(overall.totalPercentUsed) ?? percentFromUsed(used, limit);
  const apiUsedPercent = asNumber(overall.apiPercentUsed);
  const autoUsedPercent = asNumber(overall.autoPercentUsed);
  const tokenMetrics = aggregateTokenEvents(
    cycleEvents,
    todayEvents,
    aggregatedUsage,
    apiUsedPercent,
    autoUsedPercent,
  );

  return {
    auto: toQuota(remaining, limit, null),
    api: toQuota(remaining, limit, null),
    metrics: {
      totalUsedPercent,
      apiUsedPercent,
      autoUsedPercent,
      totalUsed: used ?? usedFromPercent(totalUsedPercent, limit),
      apiUsed: usedFromPercent(apiUsedPercent, limit),
      autoUsed: usedFromPercent(autoUsedPercent, limit),
      planLimit: limit,
      ...tokenMetrics,
    },
  };
}

function backfillMetricsTokensFromIncludedUsage(
  metrics: UsageMetrics,
  includedUsage: IncludedUsageBreakdown,
): UsageMetrics {
  if (!includedUsage.available || includedUsage.categories.length === 0) return metrics;

  const apiCat = includedUsage.categories.find((category) => category.key === 'api');
  const autoCat = includedUsage.categories.find((category) => category.key === 'firstParty');
  const apiTokens = metrics.apiTokens ?? apiCat?.totalTokens ?? null;
  const autoTokens = metrics.autoTokens ?? autoCat?.totalTokens ?? null;
  const summed =
    (apiTokens ?? 0) + (autoTokens ?? 0) > 0 ? (apiTokens ?? 0) + (autoTokens ?? 0) : null;

  return {
    ...metrics,
    apiTokens,
    autoTokens,
    totalTokens: metrics.totalTokens ?? summed,
    apiUsedPercent: metrics.apiUsedPercent ?? apiCat?.usagePercent ?? null,
    autoUsedPercent: metrics.autoUsedPercent ?? autoCat?.usagePercent ?? null,
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
  aggregatedUsage?: RawAggregatedUsageResponse | null;
} {
  const combined = raw as RawCookieCombinedResponse & RawCookieResponse;
  if (
    combined.summary !== null &&
    combined.summary !== undefined &&
    typeof combined.summary === 'object'
  ) {
    return {
      summary: combined.summary,
      todayEvents: combined.todayEvents,
      cycleEvents: combined.cycleEvents,
      aggregatedUsage: combined.aggregatedUsage,
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
    includedUsage: { available: false, categories: [] },
    billingCycleStart: null,
    billingCycleEnd,
    fetchedAt,
    stale,
    rawVersion: 'official:v1',
  };
}

export function normalizeCookie(raw: unknown, fetchedAt: string): TokenSnapshot {
  const { summary: data, todayEvents, cycleEvents, aggregatedUsage } = unwrapCookieRaw(raw);

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
      api = toQuota(remaining, limit, resetAt);
    }

    metrics = buildMetricsFromPlan(plan, cycleEvents, todayEvents, aggregatedUsage);
  } else if (data.individualUsage?.overall) {
    const fromOverall = buildMetricsFromOverall(
      data.individualUsage.overall,
      cycleEvents,
      todayEvents,
      aggregatedUsage,
    );
    auto = { ...fromOverall.auto, resetAt };
    api = { ...fromOverall.api, resetAt };
    metrics = fromOverall.metrics;
  } else {
    metrics = buildMetricsFromQuotas(auto, api);
  }

  const includedUsage = resolveIncludedUsage(
    aggregatedUsage,
    cycleEvents,
    metrics.apiUsedPercent,
    metrics.autoUsedPercent,
  );
  metrics = backfillMetricsTokensFromIncludedUsage(metrics, includedUsage);

  const billingCycleStart = data.billingCycleStart ?? null;
  const billingCycleEnd = data.billingCycleEnd ?? resetAt;

  const stale = isEmptyQuota(auto) && isEmptyQuota(api) && metrics.totalUsedPercent === null;

  return {
    source: 'cookie',
    auto,
    api,
    metrics,
    includedUsage,
    billingCycleStart,
    billingCycleEnd,
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
