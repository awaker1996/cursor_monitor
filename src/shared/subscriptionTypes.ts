/** 订阅提供方标识，后续新增订阅源时在此扩展联合类型。 */
export type SubscriptionProviderId = 'deepseek';

/** 凭据种类：apiKey 查余额，usageToken（网页登录 Token）查用量。 */
export type SubscriptionCredentialKind = 'apiKey' | 'usageToken';

export interface SubscriptionProviderMeta {
  id: SubscriptionProviderId;
  label: string;
  configured: boolean;
  usageSupported: boolean;
  usageConfigured: boolean;
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

/** 可辨识联合：新增订阅源时在此追加对应的数据类型。 */
export type SubscriptionData = DeepSeekSubscriptionData;

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
  models: DeepSeekModelUsage[];
  totalTokens: number;
  totalRequests: number;
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
