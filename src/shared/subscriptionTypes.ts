/** 订阅提供方标识，后续新增订阅源时在此扩展联合类型。 */
export type SubscriptionProviderId = 'cursor' | 'deepseek' | 'commandcode';

/** 凭据种类：apiKey 查余额，usageToken（网页登录 Token）查用量，sessionToken 查流水。 */
export type SubscriptionCredentialKind = 'apiKey' | 'usageToken' | 'sessionToken';

export interface SubscriptionProviderMeta {
  id: SubscriptionProviderId;
  label: string;
  configured: boolean;
  usageSupported: boolean;
  usageConfigured: boolean;
  /** 是否需要（且已配置）独立的流水会话凭据。 */
  sessionSupported: boolean;
  sessionConfigured: boolean;
}

/** DeepSeek 开放平台 `GET /user/balance` 的单币种余额。 */
export interface DeepSeekBalanceInfo {
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
}

export interface DeepSeekSubscriptionData {
  providerId: 'deepseek';
  isAvailable: boolean;
  balances: DeepSeekBalanceInfo[];
}

/** Command Code 凭据来源：manual 手动录入、env 环境变量、auth-file 自动读取 auth.json。 */
export type CommandCodeCredentialSource = 'manual' | 'env' | 'auth-file';

/**
 * 用量限额窗口，供进度计量条直接渲染。
 * fiveHour / weekly 来自 credits 接口；monthly 的上限由套餐映射得出（接口不返回）。
 */
export interface CommandCodeLimit {
  key: 'fiveHour' | 'weekly' | 'monthly';
  used: number;
  cap: number;
  /** 重置时间，归一化为 unix 秒；无法解析时为 null。 */
  resetAt: number | null;
}

export interface CommandCodeCredits {
  monthlyCredits: number;
  purchasedCredits: number;
  freeCredits: number;
  remainingCredits: number;
}

