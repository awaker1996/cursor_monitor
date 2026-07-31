import { formatIncludedUsageTokens } from '../../shared/format';
import type { UsageFlowModelStats } from '../../shared/types';

interface UsageFlowModelStatsProps {
  stats: UsageFlowModelStats;
}

export default function UsageFlowModelStatsPanel({ stats }: UsageFlowModelStatsProps) {
  if (!stats.available || stats.models.length === 0) {
    return null;
  }

  const maxShare = stats.models[0]?.sharePercent ?? 100;

  return (
    <section className="flow-model-stats" aria-label="模型用量统计">
      <header className="flow-model-stats__header">
        <h2 className="flow-model-stats__title">模型用量统计</h2>
        <div className="flow-model-stats__total">
          <span className="flow-model-stats__total-label">总 Tokens</span>
          <span className="flow-model-stats__total-value">
            {formatIncludedUsageTokens(stats.totalTokens)}
          </span>
        </div>
      </header>

      {stats.incomplete && (
        <p className="flow-model-stats__hint">部分数据未拉全，统计可能不完整</p>
      )}

      <ul className="flow-model-stats__list">
        {stats.models.map((item) => {
          const barWidth =
            maxShare > 0 ? Math.max(4, (item.sharePercent / maxShare) * 100) : 0;
          return (
            <li key={item.model} className="flow-model-stats__row">
              <div className="flow-model-stats__row-head">
                <span className="flow-model-stats__model" title={item.model}>
                  {item.model}
                </span>
                <span className="flow-model-stats__metrics">
                  <span className="flow-model-stats__tokens">
                    {formatIncludedUsageTokens(item.tokens)}
                  </span>
                  <span className="flow-model-stats__share">{item.sharePercent}%</span>
                </span>
              </div>
              <div
                className="flow-model-stats__bar-track"
                role="presentation"
                aria-hidden
              >
                <div
                  className="flow-model-stats__bar-fill"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
