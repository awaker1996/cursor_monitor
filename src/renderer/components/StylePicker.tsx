import { useRef, type KeyboardEvent } from 'react';
import type { UiStyleMode } from '../../shared/types';
import { UI_STYLE_OPTIONS } from '../uiStyle';

/** 四个档位按语义分两行：先「自动跟随」（省心），再「手动固定」（明确）。
 *  分组标题右侧补一句短语，说明这一组档位的共性，选之前不用逐个试。 */
const STYLE_GROUPS: Array<{ id: 'auto' | 'manual'; label: string; hint: string }> = [
  { id: 'auto', label: '自动跟随', hint: '由系统或时间决定' },
  { id: 'manual', label: '手动固定', hint: '选定后保持不变' },
];

/** 每个档位的缩略预览：用 CSS 画一扇迷你窗口（标题条 + 侧栏 + 内容线），
 *  比真实截图更轻、更可控，深浅两套主题下都不会有色差。 */
function StyleMock({ mode }: { mode: UiStyleMode }) {
  return (
    <span className="style-mock" data-mock={mode} aria-hidden="true">
      <span className="style-mock__bar">
        <span className="style-mock__dot" />
        <span className="style-mock__dot" />
        <span className="style-mock__dot" />
      </span>
      <span className="style-mock__body">
        <span className="style-mock__side" />
        <span className="style-mock__main">
          <span className="style-mock__line style-mock__line--accent" />
          <span className="style-mock__line" />
          <span className="style-mock__line style-mock__line--short" />
        </span>
      </span>
    </span>
  );
}

/** 界面风格选择器：两行两列的预览卡。
 *  卡片本身就是单选钮（role=radio），选中态用描边高亮 + 右侧对勾；
 *  方向键 / Home / End 在四项间移动并即时切换，符合原生单选组的手感。 */
export function StylePicker({
  value,
  switchedTo,
  onChange,
}: {
  value: UiStyleMode;
  /** 刚刚切换到的档位：用于让新选中卡播一次扫光，确认「已生效」。 */
  switchedTo?: UiStyleMode | null;
  onChange: (next: UiStyleMode) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const lastIndex = UI_STYLE_OPTIONS.length - 1;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = index === lastIndex ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = index === 0 ? lastIndex : index - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = lastIndex;
    } else {
      return;
    }
    event.preventDefault();
    buttons.current[next]?.focus();
    const option = UI_STYLE_OPTIONS[next];
    if (option && option.value !== value) onChange(option.value);
  };

  return (
    <div className="style-picker" role="radiogroup" aria-label="界面风格">
      {STYLE_GROUPS.map((group) => (
        <div className="style-picker__group" key={group.id}>
          <div className="style-picker__group-head">
            <span className="style-picker__group-label">{group.label}</span>
            <span className="style-picker__group-hint">{group.hint}</span>
            <span className="style-picker__rule" aria-hidden="true" />
          </div>
          <div className="style-picker__row">
            {UI_STYLE_OPTIONS.map((option, index) => {
              if (option.group !== group.id) return null;
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className="style-opt"
                  data-active={active ? 'true' : 'false'}
                  data-switching={switchedTo === option.value ? 'true' : undefined}
                  tabIndex={active ? 0 : -1}
                  ref={(node) => {
                    buttons.current[index] = node;
                  }}
                  onClick={() => onChange(option.value)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <span className="style-opt__preview">
                    <StyleMock mode={option.value} />
                  </span>
                  <span className="style-opt__meta">
                    <span className="style-opt__text">
                      <span className="style-opt__label">{option.label}</span>
                      <span className="style-opt__hint">{option.hint}</span>
                    </span>
                    <span className="style-opt__tick" aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const MINUTES_PER_DAY = 1440;

const percentOf = (minutes: number): number =>
  (Math.min(Math.max(minutes, 0), MINUTES_PER_DAY) / MINUTES_PER_DAY) * 100;

/** 24 小时时间轴：把「自动切换时段」画成一条昼夜轨道 ——
 *  白天段高亮、当前时刻一枚发光刻度，看不出具体时段也能一眼判断现在处在哪一档。
 *  起止相同表示空窗口（全天按夜间处理），此时不画白天段。 */
export function DayWindowTrack({
  startMin,
  endMin,
  now,
}: {
  startMin: number;
  endMin: number;
  now: Date;
}) {
  const segments =
    startMin === endMin
      ? []
      : startMin < endMin
        ? [{ left: percentOf(startMin), width: percentOf(endMin) - percentOf(startMin) }]
        : [
            { left: 0, width: percentOf(endMin) },
            { left: percentOf(startMin), width: 100 - percentOf(startMin) },
          ];
  const nowPercent = percentOf(now.getHours() * 60 + now.getMinutes());

  return (
    <div className="day-track" aria-hidden="true">
      <div className="day-track__bar">
        {segments.map((segment) => (
          <span
            key={segment.left}
            className="day-track__day"
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
          />
        ))}
        <span className="day-track__now" style={{ left: `${nowPercent}%` }} />
      </div>
      <div className="day-track__axis">
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
