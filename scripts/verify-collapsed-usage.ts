/**
 * Regression checks for the collapsed usage chips on subscription cards.
 * Run: npx tsx scripts/verify-collapsed-usage.ts
 */
import {
  collapsedUsageAriaLabel,
  providerCollapsedUsage,
  type ProviderCacheEntry,
} from '../src/renderer/components/SubscriptionUtils';
import type { CursorSubscriptionData, SubscriptionData } from '../src/shared/subscriptionTypes';

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
  console.log(`  ok ${name}`);
}

function entry(data: SubscriptionData): ProviderCacheEntry {
  return {
    info: { success: true, providerId: data.providerId, data },
    usage: null,
    infoError: null,
    usageError: null,
  };
}

function cursorData(overrides: Partial<CursorSubscriptionData> = {}): CursorSubscriptionData {
  return {
    providerId: 'cursor',
    cursorModelsUsedPercent: 20.74,
    otherModelsUsedPercent: 0,
    cursorModelsTodayUsedPercent: null,
    otherModelsTodayUsedPercent: null,
    totalUsedPercent: 20.74,
    billingCycleStart: null,
    billingCycleEnd: null,
    cursorModels: [],
    otherModels: [],
    source: 'cookie',
    hasCookie: true,
    membershipType: 'pro',
    ...overrides,
  };
}

console.log('providerCollapsedUsage: cursor');

{
  const chips = providerCollapsedUsage('cursor', entry(cursorData({
    cursorModelsTodayUsedPercent: 3.251,
    otherModelsTodayUsedPercent: 91.7,
  })));
  assert('two chips', chips.length === 2, `got ${chips.length}`);
  assert('cursor chip label', chips[0].label === '今日 Cursor', chips[0].label);
  assert('cursor chip percent', chips[0].percent === 3.251, String(chips[0].percent));
  assert('cursor chip title', chips[0].title === '今日 Cursor Models已用 3%', chips[0].title);
  assert('other chip label', chips[1].label === '今日 Other', chips[1].label);
  assert('other chip title', chips[1].title === '今日 Other Models已用 92%', chips[1].title);
  assert('stable keys', chips[0].key !== chips[1].key);
}

{
  // 今日 Other 缺失时只出 Cursor 一根，不补 0%。
  const chips = providerCollapsedUsage(
    'cursor',
    entry(cursorData({ otherModelsTodayUsedPercent: null, cursorModelsTodayUsedPercent: 12 })),
  );
  assert('single chip when other missing', chips.length === 1 && chips[0].label === '今日 Cursor');
}

{
  // 两个池都没有今日数据（官方额度源 / 今日事件不完整）时回退为周期口径，标签标注窗口。
  const chips = providerCollapsedUsage('cursor', entry(cursorData()));
  assert('cycle fallback chips', chips.length === 2, `got ${chips.length}`);
  assert('cycle cursor label', chips[0].label === '周期 Cursor', chips[0].label);
  assert('cycle cursor title', chips[0].title === '周期 Cursor Models已用 21%', chips[0].title);
  assert('cycle other label', chips[1].label === '周期 Other', chips[1].label);
  assert('cycle other percent', chips[1].percent === 0, String(chips[1].percent));
  assert('aria label', collapsedUsageAriaLabel('cursor') === '用量摘要');
}

{
  // 今日与周期都缺失（无任何可用数据）时才不出小条。
  const chips = providerCollapsedUsage(
    'cursor',
    entry(cursorData({ cursorModelsUsedPercent: null, otherModelsUsedPercent: null })),
  );
  assert('no chips without any data', chips.length === 0, `got ${chips.length}`);
}

{
  const chips = providerCollapsedUsage(
    'cursor',
    entry(cursorData({ cursorModelsTodayUsedPercent: 140, otherModelsTodayUsedPercent: -3 })),
  );
  assert('percent clamped into 0-100', chips[0].percent === 100 && chips[1].percent === 0, JSON.stringify(chips.map((c) => c.percent)));
}

console.log('providerCollapsedUsage: commandcode');

{
  const chips = providerCollapsedUsage(
    'commandcode',
    entry({
      providerId: 'commandcode',
      account: { login: 'demo', orgId: null },
      credits: null,
      plan: null,
      summary: null,
      limits: [
        { key: 'fiveHour', used: 0, cap: 20, resetAt: null },
        { key: 'monthly', used: 9.9, cap: 10, resetAt: null },
      ],
      unavailable: [],
      credentialSource: 'manual',
    }),
  );
  assert('present limits only', chips.length === 2, `got ${chips.length}`);
  assert('fiveHour chip', chips[0].label === '5h' && chips[0].percent === 0, JSON.stringify(chips[0]));
  assert('monthly chip tone input', chips[1].percent === 99, String(chips[1].percent));
  assert('monthly chip title', chips[1].title === '每月限额已用 99%', chips[1].title);
  assert('aria label', collapsedUsageAriaLabel('commandcode') === '限额摘要');
}

console.log('providerCollapsedUsage: 其它平台与错配数据');

{
  const chips = providerCollapsedUsage('deepseek', entry({
    providerId: 'deepseek',
    isAvailable: true,
    balances: [{ currency: 'CNY', totalBalance: '8.95', grantedBalance: '8.95', toppedUpBalance: '0' }],
  }));
  assert('deepseek has no chips', chips.length === 0);
}

{
  // 缓存里存的是别的平台数据时不得串台。
  const mismatched = entry(cursorData({ cursorModelsTodayUsedPercent: 30 }));
  mismatched.info = { success: true, providerId: 'commandcode', data: mismatched.info?.data ?? null };
  assert('mismatched provider ignored', providerCollapsedUsage('commandcode', mismatched).length === 0);
  assert('no entry ignored', providerCollapsedUsage('cursor', undefined).length === 0);
}
