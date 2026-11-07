import { useEffect, useRef, useState, type ReactNode as ReactNodeLike } from 'react';
import {
  REFRESH_INTERVAL_MAX,
  REFRESH_INTERVAL_MIN,
  type AppSettings,
} from '../../shared/types';
import { SettingsRow, SliderInput, Switch, TimeRangeSelect } from './SettingsControls';
import { DayWindowTrack, StylePicker } from './StylePicker';
import { UI_STYLE_LABELS, UI_STYLE_OPTIONS, useSystemPrefersDark } from '../uiStyle';
import type { UiStyleMode } from '../../shared/types';
import {
  describeDayWindow,
  formatMinutes,
  isOvernightWindow,
  parseTimeToMinutes,
  resolveEffectiveUiStyle,
} from '../../shared/uiStyle';
import type { ToastTone } from '../pages/SettingsPage';
function GlassCard({
  children,
  className,
}: {
  children: ReactNodeLike;
  className?: string;
}) {
  const classes = ['set-card', className ?? ''].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}

export { GlassCard };

/** 把刷新间隔说成人话：秒 / 分钟。 */
function humanInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}

/** 数据刷新与统计偏好。由 SettingsPage 挂在「数据刷新」分区下。
 * 顶部先给三块当前节奏的读数，再往下才是开关与间隔；保存逻辑不变。 */
