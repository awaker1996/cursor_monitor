/**
 * Live diagnosis for "token 明细不可用":
 * reads the stored session cookie and probes the three dashboard endpoints
 * (usage-summary / get-filtered-usage-events / get-aggregated-usage-events),
 * reporting HTTP status and payload shape. Never prints the cookie value.
 * Run: npx tsx scripts/diagnose-token-detail.ts
 */

const SERVICE_NAME = 'cursor-token-monitor';
const ACCOUNT_NAME = 'session-cookie';

const SUMMARY_ENDPOINTS = [
  'https://cursor.com/api/usage-summary',
  'https://www.cursor.com/api/usage-summary',
  'https://cursor.com/api/dashboard/usage-summary',
  'https://www.cursor.com/api/dashboard/usage-summary',
];
const EVENTS_ENDPOINTS = [
  'https://cursor.com/api/dashboard/get-filtered-usage-events',
  'https://www.cursor.com/api/dashboard/get-filtered-usage-events',
];
const AGGREGATED_ENDPOINTS = [
  'https://cursor.com/api/dashboard/get-aggregated-usage-events',
  'https://www.cursor.com/api/dashboard/get-aggregated-usage-events',
];

function buildHeaders(cookieHeader: string): Record<string, string> {
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
      exp?: number;
    };
    if (payload.exp) {
      const expDate = new Date(payload.exp * 1000);
      console.log(
        `  JWT exp: ${expDate.toISOString()} (${expDate.getTime() < Date.now() ? '已过期!' : '未过期'})`,
      );
    }
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

function extractUserId(input: string): string | null {
  const value = input.trim();
  const match = value.match(/(?:^|;\s*)WorkosCursorSessionToken=([^;]+)/);
  const token = match?.[1] ?? value;
  const decoded = token.replace(/%3A%3A/gi, '::');
  const [maybeUserId, jwtPart] = decoded.split('::');
  if (/^\d+$/.test(maybeUserId)) return maybeUserId;
  const jwt = jwtPart ?? (looksLikeJwt(decoded) ? decoded : null);
  if (jwt) return extractUserIdFromJwt(jwt);
  return null;
}

function describePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '(空响应)';
  if (typeof payload !== 'object') return `(标量: ${typeof payload})`;
  const record = payload as Record<string, unknown>;
  if (typeof record.rawText === 'string') {
    return `(非JSON, 前120字符: ${JSON.stringify(record.rawText.slice(0, 120))})`;
  }
  const keys = Object.keys(record);
  const parts: string[] = [`keys=[${keys.join(', ')}]`];
  if (Array.isArray(record.aggregations)) parts.push(`aggregations.length=${record.aggregations.length}`);
  if (Array.isArray(record.usageEventsDisplay)) {
    parts.push(`usageEventsDisplay.length=${record.usageEventsDisplay.length}`);
    const first = record.usageEventsDisplay[0] as Record<string, unknown> | undefined;
    if (first) parts.push(`event[0].keys=[${Object.keys(first).join(', ')}]`);
  }
  if (record.totalUsageEventsCount !== undefined) {
    parts.push(`totalUsageEventsCount=${record.totalUsageEventsCount}`);
  }
  if (typeof record.error === 'string') parts.push(`error=${record.error}`);
  if (typeof record.message === 'string') parts.push(`message=${record.message}`);
  return parts.join(' ');
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text.slice(0, 500) };
  }
}

