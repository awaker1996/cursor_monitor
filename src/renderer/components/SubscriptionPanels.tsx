import type { ReactNode } from 'react';
import ErrorHint from './ErrorHint';
import { formatCount, formatUsd, parseMonthValue } from './SubscriptionUtils';
import { formatIncludedUsageTokens, formatUsedPercent } from '../../shared/format';
import type {
  CommandCodeSubscriptionData,
  CursorModelItem,
  CursorSubscriptionData,
  DeepSeekUsageData,
  SubscriptionInfoResult,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';

/* ── 展开区只剩「用量明细」 ──
   套餐、计费周期、限额百分比与重置时间都已在卡片常显区呈现，
   这里不再重复，避免同一组数字在一屏内出现两次。 */

/** 统一区块：标题（可带右侧控件） + 内容。 */
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

function CursorDetails({ data }: { data: CursorSubscriptionData }) {
  const modelCount = data.cursorModels.length + data.otherModels.length;

  return (
    <Block title="用量明细">
      {modelCount === 0 ? (
        <EmptyBlock text="本计费周期内没有模型调用记录" />
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
  );
}

/* ── Command Code ── */

function CommandCodeDetails({ data }: { data: CommandCodeSubscriptionData }) {
  const { summary } = data;
  const requestsValue =
    summary == null
      ? null
      : summary.completedCount !== undefined || summary.failedCount !== undefined
        ? `${formatCount(summary.totalCount)}（成功 ${formatCount(summary.completedCount ?? 0)} / 失败 ${formatCount(summary.failedCount ?? 0)}）`
        : formatCount(summary.totalCount);

  return (
    <Block title="用量明细">
      {!summary ? (
        <EmptyBlock text="用量汇总暂时无法获取，可能是 alpha 接口已变动，稍后刷新再试" />
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

function DeepSeekDetails({
  usage,
  usageMonth,
  onUsageMonthChange,
  usageConfigured,
  usageError,
  refreshing,
}: {
  usage: SubscriptionUsageResult | null;
  usageMonth: string;
  onUsageMonthChange: (value: string) => void;
  usageConfigured: boolean;
  usageError: string | null;
  refreshing: boolean;
}) {
  const cached = usage?.data?.providerId === 'deepseek' && usage.success ? usage.data : null;
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
        message="尚未配置用量 Token，无法按模型查询用量"
        action="在下方「凭据配置」中填写用量 Token 并保存后即可查询（数据来自 DeepSeek 平台控制台接口）"
      />
    );
  } else if (cached && !matchesSelected) {
    usageBody = (
      <ErrorHint
        tone="info"
        message={`当前显示的是 ${cached.year} 年 ${cached.month} 月的缓存数据`}
        action="点击上方「刷新」查询所选月份"
      />
    );
  } else if (usageError && !current) {
    usageBody = <ErrorHint tone="error" message={usageError} />;
  } else if (!current) {
    usageBody = (
      <ErrorHint tone="info" message={refreshing ? '正在查询该月份用量…' : '所选月份暂无用量记录'} />
    );
  } else if (current.models.length === 0) {
    usageBody = <ErrorHint tone="info" message="该月份没有模型调用记录" />;
  } else {
    usageBody = (
      <>
        <DeepSeekModelRows usage={current} />
        {current.zeroUsageModelCount > 0 && (
          <p className="field-hint">
            另有 {current.zeroUsageModelCount} 个模型当月调用为 0，未在表中列出
          </p>
        )}
      </>
    );
  }

  return (
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
  );
}

/* ── 分发表 ── */

export interface SubscriptionPanelProps {
  info: SubscriptionInfoResult | null;
  usage: SubscriptionUsageResult | null;
  usageError: string | null;
  refreshing: boolean;
  usageMonth: string;
  onUsageMonthChange: (value: string) => void;
  usageConfigured: boolean;
}

export default function SubscriptionPanel({
  info,
  usage,
  usageError,
  refreshing,
  usageMonth,
  onUsageMonthChange,
  usageConfigured,
}: SubscriptionPanelProps) {
  const data = info?.data ?? null;
  if (!data) return null;

  if (data.providerId === 'cursor') {
    return <CursorDetails data={data} />;
  }

  if (data.providerId === 'commandcode') {
    return <CommandCodeDetails data={data} />;
  }

  return (
    <DeepSeekDetails
      usage={usage}
      usageMonth={usageMonth}
      onUsageMonthChange={onUsageMonthChange}
      usageConfigured={usageConfigured}
      usageError={usageError}
      refreshing={refreshing}
    />
  );
}
