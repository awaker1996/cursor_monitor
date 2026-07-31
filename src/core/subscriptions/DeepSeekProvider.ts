import type { AppSettings } from '../../shared/types';
import type {
  DeepSeekBalanceInfo,
  DeepSeekModelUsage,
  RawDeepSeekBalanceResponse,
  RawDeepSeekUsageAmountResponse,
  RawDeepSeekUsageBizData,
  SubscriptionInfoResult,
  SubscriptionUsageQuery,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';
import type { SubscriptionProvider } from './types';
import { credentialVault } from '../../security/CredentialVault';
import { createLogger } from '../../utils/logger';

const log = createLogger('DeepSeekProvider');

const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance';
// 平台控制台内部接口（未公开），需网页登录 Token 鉴权，随时可能变动
const USAGE_ENDPOINT = 'https://platform.deepseek.com/api/v0/usage/amount';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const DEEPSEEK_CREDENTIAL_ACCOUNT = 'deepseek-api-key';
export const DEEPSEEK_USAGE_CREDENTIAL_ACCOUNT = 'deepseek-usage-token';

function toAmountNumber(value: string | number | undefined): number {
  if (value == null) return 0;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** 从 biz_data.total 汇总各模型的月度用量指标。 */
function parseModelUsages(bizData: RawDeepSeekUsageBizData): DeepSeekModelUsage[] {
  return (bizData.total ?? []).map((item) => {
    let cacheHitTokens = 0;
    let cacheMissTokens = 0;
    let responseTokens = 0;
    let requests = 0;
    let otherTokens = 0;
    for (const entry of item.usage ?? []) {
      const amount = toAmountNumber(entry.amount);
      switch (entry.type) {
        case 'PROMPT_CACHE_HIT_TOKEN':
          cacheHitTokens += amount;
          break;
        case 'PROMPT_CACHE_MISS_TOKEN':
          cacheMissTokens += amount;
          break;
        case 'RESPONSE_TOKEN':
          responseTokens += amount;
          break;
        case 'REQUEST':
          requests += amount;
          break;
        default:
          // 其他 token 类指标（如 PROMPT_TOKEN）计入总量，避免字段变动时丢数据
          otherTokens += amount;
          break;
      }
    }
    const inputTokens = cacheHitTokens + cacheMissTokens;
    return {
      model: item.model ?? '-',
      cacheHitTokens,
      cacheMissTokens,
      responseTokens,
      requests,
      totalTokens: inputTokens + responseTokens + otherTokens,
      cacheHitRatePercent:
        inputTokens > 0 ? Math.round((cacheHitTokens / inputTokens) * 1000) / 10 : null,
    };
  });
}

export class DeepSeekProvider implements SubscriptionProvider {
  readonly id = 'deepseek' as const;
  readonly label = 'DeepSeek';
  readonly credentialAccount = DEEPSEEK_CREDENTIAL_ACCOUNT;
  readonly usageCredentialAccount = DEEPSEEK_USAGE_CREDENTIAL_ACCOUNT;

  constructor(private getSettings: () => AppSettings) {}

  async isConfigured(): Promise<boolean> {
    return credentialVault.hasSecret(this.credentialAccount);
  }

  async fetchInfo(): Promise<SubscriptionInfoResult> {
    const apiKey = await credentialVault.getSecret(this.credentialAccount);
    if (!apiKey || !apiKey.trim()) {
      return { success: false, providerId: this.id, message: '请先配置 DeepSeek API Key' };
    }

    const settings = this.getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutSec * 1000);

    try {
      log.info('Fetching DeepSeek balance');
      const response = await fetch(BALANCE_ENDPOINT, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
          'User-Agent': 'CursorTokenMonitor/1.0',
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          providerId: this.id,
          message: 'API Key 无效或已过期，请重新配置',
        };
      }
      if (!response.ok) {
        return {
          success: false,
          providerId: this.id,
          message: `DeepSeek 接口返回 ${response.status}: ${response.statusText}`,
        };
      }

      const raw = (await response.json()) as RawDeepSeekBalanceResponse;
      const balances: DeepSeekBalanceInfo[] = (raw.balance_infos ?? []).map((item) => ({
        currency: item.currency ?? '-',
        totalBalance: item.total_balance ?? '-',
        grantedBalance: item.granted_balance ?? '-',
        toppedUpBalance: item.topped_up_balance ?? '-',
      }));

      return {
        success: true,
        providerId: this.id,
        fetchedAt: new Date().toISOString(),
        data: {
          providerId: this.id,
          isAvailable: raw.is_available === true,
          balances,
        },
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const message = isAbort
        ? '请求超时，请检查网络后重试'
        : `查询失败：${err instanceof Error ? err.message : String(err)}`;
      log.error('DeepSeek balance fetch failed', message);
      return { success: false, providerId: this.id, message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchUsage(query: SubscriptionUsageQuery): Promise<SubscriptionUsageResult> {
    const token = await credentialVault.getSecret(this.usageCredentialAccount);
    if (!token || !token.trim()) {
      return {
        success: false,
        providerId: this.id,
        message: '请先配置用量 Token（网页登录 platform.deepseek.com 后获取）',
      };
    }

    const settings = this.getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutSec * 1000);

    try {
      log.info('Fetching DeepSeek usage', { month: query.month, year: query.year });
      const url = `${USAGE_ENDPOINT}?month=${query.month}&year=${query.year}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token.trim()}`,
          'User-Agent': BROWSER_USER_AGENT,
          'x-app-version': '1.0.0',
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          providerId: this.id,
          message: '用量 Token 无效或已过期，请重新登录 platform.deepseek.com 获取',
        };
      }
      if (!response.ok) {
        return {
          success: false,
          providerId: this.id,
          message: `DeepSeek 用量接口返回 ${response.status}: ${response.statusText}（内部接口可能已变动）`,
        };
      }

      const raw = (await response.json()) as RawDeepSeekUsageAmountResponse;
      const bizData = raw.data?.biz_data ?? raw.biz_data;
      if (!bizData) {
        return {
          success: false,
          providerId: this.id,
          message: '用量接口响应结构无法识别（内部接口可能已变动）',
        };
      }

      const models = parseModelUsages(bizData);
      return {
        success: true,
        providerId: this.id,
        fetchedAt: new Date().toISOString(),
        data: {
          providerId: this.id,
          month: query.month,
          year: query.year,
          models,
          totalTokens: models.reduce((sum, m) => sum + m.totalTokens, 0),
          totalRequests: models.reduce((sum, m) => sum + m.requests, 0),
        },
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const message = isAbort
        ? '请求超时，请检查网络后重试'
        : `用量查询失败：${err instanceof Error ? err.message : String(err)}`;
      log.error('DeepSeek usage fetch failed', message);
      return { success: false, providerId: this.id, message };
    } finally {
      clearTimeout(timeout);
    }
  }
}
