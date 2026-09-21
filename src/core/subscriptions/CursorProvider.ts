import type {
  CursorModelItem,
  CursorSubscriptionData,
  SubscriptionInfoResult,
} from '../../shared/subscriptionTypes';
import type { SubscriptionProvider } from './types';
import type { TokenSnapshot } from '../../shared/types';
import { credentialVault } from '../../security/CredentialVault';
import { createLogger } from '../../utils/logger';

const log = createLogger('CursorProvider');

export const CURSOR_CREDENTIAL_ACCOUNT = 'cursor-cookie';

/**
 * Cursor 平台订阅 Provider。
 * 与其他 Provider 不同，Cursor 的用量数据由 Poller / ProviderManager 定期拉取，
 * 这里直接复用其已缓存的 TokenSnapshot 构建 SubscriptionInfoResult，无需独立发请求。
 */
export class CursorProvider implements SubscriptionProvider {
  readonly id = 'cursor' as const;
  readonly label = 'Cursor';
  readonly credentialAccount = CURSOR_CREDENTIAL_ACCOUNT;

  private getSnapshot: () => TokenSnapshot | null;

  constructor(getSnapshot: () => TokenSnapshot | null) {
    this.getSnapshot = getSnapshot;
  }

  async isConfigured(): Promise<boolean> {
    return credentialVault.hasCookie();
  }

  async fetchInfo(): Promise<SubscriptionInfoResult> {
    const hasCookie = await credentialVault.hasCookie();
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

    const data = this.buildData(snapshot, hasCookie);

    return {
      success: true,
      providerId: this.id,
      fetchedAt: snapshot.fetchedAt,
      data,
    };
  }

  private buildData(snapshot: TokenSnapshot, hasCookie: boolean): CursorSubscriptionData {
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
    });

    return {
      providerId: this.id,
      cursorModelsUsedPercent: metrics.autoUsedPercent ?? null,
      otherModelsUsedPercent: metrics.apiUsedPercent ?? null,
      totalUsedPercent: metrics.totalUsedPercent ?? null,
      billingCycleStart: snapshot.billingCycleStart ?? null,
      billingCycleEnd: snapshot.billingCycleEnd ?? null,
      cursorModels,
      otherModels,
      source: snapshot.source,
      hasCookie,
    };
  }
}
