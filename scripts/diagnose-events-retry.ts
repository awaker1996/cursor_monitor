/**
 * Focused retry probe: does cursor.com's get-filtered-usage-events ever
 * succeed once TLS survives, and does the string WorkOS userId matter?
 * Run: npx tsx scripts/diagnose-events-retry.ts
 */
export {};

const SERVICE_NAME = 'cursor-token-monitor';
const ACCOUNT_NAME = 'session-cookie';

function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function extractUserIdFromJwt(jwt: string): string | null {
  try {
    const [, payloadPart] = jwt.split('.');
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { sub?: string };
    return payload.sub?.split('|').pop() || null;
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

async function postWithRetry(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  attempts = 4,
): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let summary = `(非JSON) ${text.slice(0, 160)}`;
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        const events = json.usageEventsDisplay;
        const aggs = json.aggregations;
        summary = `keys=[${Object.keys(json).join(', ')}]`;
        if (Array.isArray(events)) summary += ` events=${events.length}`;
        if (Array.isArray(aggs)) summary += ` aggregations=${aggs.length}`;
        if (json.totalUsageEventsCount !== undefined) summary += ` total=${json.totalUsageEventsCount}`;
        if (typeof json.error === 'string') summary += ` error=${json.error}`;
      } catch {
        /* keep raw summary */
      }
      console.log(`[${label}] 第${i}次: HTTP ${response.status} ${summary}`);
      return;
    } catch (err) {
      const cause = (err as Error).cause as { code?: string } | undefined;
      console.log(`[${label}] 第${i}次: 失败 ${cause?.code ?? (err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  console.log(`[${label}] ${attempts} 次全部失败`);
}

async function main(): Promise<void> {
  const keytarMod = (await import('keytar')) as typeof import('keytar') & {
    default?: typeof import('keytar');
  };
  const kt = keytarMod.default ?? keytarMod;
  const cookie = await kt.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  if (!cookie) {
    console.log('未找到 Cookie');
    return;
  }

  const cookieHeader = normalizeWorkosCookie(cookie);
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Cookie: cookieHeader,
    Origin: 'https://cursor.com',
    Referer: 'https://cursor.com/dashboard/usage',
    'User-Agent': 'CursorTokenMonitor/1.0',
  };

  const now = Date.now();
  const cycleStart = now - 30 * 24 * 60 * 60 * 1000;
  const range = { startDate: String(cycleStart), endDate: String(now) };

  await postWithRetry(
    'events 无userId',
    'https://cursor.com/api/dashboard/get-filtered-usage-events',
    headers,
    { teamId: 0, ...range, page: 1, pageSize: 10 },
  );

  await postWithRetry(
    'events 字符串userId',
    'https://cursor.com/api/dashboard/get-filtered-usage-events',
    headers,
    {
      teamId: 0,
      userId: extractUserIdFromJwt(
        cookieHeader.replace(/^WorkosCursorSessionToken=[^%]*%3A%3A/, ''),
      ),
      ...range,
      page: 1,
      pageSize: 10,
    },
  );

  await postWithRetry(
    'aggregated teamId=-1',
    'https://cursor.com/api/dashboard/get-aggregated-usage-events',
    headers,
    { teamId: -1, startDate: cycleStart, endDate: now },
  );
}

main().catch((err) => {
  console.error('异常:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
