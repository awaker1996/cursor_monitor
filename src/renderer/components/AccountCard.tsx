import type { ReactNode } from 'react';
import type { SubscriptionProviderMeta } from '../../shared/subscriptionTypes';
import { formatRelativeTime, type AccountCardView } from './SubscriptionUtils';

export type AccountHealth = 'green' | 'gray' | 'yellow';

const HEALTH_TEXT: Record<AccountHealth, string> = {
  green: '正常',
  gray: '未配置',
  yellow: '异常',
};

const HEALTH_TITLE: Record<AccountHealth, string> = {
  green: '已配置 · 数据正常',
  gray: '未配置凭据',
  yellow: '已配置 · 最近查询失败',
};

interface AccountCardProps {
  meta: SubscriptionProviderMeta;
  view: AccountCardView | null;
  health: AccountHealth;
  open: boolean;
  onToggle: () => void;
  /** 最近一次成功查询时间，页脚据此渲染相对时间 */
  updatedAt?: string;
  /** 未配置 / 无数据 / 查询失败时的占位与引导 */
  placeholder?: ReactNode;
  /** 展开区：刷新工具条 + 明细 + 凭据配置 */
  children?: ReactNode;
}

/**
 * 平台卡片：收起态常显套餐、计费周期与关键额度指标，
 * 模型/用量明细与凭据配置收在展开区（由页面传入 children）。
 * 纯展示组件，所有状态留在 SubscriptionsPage。
 */
export default function AccountCard({
  meta,
  view,
  health,
  open,
  onToggle,
  updatedAt,
  placeholder,
  children,
}: AccountCardProps) {
  const classes = [
    'account-card',
    open ? 'account-card--open' : '',
    meta.configured ? '' : 'account-card--unconfigured',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes}>
      <button
        type="button"
        className="account-card__header"
        aria-expanded={open}
        onClick={onToggle}
        title={HEALTH_TITLE[health]}
      >
        <span className={`provider-card__dot provider-card__dot--${health}`} aria-hidden />
        <span className="account-card__title">
          <span className="account-card__name-row">
            <span className="account-card__name">{meta.label}</span>
            {view?.planLabel && (
              <span className="account-card__plan" title="订阅套餐">
                {view.planLabel}
              </span>
            )}
          </span>
        </span>
        <span className="account-card__header-actions">
          <span className={`account-card__status account-card__status--${health}`}>
            {HEALTH_TEXT[health]}
          </span>
          <span className="account-card__chevron" aria-hidden>
            {open ? '▴' : '▾'}
          </span>
        </span>
      </button>

      {view && (
        <div className="account-card__summary">
          {view.planMeta && <p className="account-card__period">{view.planMeta}</p>}

          {view.metrics.length > 0 && (
            <div
              className={`account-metrics${
                view.metrics.length === 1 ? ' account-metrics--single' : ''
              }`}
            >
              {view.metrics.map((metric) => (
                <div className="account-metric" key={metric.key} title={metric.title}>
                  <div className="account-metric__head">
                    <span className="account-metric__label">{metric.label}</span>
                    <span className="account-metric__value">{metric.value}</span>
                  </div>
                  {metric.percent !== null && (
                    <div
                      className="account-metric__track"
                      role="meter"
                      aria-label={`${metric.label} ${metric.value}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(metric.percent)}
                      aria-valuetext={metric.note ? `${metric.value}，${metric.note}` : metric.value}
                    >
                      <span
                        className={`account-metric__fill account-metric__fill--${metric.tone}`}
                        style={{ width: `${metric.percent}%` }}
                      />
                    </div>
                  )}
                  {metric.note && <p className="account-metric__note">{metric.note}</p>}
                </div>
              ))}
            </div>
          )}

          {view.todayLine && <p className="account-card__today">{view.todayLine}</p>}
          {view.footnote && <p className="account-card__note">{view.footnote}</p>}
          <p className="account-card__updated">
            {view.sourceLabel} · {formatRelativeTime(updatedAt)}
          </p>
        </div>
      )}

      {placeholder}

      {open && <div className="account-card__body">{children}</div>}
    </section>
  );
}
