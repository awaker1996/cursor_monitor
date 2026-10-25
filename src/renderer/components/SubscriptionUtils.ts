import {
  CURSOR_MODELS_LABEL,
  OTHER_MODELS_LABEL,
  formatIncludedUsageTokens,
  formatUsedPercent,
} from '../../shared/format';
import type {
  CommandCodeLimit,
  CommandCodeQuotaSection,
  CommandCodeSubscriptionData,
  CursorSubscriptionData,
  DeepSeekSubscriptionData,
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

/* ── 账户卡片视图模型 ──
   收起态常显的「套餐 + 周期 + 关键额度」由这里组装成纯数据，页面只负责渲染。
   所有时间格式化都接受 now 参数，便于回归脚本注入固定时间。 */

export type MetricTone = 'ok' | 'warn' | 'bad';

export interface AccountMetric {
  key: string;
  /** 左侧口径名，如「5 小时限额」「Cursor 模型」「积分」 */
  label: string;
  /** 右侧主值，如「剩余 98.9%」「剩余 $37.54」 */
  value: string;
  /** 0-100；null 表示不画进度条（余额类） */
  percent: number | null;
  tone: MetricTone;
  /** 条下注释：重置时间 + 剩余天数 */
  note?: string;
  /** 悬停的完整口径 */
  title?: string;
}

export interface AccountCardView {
  planLabel: string | null;
  planMeta: string | null;
  metrics: AccountMetric[];
  todayLine: string | null;
  footnote: string | null;
  sourceLabel: string;
}

export interface AccountCardViewOptions {
  now?: number;
  /** 当前选中的查询月份（YYYY-MM），用于 DeepSeek 月度用量摘要 */
  usageMonth?: string;
}

/** 统一把 ISO / unix 秒 / unix 毫秒解析为 Date；不可解析返回 null。 */
function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    // 0 是接口「无重置时间」的常见哨兵值，按未知处理，避免显示 1970 年
    if (!Number.isFinite(value) || value <= 0) return null;
    const date = new Date(value >= 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^0+$/.test(value.trim())) return null;
  return parseTimestamp(value);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 计费周期区间：`10/25 – 11/24`；跨年时两端带年份。 */
export function formatCycleRange(
  start: string | number | null | undefined,
  end: string | number | null | undefined,
): string | null {
  const from = toDate(start);
  const to = toDate(end);
  if (!from && !to) return null;
  if (!from || !to) return formatMonthDay((from ?? to) as Date);
  const sameYear = from.getFullYear() === to.getFullYear();
  const fromLabel = sameYear ? formatMonthDay(from) : `${from.getFullYear()}/${formatMonthDay(from)}`;
  const toLabel = sameYear ? formatMonthDay(to) : `${to.getFullYear()}/${formatMonthDay(to)}`;
  return `${fromLabel} – ${toLabel}`;
}

/** 自然日倒数：`30 天后` / `今天到期` / `已到期 12 天`。 */
export function formatRelativeDays(
  target: string | number | null | undefined,
  now: number = Date.now(),
): string | null {
  const date = toDate(target);
  if (!date) return null;
  const diff = Math.round(
    (startOfLocalDay(date) - startOfLocalDay(new Date(now))) / 86_400_000,
  );
  if (diff > 0) return `${diff} 天后`;
  if (diff === 0) return '今天到期';
  return `已到期 ${Math.abs(diff)} 天`;
}

/** 指标条下注释：`重置于 11月24日 17:54 · 30 天后`。 */
export function formatResetNote(
  target: string | number | null | undefined,
  now: number = Date.now(),
): string {
  const date = toDate(target);
  if (!date) return '重置时间未知';
  const label = `${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(date)}`;
  const relative = formatRelativeDays(target, now);
  // 重置/到期共用同一套倒数，但「今天到期」「已到期 N 天」用于重置时语义不通，
  // 这里换成「今天重置」「已重置」。
  const resetRelative =
    relative === null
      ? null
      : relative === '今天到期'
        ? '今天重置'
        : relative.startsWith('已到期')
          ? '已重置'
          : relative;
  return resetRelative ? `重置于 ${label} · ${resetRelative}` : `重置于 ${label}`;
}

/** 卡片页脚：`刚刚更新` / `5 分钟前更新` / `10月25日 21:36 更新`。 */
export function formatRelativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return '尚未更新';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '尚未更新';
  const diff = Math.max(0, now - date.getTime());
  if (diff < 60_000) return '刚刚更新';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(date)} 更新`;
}

function formatPercentText(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

/** 用量类指标：主值显示「剩余」，进度条与 tone 按已用百分比判定。 */
function pushUsageMetric(
  metrics: AccountMetric[],
  key: string,
  label: string,
  used: number | null | undefined,
  note: string | null,
  title: string,
): void {
  if (used === null || used === undefined || !Number.isFinite(used)) return;
  const usedPercent = clampPercent(used);
  const remaining = clampPercent(100 - usedPercent);
  metrics.push({
    key,
    label,
    value: `剩余 ${formatPercentText(remaining)}`,
    percent: remaining,
    tone: limitTone(usedPercent),
    note: note ?? undefined,
    title: `${title}已用 ${formatPercentText(usedPercent)}`,
  });
}

function buildCursorCardView(data: CursorSubscriptionData, now: number): AccountCardView {
  const cycleNote = formatResetNote(data.billingCycleEnd, now);
  const metrics: AccountMetric[] = [];

  pushUsageMetric(
    metrics,
    'cursorModels',
    'Cursor 模型',
    data.cursorModelsUsedPercent,
    cycleNote,
    `${CURSOR_MODELS_LABEL} 周期`,
  );
  pushUsageMetric(
    metrics,
    'otherModels',
    '其他模型',
    data.otherModelsUsedPercent,
    cycleNote,
    `${OTHER_MODELS_LABEL} 周期`,
  );

  const grokBot = data.grokBot;
  if (grokBot?.hasNonZeroIncludedLimit) {
    // 标签直接写平台名，周额度写进注释行：窄列里不会把「Grok Bot」截掉
    pushUsageMetric(
      metrics,
      'grokBot',
      'Grok Bot',
      grokBot.usedPercent,
      `周额度 · ${formatResetNote(grokBot.resetsAt, now)}`,
      'Grok Bot 周',
    );
  }

  pushUsageMetric(metrics, 'total', '合计', data.totalUsedPercent, cycleNote, '周期总用量');

  const hasToday =
    data.cursorModelsTodayUsedPercent !== null || data.otherModelsTodayUsedPercent !== null;
  const windowLabel = hasToday ? '今日' : '周期';
  const todayParts: string[] = [];
  const cursorToday = hasToday ? data.cursorModelsTodayUsedPercent : data.cursorModelsUsedPercent;
  const otherToday = hasToday ? data.otherModelsTodayUsedPercent : data.otherModelsUsedPercent;
  if (cursorToday !== null) {
    todayParts.push(`${windowLabel} Cursor ${formatUsedPercent(cursorToday)}`);
  }
  if (otherToday !== null) {
    todayParts.push(`${windowLabel} Other ${formatUsedPercent(otherToday)}`);
  }

  const cycleRange = formatCycleRange(data.billingCycleStart, data.billingCycleEnd);
  const cycleRelative = formatRelativeDays(data.billingCycleEnd, now);
  const cycleText = [cycleRange, cycleRelative].filter(Boolean).join(' · ');

  const footnoteParts: string[] = [];
  if (grokBot && !grokBot.hasNonZeroIncludedLimit) {
    footnoteParts.push('当前套餐不含 Grok Bot 周额度');
  }
  if (grokBot?.hasNonZeroIncludedLimit && grokBot.onDemandEligible) {
    footnoteParts.push('Grok Bot 周额度用尽后可设置按需额度继续使用');
  }

  return {
    planLabel: formatCursorPlanLabel(data.membershipType),
    planMeta: cycleText ? `计费周期 ${cycleText}` : '计费周期未知',
    metrics,
    todayLine: todayParts.length > 0 ? todayParts.join(' · ') : null,
    footnote: footnoteParts.length > 0 ? footnoteParts.join('；') : null,
    sourceLabel: data.source === 'official' ? '官方接口' : 'Dashboard Cookie',
  };
}

function buildCommandCodeCardView(
  data: CommandCodeSubscriptionData,
  now: number,
): AccountCardView {
  const metrics: AccountMetric[] = [];

  for (const limit of data.limits) {
    const usedPercent = limitPercent(limit);
    const remaining = clampPercent(100 - usedPercent);
    metrics.push({
      key: limit.key,
      label: LIMIT_LABELS[limit.key],
      value: `剩余 ${formatPercentText(remaining)}`,
      percent: remaining,
      tone: limitTone(usedPercent),
      note: formatResetNote(limit.resetAt, now),
      title: `${LIMIT_LABELS[limit.key]}已用 ${formatUsd(limit.used)} / ${formatUsd(limit.cap)}`,
    });
  }

  if (data.credits) {
    const monthlyLimit = data.limits.find((item) => item.key === 'monthly');
    const cap = monthlyLimit?.cap ?? 0;
    const remaining = data.credits.remainingCredits;
    const percent = cap > 0 ? clampPercent((remaining / cap) * 100) : null;
    metrics.push({
      key: 'credits',
      label: '积分',
      value: `剩余 ${formatUsd(remaining)}`,
      percent,
      tone: percent === null ? 'ok' : limitTone(100 - percent),
      note: `月度 ${formatUsd(data.credits.monthlyCredits)} · 购买 ${formatUsd(
        data.credits.purchasedCredits,
      )} · 赠送 ${formatUsd(data.credits.freeCredits)}`,
      title: cap > 0 ? `${formatUsd(remaining)} / ${formatUsd(cap)}` : undefined,
    });
  }

  const plan = data.plan;
  const planParts: string[] = [];
  if (plan?.status) planParts.push(plan.status);
  const range = formatCycleRange(plan?.currentPeriodStart ?? null, plan?.currentPeriodEnd ?? null);
  const relative = formatRelativeDays(plan?.currentPeriodEnd ?? null, now);
  const cycleText = [range, relative].filter(Boolean).join(' · ');
  if (cycleText) planParts.push(`计费周期 ${cycleText}`);

  const footnoteParts: string[] = [];
  if (!data.credits) footnoteParts.push('额度数据不可用');
  if (data.unavailable.length > 0) {
    footnoteParts.push(
      `本次未获取：${data.unavailable.map((section) => QUOTA_SECTION_LABELS[section]).join('、')}`,
    );
  }

  return {
    planLabel: plan?.planId ? formatPlanLabel(plan.planId) : null,
    planMeta: planParts.length > 0 ? planParts.join(' · ') : null,
    metrics,
    todayLine: null,
    footnote: footnoteParts.length > 0 ? footnoteParts.join('；') : null,
    sourceLabel: 'Command Code alpha',
  };
}

function buildDeepSeekCardView(
  data: DeepSeekSubscriptionData,
  usage: SubscriptionUsageResult | null,
  usageMonth: string | undefined,
): AccountCardView {
  const metrics: AccountMetric[] = data.balances.map((item) => ({
    key: `balance-${item.currency}`,
    label: `${item.currency} 余额`,
    value: `${item.currency} ${item.totalBalance}`,
    percent: null,
    tone: data.isAvailable ? 'ok' : 'bad',
    note: `充值 ${item.toppedUpBalance} · 赠送 ${item.grantedBalance}`,
  }));

  if (metrics.length === 0) {
    metrics.push({
      key: 'balance',
      label: '余额',
      value: '平台未返回余额明细',
      percent: null,
      tone: 'bad',
      note: '稍后刷新重试',
    });
  }

  const selected = usageMonth ? parseMonthValue(usageMonth) : null;
  const cached = usage?.success ? (usage.data ?? null) : null;
  if (
    selected &&
    cached &&
    cached.providerId === 'deepseek' &&
    cached.month === selected.month &&
    cached.year === selected.year
  ) {
    metrics.push({
      key: 'monthUsage',
      label: `${selected.month} 月用量`,
      value: formatIncludedUsageTokens(cached.totalTokens),
      percent: null,
      tone: 'ok',
      note: `请求 ${formatCount(cached.totalRequests)} 次${
        cached.cacheHitRatePercent === null
          ? ''
          : ` · 命中率 ${formatPercentText(cached.cacheHitRatePercent)}`
      }`,
    });
  }

  return {
    planLabel: null,
    planMeta: '预付费余额 · 无到期日',
    metrics,
    todayLine: null,
    footnote: data.isAvailable ? null : '账户当前不可用',
    sourceLabel: 'DeepSeek 余额接口',
  };
}

/** 收起态卡片的完整视图；未配置 / 无数据 / 查询失败时返回 null，由卡片走占位态。 */
export function buildAccountCardView(
  id: SubscriptionProviderId,
  entry: ProviderCacheEntry | undefined,
  options: AccountCardViewOptions = {},
): AccountCardView | null {
  const data = entry?.info?.data ?? null;
  if (!data || data.providerId !== id) return null;
  const now = options.now ?? Date.now();
  switch (data.providerId) {
    case 'cursor':
      return buildCursorCardView(data, now);
    case 'commandcode':
      return buildCommandCodeCardView(data, now);
    case 'deepseek':
      return buildDeepSeekCardView(data, entry?.usage ?? null, options.usageMonth);
    default:
      return null;
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

/**
 * Grok Bot 周重置文案：`M月D日（N 天后）`，与控制台「Resets 10月15日」同族但更紧凑。
 * 时间不可解析时返回「重置时间未知」。
 */
export function formatSandReset(value: string | null): string {
  const reset = parseTimestamp(value);
  if (!reset) return '重置时间未知';
  const label = `${reset.getMonth() + 1} 月 ${reset.getDate()} 日`;
  const days = Math.ceil((reset.getTime() - Date.now()) / 86_400_000);
  if (days > 0) return `${label}（${days} 天后）`;
  return `${label}（已重置）`;
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
