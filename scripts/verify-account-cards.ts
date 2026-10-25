/**
 * Lightweight regression checks for the account-card view model (套餐/周期/额度常显).
 * Run: npx tsx scripts/verify-account-cards.ts
 */
import {
  EMPTY_PROVIDER_ENTRY,
  buildAccountCardView,
  formatCycleRange,
  formatRelativeDays,
  formatRelativeTime,
  formatResetNote,
  type ProviderCacheEntry,
} from '../src/renderer/components/SubscriptionUtils';
import type {
  CommandCodeSubscriptionData,
  CursorSubscriptionData,
  DeepSeekSubscriptionData,
  SubscriptionData,
  SubscriptionProviderId,
  SubscriptionUsageResult,
} from '../src/shared/subscriptionTypes';

// 固定「现在」：2026-10-25 21:36（本地时间），避免相对天数随真实时间漂移。
const NOW = new Date(2026, 9, 25, 21, 36, 0).getTime();

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  console.log(`  ok ${name}`);
}

function eq(name: string, actual: unknown, expected: unknown): void {
  assert(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function makeEntry(data: SubscriptionData, usage: SubscriptionUsageResult | null = null): ProviderCacheEntry {
  return {
    info: {
      success: true,
      providerId: data.providerId,
      fetchedAt: new Date(NOW).toISOString(),
      data,
    },
    usage,
    infoError: null,
    usageError: null,
  };
}

function viewOf(
  id: SubscriptionProviderId,
  entry: ProviderCacheEntry,
  usageMonth?: string,
) {
  return buildAccountCardView(id, entry, { now: NOW, usageMonth });
}

/* ── Cursor ── */

function cursorData(overrides: Partial<CursorSubscriptionData> = {}): CursorSubscriptionData {
  return {
    providerId: 'cursor',
    cursorModelsUsedPercent: 0,
    otherModelsUsedPercent: 25,
    cursorModelsTodayUsedPercent: 3,
    otherModelsTodayUsedPercent: 0,
    totalUsedPercent: 12.5,
    billingCycleStart: '2026-10-25T09:00:00',
    billingCycleEnd: '2026-11-24T17:54:00',
    cursorModels: [],
    otherModels: [],
    source: 'cookie',
    hasCookie: true,
    membershipType: 'pro',
    grokBot: null,
    ...overrides,
  };
}

console.log('cursor card view');
{
  const view = viewOf('cursor', makeEntry(cursorData()));
  assert('not null', view !== null);
  eq('plan label', view?.planLabel, 'Pro');
  eq('plan meta', view?.planMeta, '计费周期 10/25 – 11/24 · 30 天后');
  eq('metric count', view?.metrics.length, 3);
  eq('cursor models label', view?.metrics[0].label, 'Cursor 模型');
  eq('cursor models value', view?.metrics[0].value, '剩余 100%');
  eq('cursor models percent', view?.metrics[0].percent, 100);
  eq('cursor models tone', view?.metrics[0].tone, 'ok');
  eq('other models value', view?.metrics[1].value, '剩余 75%');
  eq('total value', view?.metrics[2].value, '剩余 87.5%');
  eq('reset note', view?.metrics[0].note, '重置于 11月24日 17:54 · 30 天后');
  eq('today line', view?.todayLine, '今日 Cursor 3.00% · 今日 Other 0.00%');
  eq('source label', view?.sourceLabel, 'Dashboard Cookie');
  eq('footnote', view?.footnote, null);
}

{
  // 今日口径缺失 → 回退周期口径并标注「周期」，不把「无今日数据」读成「没用量」
  const view = viewOf(
    'cursor',
    makeEntry(cursorData({ cursorModelsTodayUsedPercent: null, otherModelsTodayUsedPercent: null })),
  );
  eq('today fallback line', view?.todayLine, '周期 Cursor 0.00% · 周期 Other 25.00%');
}

{
  const view = viewOf(
    'cursor',
    makeEntry(
      cursorData({
        grokBot: {
          usedPercent: 15.1,
          periodStart: '2026-10-22T12:08:00',
          resetsAt: '2026-10-29T12:08:00',
          hasAvailableUsage: true,
          hasNonZeroIncludedLimit: true,
          onDemandEligible: false,
          planLabel: 'Grok Bot Plan',
          brand: 'grok',
        },
      }),
    ),
  );
  eq('grok bot metric count', view?.metrics.length, 4);
  eq('grok bot label', view?.metrics[2].label, 'Grok Bot');
  eq('grok bot value', view?.metrics[2].value, '剩余 84.9%');
  eq(
    'grok bot note',
    view?.metrics[2].note,
    '周额度 · 重置于 10月29日 12:08 · 4 天后',
  );
}

{
  const view = viewOf(
    'cursor',
    makeEntry(
      cursorData({
        grokBot: {
          usedPercent: null,
          periodStart: null,
          resetsAt: null,
          hasAvailableUsage: false,
          hasNonZeroIncludedLimit: false,
          onDemandEligible: false,
          planLabel: null,
          brand: 'cursor',
        },
      }),
    ),
  );
  eq('zero quota metric count', view?.metrics.length, 3);
  eq('zero quota footnote', view?.footnote, '当前套餐不含 Grok Bot 周额度');
}

{
  const view = viewOf(
    'cursor',
    makeEntry(
      cursorData({
        billingCycleStart: null,
        billingCycleEnd: null,
        cursorModelsUsedPercent: 95,
        totalUsedPercent: 92,
      }),
    ),
  );
  eq('missing cycle meta', view?.planMeta, '计费周期未知');
  eq('missing cycle note', view?.metrics[0].note, '重置时间未知');
  eq('danger tone', view?.metrics[0].tone, 'bad');
}

/* ── Command Code ── */

function unix(local: [number, number, number, number, number]): number {
  return Math.floor(new Date(local[0], local[1], local[2], local[3], local[4]).getTime() / 1000);
}

function commandCodeData(
  overrides: Partial<CommandCodeSubscriptionData> = {},
): CommandCodeSubscriptionData {
  return {
    providerId: 'commandcode',
    account: { login: 'me@example.com', orgId: null, keyName: 'studio' },
    credits: {
      monthlyCredits: 70,
      purchasedCredits: 0,
      freeCredits: 0,
      remainingCredits: 32.46,
    },
    plan: {
      planId: 'individual-goat',
      status: 'active',
      currentPeriodStart: '2026-10-12T09:00:00',
      currentPeriodEnd: '2026-11-12T17:31:00',
    },
    summary: null,
    limits: [
      { key: 'fiveHour', used: 0.11, cap: 10, resetAt: unix([2026, 9, 25, 22, 31]) },
      { key: 'weekly', used: 0.4, cap: 10, resetAt: unix([2026, 10, 1, 17, 31]) },
      { key: 'monthly', used: 37.54, cap: 70, resetAt: unix([2026, 10, 5, 22, 42]) },
    ],
    unavailable: [],
    credentialSource: 'manual',
    ...overrides,
  };
}

console.log('command code card view');
{
  const view = viewOf('commandcode', makeEntry(commandCodeData()));
  eq('plan label', view?.planLabel, 'GOAT');
  eq('plan meta', view?.planMeta, 'active · 计费周期 10/12 – 11/12 · 18 天后');
  eq('five hour value', view?.metrics[0].value, '剩余 98.9%');
  eq('five hour note', view?.metrics[0].note, '重置于 10月25日 22:31 · 今天重置');
  eq('weekly note', view?.metrics[1].note, '重置于 11月1日 17:31 · 7 天后');
  eq('monthly value', view?.metrics[2].value, '剩余 46.37%');
  eq('credits value', view?.metrics[3].value, '剩余 $32.46');
  eq('credits percent', Math.round((view?.metrics[3].percent ?? 0) * 100) / 100, 46.37);
  eq('credits note', view?.metrics[3].note, '月度 $70.00 · 购买 $0.00 · 赠送 $0.00');
  eq('source label', view?.sourceLabel, 'Command Code alpha');
}

{
  const view = viewOf(
    'commandcode',
    makeEntry(commandCodeData({ limits: [] })),
  );
  eq('no limits metric count', view?.metrics.length, 1);
  eq('credits without cap percent', view?.metrics[0].percent, null);
}

{
  // 到期时间三种形态（秒 / 毫秒 / ISO）换算出的剩余天数一致
  const endMs = new Date(2026, 10, 12, 17, 31).getTime();
  for (const value of [String(Math.floor(endMs / 1000)), String(endMs), '2026-11-12T17:31:00']) {
    const view = viewOf(
      'commandcode',
      makeEntry(
        commandCodeData({
          plan: {
            planId: 'individual-goat',
            status: 'active',
            currentPeriodStart: null,
            currentPeriodEnd: value,
          },
        }),
      ),
    );
    eq(`period end ${value.slice(0, 10)}…`, view?.planMeta?.includes('18 天后'), true);
  }
}

{
  const view = viewOf(
    'commandcode',
    makeEntry(commandCodeData({ credits: null, unavailable: ['credits', 'usage'] })),
  );
  eq('unavailable footnote', view?.footnote, '额度数据不可用；本次未获取：额度、用量');
}

/* ── DeepSeek ── */

function deepSeekUsage(month: number, year: number): SubscriptionUsageResult {
  return {
    success: true,
    providerId: 'deepseek',
    fetchedAt: new Date(NOW).toISOString(),
    data: {
      providerId: 'deepseek',
      month,
      year,
      models: [],
      totalTokens: 123456,
      totalRequests: 42,
      totalResponseTokens: 0,
      cacheHitRatePercent: 55.5,
      zeroUsageModelCount: 0,
    },
  };
}

function deepSeekData(overrides: Partial<DeepSeekSubscriptionData> = {}): DeepSeekSubscriptionData {
  return {
    providerId: 'deepseek',
    isAvailable: true,
    balances: [
      { currency: 'CNY', totalBalance: '12.34', grantedBalance: '2.00', toppedUpBalance: '10.34' },
    ],
    ...overrides,
  };
}

console.log('deepseek card view');
{
  const view = viewOf(
    'deepseek',
    makeEntry(deepSeekData(), deepSeekUsage(9, 2026)),
    '2026-09',
  );
  eq('plan label', view?.planLabel, null);
  eq('plan meta', view?.planMeta, '预付费余额 · 无到期日');
  eq('balance label', view?.metrics[0].label, 'CNY 余额');
  eq('balance value', view?.metrics[0].value, 'CNY 12.34');
  eq('balance note', view?.metrics[0].note, '充值 10.34 · 赠送 2.00');
  eq('month metric count', view?.metrics.length, 2);
  eq('month value', view?.metrics[1].value, '12.3万');
  eq('month note', view?.metrics[1].note, '请求 42 次 · 命中率 55.5%');
  eq('source label', view?.sourceLabel, 'DeepSeek 余额接口');
}

{
  const view = viewOf(
    'deepseek',
    makeEntry(deepSeekData(), deepSeekUsage(9, 2026)),
    '2026-10',
  );
  eq('month mismatch metric count', view?.metrics.length, 1);
}

{
  const view = viewOf(
    'deepseek',
    makeEntry(deepSeekData({ isAvailable: false, balances: [] })),
  );
  eq('unavailable balance tone', view?.metrics[0].tone, 'bad');
  eq('unavailable balance value', view?.metrics[0].value, '平台未返回余额明细');
  eq('unavailable footnote', view?.footnote, '账户当前不可用');
}

/* ── 格式化边界 ── */

console.log('formatters');
{
  eq('same-year range', formatCycleRange('2026-10-25T00:00:00', '2026-11-24T00:00:00'), '10/25 – 11/24');
  eq('cross-year range', formatCycleRange('2026-12-20T00:00:00', '2027-01-19T00:00:00'), '2026/12/20 – 2027/1/19');
  eq('open range', formatCycleRange(null, '2026-11-24T00:00:00'), '11/24');
  eq('empty range', formatCycleRange(null, null), null);

  eq('one day left', formatRelativeDays(new Date(2026, 9, 26, 9, 0).getTime(), NOW), '1 天后');
  eq('today', formatRelativeDays(new Date(2026, 9, 25, 23, 0).getTime(), NOW), '今天到期');
  eq('expired', formatRelativeDays(new Date(2026, 9, 23, 9, 0).getTime(), NOW), '已到期 2 天');
  eq('invalid relative days', formatRelativeDays('not-a-date', NOW), null);

  eq(
    'reset note from unix seconds',
    formatResetNote(unix([2026, 9, 25, 22, 31]), NOW),
    '重置于 10月25日 22:31 · 今天重置',
  );
  eq('reset note invalid', formatResetNote('bad', NOW), '重置时间未知');
  eq('reset note zero sentinel', formatResetNote(0, NOW), '重置时间未知');

  eq('updated just now', formatRelativeTime(new Date(NOW - 30_000).toISOString(), NOW), '刚刚更新');
  eq('updated minutes', formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW), '5 分钟前更新');
  eq('updated hours', formatRelativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW), '3 小时前更新');
  eq(
    'updated days',
    formatRelativeTime(new Date(NOW - 2 * 86_400_000).toISOString(), NOW),
    '10月23日 21:36 更新',
  );
  eq('updated missing', formatRelativeTime(undefined, NOW), '尚未更新');
}

console.log('null views');
{
  eq('missing entry', buildAccountCardView('cursor', undefined, { now: NOW }), null);
  eq('empty entry', buildAccountCardView('cursor', EMPTY_PROVIDER_ENTRY, { now: NOW }), null);
  eq(
    'provider mismatch',
    buildAccountCardView('commandcode', makeEntry(cursorData()), { now: NOW }),
    null,
  );
}

console.log('\nAll account-card checks passed.');
