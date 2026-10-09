import type { CSSProperties } from 'react';
import type { MetricDisplayItem } from '../../shared/format';

interface MetricRowProps {
  item: MetricDisplayItem;
  /** 入场 stagger 的序号，决定 animation-delay 的倍率。 */
  index?: number;
  /** 仅面板展开动画真正开始后才挂上 stagger 动画，避免面板未挂载时就跑完。 */
  stagger?: boolean;
}

export default function MetricRow({ item, index = 0, stagger = false }: MetricRowProps) {
  const barWidth = item.percentValue ?? 0;
  const hasBar = item.percentValue !== null;
  const timeframe = item.key.endsWith('Today') ? 'today' : 'period';
  const className = `metric-card metric-card--${item.accent} metric-card--${timeframe}${
    stagger ? ' metric-card--stagger' : ''
  }`;
  const style = stagger ? ({ '--stagger-i': index } as CSSProperties) : undefined;

  return (
    <div className={className} style={style}>
      <div className="metric-card__main">
        <span className="metric-card__label">{item.label}</span>
        <span className={`metric-card__value metric-card__value--${item.statusLevel}`}>
          {item.percent}
        </span>
      </div>
      {hasBar && (
        <div className="metric-card__track" aria-hidden>
          <div
            className={`metric-card__fill metric-card__fill--${item.statusLevel}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      )}
      <span className="metric-card__detail">{item.detail ?? '—'}</span>
    </div>
  );
}
