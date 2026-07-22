import type { RawUsageEvent, UsageFlowEntry } from './types';
import { formatIncludedUsageTokens } from './format';

/** Cursor Billing maps first-party routing bucket `default` → `auto`. */
export function formatUsageEventModelName(model: string | undefined | null): string {
  const name = model?.trim();
  if (!name) return '--';
  if (name.toLowerCase() === 'default') return 'auto';
  return name;
}

export function isMaxModeEvent(event: RawUsageEvent): boolean {
  const record = event as Record<string, unknown>;
  return record.maxMode === true || record.max_mode === true;
}

function hasExplicitFreeKind(kind: string): boolean {
  if (!kind) return false;
  if (kind === 'Free') return true;
  if (/USAGE_EVENT_KIND_FREE/i.test(kind)) return true;
  return /\bFREE\b/i.test(kind) && !/INCLUDED/i.test(kind);
}

function hasExplicitUsageBasedKind(kind: string): boolean {
  return /USAGE_BASED/i.test(kind);
}

function hasExplicitIncludedKind(kind: string): boolean {
  return /INCLUDED/i.test(kind);
}

/**
 * Resolve Type column label.
 * Explicit `kind` wins; zero-token rows default to Free (dashboard auto/free rows).
 */
export function resolveUsageFlowType(event: RawUsageEvent, tokenCount: number): string {
  const kind = event.kind?.trim() ?? '';

  if (hasExplicitFreeKind(kind)) return 'Free';
  if (hasExplicitUsageBasedKind(kind)) return 'Usage-based';
  if (/ABOVE_CAP/i.test(kind)) return 'Above cap';
  if (/BONUS/i.test(kind)) return 'Bonus';
  if (hasExplicitIncludedKind(kind)) return 'Included';

  if (tokenCount <= 0) return 'Free';

  if (!kind) return 'Included';
  return formatUsageEventKind(kind);
}

/** @deprecated Prefer resolveUsageFlowType with tokenCount. */
export function formatUsageEventKind(kind: string | undefined | null): string {
  const normalized = kind?.trim();
  if (!normalized) return 'Included';

  if (/USAGE_EVENT_KIND_FREE/i.test(normalized) || normalized === 'Free') return 'Free';
  if (/\bFREE\b/i.test(normalized) && !/INCLUDED/i.test(normalized)) return 'Free';
  if (/INCLUDED/i.test(normalized)) return 'Included';
  if (/USAGE_BASED/i.test(normalized)) return 'Usage-based';
  if (/ABOVE_CAP/i.test(normalized)) return 'Above cap';
  if (/BONUS/i.test(normalized)) return 'Bonus';

  if (normalized.startsWith('USAGE_EVENT_KIND_')) {
    const tail = normalized.slice('USAGE_EVENT_KIND_'.length);
    if (/FREE/i.test(tail)) return 'Free';
    if (/INCLUDED/i.test(tail)) return 'Included';
    return tail
      .split('_')
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }

  return normalized;
}

/** Tokens column: zero/empty matches dashboard `-`; otherwise 万/亿 formatting. */
export function formatUsageFlowTokens(tokenCount: number): string {
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) return '-';
  return formatIncludedUsageTokens(tokenCount);
}

/** Map to dashboard Cost column (uses resolved Type). */
export function resolveUsageFlowCost(
  event: RawUsageEvent,
  type: string,
  costCents: number | null,
): string {
  if (type === 'Free') return 'Free';
  if (type === 'Included') return 'Included';

  const display = event.costDisplay?.trim();
  if (display) {
    if (/^included$/i.test(display) || display === '-') return 'Included';
    if (/^free$/i.test(display)) return 'Free';
    return display;
  }

  const usageBased = event.usageBasedCosts?.trim();
  if (usageBased) {
    if (/^included$/i.test(usageBased) || usageBased === '-') return 'Included';
    if (/^free$/i.test(usageBased)) return 'Free';
    return usageBased;
  }

  if (costCents === null || costCents === 0) {
    return type === 'Usage-based' ? '$0.00' : 'Included';
  }
  return `$${(costCents / 100).toFixed(2)}`;
}

/** @deprecated Prefer resolveUsageFlowCost with resolved type. */
export function formatUsageEventCost(event: RawUsageEvent, costCents: number | null): string {
  const tokenCount = sumEventTokens(event);
  const type = resolveUsageFlowType(event, tokenCount);
  return resolveUsageFlowCost(event, type, costCents);
}

export function sumEventTokens(event: RawUsageEvent): number {
  const usage = event.tokenUsage;
  if (!usage) return 0;
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  );
}

export function mapUsageFlowEntry(
  event: RawUsageEvent,
  tokenCount: number,
  costCents: number | null,
  formatDate: (iso: string) => string,
): UsageFlowEntry {
  const timestamp = extractUsageEventTimestamp(event) ?? '';
  const type = resolveUsageFlowType(event, tokenCount);

  return {
    timestamp,
    date: timestamp ? formatDate(timestamp) : '--',
    type,
    model: formatUsageEventModelName(event.model),
    modelMax: isMaxModeEvent(event),
    tokens: formatUsageFlowTokens(tokenCount),
    cost: resolveUsageFlowCost(event, type, costCents),
  };
}

/** Parse API timestamp (epoch ms string/number or ISO) to ISO string. */
export function parseUsageEventTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const ms = Number(trimmed);
      if (Number.isFinite(ms)) {
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      }
    }

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

export function extractUsageEventTimestamp(event: RawUsageEvent): string | null {
  const record = event as Record<string, unknown>;
  const candidates = [
    event.timestamp,
    record.createdAt,
    record.eventTime,
    record.occurredAt,
    record.time,
    record.date,
    record.eventTimestamp,
    record.timestampMs,
  ];

  for (const value of candidates) {
    const parsed = parseUsageEventTimestamp(value);
    if (parsed) return parsed;
  }
  return null;
}

/** @deprecated Use formatUsageEventModelName. */
export function formatUsageEventModel(model: string | undefined | null): string {
  return formatUsageEventModelName(model);
}
