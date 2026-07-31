import type {
  SubscriptionInfoResult,
  SubscriptionProviderId,
  SubscriptionUsageQuery,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';

export interface SubscriptionProvider {
  readonly id: SubscriptionProviderId;
  readonly label: string;
  /** CredentialVault account name storing this provider's API key. */
  readonly credentialAccount: string;
  /** CredentialVault account name for the usage token; undefined when usage query is unsupported. */
  readonly usageCredentialAccount?: string;
  isConfigured(): Promise<boolean>;
  fetchInfo(): Promise<SubscriptionInfoResult>;
  fetchUsage?(query: SubscriptionUsageQuery): Promise<SubscriptionUsageResult>;
}
