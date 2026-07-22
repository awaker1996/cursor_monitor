import type {
  AppSettings,
  ProviderResult,
  RawCookieResponse,
  RawUsageEventsResponse,
  TokenProvider,
} from '../../shared/types';
import { credentialVault } from '../../security/CredentialVault';
import { createLogger } from '../../utils/logger';

const log = createLogger('CookieProvider');

const DASHBOARD_SUMMARY_ENDPOINTS = [
  'https://cursor.com/api/usage-summary',
  'https://www.cursor.com/api/usage-summary',
  'https://cursor.com/api/dashboard/usage-summary',
  'https://www.cursor.com/api/dashboard/usage-summary',
];

const DASHBOARD_EVENTS_ENDPOINTS = [
  'https://cursor.com/api/dashboard/get-filtered-usage-events',
  'https://www.cursor.com/api/dashboard/get-filtered-usage-events',
];

/** Billing Included Usage uses this server-side aggregation (no event pagination). */
const DASHBOARD_AGGREGATED_ENDPOINTS = [
  'https://cursor.com/api/dashboard/get-aggregated-usage-events',
  'https://www.cursor.com/api/dashboard/get-aggregated-usage-events',
];

function getTodayRangeMs(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return {
    startDate: String(start.getTime()),
    endDate: String(now.getTime()),
  };
}

function getBillingCycleRangeMs(summary: RawCookieResponse): { startDate: string; endDate: string } {
  const now = Date.now();
  const start = summary.billingCycleStart ? new Date(summary.billingCycleStart).getTime() : null;
  const end = summary.billingCycleEnd ? new Date(summary.billingCycleEnd).getTime() : now;
  if (start !== null && Number.isFinite(start)) {
    return { startDate: String(start), endDate: String(end) };
  }
  return { startDate: String(now - 30 * 24 * 60 * 60 * 1000), endDate: String(now) };
}

function buildDashboardHeaders(cookieHeader: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Cookie: cookieHeader,
    Origin: 'https://cursor.com',
    Referer: 'https://cursor.com/dashboard/usage',
    'User-Agent': 'CursorTokenMonitor/1.0',
  };
}

function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function extractUserIdFromJwt(jwt: string): string | null {
  try {
    const [, payloadPart] = jwt.split('.');
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      sub?: string;
    };
    const sub = payload.sub?.split('|').pop();
    return sub || null;
  } catch {
    return null;
  }
}

function normalizeWorkosCookie(input: string): string {
  const value = input.trim();
  const match = value.match(/(?:^|;\s*)WorkosCursorSessionToken=([^;]+)/);
  const token = match?.[1] ?? value;

  if (token.includes('%3A%3A')) return `WorkosCursorSessionToken=${token}`;
  if (token.includes('::')) return `WorkosCursorSessionToken=${token.replace('::', '%3A%3A')}`;
  if (looksLikeJwt(token)) {
    const userId = extractUserIdFromJwt(token);
    if (userId) return `WorkosCursorSessionToken=${userId}%3A%3A${token}`;
  }

  return match ? `WorkosCursorSessionToken=${token}` : value;
}

/**
 * Extract the numeric Cursor user id from a session cookie.
 * The dashboard `get-filtered-usage-events` endpoint requires `userId`
 * in the request body; without it the response returns no events and the
 * token detail can never be resolved.
 */
function extractUserId(input: string): string | null {
  const value = input.trim();
  const match = value.match(/(?:^|;\s*)WorkosCursorSessionToken=([^;]+)/);
  const token = match?.[1] ?? value;

  const decoded = token.replace(/%3A%3A/gi, '::');
  const [maybeUserId, jwtPart] = decoded.split('::');

  if (jwtPart && /^\d+$/.test(maybeUserId)) return maybeUserId;
  if (/^\d+$/.test(maybeUserId)) return maybeUserId;

  const jwt = jwtPart ?? (looksLikeJwt(decoded) ? decoded : null);
  if (jwt) return extractUserIdFromJwt(jwt);

  return null;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text.slice(0, 500) };
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const message = record.error ?? record.message ?? record.detail;
  return typeof message === 'string' ? message : null;
}

function errorToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reject HTML/error/legacy `/api/usage` payloads that would normalize to all `--`.
 * A usable summary must expose billing cycle dates and/or individual usage buckets.
 */
function hasPlanNumericFields(plan: unknown): boolean {
  if (!plan || typeof plan !== 'object') return false;
  const record = plan as Record<string, unknown>;
  const keys = [
    'used',
    'limit',
    'remaining',
    'apiPercentUsed',
    'autoPercentUsed',
    'totalPercentUsed',
  ];
  return keys.some((key) => {
    const value = Number(record[key]);
    return Number.isFinite(value);
  });
}

export function isUsableCookieSummary(payload: unknown): payload is RawCookieResponse {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  if (typeof record.rawText === 'string') return false;
  if (typeof record.error === 'string') return false;

  const individual = record.individualUsage;
  if (individual && typeof individual === 'object') {
    const usage = individual as Record<string, unknown>;
    if (usage.plan && typeof usage.plan === 'object' && hasPlanNumericFields(usage.plan)) {
      return true;
    }
    if (usage.overall && typeof usage.overall === 'object' && hasPlanNumericFields(usage.overall)) {
      return true;
    }
  }

  const nestedUsage = record.usage;
  if (nestedUsage && typeof nestedUsage === 'object') {
    const usage = nestedUsage as Record<string, unknown>;
    if (usage.auto || usage.api) return true;
  }

  return (
    record.autoRemaining != null ||
    record.autoLimit != null ||
    record.apiRemaining != null ||
    record.apiLimit != null
  );
}

export class CookieProvider implements TokenProvider {
  readonly name = 'cookie' as const;

  constructor(private getSettings: () => AppSettings) {}

  async isConfigured(): Promise<boolean> {
    return credentialVault.hasCookie();
  }

