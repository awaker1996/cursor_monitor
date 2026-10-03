import type { CSSProperties, ReactNode } from 'react';

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

/** 分段控件：在少量互斥选项间切换（预留，当前设置项均为开关/滑杆）。 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={`segmented__item${isActive ? ' is-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
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
