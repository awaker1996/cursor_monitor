/**
 * Success-rate sampling for cursor.com dashboard endpoints.
 * Run: npx tsx scripts/diagnose-endpoint-stability.ts
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

async function attempt(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; note: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let note = `HTTP ${response.status}`;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      if (Array.isArray(json.usageEventsDisplay)) note += ` events=${json.usageEventsDisplay.length}`;
      if (Array.isArray(json.aggregations)) note += ` aggs=${json.aggregations.length}`;
    } catch {
      note += ' (非JSON)';
    }
    return { ok: response.ok, note };
  } catch (err) {
    const cause = (err as Error).cause as { code?: string } | undefined;
    return { ok: false, note: cause?.code ?? (err as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

async function sample(
  label: string,
  rounds: number,
  make: () => { url: string; init: RequestInit },
): Promise<void> {
  let success = 0;
  const notes: string[] = [];
  for (let i = 0; i < rounds; i += 1) {
    const { url, init } = make();
    const { ok, note } = await attempt(url, init);
    if (ok) success += 1;
    notes.push(note);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  console.log(`${label}: ${success}/${rounds} 成功  [${notes.join(' | ')}]`);
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

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Cookie: normalizeWorkosCookie(cookie),
    Origin: 'https://cursor.com',
    Referer: 'https://cursor.com/dashboard/usage',
    'User-Agent': 'CursorTokenMonitor/1.0',
  };
  const now = Date.now();
  const cycleStart = now - 30 * 24 * 60 * 60 * 1000;

  await sample('summary GET      ', 5, () => ({
    url: 'https://cursor.com/api/usage-summary',
    init: { method: 'GET', headers },
  }));

  await sample('events POST      ', 5, () => ({
    url: 'https://cursor.com/api/dashboard/get-filtered-usage-events',
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        teamId: 0,
        startDate: String(cycleStart),
        endDate: String(now),
        page: 1,
        pageSize: 10,
      }),
    },
  }));

  await sample('aggregated POST  ', 5, () => ({
    url: 'https://cursor.com/api/dashboard/get-aggregated-usage-events',
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({ teamId: -1, startDate: cycleStart, endDate: now }),
    },
  }));
}

main().catch((err) => {
  console.error('异常:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