export function DataRefreshPrefs({
  settings,
  onToast,
}: {
  settings: AppSettings;
  onToast: (message: string, tone?: ToastTone) => void;
}) {
  const [intervalInput, setIntervalInput] = useState('30');
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const intervalSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string | null>(null);

  useEffect(() => {
    setIntervalInput(String(settings.refreshIntervalSec));
  }, [settings.refreshIntervalSec]);

  useEffect(() => {
    return () => {
      if (intervalSaveTimer.current) clearTimeout(intervalSaveTimer.current);
    };
  }, []);

  const validateInterval = (value: string): string | null => {
    const num = Number(value);
    if (!Number.isInteger(num)) return '刷新间隔必须是整数';
    if (num < REFRESH_INTERVAL_MIN || num > REFRESH_INTERVAL_MAX) {
      return `刷新间隔必须是 ${REFRESH_INTERVAL_MIN} 的整数倍，且不超过 ${REFRESH_INTERVAL_MAX} 秒`;
    }
    return null;
  };

  const saveInterval = async (value: string) => {
    const err = validateInterval(value);
    if (err) {
      setIntervalError(err);
      return;
    }
    if (lastSavedRef.current === value) return;
    setIntervalError(null);
    try {
      await window.electronAPI.updateSettings({
        refreshIntervalSec: Number(value),
      });
      lastSavedRef.current = value;
      onToast('刷新间隔已保存');
    } catch (e) {
      setIntervalError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleIntervalInput = (value: string) => {
    setIntervalInput(value);
    const err = validateInterval(value);
    setIntervalError(err);
    if (intervalSaveTimer.current) clearTimeout(intervalSaveTimer.current);
    if (!err) {
      intervalSaveTimer.current = setTimeout(() => {
        void saveInterval(value);
      }, 600);
    }
  };

  const commitInterval = (value: string) => {
    if (intervalSaveTimer.current) {
      clearTimeout(intervalSaveTimer.current);
      intervalSaveTimer.current = null;
    }
    void saveInterval(value);
  };

  const intervalSec = Math.max(1, Number(intervalInput) || settings.refreshIntervalSec);
  const requestsPerDay = Math.round(86_400 / intervalSec);

  return (
    <GlassCard>
      <div className="set-card__body">
        <div className="refresh-summary">
          <div className="refresh-summary__tile">
            <span className="refresh-summary__label">刷新节奏</span>
            <span className="refresh-summary__value">每 {humanInterval(intervalSec)}</span>
            <span className="refresh-summary__hint">
              {settings.autoRefreshEnabled ? '后台自动拉取中' : '自动刷新已暂停'}
            </span>
          </div>
          <div className="refresh-summary__tile">
            <span className="refresh-summary__label">每日请求</span>
            <span className="refresh-summary__value">
              {requestsPerDay.toLocaleString('zh-CN')} 次
            </span>
            <span className="refresh-summary__hint">按当前间隔估算</span>
          </div>
          <div className="refresh-summary__tile">
            <span className="refresh-summary__label">数据新鲜度</span>
            <span className="refresh-summary__value">≤ {humanInterval(intervalSec)}</span>
            <span className="refresh-summary__hint">两次拉取之间的最大延迟</span>
          </div>
        </div>
        <SettingsRow
          title="自动刷新"
          description="开启后按下方间隔在后台拉取全部账户数据；关闭仅暂停自动查询，手动「刷新」不受影响"
        >
          <Switch
            checked={settings.autoRefreshEnabled}
            onChange={(next) => {
              void window.electronAPI
                .updateSettings({ autoRefreshEnabled: next })
                .then(() => onToast(next ? '已启用自动刷新' : '已暂停自动刷新'));
            }}
            label="自动刷新"
          />
        </SettingsRow>
        <SettingsRow
          title="刷新间隔"
          description={`当前每 ${Math.max(1, Math.round(settings.refreshIntervalSec / 60))} 分钟同步一次；间隔越短数据越及时，请求也越频繁`}
          htmlFor="refresh-interval"
        >
          <SliderInput
            id="refresh-interval"
            min={REFRESH_INTERVAL_MIN}
            max={REFRESH_INTERVAL_MAX}
            step={30}
            value={Number(intervalInput) || REFRESH_INTERVAL_MIN}
            unit="秒"
            presets={[30, 60, 300, 600, 1800]}
            onInput={(n) => handleIntervalInput(String(n))}
            onCommit={(n) => commitInterval(String(n))}
          />
        </SettingsRow>
        {intervalError && <p className="set-row__error">{intervalError}</p>}
      </div>
    </GlassCard>
  );
}

/** 界面风格：四个档位以带缩略预览的选择卡呈现，自动跟随在上、手动固定在下；
 *  切换即作用于悬浮球与设置窗口；「跟随时间」的时段设置收在卡片底部，
 *  并配一条 24 小时昼夜轨道，一眼看清当前落在哪个时段。 */
export function AppearancePrefs({
  settings,
  onToast,
}: {
  settings: AppSettings;
  onToast: (message: string, tone?: ToastTone) => void;
}) {
  const isAuto = settings.uiStyle === 'auto';
  const isSystem = settings.uiStyle === 'system';
  const startMin = settings.uiStyleDayStartMin;
  const endMin = settings.uiStyleDayEndMin;
  const [draft, setDraft] = useState(() => ({
    start: formatMinutes(startMin),
    end: formatMinutes(endMin),
  }));
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [switchedTo, setSwitchedTo] = useState<UiStyleMode | null>(null);
  const lastMode = useRef(settings.uiStyle);
  const systemDark = useSystemPrefersDark();

  // 切换瞬间给新档位放一次扫光：既确认「已经切过去了」，
  // 也把底色的一次跳变收进这 0.7 秒里，不至于突兀。
  useEffect(() => {
    if (lastMode.current === settings.uiStyle) return;
    lastMode.current = settings.uiStyle;
    setSwitchedTo(settings.uiStyle);
    const timer = window.setTimeout(() => setSwitchedTo(null), 720);
    return () => window.clearTimeout(timer);
  }, [settings.uiStyle]);

  useEffect(() => {
    setDraft({ start: formatMinutes(startMin), end: formatMinutes(endMin) });
  }, [startMin, endMin]);

  // 离开「跟随时间」档时清掉校验错误并把草稿拉回已保存值：
  // 时段行随之隐藏，留着报错会挂在别的档位下面，回来时也不该看到未保存的半截时间
  useEffect(() => {
    if (isAuto) return;
    setError(null);
    setDraft({ start: formatMinutes(startMin), end: formatMinutes(endMin) });
  }, [isAuto, startMin, endMin]);

  // 自动档的状态胶囊要跟着时段边界走：每分钟重算一次「当前生效」
  useEffect(() => {
    if (!isAuto) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [isAuto]);

  const effective = resolveEffectiveUiStyle(settings.uiStyle, startMin, endMin, systemDark, now);
  const current = UI_STYLE_OPTIONS.find((o) => o.value === settings.uiStyle);
  const statusNote = isSystem
    ? systemDark
      ? '系统深色'
      : '系统浅色'
    : isAuto
      ? describeDayWindow(startMin, endMin)
      : settings.uiStyle === 'calm'
        ? '固定浅色'
        : '固定深色';

  const styleToast: Record<UiStyleMode, string> = {
    system: '已改为跟随系统',
    auto: '已按时间自动切换',
    calm: '已切换到清爽纸面',
    aurora: '已切换到极光玻璃',
  };

  const handleRangeChange = (next: { start: string; end: string }) => {
    setDraft(next);
    const start = parseTimeToMinutes(next.start);
    const end = parseTimeToMinutes(next.end);
    if (start === null || end === null) {
      setError(null);
      return;
    }
    if (start === end) {
      setError('起止时间不能相同');
      return;
    }
    setError(null);
    if (start === startMin && end === endMin) return;
    void window.electronAPI
      .updateSettings({ uiStyleDayStartMin: start, uiStyleDayEndMin: end })
      .then(() => onToast('自动切换时段已保存'));
  };

  return (
    <GlassCard>
      <div className="set-card__body set-card__body--stacked style-card">
        <div className="style-card__head">
          <div className="style-card__title-row">
            <span className="set-row__title">界面风格</span>
            <span className="style-card__status" data-effective={effective}>
              <span className="style-card__status-dot" aria-hidden />
              <span className="style-card__status-label">当前生效</span>
              <strong className="style-card__status-value">{UI_STYLE_LABELS[effective]}</strong>
              <span className="style-card__status-sep" aria-hidden />
              <em className="style-card__status-note">{statusNote}</em>
            </span>
          </div>
          <span className="set-row__desc">
            {current ? current.description : '选择界面的配色方案'}
          </span>
        </div>
        <StylePicker
          value={settings.uiStyle}
          switchedTo={switchedTo}
          onChange={(next) => {
            void window.electronAPI
              .updateSettings({ uiStyle: next })
              .then(() => onToast(styleToast[next]));
          }}
        />
        <span className="style-card__note">改动即时生效，悬浮球与设置窗口同步</span>
        {isAuto && (
          <div className="style-schedule">
            <div className="style-schedule__head">
              <span className="style-schedule__icon-frame">
                <svg
                  className="style-schedule__icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <circle cx="8" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M8 5.4v1.5M8 17.1v1.5M1.4 12h1.5M13.1 12h1.5M3.4 7.4l1.1 1.1M11.5 15.5l1.1 1.1M11.5 8.5l1.1-1.1M3.4 16.6l1.1-1.1"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    opacity=".7"
                  />
                  <path
                    d="M20.4 16.2a5.4 5.4 0 1 1-6.6-7.1 4.4 4.4 0 0 0 6.6 7.1z"
                    fill="currentColor"
                    opacity=".9"
                  />
                </svg>
              </span>
              <div className="style-schedule__text">
                <span className="style-schedule__title">自动切换时段</span>
                <span className="style-schedule__hint">
                  时段内用清爽纸面，其余时间用极光玻璃
                </span>
              </div>
              <TimeRangeSelect
                start={draft.start}
                end={draft.end}
                overnight={isOvernightWindow(startMin, endMin)}
                invalid={error !== null}
                onChange={handleRangeChange}
              />
            </div>
            <DayWindowTrack startMin={startMin} endMin={endMin} now={now} />
          </div>
        )}
        {error && <p className="set-row__error">{error}</p>}
      </div>
    </GlassCard>
  );
}

/** 悬浮球行为偏好。 */
export function BallPrefs({
  settings,
  onToast,
}: {
  settings: AppSettings;
  onToast: (message: string, tone?: ToastTone) => void;
}) {
  return (
    <GlassCard>
      <div className="set-card__body">
        <SettingsRow
          title="贴边自动收起"
          description="拖动悬浮球到屏幕边缘松手后，自动收起为贴边细条避免遮挡；将细条拖离边缘即可恢复"
        >
          <Switch
            checked={settings.edgeAutoDockEnabled}
            onChange={(next) => {
              void window.electronAPI
                .updateSettings({ edgeAutoDockEnabled: next })
                .then(() =>
                  onToast(next ? '已启用贴边收起' : '已关闭贴边收起'),
                );
            }}
            label="贴边自动收起"
          />
        </SettingsRow>
      </div>
    </GlassCard>
  );
}

/** 托盘 / 窗口图标偏好：即时选择或恢复默认。 */
export function IconPrefs({
  onToast,
}: {
  onToast: (message: string, tone?: ToastTone) => void;
}) {
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [hasCustom, setHasCustom] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.electronAPI.getIconPreview().then((preview) => {
      if (mounted) setIconPreview(preview);
    });
    void window.electronAPI.getSettings().then((s) => {
      if (mounted) setHasCustom(Boolean(s.customIconPath));
    });
    const unsub = window.electronAPI.onSettingsChanged((s) => {
      if (mounted) setHasCustom(Boolean(s.customIconPath));
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const handleSelect = async () => {
    const result = await window.electronAPI.selectCustomIcon();
    if (result.preview !== undefined) setIconPreview(result.preview);
    if (result.message) onToast(result.message, result.success === false ? 'error' : 'ok');
  };

  const handleClear = async () => {
    const result = await window.electronAPI.clearCustomIcon();
    setIconPreview(result.preview ?? null);
    onToast('已恢复默认图标');
  };

  return (
    <GlassCard>
      <div className="set-card__body">
        <div className="icon-pick">
          <span className="icon-pick__frame">
            {iconPreview ? (
              <img
                src={iconPreview}
                alt="当前自定义图标"
                className="icon-pick__img"
              />
            ) : (
              <span className="icon-pick__empty">默认</span>
            )}
          </span>
          <div className="icon-pick__meta">
            <span className="icon-pick__name">
              {hasCustom ? '已使用自定义图标' : '使用内置默认图标'}
            </span>
            <span className="icon-pick__hint">
              选择 PNG 后立即应用到系统托盘和设置窗口，建议 256×256 正方形；任务栏图标由系统缓存，需重新安装应用后才会更新
            </span>
          </div>
          <div className="icon-pick__actions">
            <button type="button" className="btn-ghost" onClick={() => void handleSelect()}>
              更换图标
            </button>
            <button
              type="button"
              className="btn-ghost btn-ghost--danger"
              onClick={() => void handleClear()}
              disabled={!hasCustom}
            >
              恢复默认
            </button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
