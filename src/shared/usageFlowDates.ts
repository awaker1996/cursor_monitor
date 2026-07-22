export type UsageFlowPreset = '1d' | '7d' | '30d' | 'mtd' | 'lastMonth' | 'custom';

export interface UsageFlowDateRange {
  startDateMs: number;
  endDateMs: number;
  label: string;
}

const SHANGHAI_TZ = 'Asia/Shanghai';

function shanghaiYmd(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = formatter.format(date).split('-').map(Number);
  return { year, month, day };
}

/** Midnight at the given calendar day in Asia/Shanghai, as epoch ms. */
export function shanghaiDayStartMs(year: number, month: number, day: number): number {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000+08:00`;
  return new Date(iso).getTime();
}

/** End of calendar day 23:59:59.999 in Asia/Shanghai. */
export function shanghaiDayEndMs(year: number, month: number, day: number): number {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59.999+08:00`;
  return new Date(iso).getTime();
}

function addDays(y: number, m: number, d: number, delta: number): { year: number; month: number; day: number } {
  const base = shanghaiDayStartMs(y, m, d);
  const next = new Date(base + delta * 24 * 60 * 60 * 1000);
  return shanghaiYmd(next);
}

const rangeLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SHANGHAI_TZ,
  month: 'short',
  day: 'numeric',
});

function formatRangeLabel(startMs: number, endMs: number): string {
  const start = rangeLabelFormatter.format(new Date(startMs));
  const end = rangeLabelFormatter.format(new Date(endMs));
  return `${start} - ${end}`;
}

export function resolveUsageFlowPreset(preset: UsageFlowPreset): UsageFlowDateRange {
  const now = Date.now();
  const today = shanghaiYmd(new Date());

  switch (preset) {
    case '1d':
      return {
        startDateMs: shanghaiDayStartMs(today.year, today.month, today.day),
        endDateMs: now,
        label: formatRangeLabel(shanghaiDayStartMs(today.year, today.month, today.day), now),
      };
    case '7d': {
      const startDay = addDays(today.year, today.month, today.day, -6);
      const startMs = shanghaiDayStartMs(startDay.year, startDay.month, startDay.day);
      return { startDateMs: startMs, endDateMs: now, label: formatRangeLabel(startMs, now) };
    }
    case '30d': {
      const startDay = addDays(today.year, today.month, today.day, -29);
      const startMs = shanghaiDayStartMs(startDay.year, startDay.month, startDay.day);
      return { startDateMs: startMs, endDateMs: now, label: formatRangeLabel(startMs, now) };
    }
    case 'mtd': {
      const startMs = shanghaiDayStartMs(today.year, today.month, 1);
      return { startDateMs: startMs, endDateMs: now, label: formatRangeLabel(startMs, now) };
    }
    case 'lastMonth': {
      const prevMonth = today.month === 1 ? 12 : today.month - 1;
      const prevYear = today.month === 1 ? today.year - 1 : today.year;
      const lastDay = new Date(prevYear, prevMonth, 0).getDate();
      const startMs = shanghaiDayStartMs(prevYear, prevMonth, 1);
      const endMs = shanghaiDayEndMs(prevYear, prevMonth, lastDay);
      return { startDateMs: startMs, endDateMs: endMs, label: formatRangeLabel(startMs, endMs) };
    }
    default:
      return resolveUsageFlowPreset('1d');
  }
}

export function resolveCustomUsageFlowRange(startYmd: string, endYmd: string): UsageFlowDateRange | null {
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startYmd);
  const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endYmd);
  if (!startMatch || !endMatch) return null;

  const startMs = shanghaiDayStartMs(Number(startMatch[1]), Number(startMatch[2]), Number(startMatch[3]));
  const endMs = shanghaiDayEndMs(Number(endMatch[1]), Number(endMatch[2]), Number(endMatch[3]));
  if (startMs > endMs) return null;

  return {
    startDateMs: startMs,
    endDateMs: Math.min(endMs, Date.now()),
    label: formatRangeLabel(startMs, endMs),
  };
}

export function ymdFromMs(ms: number): string {
  const { year, month, day } = shanghaiYmd(new Date(ms));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const USAGE_FLOW_PRESETS: { id: UsageFlowPreset; label: string }[] = [
  { id: '1d', label: '1d' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'mtd', label: 'MTD' },
  { id: 'lastMonth', label: 'Last month' },
];
