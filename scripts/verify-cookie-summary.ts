/**
 * Regression checks for Cookie usage-summary payload validation.
 * Run: npx tsx scripts/verify-cookie-summary.ts
 */
import {
  buildDateEncodings,
  describeAggregatedPayload,
  describeCookieShape,
  extractNumericIdFromPayload,
  isUsableCookieSummary,
} from '../src/core/providers/CookieProvider';

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
  console.log(`  ok ${name}`);
}

console.log('isUsableCookieSummary');

assert('rejects null', isUsableCookieSummary(null) === false);
assert('rejects array', isUsableCookieSummary([]) === false);
assert('rejects empty object', isUsableCookieSummary({}) === false);
assert(
  'rejects legacy /api/usage shape',
  isUsableCookieSummary({
    'gpt-4': { numRequests: 1, maxRequestUsage: 500 },
    startOfMonth: '2026-07-01T00:00:00.000Z',
  }) === false,
);
assert(
  'rejects html parse fallback',
  isUsableCookieSummary({ rawText: '<!DOCTYPE html>' }) === false,
);
assert(
  'rejects error payload',
  isUsableCookieSummary({ error: 'not_authenticated' }) === false,
);
assert(
  'rejects billing cycle only',
  isUsableCookieSummary({
    billingCycleStart: '2026-07-01T00:00:00.000Z',
    billingCycleEnd: '2026-08-01T00:00:00.000Z',
  }) === false,
);
assert(
  'rejects empty plan object',
  isUsableCookieSummary({
    individualUsage: { plan: {} },
  }) === false,
);
assert(
  'accepts individualUsage.plan with used/limit',
  isUsableCookieSummary({
    individualUsage: { plan: { used: 1, limit: 100 } },
  }) === true,
);
assert(
  'accepts individualUsage.overall',
  isUsableCookieSummary({
    individualUsage: { overall: { used: 1, limit: 100 } },
  }) === true,
);

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `${base64url({ alg: 'RS256' })}.${base64url(payload)}.signature`;
}

console.log('\ndescribeCookieShape');

assert(
  'userId::jwt shape reports numeric sub',
  describeCookieShape(
    `WorkosCursorSessionToken=12345%3A%3A${fakeJwt({ sub: 'user_01H|12345' })}`,
  ).subKind === 'numeric',
);
assert(
  'opaque token reports no jwt segments',
  describeCookieShape('WorkosCursorSessionToken=opaque-session-value-not-a-jwt').jwtParts === 0,
);
assert(
  'prefixed sub is not treated as numeric',
  describeCookieShape(`12345::${fakeJwt({ sub: 'user_01H2XYZ' })}`).subKind === 'prefixed',
);

console.log('\nextractNumericIdFromPayload');

assert('reads numeric id', extractNumericIdFromPayload({ id: 12345 }) === '12345');
assert('reads numeric string id', extractNumericIdFromPayload({ userId: '6789' }) === '6789');
assert(
  'reads nested user id',
  extractNumericIdFromPayload({ user: { id: 4242 } }) === '4242',
);
assert('rejects workos style id', extractNumericIdFromPayload({ id: 'user_01H2XYZ' }) === null);
assert('rejects empty payload', extractNumericIdFromPayload(null) === null);

console.log('\naggregated payload helpers');
const encodings = buildDateEncodings(1_760_000_000_000, 1_760_086_400_000);
assert('three date encodings', encodings.length === 3);
assert('millisecond number tried first', encodings[0].label === 'ms-number');
assert('iso encoding is serialisable', String(encodings[2].startDate).includes('T'));
assert(
  'empty window payload is classified',
  describeAggregatedPayload({ startDate: '1792835666000' }).includes('空聚合窗口'),
);
assert(
  'aggregations payload is not classified as empty window',
  describeAggregatedPayload({ aggregations: [] }).includes('aggregations'),
);

console.log('\nAll cookie-summary checks passed.');
