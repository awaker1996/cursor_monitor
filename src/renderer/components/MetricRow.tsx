import type { MetricDisplayItem } from '../../shared/format';

interface MetricRowProps {
  item: MetricDisplayItem;
}

export default function MetricRow({ item }: MetricRowProps) {
  const barWidth = item.percentValue ?? 0;
  const hasBar = item.percentValue !== null;

  return (
    <div className={`metric-card metric-card--${item.accent}`}>
      <span className="metric-card__label">{item.label}</span>
      <div className="metric-card__stats">
        <span className={`metric-card__value metric-card__value--${item.statusLevel}`}>
          {item.percent}
        </span>
        {item.detail && <span className="metric-card__detail">{item.detail}</span>}
      </div>
      {hasBar && (
        <div className="metric-card__track" aria-hidden>
          <div
            className={`metric-card__fill metric-card__fill--${item.statusLevel}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      )}
    </div>
  );
}
