import type {
  AppSettings,
  ProviderResult,
  RawCookieResponse,
  RawUsageEventsResponse,
  TokenProvider,
} from '../../shared/types';
import { credentialVault } from '../../security/CredentialVault';
import { createLogger } from '../../utils/logger';
import { httpRequest, type HttpRequestInit, type HttpResponseLike } from '../httpClient';

const log = createLogger('CookieProvider');

const DASHBOARD_SUMMARY_ENDPOINTS = [
  'https://cursor.com/api/usage-summary',
  'https://www.cursor.com/api/usage-summary',
  'https://cursor.com/api/dashboard/usage-summary',
  'https://www.cursor.com/api/dashboard/usage-summary',
];

const DASHBOARD_EVENTS_ENDPOINTS = [
  'https://cursor.com/api/dashboard/get-filtered-usage-events',
];

/** Billing Included Usage uses this server-side aggregation (no event pagination). */
const DASHBOARD_AGGREGATED_ENDPOINTS = [
  'https://cursor.com/api/dashboard/get-aggregated-usage-events',
];

/**
 * `www.cursor.com` 已从事件 / 聚合端点里移除：实测它对 dashboard POST 返回
 * 308 且 Location 指回自身（自我重定向），保留它只会每轮多打几次无效请求。
 * 汇总端点仍保留 www 作为兜底。
 */

/**
 * 今日窗口起点 = 本地零点与计费周期起点的较晚者。
 *
 * 计费周期在周期起点重置，跨过周期起点的「今日」用量属于上一个周期。
 * 若把这类用量算进今日，而周期侧暂时还没有可归属用量（周期内只有
 * Grok Bot 等被排除的模型），今日/周期的份额就会失去分母，百分比
 * 只能记为 null，UI 上「今日 Cursor」小条会被整根丢弃。
 * 裁剪后今日窗口恒为周期窗口的子集，两个池都能给出百分比。
 */
