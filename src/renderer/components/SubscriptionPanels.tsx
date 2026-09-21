import type { ReactNode } from 'react';
import ErrorHint from './ErrorHint';
import {
  formatUsd,
  formatCount,
  formatPlanLabel,
  formatPeriodEnd,
  parseMonthValue,
  limitPercent,
  limitTone,
  formatLimitReset,
  LIMIT_LABELS,
  QUOTA_SECTION_LABELS,
} from './SubscriptionUtils';
import {
  formatIncludedUsageTokens,
  formatBillingDate,
  formatUsedPercent,
  formatRemainingFromUsedPercent,
} from '../../shared/format';
import type {
  CommandCodeLimit,
  CommandCodeSubscriptionData,
  CursorModelItem,
  CursorSubscriptionData,
  DeepSeekSubscriptionData,
  DeepSeekUsageData,
  SubscriptionInfoResult,
  SubscriptionProviderMeta,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';

const METER_SEGMENTS = 24;

/* ── 通用骨架：三平台共用「概览 → 关键指标 → 周期与账户 → 用量明细」四段 ── */

function AccountBadge({ available }: { available: boolean }) {
  return (
    <span className={available ? 'sub-badge sub-badge--ok' : 'sub-badge sub-badge--bad'}>
      {available ? '可用' : '不可用'}
    </span>
  );
}

/** 统一区块：标题（可带右侧控件） + 内容。数据缺失时整块不渲染。 */
function Block({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sub-block">
      <div className="sub-block__head">
        <h3 className="sub-section-title">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 关键指标网格：列数随条目数，三平台均为 3 项。 */
function StatGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  const columns =
    items.length >= 3 ? ' sub-metrics--3' : items.length === 2 ? ' sub-metrics--2' : '';
  return (
    <div className={`sub-metrics${columns}`}>
      {items.map((item) => (
        <div key={item.label}>
          <div className="sub-metric__label">{item.label}</div>
          <div className="sub-metric__value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

/** 周期 / 账户信息：键值行。 */
function KeyValueRows({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="sub-rows">
      {rows.map((row) => (
        <div className="sub-row" key={row.label}>
          <span className="sub-row__key">{row.label}</span>
          <span className="sub-row__value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function Hero({
  available,
  amount,
  unit,
  detail,
}: {
  available: boolean;
  amount: ReactNode;
  unit: string;
  detail: ReactNode;
}) {
  return (
    <div className="sub-hero">
      <AccountBadge available={available} />
      <div>
        <span className="sub-hero__amount">{amount}</span>
        <span className="sub-hero__unit">{unit}</span>
        <span className="sub-hero__detail">{detail}</span>
      </div>
    </div>
  );
}

/** 明细表合计行：首列标签，其余与表体数值列对齐。 */
function TableTotal({
  label,
  cells,
  cellClass = 'sub-table__num',
}: {
  label: string;
  cells: ReactNode[];
  cellClass?: string;
}) {
  return (
    <tfoot>
      <tr className="sub-table__total">
        <td className="sub-table__model">{label}</td>
        {cells.map((cell, index) => (
          <td className={cellClass} key={index}>
            {cell}
          </td>
        ))}
      </tr>
    </tfoot>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <p className="field-hint">{text}</p>;
}

function formatPercent1(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${Number(value.toFixed(1))}%`;
}

/* ── Cursor ── */

function sumModelTokens(items: CursorModelItem[]): number | null {
  const known = items.filter((item) => item.tokens != null);
  if (known.length === 0) return null;
  return known.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
}

function CursorModelTable({
  caption,
  models,
  totalTokens,
  totalPercent,
}: {
  caption: string;
  models: CursorModelItem[];
  totalTokens: number | null;
  totalPercent: number | null;
}) {
  return (
    <div className="sub-table-group">
      <h4 className="sub-table__caption">{caption}</h4>
      <table className="sub-table">
        <thead>
          <tr>
            <th>模型</th>
            <th className="sub-table__num">Tokens</th>
            <th className="sub-table__num">占比</th>
          </tr>
        </thead>
        <tbody>
          {models.map((item) => (
            <tr key={item.model}>
              <td className="sub-table__model" title={item.model}>
                {item.model}
              </td>
              <td className="sub-table__num">{formatIncludedUsageTokens(item.tokens)}</td>
              <td className="sub-table__num">
                {item.usagePercent != null ? formatUsedPercent(item.usagePercent) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
        <TableTotal
          label="合计"
          cells={[formatIncludedUsageTokens(totalTokens), formatUsedPercent(totalPercent)]}
        />
      </table>
    </div>
  );
}

function CursorSections({ data }: { data: CursorSubscriptionData }) {
  const cycleStart = formatBillingDate(data.billingCycleStart);
  const cycleEnd = formatBillingDate(data.billingCycleEnd);
  const cycleLabel = cycleStart && cycleEnd ? `${cycleStart} ~ ${cycleEnd}` : null;
  const modelCount = data.cursorModels.length + data.otherModels.length;

  return (
    <>
      <Hero
        available={data.hasCookie}
        amount={formatRemainingFromUsedPercent(data.totalUsedPercent)}
        unit="周期剩余"
        detail={
          <>
            已用 {formatUsedPercent(data.totalUsedPercent)}
            {` · 来源 ${data.source === 'official' ? '官方' : 'Cookie'}`}
            {cycleLabel ? ` · ${cycleLabel}` : ''}
          </>
        }
      />

      <Block title="关键指标">
        <StatGrid
          items={[
            { label: 'Cursor Models 已用', value: formatUsedPercent(data.cursorModelsUsedPercent) },
            { label: 'Other Models 已用', value: formatUsedPercent(data.otherModelsUsedPercent) },
            { label: '明细模型数', value: formatCount(modelCount) },
          ]}
        />
      </Block>

      <Block title="周期与账户">
        <KeyValueRows
          rows={[
            { label: '计费周期', value: cycleLabel ?? '-' },
            { label: '数据来源', value: data.source === 'official' ? '官方接口' : 'Dashboard Cookie' },
            { label: '凭据状态', value: data.hasCookie ? '已配置 Cookie' : '未配置 Cookie' },
          ]}
        />
      </Block>

      <Block title="用量明细">
        {modelCount === 0 ? (
          <EmptyBlock text="本期无模型明细" />
        ) : (
          <>
            {data.cursorModels.length > 0 && (
              <CursorModelTable
                caption="Cursor Models"
                models={data.cursorModels}
                totalTokens={sumModelTokens(data.cursorModels)}
                totalPercent={data.cursorModelsUsedPercent}
              />
            )}
            {data.otherModels.length > 0 && (
              <CursorModelTable
                caption="Other Models"
                models={data.otherModels}
                totalTokens={sumModelTokens(data.otherModels)}
                totalPercent={data.otherModelsUsedPercent}
              />
            )}
          </>
        )}
      </Block>
    </>
  );
}

/* ── Command Code ── */

function UsageLimitRow({ limit }: { limit: CommandCodeLimit }) {
  const percent = limitPercent(limit);
  const tone = limitTone(percent);
  const label = LIMIT_LABELS[limit.key];
  const filled = Math.min(METER_SEGMENTS, Math.round((percent / 100) * METER_SEGMENTS));
  const rounded = Math.round(percent);

  return (
    <div className="sub-meter">
      <div className="sub-meter__head">
        <span className="sub-meter__label">{label}</span>
        <span className="sub-meter__percent">{rounded}%</span>
      </div>
      <div
        className="sub-meter__track"
        role="meter"
        aria-label={`${label} 已用 ${rounded}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${rounded}%，已用 ${formatUsd(limit.used)} / ${formatUsd(limit.cap)}`}
      >
        {Array.from({ length: METER_SEGMENTS }, (_, index) => (
          <span
            key={index}
            className={index < filled ? `sub-meter__seg sub-meter__seg--${tone}` : 'sub-meter__seg'}
          />
        ))}
      </div>
      <p className="sub-meter__reset">{formatLimitReset(limit)}</p>
    </div>
  );
}

function CommandCodeSections({ data }: { data: CommandCodeSubscriptionData }) {
  const { credits, plan, summary, account, credentialSource, limits, unavailable } = data;
  const available = plan ? plan.status === 'active' : (credits?.remainingCredits ?? 0) > 0;
  const periodEnd = formatPeriodEnd(plan?.currentPeriodEnd ?? null);
  const periodStart = formatBillingDate(plan?.currentPeriodStart ?? null);
  const periodEndDate = formatBillingDate(plan?.currentPeriodEnd ?? null);
  const cycleLabel = periodStart && periodEndDate ? `${periodStart} ~ ${periodEndDate}` : null;

  const requestsValue =
    summary == null
      ? null
      : summary.completedCount !== undefined || summary.failedCount !== undefined
        ? `${formatCount(summary.totalCount)}（成功 ${formatCount(summary.completedCount ?? 0)} / 失败 ${formatCount(summary.failedCount ?? 0)}）`
        : formatCount(summary.totalCount);

  return (
    <>
      <Hero
        available={available}
        amount={formatUsd(credits?.remainingCredits ?? 0)}
        unit="剩余额度"
        detail={
          credits ? (
            <>
              月度 {formatUsd(credits.monthlyCredits)} · 购买 {formatUsd(credits.purchasedCredits)} · 赠送{' '}
              {formatUsd(credits.freeCredits)}
            </>
          ) : (
            '额度数据不可用'
          )
        }
      />

      {summary && (
        <Block title="关键指标">
          <StatGrid
            items={[
              { label: '当期消耗', value: formatUsd(summary.totalCost) },
              { label: '请求数', value: formatCount(summary.totalCount) },
              {
                label: 'Tokens',
                value:
                  summary.totalTokens === undefined
                    ? '-'
                    : formatIncludedUsageTokens(summary.totalTokens),
              },
            ]}
          />
        </Block>
      )}

      <Block title="周期与账户">
        <KeyValueRows
          rows={[
            {
              label: '套餐',
              value: `${formatPlanLabel(plan?.planId ?? null)}${
                plan?.status ? `（${plan.status}）` : ''
              }${periodEnd ? ` · 续期 ${periodEnd}` : ''}`,
            },
            { label: '计费周期', value: cycleLabel ?? '-' },
            {
              label: '账号',
              value: `${account.keyName ?? account.login}${
                credentialSource === 'auth-file' ? '（凭据自动读取）' : ''
              }`,
            },
            {
              label: '统计口径',
              value: summary?.periodBasis === 'billing-period' ? '计费周期' : (summary?.periodBasis ?? '-'),
            },
          ]}
        />
        {unavailable.length > 0 && (
          <p className="field-hint">
            部分数据不可用：{unavailable.map((section) => QUOTA_SECTION_LABELS[section]).join('、')}
          </p>
        )}
      </Block>

      {limits.length > 0 && (
        <Block title="用量限额">
          {limits.map((limit) => (
            <UsageLimitRow key={limit.key} limit={limit} />
          ))}
        </Block>
      )}

      <Block title="用量明细">
        {!summary ? (
          <EmptyBlock text="用量汇总不可用（alpha 接口可能已变动）" />
        ) : (
          <table className="sub-table">
            <thead>
              <tr>
                <th>指标</th>
                <th className="sub-table__value">数值</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sub-table__model">输入 Tokens</td>
                <td className="sub-table__value">
                  {formatIncludedUsageTokens(summary.totalTokensIn ?? null)}
                </td>
              </tr>
              <tr>
                <td className="sub-table__model">输出 Tokens</td>
                <td className="sub-table__value">
                  {formatIncludedUsageTokens(summary.totalTokensOut ?? null)}
                </td>
              </tr>
              <tr>
                <td className="sub-table__model">请求数</td>
                <td className="sub-table__value">{requestsValue ?? '-'}</td>
              </tr>
              <tr>
                <td className="sub-table__model">成功率</td>
                <td className="sub-table__value">{formatPercent1(summary.successRate)}</td>
              </tr>
              <tr>
                <td className="sub-table__model">平均单次成本</td>
                <td className="sub-table__value">
                  {summary.averageCost === undefined ? '-' : `$${summary.averageCost.toFixed(4)}`}
                </td>
              </tr>
            </tbody>
            <TableTotal
              label="合计"
              cellClass="sub-table__value"
              cells={[
                `${formatUsd(summary.totalCost)} · ${formatIncludedUsageTokens(
                  summary.totalTokens ?? null,
                )} Tokens`,
              ]}
            />
          </table>
        )}
      </Block>
    </>
  );
}

/* ── DeepSeek ── */

function DeepSeekModelRows({ usage }: { usage: DeepSeekUsageData }) {
  return (
    <table className="sub-table">
      <thead>
        <tr>
          <th>模型</th>
          <th className="sub-table__num">Token</th>
          <th className="sub-table__num">输出</th>
          <th className="sub-table__num">命中率</th>
          <th className="sub-table__num">请求</th>
        </tr>
      </thead>
      <tbody>
        {usage.models.map((model) => (
          <tr key={model.model}>
            <td className="sub-table__model" title={model.model}>
              {model.model}
            </td>
            <td className="sub-table__num" title={formatCount(model.totalTokens)}>
              {formatIncludedUsageTokens(model.totalTokens)}
            </td>
            <td className="sub-table__num" title={formatCount(model.responseTokens)}>
              {formatIncludedUsageTokens(model.responseTokens)}
            </td>
            <td className="sub-table__num">{formatPercent1(model.cacheHitRatePercent)}</td>
            <td className="sub-table__num" title={formatCount(model.requests)}>
              {formatCount(model.requests)}
            </td>
          </tr>
        ))}
      </tbody>
      <TableTotal
        label="合计"
        cells={[
          formatIncludedUsageTokens(usage.totalTokens),
          formatIncludedUsageTokens(usage.totalResponseTokens),
          formatPercent1(usage.cacheHitRatePercent),
          formatCount(usage.totalRequests),
        ]}
      />
    </table>
  );
}

function DeepSeekSections({
  data,
  usage,
  usageMonth,
  onUsageMonthChange,
  usageConfigured,
  usageError,
  refreshing,
}: {
  data: DeepSeekSubscriptionData;
  usage: SubscriptionUsageResult | null;
  usageMonth: string;
  onUsageMonthChange: (value: string) => void;
  usageConfigured: boolean;
  usageError: string | null;
  refreshing: boolean;
}) {
  const balance = data.balances[0] ?? null;
  const cached =
    usage?.data?.providerId === 'deepseek' && usage.success ? usage.data : null;
  const selected = parseMonthValue(usageMonth);
  const matchesSelected =
    cached !== null &&
    selected !== null &&
    cached.month === selected.month &&
    cached.year === selected.year;
  const current = matchesSelected ? cached : null;

  let usageBody: ReactNode;
  if (!usageConfigured) {
    usageBody = (
      <ErrorHint
        tone="info"
        message="尚未配置用量 Token"
        action="展开下方「凭据配置」配置后即可按模型查询用量（数据来自平台控制台内部接口）"
      />
    );
  } else if (cached && !matchesSelected) {
    usageBody = (
      <ErrorHint
        tone="info"
        message={`当前显示 ${cached.year} 年 ${cached.month} 月缓存，点击「刷新」查询所选月份`}
      />
    );
  } else if (usageError && !current) {
    usageBody = <ErrorHint tone="error" message={usageError} />;
  } else if (!current) {
    usageBody = (
      <ErrorHint tone="info" message={refreshing ? '正在查询…' : '暂无该月份用量记录'} />
    );
  } else if (current.models.length === 0) {
    usageBody = <ErrorHint tone="info" message="该月份无用量记录" />;
  } else {
    usageBody = (
      <>
        <DeepSeekModelRows usage={current} />
        {current.zeroUsageModelCount > 0 && (
          <p className="field-hint">
            另有 {current.zeroUsageModelCount} 个模型本期无用量，未在表中列出
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <Hero
        available={data.isAvailable}
        amount={balance ? balance.totalBalance : '-'}
        unit={balance?.currency ?? ''}
        detail={
          balance ? (
            <>
              充值 {balance.toppedUpBalance} · 赠送 {balance.grantedBalance}
            </>
          ) : (
            '接口未返回余额明细'
          )
        }
      />

      {current && (
        <Block title="关键指标">
          <StatGrid
            items={[
              {
                label: `${current.month} 月 Token`,
                value: formatIncludedUsageTokens(current.totalTokens),
              },
              { label: `${current.month} 月请求`, value: formatCount(current.totalRequests) },
              { label: '缓存命中率', value: formatPercent1(current.cacheHitRatePercent) },
            ]}
          />
        </Block>
      )}

      <Block title="周期与账户">
        <KeyValueRows
          rows={[
            { label: '账户状态', value: data.isAvailable ? '可用' : '不可用' },
            ...data.balances.map((item) => ({
              label: `${item.currency} 余额`,
              value: `总计 ${item.totalBalance} · 充值 ${item.toppedUpBalance} · 赠送 ${item.grantedBalance}`,
            })),
            {
              label: '查询月份',
              value: selected ? `${selected.year} 年 ${selected.month} 月` : usageMonth,
            },
          ]}
        />
      </Block>

      <Block
        title="用量明细"
        action={
          <input
            type="month"
            value={usageMonth}
            aria-label="查询月份"
            onChange={(event) => onUsageMonthChange(event.target.value)}
          />
        }
      >
        {usageBody}
      </Block>
    </>
  );
}

/* ── 分发表 ── */

export interface SubscriptionPanelProps {
  meta: SubscriptionProviderMeta;
  info: SubscriptionInfoResult | null;
  usage: SubscriptionUsageResult | null;
  infoError: string | null;
  usageError: string | null;
  refreshing: boolean;
  usageMonth: string;
  onUsageMonthChange: (value: string) => void;
}

export default function SubscriptionPanel({
  meta,
  info,
  usage,
  infoError,
  usageError,
  refreshing,
  usageMonth,
  onUsageMonthChange,
}: SubscriptionPanelProps) {
  const data = info?.data ?? null;

  let body: ReactNode;
  if (!meta.configured) {
    body = (
      <ErrorHint
        tone="info"
        message={meta.id === 'cursor' ? '尚未配置 Cookie' : '尚未配置 API Key'}
        action="展开下方「凭据配置」完成配置后再次查询"
      />
    );
  } else if (!data) {
    body = infoError ? (
      <ErrorHint tone="error" message={infoError} />
    ) : (
      <ErrorHint tone="info" message={refreshing ? '正在查询…' : '暂无数据，点击「刷新」查询'} />
    );
  } else if (data.providerId === 'cursor') {
    body = <CursorSections data={data} />;
  } else if (data.providerId === 'commandcode') {
    body = <CommandCodeSections data={data} />;
  } else {
    body = (
      <DeepSeekSections
        data={data}
        usage={usage}
        usageMonth={usageMonth}
        onUsageMonthChange={onUsageMonthChange}
        usageConfigured={meta.usageConfigured}
        usageError={usageError}
        refreshing={refreshing}
      />
    );
  }

  return (
    <section className="settings-section">
      <h2>{meta.label}</h2>
      {body}
    </section>
  );
}
