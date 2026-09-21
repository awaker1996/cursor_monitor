import type { SettingsStore } from '../../settings/SettingsStore';
import type {
  SubscriptionCacheSnapshot,
  SubscriptionCredentialKind,
  SubscriptionInfoResult,
  SubscriptionProviderId,
  SubscriptionProviderMeta,
  SubscriptionUsageQuery,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';
import type { SubscriptionProvider } from './types';
import type { TokenSnapshot } from '../../shared/types';
import { DeepSeekProvider } from './DeepSeekProvider';
import { CommandCodeProvider } from './CommandCodeProvider';
import { CursorProvider } from './CursorProvider';
import type { SubscriptionCache } from './SubscriptionCache';
import { credentialVault } from '../../security/CredentialVault';
import { createLogger } from '../../utils/logger';

const log = createLogger('SubscriptionManager');

export class SubscriptionManager {
  private providers = new Map<SubscriptionProviderId, SubscriptionProvider>();

  constructor(
    settingsStore: SettingsStore,
    private cache: SubscriptionCache,
    getSnapshot: () => TokenSnapshot | null,
  ) {
    // 新增订阅源时在此注册对应 Provider，注册顺序即弹窗 tab 顺序
    this.register(new CursorProvider(getSnapshot));
    this.register(new CommandCodeProvider(() => settingsStore.get()));
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
    if (kind === 'sessionToken') {
      if (!provider.sessionCredentialAccount) {
        throw new Error(`${provider.label} 不支持流水会话凭据`);
      }
      return provider.sessionCredentialAccount;
    }
    return provider.credentialAccount;
  }

  async listProviders(): Promise<SubscriptionProviderMeta[]> {
    const metas: SubscriptionProviderMeta[] = [];
    for (const provider of this.providers.values()) {
      const usageSupported = typeof provider.fetchUsage === 'function';
      const sessionSupported = Boolean(provider.sessionCredentialAccount);
      metas.push({
        id: provider.id,
        label: provider.label,
        configured: await provider.isConfigured(),
        usageSupported,
        usageConfigured:
          usageSupported && provider.usageCredentialAccount
            ? await credentialVault.hasSecret(provider.usageCredentialAccount)
            : false,
        sessionSupported,
        sessionConfigured:
          sessionSupported && provider.sessionCredentialAccount
            ? await credentialVault.hasSecret(provider.sessionCredentialAccount)
            : false,
      });
    }
    return metas;
  }

  async fetchInfo(id: SubscriptionProviderId): Promise<SubscriptionInfoResult> {
    const result = await this.getProvider(id).fetchInfo();
    this.cache.saveInfo(id, result);
    return result;
  }

  async fetchUsage(
    id: SubscriptionProviderId,
    query: SubscriptionUsageQuery,
  ): Promise<SubscriptionUsageResult> {
    const provider = this.getProvider(id);
    if (!provider.fetchUsage) {
      return { success: false, providerId: id, message: `${provider.label} 不支持用量查询` };
    }
    const result = await provider.fetchUsage(query);
    this.cache.saveUsage(id, result);
    return result;
  }

  /** 上次成功查询的结果，供弹窗打开与切换 tab 时直接复用。 */
  getCached(): SubscriptionCacheSnapshot {
    return this.cache.getSnapshot();
  }

  async saveKey(
    id: SubscriptionProviderId,
    key: string,
    kind: SubscriptionCredentialKind = 'apiKey',
  ): Promise<void> {
    if (id === 'cursor' && kind === 'apiKey') {
      await credentialVault.saveCookie(key.trim());
      log.info('Subscription credential saved', { provider: id, kind });
      return;
    }
    const provider = this.getProvider(id);
    await credentialVault.saveSecret(this.resolveAccount(provider, kind), key.trim());
    log.info('Subscription credential saved', { provider: id, kind });
  }

  async clearKey(
    id: SubscriptionProviderId,
    kind: SubscriptionCredentialKind = 'apiKey',
  ): Promise<void> {
    if (id === 'cursor' && kind === 'apiKey') {
      await credentialVault.clearCookie();
      log.info('Subscription credential cleared', { provider: id, kind });
      return;
    }
    const provider = this.getProvider(id);
    await credentialVault.clearSecret(this.resolveAccount(provider, kind));
    log.info('Subscription credential cleared', { provider: id, kind });
  }
}
