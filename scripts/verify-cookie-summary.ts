/**
 * Regression checks for Cookie usage-summary payload validation.
 * Run: npx tsx scripts/verify-cookie-summary.ts
 */
import { isUsableCookieSummary } from '../src/core/providers/CookieProvider';

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

console.log('\nAll cookie-summary checks passed.');
