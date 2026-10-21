import type {
  CursorGrokBotUsage,
  CursorModelItem,
  CursorSubscriptionData,
  SubscriptionInfoResult,
} from '../../shared/subscriptionTypes';
import type { SubscriptionProvider } from './types';
import type { AppSettings, TokenSnapshot } from '../../shared/types';
import { credentialVault } from '../../security/CredentialVault';
import { buildDashboardHeaders, normalizeWorkosCookie } from '../providers/CookieProvider';
import { SAND_USAGE_ENDPOINTS, parseSandUsageStatus } from './sandUsage';
import { createLogger } from '../../utils/logger';

const log = createLogger('CursorProvider');

export const CURSOR_CREDENTIAL_ACCOUNT = 'cursor-cookie';

/**
 * Cursor 平台订阅 Provider。
 * 用量主体由 Poller / ProviderManager 定期拉取，这里直接复用其已缓存的 TokenSnapshot；
 * 唯一的额外请求是 Grok Bot 周用量（dashboard 的 get-sand-usage-status），
 * 该数据不在 TokenSnapshot 中，拿不到时降级为 null，不影响主体展示。
 */
export class CursorProvider implements SubscriptionProvider {
  readonly id = 'cursor' as const;
  readonly label = 'Cursor';
  readonly credentialAccount = CURSOR_CREDENTIAL_ACCOUNT;

  private getSnapshot: () => TokenSnapshot | null;
  private getSettings: () => AppSettings;

  constructor(getSnapshot: () => TokenSnapshot | null, getSettings: () => AppSettings) {
    this.getSnapshot = getSnapshot;
    this.getSettings = getSettings;
  }

  async isConfigured(): Promise<boolean> {
    return credentialVault.hasCookie();
  }

  async fetchInfo(): Promise<SubscriptionInfoResult> {
    // 两个来源相互独立，并发获取；快照缺失时仍需 hasCookie 组织提示文案。
    const [hasCookie, grokBot] = await Promise.all([
      credentialVault.hasCookie(),
      this.fetchGrokBotUsage(),
    ]);
    const snapshot = this.getSnapshot();

    if (!snapshot) {
      return {
        success: false,
        providerId: this.id,
        message: hasCookie
          ? '暂无快照数据，请等待刷新或手动刷新'
          : '未配置 Cookie，请先在下方凭据配置中完成配置',
      };
    }

    const data = this.buildData(snapshot, hasCookie, grokBot);

    return {
      success: true,
      providerId: this.id,
      fetchedAt: snapshot.fetchedAt,
      data,
    };
  }

  /**
   * 拉取 Grok Bot 周用量。未配置 Cookie 时直接跳过；任何失败都只记录日志并返回 null，
   * 绝不让 Cursor 主体的用量数据因此不可用。
   */
  private async fetchGrokBotUsage(): Promise<CursorGrokBotUsage | null> {
    const cookie = await credentialVault.getCookie();
    if (!cookie || !cookie.trim()) return null;

    const headers = buildDashboardHeaders(normalizeWorkosCookie(cookie));
    const timeoutMs = this.getSettings().requestTimeoutSec * 1000;
    const errors: string[] = [];

    for (const endpoint of SAND_USAGE_ENDPOINTS) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: '{}',
          signal: controller.signal,
        });
        if (!response.ok) {
          errors.push(`${endpoint} HTTP ${response.status}`);
          continue;
        }
        const payload = (await response.json()) as unknown;
        return parseSandUsageStatus(payload);
      } catch (err) {
        errors.push(`${endpoint} ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    log.warn('Grok Bot usage unavailable', { errors });
    return null;
  }

  private buildData(
    snapshot: TokenSnapshot,
    hasCookie: boolean,
    grokBot: CursorGrokBotUsage | null,
  ): CursorSubscriptionData {
    const metrics = snapshot.metrics;
    const includedUsage = snapshot.includedUsage;

    const cursorModelsCategory = includedUsage?.categories.find((c) => c.key === 'firstParty');
    const otherModelsCategory = includedUsage?.categories.find((c) => c.key === 'api');

    const cursorModels: CursorModelItem[] = (cursorModelsCategory?.models ?? []).map((m) => ({
      model: m.model,
      tokens: m.tokens,
      usagePercent: m.usagePercent,
    }));

    const otherModels: CursorModelItem[] = (otherModelsCategory?.models ?? []).map((m) => ({
      model: m.model,
      tokens: m.tokens,
      usagePercent: m.usagePercent,
    }));

    log.info('Built Cursor subscription data', {
      source: snapshot.source,
      cursorModels: cursorModels.length,
      otherModels: otherModels.length,
      cursorModelsTodayUsedPercent: metrics.autoTodayUsedPercent ?? null,
      otherModelsTodayUsedPercent: metrics.apiTodayUsedPercent ?? null,
      grokBotUsedPercent: grokBot?.usedPercent ?? null,
    });

    return {
      providerId: this.id,
      cursorModelsUsedPercent: metrics.autoUsedPercent ?? null,
      otherModelsUsedPercent: metrics.apiUsedPercent ?? null,
      cursorModelsTodayUsedPercent: metrics.autoTodayUsedPercent ?? null,
      otherModelsTodayUsedPercent: metrics.apiTodayUsedPercent ?? null,
      totalUsedPercent: metrics.totalUsedPercent ?? null,
      billingCycleStart: snapshot.billingCycleStart ?? null,
      billingCycleEnd: snapshot.billingCycleEnd ?? null,
      cursorModels,
      otherModels,
      source: snapshot.source,
      hasCookie,
      membershipType: snapshot.membershipType ?? null,
      grokBot,
    };
  }
}
