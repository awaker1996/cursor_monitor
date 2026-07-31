/** Conventional page-size options for usage flow table. */
export const USAGE_FLOW_PAGE_SIZES = [10, 20, 50, 100] as const;

export type UsageFlowPageSize = (typeof USAGE_FLOW_PAGE_SIZES)[number];

export const DEFAULT_USAGE_FLOW_PAGE_SIZE: UsageFlowPageSize = 20;

export function normalizeUsageFlowPageSize(value: number | undefined): UsageFlowPageSize {
  const n = Number.isFinite(value) ? Math.floor(value!) : DEFAULT_USAGE_FLOW_PAGE_SIZE;
  if ((USAGE_FLOW_PAGE_SIZES as readonly number[]).includes(n)) {
    return n as UsageFlowPageSize;
  }
  return DEFAULT_USAGE_FLOW_PAGE_SIZE;
}