  async fetch(): Promise<ProviderResult> {
    const cookie = await credentialVault.getCookie();
    if (!cookie) {
      throw new Error('Cookie not configured. Please add your session cookie in Settings.');
    }

    const settings = this.getSettings();
    const endpoints = [
      ...DASHBOARD_SUMMARY_ENDPOINTS,
      settings.cookieEndpoint,
    ].filter((endpoint, index, all) => all.indexOf(endpoint) === index);
    const cookieHeader = normalizeWorkosCookie(cookie);
    const userId = extractUserId(cookie);

    let lastError: Error | null = null;
    for (const endpoint of endpoints) {
      log.info('Fetching from cookie endpoint', { endpoint });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutSec * 1000);

      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: buildDashboardHeaders(cookieHeader),
          signal: controller.signal,
        });

        const summary = (await readJsonResponse(response)) as RawCookieResponse;

        if (response.status === 401 || response.status === 403) {
          throw new Error(
            extractErrorMessage(summary) || 'Cookie expired or invalid. Please update your cookie in Settings.',
          );
        }

        if (response.ok) {
          if (!isUsableCookieSummary(summary)) {
            lastError = new Error(
              extractErrorMessage(summary) ||
                'Cookie usage-summary returned no billing/usage fields',
            );
            log.warn('Cookie endpoint returned unusable summary payload', {
              endpoint,
              status: response.status,
              error: lastError.message,
            });
            continue;
          }

          const todayRange = getTodayRangeMs();
          const cycleRange = getBillingCycleRangeMs(summary);
          const todayEventsController = new AbortController();
          const cycleEventsController = new AbortController();
          const aggregatedController = new AbortController();
          const todayEventsTimeout = setTimeout(
            () => todayEventsController.abort(),
            settings.requestTimeoutSec * 1000,
          );
          const cycleEventsTimeout = setTimeout(
            () => cycleEventsController.abort(),
            Math.max(settings.requestTimeoutSec, 15) * 1000,
          );
          const aggregatedTimeout = setTimeout(
            () => aggregatedController.abort(),
            Math.max(settings.requestTimeoutSec, 15) * 1000,
          );

          let todayEvents: unknown | null = null;
          let cycleEvents: unknown | null = null;
          let aggregatedUsage: unknown | null = null;
          try {
            [todayEvents, cycleEvents, aggregatedUsage] = await Promise.all([
              fetchUsageEvents(
                cookieHeader,
                todayRange,
                todayEventsController.signal,
                10,
                userId,
              ),
              fetchUsageEvents(
                cookieHeader,
                cycleRange,
                cycleEventsController.signal,
                15,
                userId,
              ),
              fetchAggregatedUsage(cookieHeader, cycleRange, aggregatedController.signal),
            ]);
          } finally {
            clearTimeout(todayEventsTimeout);
            clearTimeout(cycleEventsTimeout);
            clearTimeout(aggregatedTimeout);
          }

          return {
            raw: { summary, todayEvents, cycleEvents, aggregatedUsage },
            source: 'cookie',
            rawVersion: 'cookie:usage-summary+aggregated',
          };
        }

        lastError = new Error(
          extractErrorMessage(summary) || `Cookie API returned ${response.status}: ${response.statusText}`,
        );
        log.warn('Cookie endpoint returned unusable response', {
          endpoint,
          status: response.status,
          error: lastError.message,
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        log.warn('Cookie endpoint failed, trying next candidate', {
          endpoint,
          error: errorToMessage(err),
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    const error = lastError ?? new Error('Cookie API returned no usable response');
    log.error('Cookie fetch failed', error);
    throw error;
  }

  /** Fetch a single page of usage events for the flow window (independent of poller). */
  async fetchUsageFlowPage(
    startDateMs: number,
    endDateMs: number,
    page: number,
    pageSize: number,
  ): Promise<RawUsageEventsResponse | null> {
    const cookie = await credentialVault.getCookie();
    if (!cookie) {
      throw new Error('Cookie not configured. Please add your session cookie in Settings.');
    }

    const settings = this.getSettings();
    const cookieHeader = normalizeWorkosCookie(cookie);
    const userId = extractUserId(cookie);
    const userIdNum = userId && /^\d+$/.test(userId) ? Number(userId) : undefined;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(settings.requestTimeoutSec, 15) * 1000,
    );

    try {
      const range = {
        startDate: String(startDateMs),
        endDate: String(endDateMs),
      };
      const record = await fetchUsageEventsPage(
        cookieHeader,
        range,
        controller.signal,
        page,
        pageSize,
        userIdNum,
      );
      if (!record) return null;

      const events = Array.isArray(record.usageEventsDisplay) ? record.usageEventsDisplay : [];

      return {
        usageEventsDisplay: events as RawUsageEventsResponse['usageEventsDisplay'],
        totalUsageEventsCount: record.totalUsageEventsCount ?? 0,
        eventsComplete: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchUsageEvents(
  cookieHeader: string,
  range: { startDate: string; endDate: string },
  signal: AbortSignal,
  maxPages: number,
  userId: string | null,
): Promise<RawUsageEventsResponse | null> {
  const events: unknown[] = [];
  let totalUsageEventsCount: number | null = null;
  const pageSize = 100;
  const userIdNum = userId && /^\d+$/.test(userId) ? Number(userId) : undefined;

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const record = await fetchUsageEventsPage(
        cookieHeader,
        range,
        signal,
        page,
        pageSize,
        userIdNum,
      );
      if (!record) {
        return buildUsageEventsResponse(events, totalUsageEventsCount, false);
      }
      const pageEvents = Array.isArray(record.usageEventsDisplay) ? record.usageEventsDisplay : [];
      events.push(...pageEvents);
      if (Number.isFinite(Number(record.totalUsageEventsCount))) {
        totalUsageEventsCount = Number(record.totalUsageEventsCount);
      }

      if (pageEvents.length < pageSize) break;
      if (totalUsageEventsCount !== null && events.length >= totalUsageEventsCount) break;
    }

    return buildUsageEventsResponse(events, totalUsageEventsCount, true);
  } catch (err) {
    log.warn('Usage events fetch aborted', { error: errorToMessage(err) });
    return buildUsageEventsResponse(events, totalUsageEventsCount, false);
  }
}

function buildUsageEventsResponse(
  events: unknown[],
  totalUsageEventsCount: number | null,
  fetchCompleted: boolean,
): RawUsageEventsResponse | null {
  if (events.length === 0) return null;

  const fetched = events.length;
  const total = totalUsageEventsCount;
  const paginationComplete =
    total === null || !Number.isFinite(total) ? fetchCompleted : fetched >= total;
  const eventsComplete = fetchCompleted && paginationComplete;

  return {
    usageEventsDisplay: events as RawUsageEventsResponse['usageEventsDisplay'],
    totalUsageEventsCount: total ?? undefined,
    eventsComplete,
  };
}

async function fetchUsageEventsPage(
  cookieHeader: string,
  range: { startDate: string; endDate: string },
  signal: AbortSignal,
  page: number,
  pageSize: number,
  userIdNum: number | undefined,
): Promise<{ usageEventsDisplay?: unknown[]; totalUsageEventsCount?: number } | null> {
  for (const endpoint of DASHBOARD_EVENTS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildDashboardHeaders(cookieHeader),
        body: JSON.stringify({
          teamId: 0,
          ...(userIdNum !== undefined ? { userId: userIdNum } : {}),
          ...range,
          page,
          pageSize,
        }),
        signal,
      });

      const payload = await readJsonResponse(response);
      if (response.ok) {
        return payload as { usageEventsDisplay?: unknown[]; totalUsageEventsCount?: number };
      }

      log.warn('Usage events endpoint returned unusable response', {
        endpoint,
        status: response.status,
        error: extractErrorMessage(payload),
      });
    } catch (err) {
      log.warn('Usage events endpoint failed, trying next candidate', {
        endpoint,
        error: errorToMessage(err),
      });
    }
  }

  return null;
}

