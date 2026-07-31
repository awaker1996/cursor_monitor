import type { SettingsStore } from '../../settings/SettingsStore';
import type {
  SubscriptionCredentialKind,
  SubscriptionInfoResult,
  SubscriptionProviderId,
  SubscriptionProviderMeta,
  SubscriptionUsageQuery,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';
import type { SubscriptionProvider } from './types';
import { DeepSeekProvider } from './DeepSeekProvider';
import { credentialVault } from '../../security/CredentialVault';
import { createLogger } from '../../utils/logger';

const log = createLogger('SubscriptionManager');

export class SubscriptionManager {
  private providers = new Map<SubscriptionProviderId, SubscriptionProvider>();

  constructor(settingsStore: SettingsStore) {
    // 新增订阅源时在此注册对应 Provider
    this.register(new DeepSeekProvider(() => settingsStore.get()));
  }

  private register(provider: SubscriptionProvider): void {
    this.providers.set(provider.id, provider);
  }

  private getProvider(id: SubscriptionProviderId): SubscriptionProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`未知的订阅提供方: ${id}`);
    return provider;
  }

  /** 按凭据种类解析存储账户；不支持用量 Token 的提供方会报错。 */
  private resolveAccount(
    provider: SubscriptionProvider,
    kind: SubscriptionCredentialKind,
  ): string {
    if (kind === 'usageToken') {
      if (!provider.usageCredentialAccount) {
        throw new Error(`${provider.label} 不支持用量 Token`);
      }
      return provider.usageCredentialAccount;
    }
    return provider.credentialAccount;
  }

  async listProviders(): Promise<SubscriptionProviderMeta[]> {
    const metas: SubscriptionProviderMeta[] = [];
    for (const provider of this.providers.values()) {
      const usageSupported = typeof provider.fetchUsage === 'function';
      metas.push({
        id: provider.id,
        label: provider.label,
        configured: await provider.isConfigured(),
        usageSupported,
        usageConfigured:
          usageSupported && provider.usageCredentialAccount
            ? await credentialVault.hasSecret(provider.usageCredentialAccount)
            : false,
      });
    }
    return metas;
  }

  async fetchInfo(id: SubscriptionProviderId): Promise<SubscriptionInfoResult> {
    return this.getProvider(id).fetchInfo();
  }

  async fetchUsage(
    id: SubscriptionProviderId,
    query: SubscriptionUsageQuery,
  ): Promise<SubscriptionUsageResult> {
    const provider = this.getProvider(id);
    if (!provider.fetchUsage) {
      return { success: false, providerId: id, message: `${provider.label} 不支持用量查询` };
    }
    return provider.fetchUsage(query);
  }

  async saveKey(
    id: SubscriptionProviderId,
    key: string,
    kind: SubscriptionCredentialKind = 'apiKey',
  ): Promise<void> {
    const provider = this.getProvider(id);
    await credentialVault.saveSecret(this.resolveAccount(provider, kind), key.trim());
    log.info('Subscription credential saved', { provider: id, kind });
  }

  async clearKey(
    id: SubscriptionProviderId,
    kind: SubscriptionCredentialKind = 'apiKey',
  ): Promise<void> {
    const provider = this.getProvider(id);
    await credentialVault.clearSecret(this.resolveAccount(provider, kind));
    log.info('Subscription credential cleared', { provider: id, kind });
  }
}
