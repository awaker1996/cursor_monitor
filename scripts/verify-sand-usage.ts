/**
 * Regression checks for the Cursor Grok Bot (backend code name "sand") weekly usage.
 * The first fixture is the real response captured from
 * `POST https://cursor.com/api/dashboard/get-sand-usage-status` on 2026-10-12,
 * which the Cursor console rendered as "Weekly usage 1% used / Resets 10月15日".
 * Run: npx tsx scripts/verify-sand-usage.ts
 */
import { parseSandUsageStatus } from '../src/core/subscriptions/sandUsage';
import { formatSandReset } from '../src/renderer/components/SubscriptionUtils';

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
  console.log(`  ok ${name}`);
}

/** 实测真实响应（2026-10-12）。 */
const REAL_RESPONSE = {
  currentPeriodStart: '2026-10-08T04:08:41.245Z',
  nextResetTimestampUtc: '2026-10-15T04:08:41.245Z',
  usagePercent: 0.748597,
  hasAvailableUsage: true,
  hasNonZeroIncludedLimit: true,
  upgradeRecommendation: { kind: 'upgrade-to-pro-plus-for-more-usage' },
  onDemandSettings: {
    visible: true,
    eligible: true,
    dashboardUrl: 'https://cursor.com/dashboard/spending?for=auth0%7Cuser_01KWDZB24ZYD85181FBFSE35Q1',
  },
  grokPlanLabel: 'Grok Bot Plan',
  cursorPlanName: 'Pro',
  billingBrand: 'SAND_BILLING_BRAND_CURSOR',
};

console.log('parseSandUsageStatus: real capture');

{
  const usage = parseSandUsageStatus(REAL_RESPONSE);
  assert('usedPercent 是百分比而非比例', usage.usedPercent === 0.748597, String(usage.usedPercent));
  assert('usedPercent 四舍五入后为 1%', Math.round(usage.usedPercent ?? -1) === 1);
  assert(
    'resetsAt 保留 ISO 原串',
    usage.resetsAt === '2026-10-15T04:08:41.245Z',
    String(usage.resetsAt),
  );
  assert(
    'periodStart 保留 ISO 原串',
    usage.periodStart === '2026-10-08T04:08:41.245Z',
    String(usage.periodStart),
  );
  assert('hasAvailableUsage', usage.hasAvailableUsage === true);
  assert('hasNonZeroIncludedLimit', usage.hasNonZeroIncludedLimit === true);
  assert('onDemandEligible', usage.onDemandEligible === true);
  assert('planLabel', usage.planLabel === 'Grok Bot Plan', String(usage.planLabel));
  assert('brand 默认 cursor', usage.brand === 'cursor');
}

console.log('parseSandUsageStatus: defensive defaults');

{
  const empty = parseSandUsageStatus({});
  assert('空对象 usedPercent 为 null', empty.usedPercent === null);
  assert('空对象 resetsAt 为 null', empty.resetsAt === null);
  assert('空对象 hasNonZeroIncludedLimit 为 false', empty.hasNonZeroIncludedLimit === false);
  assert('空对象 onDemandEligible 为 false', empty.onDemandEligible === false);
  assert('空对象 brand 为 cursor', empty.brand === 'cursor');

  assert('非对象入参不抛错', parseSandUsageStatus(null).usedPercent === null);
  assert('字符串数字可解析', parseSandUsageStatus({ usagePercent: '0.5' }).usedPercent === 0.5);
  // 非有限数视为「缺失」而非 0：避免把拿不到的数据误显示成「没用量」。
  assert('NaN 视为缺失', parseSandUsageStatus({ usagePercent: Number.NaN }).usedPercent === null);
  assert('超 100 被夹取', parseSandUsageStatus({ usagePercent: 150 }).usedPercent === 100);
  assert('负数被夹取', parseSandUsageStatus({ usagePercent: -5 }).usedPercent === 0);
  assert(
    'blank 字符串视为缺失',
    parseSandUsageStatus({ nextResetTimestampUtc: '   ' }).resetsAt === null,
  );
  assert(
    'GROK 品牌被识别',
    parseSandUsageStatus({ billingBrand: 'SAND_BILLING_BRAND_GROK' }).brand === 'grok',
  );
}

console.log('formatSandReset');

{
  assert('空值提示未知', formatSandReset(null) === '重置时间未知');
  assert('非法值提示未知', formatSandReset('not-a-date') === '重置时间未知');

  const future = new Date(Date.now() + 2.5 * 86_400_000);
  const futureText = formatSandReset(future.toISOString());
  assert('未来时间带天数', futureText.includes('3 天后'), futureText);
  assert(
    '未来时间用 M月D日',
    futureText.startsWith(`${future.getMonth() + 1} 月 ${future.getDate()} 日`),
    futureText,
  );

  const past = new Date(Date.now() - 86_400_000);
  assert('已过期标记为已重置', formatSandReset(past.toISOString()).includes('已重置'));
}