async function probe(
  label: string,
  endpoint: string,
  init: RequestInit,
): Promise<{ ok: boolean; payload: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, { ...init, signal: controller.signal });
    const payload = await readJson(response);
    console.log(`  [${label}] ${endpoint}`);
    console.log(`    HTTP ${response.status} ${response.statusText}`);
    console.log(`    ${describePayload(payload)}`);
    return { ok: response.ok, payload };
  } catch (err) {
    console.log(`  [${label}] ${endpoint}`);
    console.log(`    请求失败: ${err instanceof Error ? err.message : String(err)}`);
    let cause: unknown = err instanceof Error ? err.cause : undefined;
    while (cause) {
      const c = cause as { code?: string; message?: string; cause?: unknown };
      console.log(`    cause: code=${c.code ?? '-'} message=${c.message ?? String(cause)}`);
      cause = c.cause;
    }
    return { ok: false, payload: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  console.log('== 1. 读取本机凭据 ==');
  let cookie: string | null = null;
  try {
    const keytar = (await import('keytar')) as typeof import('keytar') & {
      default?: typeof import('keytar');
    };
    const kt = keytar.default ?? keytar;
    cookie = await kt.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  } catch (err) {
    console.log(`  keytar 加载失败: ${err instanceof Error ? err.message : String(err)}`);
    console.log('  （应用内若走 safeStorage 兜底则此脚本读不到，可在设置页重新粘贴 Cookie 测试）');
    return;
  }

  if (!cookie) {
    console.log('  未找到已保存的 Cookie（service=cursor-token-monitor）。');
    console.log('  结论: Cookie 未配置或存在 safeStorage 兜底文件中，请在设置页检查。');
    return;
  }

  console.log(`  Cookie 已读取, 长度=${cookie.length}`);
  const cookieHeader = normalizeWorkosCookie(cookie);
  const userId = extractUserId(cookie);
  console.log(`  归一化后含 WorkosCursorSessionToken=${cookieHeader.startsWith('WorkosCursorSessionToken=')}`);
  console.log(`  提取 userId: ${userId ?? '失败(null) —— 明细接口将缺 userId'}`);

  const headers = buildHeaders(cookieHeader);
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const cycleStart = now - 30 * 24 * 60 * 60 * 1000;

  console.log('\n== 2. usage-summary（额度概览） ==');
  let summaryOk = false;
  for (const endpoint of SUMMARY_ENDPOINTS) {
    const { ok, payload } = await probe('GET', endpoint, { method: 'GET', headers });
    if (ok && payload && typeof payload === 'object' && !(payload as Record<string, unknown>).rawText) {
      summaryOk = true;
      break;
    }
  }
  if (!summaryOk) console.log('  >>> 概览接口全部失败：Cookie 无效/过期 或接口变更');

  console.log('\n== 3. get-filtered-usage-events（周期事件, 明细主来源） ==');
  const userIdNum = userId && /^\d+$/.test(userId) ? Number(userId) : undefined;
  let eventsOk = false;
  for (const endpoint of EVENTS_ENDPOINTS) {
    const { ok, payload } = await probe('POST', endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        teamId: 0,
        ...(userIdNum !== undefined ? { userId: userIdNum } : {}),
        startDate: String(cycleStart),
        endDate: String(now),
        page: 1,
        pageSize: 10,
      }),
    });
    if (ok && payload && typeof payload === 'object') {
      const events = (payload as { usageEventsDisplay?: unknown[] }).usageEventsDisplay;
      if (Array.isArray(events)) {
        eventsOk = events.length > 0;
        if (events.length === 0) console.log('    >>> 返回 200 但事件为空（userId 缺失或参数被拒）');
        break;
      }
    }
  }

  console.log('\n== 4. get-aggregated-usage-events（服务端聚合, 明细回填来源） ==');
  let aggregatedOk = false;
  for (const endpoint of AGGREGATED_ENDPOINTS) {
    for (const teamId of [-1, 0]) {
      const { ok, payload } = await probe(`POST teamId=${teamId}`, endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ teamId, startDate: cycleStart, endDate: now }),
      });
      if (ok && payload && typeof payload === 'object') {
        const rows = (payload as { aggregations?: unknown[] }).aggregations;
        if (Array.isArray(rows) && rows.length > 0) {
          aggregatedOk = true;
          break;
        }
      }
    }
    if (aggregatedOk) break;
  }

  console.log('\n== 诊断结论 ==');
  console.log(`  概览接口:   ${summaryOk ? '正常' : '失败'}`);
  console.log(`  事件接口:   ${eventsOk ? '正常(有事件)' : '异常(无事件或失败)'}`);
  console.log(`  聚合接口:   ${aggregatedOk ? '正常(有聚合行)' : '异常(无数据或失败)'}`);
  if (!eventsOk && !aggregatedOk) {
    console.log('  >>> 事件+聚合都拿不到数据 → totalTokens 无法计算 → UI 显示 "token 明细不可用"');
  } else if (eventsOk || aggregatedOk) {
    console.log('  >>> API 侧有数据，若 UI 仍显示不可用，问题在应用内归一化/缓存链路');
  }
}

main().catch((err) => {
  console.error('诊断脚本异常:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
