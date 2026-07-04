import { formatPercent, formatTokenCount } from '../../shared/format';
import type { TokenQuota } from '../../shared/types';

interface TokenBadgeProps {
  label: string;
  quota: TokenQuota;
  accent?: 'auto' | 'api';
}

export default function TokenBadge({ label, quota, accent = 'auto' }: TokenBadgeProps) {
  const percent = formatPercent(quota.remaining, quota.limit);
  const remaining = formatTokenCount(quota.remaining);
  const limit = formatTokenCount(quota.limit);

  return (
    <div className={`token-badge token-badge--${accent}`}>
      <div className="token-badge__header">
        <span className="token-badge__label">{label}</span>
        <span className="token-badge__percent">{percent}</span>
      </div>
      <div className="token-badge__values">
        <span className="token-badge__remaining">{remaining}</span>
        {quota.limit !== null && (
          <span className="token-badge__limit">/ {limit}</span>
        )}
      </div>
      {quota.resetAt && (
        <div className="token-badge__reset">
          重置: {new Date(quota.resetAt).toLocaleDateString('zh-CN')}
        </div>
      )}
    </div>
  );
}
