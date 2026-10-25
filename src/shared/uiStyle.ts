import type { EffectiveUiStyle, UiStyleMode } from './types';

/** 一天内的分钟数。 */
export const MINUTES_PER_DAY = 1440;

/** 默认白天时段：07:00 – 19:00。 */
export const DEFAULT_DAY_START_MIN = 420;
export const DEFAULT_DAY_END_MIN = 1140;

/** "HH:mm" → 分钟数；非法输入返回 null。 */
export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 分钟数 → "HH:mm"。 */
export function formatMinutes(minutes: number): string {
  const clamped = Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 脏值兜底：非有限数或越界一律回落到 fallback。 */
export function normalizeDayMinutes(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > MINUTES_PER_DAY - 1) return fallback;
  return rounded;
}

/** 白天时段是否跨零点（起点大于终点）。 */
export function isOvernightWindow(startMin: number, endMin: number): boolean {
  return startMin > endMin;
}

/** 当前是否处于白天时段：左闭右开 [start, end)；
 *  跨零点时为 [start, 24:00) ∪ [00:00, end)；起止相同视为空窗口（全天按夜间处理）。 */
export function isDayTime(now: Date, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  if (startMin < endMin) return current >= startMin && current < endMin;
  return current >= startMin || current < endMin;
}

/** 解析实际生效的风格：手动档原样返回，system 档按系统深浅色，auto 档按当前时间在纸面 / 玻璃之间选。
 *  systemPrefersDark 由调用方给出（主进程取 nativeTheme，渲染层取 prefers-color-scheme），
 *  纯函数本身不碰环境，便于回归脚本覆盖四种档位。 */
export function resolveEffectiveUiStyle(
  mode: UiStyleMode,
  startMin: number,
  endMin: number,
  systemPrefersDark: boolean,
  now: Date = new Date(),
): EffectiveUiStyle {
  if (mode === 'system') return systemPrefersDark ? 'aurora' : 'calm';
  if (mode !== 'auto') return mode === 'calm' ? 'calm' : 'aurora';
  return isDayTime(now, startMin, endMin) ? 'calm' : 'aurora';
}

/** 窗口底色：跟随生效风格，避免加载与拉伸时闪色。 */
export function uiStyleBackgroundColor(style: EffectiveUiStyle): string {
  return style === 'calm' ? '#f2f4f8' : '#0b1026';
}

/** 白天时段的文字描述，跨零点时标注「次日」。 */
export function describeDayWindow(startMin: number, endMin: number): string {
  const start = formatMinutes(startMin);
  const end = formatMinutes(endMin);
  return isOvernightWindow(startMin, endMin) ? `${start}–次日 ${end}` : `${start}–${end}`;
}