export interface CommandCodePlan {
  planId: string | null;
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface CommandCodeAccount {
  login: string;
  orgId: string | null;
  keyName?: string;
}

/** 计费周期内的用量汇总。 */
export interface CommandCodeSummary {
  totalCost: number;
  totalCount: number;
  totalTokens?: number;
  /** 周期内消耗的月度积分，用于月度限额进度。 */
  monthlyCreditsUsed?: number;
  /** 输入 token 合计（接口 totalTokensIn）。 */
  totalTokensIn?: number;
  /** 输出 token 合计（接口 totalTokensOut）。 */
  totalTokensOut?: number;
  /** 成功 / 失败请求数，用于在明细里拆分请求口径。 */
  completedCount?: number;
  failedCount?: number;
  /** 成功请求占比（0-100）。 */
  successRate?: number;
  /** 单次请求平均成本（美元）。 */
  averageCost?: number;
  /** 统计口径，接口当前返回 billing-period。 */
  periodBasis?: string;
}

export interface CommandCodeSubscriptionData {
  providerId: 'commandcode';
  account: CommandCodeAccount;
  credits: CommandCodeCredits | null;
  plan: CommandCodePlan | null;
  summary: CommandCodeSummary | null;
  limits: CommandCodeLimit[];
  /** 未能获取到的数据段，避免把失败误显示为零值。 */
  unavailable: CommandCodeQuotaSection[];
  credentialSource: CommandCodeCredentialSource;
}

export type CommandCodeQuotaSection = 'credits' | 'subscription' | 'usage';

/** 单个提供方的缓存条目：只保存成功结果，失败不覆盖上一次成功数据。 */
export interface SubscriptionCacheEntry {
  info?: SubscriptionInfoResult;
  usage?: SubscriptionUsageResult;
}

/** 各提供方的缓存快照，键为提供方 id。 */
export type SubscriptionCacheSnapshot = Partial<
  Record<SubscriptionProviderId, SubscriptionCacheEntry>
>;

/** Cursor 平台周期用量数据，来源于 TokenSnapshot 的 metrics 与 includedUsage。 */
export interface CursorSubscriptionData {
  providerId: 'cursor';
  /** Cursor Models（auto）周期用量百分比 */
  cursorModelsUsedPercent: number | null;
  /** Other Models（api）周期用量百分比 */
  otherModelsUsedPercent: number | null;
  /** 总用量百分比 */
  totalUsedPercent: number | null;
  /** 计费周期开始 */
  billingCycleStart: string | null;
  /** 计费周期结束 */
  billingCycleEnd: string | null;
  /** Cursor Models 分类下的模型明细 */
  cursorModels: CursorModelItem[];
  /** Other Models 分类下的模型明细 */
  otherModels: CursorModelItem[];
  /** 数据来源：official / cookie */
  source: string;
  /** 是否已配置 Cookie */
  hasCookie: boolean;
}

export interface CursorModelItem {
  model: string;
  tokens: number | null;
  usagePercent: number | null;
}

/** 可辨识联合：新增订阅源时在此追加对应的数据类型。 */
export type SubscriptionData = DeepSeekSubscriptionData | CommandCodeSubscriptionData | CursorSubscriptionData;

export interface SubscriptionInfoResult {
  success: boolean;
  providerId: SubscriptionProviderId;
  message?: string;
  fetchedAt?: string;
  data?: SubscriptionData | null;
}

/** DeepSeek 官方余额接口原始响应结构。 */
export interface RawDeepSeekBalanceResponse {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
}

export interface SubscriptionUsageQuery {
  /** 1-12 */
  month: number;
  year: number;
}

/** DeepSeek 单个模型的月度用量汇总。 */
export interface DeepSeekModelUsage {
  model: string;
  cacheHitTokens: number;
  cacheMissTokens: number;
  responseTokens: number;
  requests: number;
  totalTokens: number;
  /** 缓存命中率（0-100），输入 token 为 0 时为 null。 */
  cacheHitRatePercent: number | null;
}

export interface DeepSeekUsageData {
  providerId: 'deepseek';
  month: number;
  year: number;
  /** 仅含有用量的模型；全零模型由 zeroUsageModelCount 记数并从表格中隐去。 */
  models: DeepSeekModelUsage[];
  totalTokens: number;
  totalRequests: number;
  /** 输出 token 合计，对应表格「输出」列的合计行。 */
  totalResponseTokens: number;
  /** 缓存命中率合计（按输入 token 加权），无输入时为 null。 */
  cacheHitRatePercent: number | null;
  /** 本期零用量、未在表格中列出的模型数量。 */
  zeroUsageModelCount: number;
}

/** 可辨识联合：新增订阅源时在此追加对应的用量数据类型。 */
export type SubscriptionUsageData = DeepSeekUsageData;

export interface SubscriptionUsageResult {
  success: boolean;
  providerId: SubscriptionProviderId;
  message?: string;
  fetchedAt?: string;
  data?: SubscriptionUsageData | null;
}

/** DeepSeek 平台内部用量接口（/api/v0/usage/amount）原始响应结构，字段防御式解析。 */
export interface RawDeepSeekUsageAmountResponse {
  code?: number;
  msg?: string;
  data?: {
    biz_data?: RawDeepSeekUsageBizData;
  };
  biz_data?: RawDeepSeekUsageBizData;
}

export interface RawDeepSeekUsageBizData {
  total?: Array<{
    model?: string;
    usage?: Array<{ type?: string; amount?: string | number }>;
  }>;
  days?: Array<{
    date?: string;
    data?: Array<{
      model?: string;
      usage?: Array<{ type?: string; amount?: string | number }>;
    }>;
  }>;
}

/**
 * Command Code alpha 内部接口原始响应结构（与 cmd CLI 的 /usage 同源，未公开、可能变动），
 * 全部字段可选并按需防御式解析。
 */
export interface RawCommandCodeWhoami {
  org?: {
    id?: string;
    login?: string;
  };
  user?: {
    userName?: string;
    name?: string;
    keyName?: string;
    displayName?: string;
  };
}

export interface RawCommandCodeCredits {
  credits?: {
    monthlyCredits?: number;
    purchasedCredits?: number;
    freeCredits?: number;
  };
  windowLimits?: {
    fiveHour?: { used?: number; cap?: number; resetAt?: string | number };
    weekly?: { used?: number; cap?: number; resetAt?: string | number };
  };
}

export interface RawCommandCodeSubscription {
  data?: {
    planId?: string;
    status?: string;
    currentPeriodStart?: string | number;
    currentPeriodEnd?: string | number;
  };
}

export interface RawCommandCodeUsageSummary {
  totalCost?: number;
  totalCount?: number;
  totalTokens?: number;
  tokens?: number;
  /** 周期内消耗的月度积分。 */
  totalMonthlyCredits?: number;
  totalTokensIn?: number;
  totalTokensOut?: number;
  completedCount?: number;
  failedCount?: number;
  successRate?: number;
  averageCost?: number;
  /** 接口当前返回 billing-period，表示汇总按计费周期统计。 */
  periodBasis?: string;
}
