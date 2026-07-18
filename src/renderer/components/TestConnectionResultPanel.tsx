import {
  buildBillingPeriodDisplay,
  buildDashboardSummary,
  buildMetricItems,
  formatBillingDate,
  formatPercent,
  formatTokenCount,
  FIRST_PARTY_MODELS_LABEL,
} from '../../shared/format';
import type { TestConnectionResult, TokenQuota } from '../../shared/types';
import MetricRow from './MetricRow';

interface TestConnectionResultPanelProps {
  result: TestConnectionResult;
}

function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatFetchedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatQuotaLine(label: string, quota: TokenQuota): string | null {
  const { remaining, limit, resetAt } = quota;
  if (remaining === null && limit === null) return null;

  const parts: string[] = [];
  if (remaining !== null && limit !== null) {
    parts.push(
      `余量 ${formatTokenCount(remaining)} / ${formatTokenCount(limit)}（${formatPercent(remaining, limit)}）`,
    );
  } else if (remaining !== null) {
    parts.push(`余量 ${formatTokenCount(remaining)}`);
  } else if (limit !== null) {
    parts.push(`上限 ${formatTokenCount(limit)}`);
  }

  const resetLabel = formatBillingDate(resetAt);
  if (resetLabel) parts.push(`重置 ${resetLabel}`);

  return `${label}：${parts.join('，')}`;
}

function formatIncludedUsageStatus(result: TestConnectionResult): string | null {
  const breakdown = result.snapshot?.includedUsage;
  if (!breakdown) return 'Included Usage：未返回';
  if (!breakdown.available) return 'Included Usage：不可用';
  if (breakdown.incomplete) return 'Included Usage：部分可用（数据不完整）';
  const count = breakdown.categories.length;
  return `Included Usage：可用（${count} 个分类）`;
}

export default function TestConnectionResultPanel({ result }: TestConnectionResultPanelProps) {
  const durationLabel = formatDuration(result.durationMs);
  const snapshot = result.snapshot;
  const dashboardSummary = snapshot ? buildDashboardSummary(snapshot) : null;
  const metricItems = snapshot ? buildMetricItems(snapshot.metrics) : [];
  const billingPeriod = snapshot
    ? buildBillingPeriodDisplay(snapshot.billingCycleStart, snapshot.billingCycleEnd)
    : null;

  const quotaLines = snapshot
    ? [
        formatQuotaLine('API 配额', snapshot.api),
        formatQuotaLine(`${FIRST_PARTY_MODELS_LABEL} 配额`, snapshot.auto),
      ].filter((line): line is string => line !== null)
    : [];

  return (
    <div className={`test-result test-result--${result.success ? 'ok' : 'fail'}`}>
      <div className="test-result__header">
        <span className="test-result__title">{result.success ? '连接成功' : '连接失败'}</span>
        {durationLabel && <span className="test-result__duration">耗时 {durationLabel}</span>}
      </div>

      <p className="test-result__message">{result.message}</p>

      {snapshot && (
        <div className="test-result__body">
          <dl className="test-result__meta">
            <div className="test-result__meta-row">
              <dt>数据源</dt>
              <dd>{snapshot.source === 'official' ? '官方 API' : 'Cookie'}</dd>
            </div>
            <div className="test-result__meta-row">
              <dt>数据版本</dt>
              <dd>{snapshot.rawVersion}</dd>
            </div>
            <div className="test-result__meta-row">
              <dt>获取时间</dt>
              <dd>{formatFetchedAt(snapshot.fetchedAt)}</dd>
            </div>
            {dashboardSummary && (
              <div className="test-result__meta-row">
                <dt>总消耗</dt>
                <dd>
                  {dashboardSummary.totalPercent}
                  {dashboardSummary.totalTokens !== 'token 明细不可用' && (
                    <span className="test-result__meta-detail">（{dashboardSummary.totalTokens}）</span>
                  )}
                </dd>
              </div>
            )}
            {billingPeriod && (billingPeriod.start || billingPeriod.end) && (
              <div className="test-result__meta-row">
                <dt>账单周期</dt>
                <dd>
                  {billingPeriod.start ?? '--'} ~ {billingPeriod.end ?? '--'}
                </dd>
              </div>
            )}
            <div className="test-result__meta-row">
              <dt>明细接口</dt>
              <dd>{formatIncludedUsageStatus(result)}</dd>
            </div>
          </dl>

          {quotaLines.length > 0 && (
            <div className="test-result__section">
              <h3 className="test-result__section-title">Token 配额</h3>
              <ul className="test-result__list">
                {quotaLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {metricItems.length > 0 && (
            <div className="test-result__section">
              <h3 className="test-result__section-title">用量分项</h3>
              <div className="test-result__metrics metric-list">
                {metricItems.map((item) => (
                  <MetricRow key={item.key} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
