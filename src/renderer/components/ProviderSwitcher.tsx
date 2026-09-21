import type { ProviderCacheEntry } from './SubscriptionUtils';
import { providerSummaryLine } from './SubscriptionUtils';
import type {
  SubscriptionProviderId,
  SubscriptionProviderMeta,
} from '../../shared/subscriptionTypes';

interface ProviderSwitcherProps {
  providers: SubscriptionProviderMeta[];
  activeId: SubscriptionProviderId;
  cache: Partial<Record<SubscriptionProviderId, ProviderCacheEntry>>;
  onSelect: (id: SubscriptionProviderId) => void;
}

type Health = 'green' | 'gray' | 'yellow';

function providerHealth(
  meta: SubscriptionProviderMeta,
  entry: ProviderCacheEntry | undefined,
): Health {
  if (!meta.configured) return 'gray';
  if (entry?.infoError) return 'yellow';
  return 'green';
}

const HEALTH_LABEL: Record<Health, string> = {
  green: '已配置 · 数据正常',
  gray: '未配置凭据',
  yellow: '已配置 · 最近查询失败',
};

export default function ProviderSwitcher({
  providers,
  activeId,
  cache,
  onSelect,
}: ProviderSwitcherProps) {
  return (
    <div className="provider-cards" role="tablist" aria-label="订阅提供方">
      {providers.map((provider) => {
        const entry = cache[provider.id];
        const health = providerHealth(provider, entry);
        const isActive = provider.id === activeId;
        return (
          <button
            key={provider.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'provider-card provider-card--active' : 'provider-card'}
            onClick={() => onSelect(provider.id)}
            title={HEALTH_LABEL[health]}
          >
            <span className="provider-card__head">
              <span
                className={`provider-card__dot provider-card__dot--${health}`}
                aria-hidden
              />
              <span className="provider-card__name">{provider.label}</span>
            </span>
            <span className="provider-card__value">{providerSummaryLine(provider.id, entry)}</span>
          </button>
        );
      })}
    </div>
  );
}
