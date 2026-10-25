import { Fragment, type CSSProperties, type ReactNode } from 'react';

/** 一行「标题 + 描述 + 控件」的设置行，hover 时整行高亮。 */
export function SettingsRow({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div className="set-row">
      <Label className="set-row__text" htmlFor={htmlFor}>
        <span className="set-row__title">{title}</span>
        {description && <span className="set-row__desc">{description}</span>}
      </Label>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

/** 自绘开关：替代原生 checkbox，带弹性动画。 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' is-on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" />
    </button>
  );
}

/** 分段控件：在少量互斥选项间切换。
 *  group 变化处画一道细分隔线（把自动跟随与手动固定分开）；
 *  wide 让控件撑满整行、各段等宽，用于界面风格这类主操作。 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  wide,
}: {
  value: T;
  options: Array<{ value: T; label: string; group?: string }>;
  onChange: (next: T) => void;
  ariaLabel: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`segmented${wide ? ' segmented--wide' : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((opt, index) => {
        const isActive = opt.value === value;
        const startsGroup = index > 0 && opt.group !== options[index - 1].group;
        return (
          <Fragment key={String(opt.value)}>
            {startsGroup && <span className="segmented__divider" aria-hidden />}
            <button
              type="button"
              role="radio"
              aria-checked={isActive}
              className={`segmented__item${isActive ? ' is-active' : ''}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** 时段选择的小时项：00–23。 */
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
/** 分钟步长：选项按 5 分钟一档，已存的非整 5 分钟值会单独保留一项。 */
const MINUTE_STEP = 5;

const pad2 = (n: number): string => String(n).padStart(2, '0');

function splitTime(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map((part) => Number(part));
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  };
}

/** 分钟候选项：5 分钟一档 + 当前值（避免已存的 07:03 被下拉框悄悄改掉）。 */
function minuteOptions(current: number): number[] {
  const list: number[] = [];
  for (let minute = 0; minute < 60; minute += MINUTE_STEP) list.push(minute);
  if (!list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

/** 时段选择：两个「时 : 分」原生下拉，取代原来的 time 输入（免去系统时钟弹窗），
 *  跨零点时给出提示徽标。 */
export function TimeRangeSelect({
  start,
  end,
  overnight,
  invalid,
  onChange,
}: {
  start: string;
  end: string;
  overnight: boolean;
  invalid?: boolean;
  onChange: (next: { start: string; end: string }) => void;
}) {
  const startParts = splitTime(start);
  const endParts = splitTime(end);

  const renderPickers = (
    parts: { hour: number; minute: number },
    label: string,
    commit: (next: { hour: number; minute: number }) => void,
  ) => (
    <span className="time-select__pill">
      <select
        className="time-select__part"
        aria-label={`${label}小时`}
        value={parts.hour}
        onChange={(e) => commit({ ...parts, hour: Number(e.target.value) })}
      >
        {HOUR_OPTIONS.map((hour) => (
          <option key={hour} value={hour}>
            {pad2(hour)}
          </option>
        ))}
      </select>
      <span className="time-select__colon" aria-hidden>
        :
      </span>
      <select
        className="time-select__part"
        aria-label={`${label}分钟`}
        value={parts.minute}
        onChange={(e) => commit({ ...parts, minute: Number(e.target.value) })}
      >
        {minuteOptions(parts.minute).map((minute) => (
          <option key={minute} value={minute}>
            {pad2(minute)}
          </option>
        ))}
      </select>
    </span>
  );

  return (
    <div className={`time-select${invalid ? ' is-invalid' : ''}`}>
      <label className="time-select__field">
        <span className="time-select__caption">从</span>
        {renderPickers(startParts, '开始时间', ({ hour, minute }) =>
          onChange({ start: `${pad2(hour)}:${pad2(minute)}`, end }),
        )}
      </label>
      <span className="time-select__arrow" aria-hidden>
        →
      </span>
      <label className="time-select__field">
        <span className="time-select__caption">到</span>
        {renderPickers(endParts, '结束时间', ({ hour, minute }) =>
          onChange({ start, end: `${pad2(hour)}:${pad2(minute)}` }),
        )}
      </label>
      {overnight && <span className="time-select__badge">跨零点</span>}
    </div>
  );
}

/** 数值滑杆 + 步进按钮 + 快捷档位，键盘/点击均可精确调整。 */
export function SliderInput({
  id,
  min,
  max,
  step = 1,
  value,
  unit,
  presets,
  onCommit,
  onInput,
}: {
  id: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
  /** 快捷档位，如 [30, 60, 300, 600]；点击直接跳到该值。 */
  presets?: number[];
  onCommit: (next: number) => void;
  onInput: (next: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const percent = ((value - min) / (max - min)) * 100;
  const stepBy = (delta: number) => {
    const next = clamp(value + delta);
    if (next !== value) {
      onInput(next);
      onCommit(next);
    }
  };
  return (
    <div className="slider-input">
      <div className="slider-input__stepper">
        <button
          type="button"
          className="slider-input__step"
          aria-label="减少"
          disabled={value <= min}
          onClick={() => stepBy(-step)}
        >
          −
        </button>
        <input
          id={id}
          type="range"
          className="slider-input__range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ '--slider-fill': `${percent}%` } as CSSProperties}
          onChange={(e) => onInput(Number(e.target.value))}
          onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
              onCommit(Number((e.target as HTMLInputElement).value));
            }
          }}
          onBlur={(e) => onCommit(Number(e.target.value))}
        />
        <button
          type="button"
          className="slider-input__step"
          aria-label="增加"
          disabled={value >= max}
          onClick={() => stepBy(step)}
        >
          +
        </button>
      </div>
      <span className="slider-input__value">
        {value}
        {unit && <em>{unit}</em>}
      </span>
      {presets && presets.length > 0 && (
        <div className="slider-input__presets" role="group" aria-label="快捷档位">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className={`slider-input__preset${p === value ? ' is-active' : ''}`}
              aria-pressed={p === value}
              onClick={() => {
                onInput(p);
                onCommit(p);
              }}
            >
              {p >= 60 ? `${p / 60} 分` : `${p} 秒`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