/**
 * Fetch server-side per-model aggregation used by Billing → Included Usage.
 * One request covers the full billing window (no event pagination).
 */
async function fetchAggregatedUsage(
  cookieHeader: string,
  range: { startDate: string; endDate: string },
  signal: AbortSignal,
): Promise<unknown | null> {
  const startDate = Number(range.startDate);
  const endDate = Number(range.endDate);
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate)) return null;

  // teamId -1 = individual (matches Cursor dashboard / Billing page)
  const bodyVariants: Array<Record<string, unknown>> = [
    { teamId: -1, startDate, endDate },
    { teamId: 0, startDate, endDate },
  ];

  for (const endpoint of DASHBOARD_AGGREGATED_ENDPOINTS) {
    for (const body of bodyVariants) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: buildDashboardHeaders(cookieHeader),
          body: JSON.stringify(body),
          signal,
        });
        const payload = await readJsonResponse(response);
        if (response.ok && payload && typeof payload === 'object') {
          const record = payload as { aggregations?: unknown };
          if (Array.isArray(record.aggregations)) {
            log.info('Aggregated usage fetched', {
              endpoint,
              teamId: body.teamId,
              models: record.aggregations.length,
            });
            return payload;
          }
        }
        log.warn('Aggregated usage endpoint returned unusable response', {
          endpoint,
          teamId: body.teamId,
          status: response.status,
          error: extractErrorMessage(payload),
        });
      } catch (err) {
        log.warn('Aggregated usage endpoint failed, trying next candidate', {
          endpoint,
          teamId: body.teamId,
          error: errorToMessage(err),
        });
      }
    }
  }

  return null;
}
