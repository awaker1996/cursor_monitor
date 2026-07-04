import type { AppSettings, ProviderResult, RawCookieResponse, TokenProvider } from '../../shared/types';
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
          const todayRange = getTodayRangeMs();
          const cycleRange = getBillingCycleRangeMs(summary);
          const eventsController = new AbortController();
          const eventsTimeout = setTimeout(
            () => eventsController.abort(),
            settings.requestTimeoutSec * 1000,
          );

          let todayEvents: unknown | null = null;
          let cycleEvents: unknown | null = null;
          try {
            [todayEvents, cycleEvents] = await Promise.all([
              fetchUsageEvents(cookieHeader, todayRange, eventsController.signal, 5, userId),
              fetchUsageEvents(cookieHeader, cycleRange, eventsController.signal, 15, userId),
            ]);
          } finally {
            clearTimeout(eventsTimeout);
          }

          return {
            raw: { summary, todayEvents, cycleEvents },
            source: 'cookie',
            rawVersion: 'cookie:usage-summary',
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
}

async function fetchUsageEvents(
  cookieHeader: string,
  range: { startDate: string; endDate: string },
  signal: AbortSignal,
  maxPages: number,
  userId: string | null,
): Promise<unknown | null> {
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
      if (!record) return events.length > 0 ? { usageEventsDisplay: events, totalUsageEventsCount } : null;
      const pageEvents = Array.isArray(record.usageEventsDisplay) ? record.usageEventsDisplay : [];
      events.push(...pageEvents);
      if (Number.isFinite(Number(record.totalUsageEventsCount))) {
        totalUsageEventsCount = Number(record.totalUsageEventsCount);
      }

      if (pageEvents.length < pageSize) break;
      if (totalUsageEventsCount !== null && events.length >= totalUsageEventsCount) break;
    }

    return { usageEventsDisplay: events, totalUsageEventsCount };
  } catch (err) {
    log.warn('Usage events fetch aborted', { error: errorToMessage(err) });
    return events.length > 0 ? { usageEventsDisplay: events, totalUsageEventsCount } : null;
  }
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
