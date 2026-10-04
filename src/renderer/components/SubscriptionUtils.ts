import {
  CURSOR_MODELS_LABEL,
  OTHER_MODELS_LABEL,
  formatRemainingFromUsedPercent,
} from '../../shared/format';
import type {
  CommandCodeLimit,
  CommandCodeQuotaSection,
  CommandCodeSubscriptionData,
  CursorSubscriptionData,
  SubscriptionInfoResult,
  SubscriptionProviderId,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';

/** 单个 provider 的渲染缓存：成功结果与错误信息并存，失败时保留上次成功数据。 */
export interface ProviderCacheEntry {
  info: SubscriptionInfoResult | null;
  usage: SubscriptionUsageResult | null;
  infoError: string | null;
  usageError: string | null;
}

export const EMPTY_PROVIDER_ENTRY: ProviderCacheEntry = {
  info: null,
  usage: null,
  infoError: null,
  usageError: null,
};

/** 卡片收起态的一根用量小条：短标签 + 进度条 + 百分比，百分比已夹取到 0-100。 */
export interface CollapsedUsageChip {
  key: string;
  label: string;
  percent: number;
  /** 悬停提示，展开为完整口径名称。 */
  title: string;
}

const COMMAND_CODE_CHIP_LABELS = { fiveHour: '5h', weekly: '周', monthly: '月' } as const;

/** CommandCode 收起态限额摘要：5 小时 / 每周 / 每月限额百分比，缺哪项就不出哪根。 */
function commandCodeCollapsedChips(data: CommandCodeSubscriptionData): CollapsedUsageChip[] {
  const chips: CollapsedUsageChip[] = [];
  for (const key of ['fiveHour', 'weekly', 'monthly'] as const) {
    const limit = data.limits.find((item) => item.key === key);
    if (!limit) continue;
    const percent = limitPercent(limit);
    chips.push({
      key,
      label: COMMAND_CODE_CHIP_LABELS[key],
      percent,
      title: `${LIMIT_LABELS[key]}已用 ${Math.round(percent)}%`,
    });
  }
  return chips;
}

/** Cursor 收起态摘要：今日 Cursor / 今日 Other 两个用量池，缺少今日数据的不出小条。 */
function cursorCollapsedChips(data: CursorSubscriptionData): CollapsedUsageChip[] {
  const buckets: Array<{ key: string; label: string; full: string; percent: number | null }> = [
    {
      key: 'cursorModelsToday',
      label: '今日 Cursor',
      full: `今日 ${CURSOR_MODELS_LABEL}`,
      percent: data.cursorModelsTodayUsedPercent,
    },
    {
      key: 'otherModelsToday',
      label: '今日 Other',
      full: `今日 ${OTHER_MODELS_LABEL}`,
      percent: data.otherModelsTodayUsedPercent,
    },
  ];

  const chips: CollapsedUsageChip[] = [];
  for (const bucket of buckets) {
    if (bucket.percent == null || !Number.isFinite(bucket.percent)) continue;
    const percent = clampPercent(bucket.percent);
    chips.push({
      key: bucket.key,
      label: bucket.label,
      percent,
      title: `${bucket.full}已用 ${Math.round(percent)}%`,
    });
  }
  return chips;
}

/**
 * 收起态小条：按 provider 口径给出需要关注的几项。
 * CommandCode 为 5 小时 / 每周 / 每月限额，Cursor 为今日两个用量池，DeepSeek 无小条。
 */
export function providerCollapsedUsage(
  id: SubscriptionProviderId,
  entry: ProviderCacheEntry | undefined,
): CollapsedUsageChip[] {
  const data = entry?.info?.data ?? null;
  if (!data || data.providerId !== id) return [];
  if (data.providerId === 'commandcode') return commandCodeCollapsedChips(data);
  if (data.providerId === 'cursor') return cursorCollapsedChips(data);
  return [];
}

/** 收起态小条分组的无障碍名称，避免 Cursor 的今日用量被读成限额。 */
export function collapsedUsageAriaLabel(id: SubscriptionProviderId): string {
  return id === 'cursor' ? '今日用量摘要' : '限额摘要';
}

/** 收起态套餐标签：有真实套餐数据时返回展示文案，否则返回 null（不展示、不写死）。 */
export function providerPlanLabel(
  id: SubscriptionProviderId,
  entry: ProviderCacheEntry | undefined,
): string | null {
  const data = entry?.info?.data ?? null;
  if (!data || data.providerId !== id) return null;
  if (data.providerId === 'commandcode') {
    return formatPlanLabel(data.plan?.planId ?? null);
  }
  if (data.providerId === 'cursor') {
    return formatCursorPlanLabel(data.membershipType);
  }
  return null;
}

/** provider 卡片上的一行摘要：取该平台最有信息量的一项数值。 */
export function providerSummaryLine(
  id: SubscriptionProviderId,
  entry: ProviderCacheEntry | undefined,
): string {
  const data = entry?.info?.data ?? null;
  if (!data || data.providerId !== id) return '暂无数据';
  switch (data.providerId) {
    case 'cursor':
      return `周期剩余 ${formatRemainingFromUsedPercent(data.totalUsedPercent)}`;
    case 'commandcode':
      return data.credits ? `剩余 ${formatUsd(data.credits.remainingCredits)}` : '额度不可用';
    case 'deepseek': {
      const balance = data.balances[0];
      return balance ? `余额 ${balance.currency} ${balance.totalBalance}` : '余额不可用';
    }
    default:
      return '暂无数据';
  }
}

const PLAN_LABELS: Record<string, string> = {
  go: 'Go',
  goat: 'GOAT',
  pro: 'Pro',
  max: 'Max',
  'max-10x': 'Max 10×',
  'max-20x': 'Max 20×',
  'team-pro': 'Team Pro',
  provider: 'Provider',
};

const LIMIT_LABELS: Record<CommandCodeLimit['key'], string> = {
  fiveHour: '5 小时限额',
  weekly: '每周限额',
  monthly: '每月限额',
};

const QUOTA_SECTION_LABELS: Record<CommandCodeQuotaSection, string> = {
  credits: '额度',
  subscription: '套餐',
  usage: '用量',
};

export function formatFetchedAt(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function formatCount(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthValue(value: string): { month: number; year: number } | null {
  const [yearStr, monthStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  return { month, year };
}

export function formatPlanLabel(planId: string | null): string {
  if (!planId) return '未知套餐';
  const key = planId.trim().toLowerCase();
  const scoped = key.replace(/^(individual|personal|team|org)-/, '');
  return PLAN_LABELS[key] ?? PLAN_LABELS[scoped] ?? planId.replace(/[_-]+/g, ' ').trim();
}

/** Cursor 套餐文案：usage-summary 的 membershipType（如 pro → Pro），未知值首字母大写。 */
export function formatCursorPlanLabel(membershipType: string | null | undefined): string | null {
  if (!membershipType || membershipType.trim().length === 0) return null;
  const key = membershipType.trim().toLowerCase();
  const known: Record<string, string> = {
    pro: 'Pro',
    business: 'Business',
    team: 'Team',
    enterprise: 'Enterprise',
    free: 'Free',
    hobby: 'Hobby',
    trial: 'Trial',
  };
  if (known[key]) return known[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const timestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  if (!Number.isFinite(timestamp) || timestamp < 0) return null;
  const date = new Date(timestamp >= 1e12 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatPeriodEnd(value: string | null): string | null {
  const end = parseTimestamp(value);
  if (!end) return null;
  const date = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(
    end.getDate(),
  ).padStart(2, '0')}`;
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  if (days > 0) return `${date}（${days} 天后）`;
  if (days === 0) return `${date}（今天）`;
  return `${date}（已续期）`;
}

/** 百分比夹取到 0-100：防止异常口径把进度条撑破或显示负值。 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function limitPercent(limit: CommandCodeLimit): number {
  if (limit.cap <= 0) return 0;
  return clampPercent((limit.used / limit.cap) * 100);
}

export function limitTone(percent: number): 'ok' | 'warn' | 'bad' {
  if (percent >= 90) return 'bad';
  if (percent >= 70) return 'warn';
  return 'ok';
}

export function formatLimitReset(limit: CommandCodeLimit): string {
  if (limit.resetAt === null) return '重置时间未知';
  const resetAt = new Date(limit.resetAt * 1000);
  if (Number.isNaN(resetAt.getTime())) return '重置时间未知';

  if (limit.key === 'monthly') {
    return `${resetAt.getMonth() + 1} 月 ${resetAt.getDate()} 日重置`;
  }

  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) return '即将重置';
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟后重置`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours} 小时 ${rest} 分钟后重置` : `${hours} 小时后重置`;
  return `${Math.floor(hours / 24)} 天后重置`;
}

export { LIMIT_LABELS, QUOTA_SECTION_LABELS };