export function getTodayRangeMs(
  summary: Pick<RawCookieResponse, 'billingCycleStart'>,
  nowMs: number = Date.now(),
): { startDate: string; endDate: string } {
  const localMidnight = new Date(nowMs);
  localMidnight.setHours(0, 0, 0, 0);
  let start = localMidnight.getTime();

  const cycleStart = summary.billingCycleStart
    ? new Date(summary.billingCycleStart).getTime()
    : Number.NaN;
  // 仅当周期起点落在「今天之内」且早于当前时刻时才裁剪；
  // 周期起点缺失、非法或位于未来都退回本地零点。
  if (Number.isFinite(cycleStart) && cycleStart > start && cycleStart < nowMs) {
    start = cycleStart;
  }

  return {
    startDate: String(start),
    endDate: String(nowMs),
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

export function buildDashboardHeaders(cookieHeader: string): Record<string, string> {
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

export function normalizeWorkosCookie(input: string): string {
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

function isNumericId(value: string | null | undefined): boolean {
  return Boolean(value) && Number.isInteger(Number(value));
}

/**
 * 结构化描述 Cookie 形态（不含任何密文）。
 *
 * dashboard 的明细接口按 `userId` 过滤：Cookie 若是新式不透明会话令牌
 * （既没有 `userId::jwt` 前缀，`sub` 也不是数字），解析必然失败，服务端
 * 就会回「空聚合窗口」。这里把形态打出来，省得靠猜。
 */
export function describeCookieShape(input: string): Record<string, unknown> {
  const value = input.trim();
  const match = value.match(/WorkosCursorSessionToken=([^;]+)/);
  const sessionToken = match?.[1] ?? value;
  const decoded = sessionToken.replace(/%3A%3A/gi, '::');
  const [head, ...rest] = decoded.split('::');
  const tail = rest.join('::');
  const jwt = tail || (looksLikeJwt(decoded) ? decoded : '');
  const parts = jwt ? jwt.split('.') : [];

  let subKind = 'missing';
  if (parts.length === 3) {
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
        sub?: string;
      };
      const sub = payload.sub ?? '';
      const lastSegment = sub.split('|').pop() ?? '';
      subKind = isNumericId(lastSegment) ? 'numeric' : sub ? 'prefixed' : 'missing';
    } catch {
      subKind = 'unparsable';
    }
  }

  return {
    hasWorkosPrefix: Boolean(match),
    hasDoubleColon: decoded.includes('::'),
    numericHead: isNumericId(head),
    jwtParts: parts.length,
    subKind,
    length: sessionToken.length,
  };
}

async function readJsonResponse(response: HttpResponseLike): Promise<unknown> {
  return (await readTextAndPayload(response)).payload;
}

/** 一次读出文本与解析结果，供需要把响应体片段写进日志的调用方复用。 */
async function readTextAndPayload(
  response: HttpResponseLike,
): Promise<{ text: string; payload: unknown }> {
  const text = await response.text();
  if (!text) return { text, payload: null };
  try {
    return { text, payload: JSON.parse(text) as unknown };
  } catch {
    return { text, payload: { rawText: text.slice(0, 500) } };
  }
}

/** 截断响应体，便于在日志里直接看出是 HTML 登录页还是 JSON 错误。 */
function bodyPreview(text: string, limit = 160): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * 登录重定向是「Cookie 对 dashboard 接口不再授权」的明确信号：
 * 未授权时 `get-aggregated-usage-events` 返回 307 指向 WorkOS 登录页，
 * fetch 自动跟随后就变成 200 的 HTML，旧日志只能看到「200 但不可用」。
 */
function describeAuthRedirect(response: HttpResponseLike): string | null {
  if (response.status < 300 || response.status >= 400) return null;
  const location = response.headers.get('location') ?? '';
  return location.includes('workos') || location.includes('/login')
    ? 'Cookie 可能已过期：接口被重定向到登录页'
    : `接口返回 ${response.status} 重定向到 ${location || '未知地址'}`;
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

/** Total attempts per endpoint for network-level failures (TLS resets etc.). */
const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_BASE_DELAY_MS = 400;

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ABORT_ERR';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `cursor.com` intermittently resets TLS connections (ECONNRESET before the
 * handshake completes), which used to blank the whole token detail for a
 * refresh cycle. Retry only thrown network errors — HTTP responses (401/500
 * etc.) are returned to the caller untouched, and caller-driven aborts stop
 * the retry loop immediately.
 *
 * 请求统一经 `httpRequest` 发出：检测到系统代理时走 CONNECT 隧道，
 * 否则退回原生 fetch（脚本与无代理环境行为不变）。
 */
async function fetchWithNetworkRetry(
  url: string,
  init: HttpRequestInit,
  attempts = NETWORK_RETRY_ATTEMPTS,
): Promise<HttpResponseLike> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await httpRequest(url, init);
    } catch (err) {
      lastError = err;
      if (isAbortError(err)) throw err;
      if (attempt < attempts) {
        log.warn('Network error, retrying request', {
          url,
          attempt,
          error: errorToMessage(err),
        });
        await delay(NETWORK_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

/** 从 `/api/auth/me` 之类的身份响应里挑出数字用户 id。 */
export function extractNumericIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const nestedUser = record.user;
  const candidates: unknown[] = [
    record.id,
    record.userId,
    record.user_id,
    nestedUser && typeof nestedUser === 'object' ? (nestedUser as Record<string, unknown>).id : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) {
      return String(candidate);
    }
    if (isNumericId(candidate as string | null | undefined)) return String(candidate);
  }
  return null;
}

/**
 * Cookie 是不含 `userId` 的新式会话令牌时，退一步问 `/api/auth/me`。
 *
 * dashboard 明细接口按 userId 过滤，拿不到就只能得到「空聚合窗口」；这个
 * 端点未登录时返回 204，登录后大概率带数字 id。解析失败就安静放弃。
 */
async function fetchUserIdFromAuthMe(
  cookieHeader: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetchWithNetworkRetry('https://cursor.com/api/auth/me', {
      method: 'GET',
      headers: buildDashboardHeaders(cookieHeader),
      signal,
    });
    if (!response.ok) return null;
    return extractNumericIdFromPayload(await readJsonResponse(response));
  } catch {
    return null;
  }
}

let cachedAuthMeUserId: string | null = null;
/** 失败后冷却一段时间再试，避免每轮刷新都白打一次 /api/auth/me。 */
let authMeCooldownUntil = 0;

export class CookieProvider implements TokenProvider {
  readonly name = 'cookie' as const;

  constructor(private getSettings: () => AppSettings) {}

  async isConfigured(): Promise<boolean> {
    return credentialVault.hasCookie();
  }

  private async resolveUserIdFromAuthMe(cookieHeader: string): Promise<string | null> {
    if (cachedAuthMeUserId) return cachedAuthMeUserId;
    if (Date.now() < authMeCooldownUntil) return null;

    const timeoutMs = Math.min(this.getSettings().requestTimeoutSec, 10) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resolved = await fetchUserIdFromAuthMe(cookieHeader, controller.signal);
      if (resolved) {
        cachedAuthMeUserId = resolved;
        log.info('从 /api/auth/me 补齐数字 userId', { source: 'auth/me' });
        return resolved;
      }
      authMeCooldownUntil = Date.now() + 10 * 60 * 1000;
      log.info('/api/auth/me 未提供数字 userId，明细按无 userId 请求，10 分钟后再试');
      return null;
    } finally {
      clearTimeout(timer);
    }
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
    let userId = extractUserId(cookie);
    if (!userId) {
      // dashboard 明细接口按 userId 过滤，解析不出来时服务端会给「空聚合窗口」，
      // 这里把 Cookie 形态结构化打出来（不含任何密文），方便判断要不要重贴。
      log.warn('Cookie 中未解析出数字 userId，dashboard 明细可能返回空窗口', describeCookieShape(cookie));
      userId = await this.resolveUserIdFromAuthMe(cookieHeader);
    }

    let lastError: Error | null = null;
    for (const endpoint of endpoints) {
      log.info('Fetching from cookie endpoint', { endpoint });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutSec * 1000);

      try {
        const response = await fetchWithNetworkRetry(endpoint, {
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

          const todayRange = getTodayRangeMs(summary);
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

          try {
            // fetchUsageEvents 恒返回响应对象（失败体现在 eventsComplete），
            // 只有聚合接口可能为 null，故无需预先声明可空变量。
            const [todayEvents, cycleEvents, aggregatedUsage] = await Promise.all([
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
              fetchAggregatedUsage(cookieHeader, cycleRange, aggregatedController.signal, userId),
            ]);

            return {
              raw: { summary, todayEvents, cycleEvents, aggregatedUsage },
              source: 'cookie',
              rawVersion: 'cookie:usage-summary+aggregated',
            };
          } finally {
            clearTimeout(todayEventsTimeout);
            clearTimeout(cycleEventsTimeout);
            clearTimeout(aggregatedTimeout);
          }
        }

        const authHint = describeAuthRedirect(response);
        lastError = new Error(
          authHint ?? extractErrorMessage(summary) ?? `Cookie API returned ${response.status}`,
        );
        log.warn('Cookie endpoint returned unusable response', {
          endpoint,
          status: response.status,
          contentType: response.headers.get('content-type'),
          redirect: authHint,
          bodyPreview: bodyPreview(await response.text()),
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
): Promise<RawUsageEventsResponse> {
  const events: unknown[] = [];
  let totalUsageEventsCount: number | null = null;
  const pageSize = 100;
  const userIdNum = userId && /^\d+$/.test(userId) ? Number(userId) : undefined;

  try {
    let stoppedEarly = false;
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

      // Full page at the maxPages cap: more events likely remain.
      if (page === maxPages) {
        stoppedEarly = true;
        break;
      }
    }

    return buildUsageEventsResponse(events, totalUsageEventsCount, !stoppedEarly);
  } catch (err) {
    log.warn('Usage events fetch aborted', { error: errorToMessage(err) });
    return buildUsageEventsResponse(events, totalUsageEventsCount, false);
  }
}

/**
 * 事件响应封装。
 *
 * 「样本完整且确实没有用量」（窗口内一条事件都没有）与「样本不完整」
 * （取数失败 / 分页截断）必须区分：前者今日口径就是 0，后者才是 null。
 * 今日窗口裁剪到计费周期起点后，周期刚重置时窗口合法为空，若把空样本
 * 记成 null，UI 会把「今日确实为 0」显示成「今日不可得」。
 */
export function buildUsageEventsResponse(
  events: unknown[],
  totalUsageEventsCount: number | null,
  fetchCompleted: boolean,
): RawUsageEventsResponse {
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
      const response = await fetchWithNetworkRetry(endpoint, {
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

      const { text, payload } = await readTextAndPayload(response);
      if (response.ok && payload && typeof payload === 'object') {
        const record = payload as { usageEventsDisplay?: unknown[]; totalUsageEventsCount?: number };
        // 登录页/占位 HTML 也是 200，必须确认结构真的是事件列表，否则空样本会被误判成「今天没用量」。
        if (
          Array.isArray(record.usageEventsDisplay) ||
          Number.isFinite(Number(record.totalUsageEventsCount))
        ) {
          return record;
        }
      }

      log.warn('Usage events endpoint returned unusable response', {
        endpoint,
        status: response.status,
        contentType: response.headers.get('content-type'),
        redirect: describeAuthRedirect(response),
        bodyPreview: bodyPreview(text),
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
  userId: string | null,
): Promise<unknown | null> {
  const startDate = Number(range.startDate);
  const endDate = Number(range.endDate);
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate)) return null;

  const userIdNum = userId && /^\d+$/.test(userId) ? Number(userId) : undefined;
  // teamId -1 = individual (matches Cursor dashboard / Billing page)；
  // userId 是 dashboard 会话身份的辅助字段，带上后再退回不带的老形态。
  // 日期编码同样影响命中：按 ms 数字 → ms 字符串 → ISO 逐个试，成功的记下来优先复用。
  const encodings = buildDateEncodings(startDate, endDate);
  for (const endpoint of DASHBOARD_AGGREGATED_ENDPOINTS) {
    // 一种编码只要拿到 2xx JSON，就说明服务端认这种编码；此时再换编码毫无
    // 意义（只会多打出 500 噪音），直接停止探测。
    for (const encoding of encodings) {
      let encodingAccepted = false;
      for (const teamId of [-1, 0]) {
        const body: Record<string, unknown> = {
          teamId,
          startDate: encoding.startDate,
          endDate: encoding.endDate,
          ...(userIdNum !== undefined ? { userId: userIdNum } : {}),
        };
        try {
          const response = await fetchWithNetworkRetry(endpoint, {
            method: 'POST',
            headers: buildDashboardHeaders(cookieHeader),
            body: JSON.stringify(body),
            signal,
          });
          const { text, payload } = await readTextAndPayload(response);
          if (response.ok && payload && typeof payload === 'object') {
            encodingAccepted = true;
            const record = payload as { aggregations?: unknown };
            if (Array.isArray(record.aggregations)) {
              preferredDateEncoding = encoding.label;
              log.info('Aggregated usage fetched', {
                endpoint,
                teamId,
                encoding: encoding.label,
                models: record.aggregations.length,
              });
              return payload;
            }
          }
          log.warn('Aggregated usage endpoint returned unusable response', {
            endpoint,
            teamId,
            encoding: encoding.label,
            hasUserId: userIdNum !== undefined,
            status: response.status,
            contentType: response.headers.get('content-type'),
            redirect: describeAuthRedirect(response),
            hint: describeAggregatedPayload(payload),
            bodyPreview: bodyPreview(text),
            error: extractErrorMessage(payload),
          });
        } catch (err) {
          log.warn('Aggregated usage endpoint failed, trying next candidate', {
            endpoint,
            teamId,
            encoding: encoding.label,
            error: errorToMessage(err),
          });
        }
      }
      if (encodingAccepted) break;
    }
  }

  log.warn('Included Usage 聚合不可用，回退事件聚合', {
    hasUserId: userIdNum !== undefined,
    hint: userIdNum === undefined ? '缺少数字 userId，服务端只会回空聚合窗口' : '窗口内没有可聚合行',
  });

  return null;
}

/** 记住上一次成功的日期编码，刷新时优先使用，避免每轮都试满三种。 */
let preferredDateEncoding: string | null = null;

interface DateEncoding {
  label: string;
  startDate: number | string;
  endDate: number | string;
}

export function buildDateEncodings(startDate: number, endDate: number): DateEncoding[] {
  const variants: DateEncoding[] = [
    { label: 'ms-number', startDate, endDate },
    { label: 'ms-string', startDate: String(startDate), endDate: String(endDate) },
    {
      label: 'iso',
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
    },
  ];
  if (!preferredDateEncoding) return variants;
  const index = variants.findIndex((variant) => variant.label === preferredDateEncoding);
  if (index <= 0) return variants;
  const [preferred] = variants.splice(index, 1);
  return [preferred, ...variants];
}

/** 把「200 但没有 aggregations」的响应归类，便于日志一眼定性。 */
export function describeAggregatedPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '响应体不是对象';
  const keys = Object.keys(payload as Record<string, unknown>);
  if (keys.length === 0) return '空对象响应';
  if (keys.length === 1 && keys[0] === 'startDate') {
    return '空聚合窗口：只回显 startDate，服务端没有返回任何模型行';
  }
  return `响应字段：${keys.slice(0, 6).join(', ')}`;
}
