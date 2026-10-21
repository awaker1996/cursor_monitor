import type { CursorGrokBotUsage, RawSandUsageStatusResponse } from '../../shared/subscriptionTypes';

/**
 * Cursor dashboard 的 Grok Bot（后端代号 sand）用量接口候选端点。
 * 内部接口，未公开；多端点与 `CookieProvider` 的候选列表保持同一风格。
 */
export const SAND_USAGE_ENDPOINTS = [
  'https://cursor.com/api/dashboard/get-sand-usage-status',
  'https://www.cursor.com/api/dashboard/get-sand-usage-status',
];

/** 夹取到 0-100，非有限数按 0 处理，避免异常口径把进度条撑破。 */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 解析 `get-sand-usage-status` 响应为展示层数据结构。
 * 字段名与语义见 `RawSandUsageStatusResponse`；缺失或异常一律走安全默认，不抛错。
 */
export function parseSandUsageStatus(raw: unknown): CursorGrokBotUsage {
  const data =
    raw && typeof raw === 'object' ? (raw as RawSandUsageStatusResponse) : ({} as RawSandUsageStatusResponse);

  const rawPercent = asFiniteNumber(data.usagePercent);
  // 实测接口直接返回百分比（0.748597 → 控制台「1% used」，进度条近乎空），不要按 0-1 比例再乘 100。
  const usedPercent = rawPercent === null ? null : clampPercent(rawPercent);

  return {
    usedPercent,
    periodStart: asTrimmedString(data.currentPeriodStart),
    resetsAt: asTrimmedString(data.nextResetTimestampUtc),
    hasAvailableUsage: data.hasAvailableUsage === true,
    hasNonZeroIncludedLimit: data.hasNonZeroIncludedLimit === true,
    onDemandEligible: data.onDemandSettings?.eligible === true,
    planLabel: asTrimmedString(data.grokPlanLabel),
    brand: data.billingBrand === 'SAND_BILLING_BRAND_GROK' ? 'grok' : 'cursor',
  };
}
