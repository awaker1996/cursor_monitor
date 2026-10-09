import { useEffect, useRef, useState, type ReactNode as ReactNodeLike } from 'react';
import {
  REFRESH_INTERVAL_MAX,
  REFRESH_INTERVAL_MIN,
  type AppSettings,
} from '../../shared/types';
import { SettingsRow, Segmented, SliderInput, Switch } from './SettingsControls';
import { UI_STYLE_OPTIONS } from '../uiStyle';
import type { UiStyle } from '../../shared/types';
import type { ToastTone } from '../pages/SettingsPage';
type CardAccent = 'data' | 'appearance' | 'ball' | 'icon' | 'about';

const ACCENT_CLASS: Record<CardAccent, string> = {
  data: 'set-card--accent-data',
  appearance: 'set-card--accent-appearance',
  ball: 'set-card--accent-ball',
  icon: 'set-card--accent-icon',
  about: 'set-card--accent-about',
};

function GlassCard({
  accent,
  children,
  className,
}: {
  accent?: CardAccent;
  children: ReactNodeLike;
  className?: string;
}) {
  const classes = ['set-card', accent ? ACCENT_CLASS[accent] : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <div className={classes}>{children}</div>;
}

export { GlassCard };
export type { CardAccent };

/** 数据刷新与统计偏好。由 SettingsPage 挂在「数据刷新」分区下。
 * 保存逻辑与原实现一致：滑杆/输入 600ms 防抖后写盘。 */
export function DataRefreshPrefs({
  settings,
  onToast,
  accent,
}: {
  settings: AppSettings;
  onToast: (message: string, tone?: ToastTone) => void;
  accent?: CardAccent;
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

  return (
    <GlassCard accent={accent}>
      <div className="set-card__body">
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
        <SettingsRow
          title="计入 Grok Bot 用量"
          description="开启后 grok-bot-* 模型的调用计入今日用量百分比与模型明细；账户订阅的官方周期占比始终不受影响"
        >
          <Switch
            checked={settings.includeGrokBotUsage}
            onChange={(next) => {
              void window.electronAPI
                .updateSettings({ includeGrokBotUsage: next })
                .then(() =>
                  onToast(next ? '已计入 Grok Bot 用量' : '已剔除 Grok Bot 用量'),
                );
            }}
            label="计入 Grok Bot 用量"
          />
        </SettingsRow>
      </div>
    </GlassCard>
  );
}

/** 界面风格切换：同时作用于悬浮球与设置窗口，改动即时生效。 */
export function AppearancePrefs({
  settings,
  onToast,
  accent,
}: {
  settings: AppSettings;
  onToast: (message: string, tone?: ToastTone) => void;
  accent?: CardAccent;
}) {
  const current = UI_STYLE_OPTIONS.find((o) => o.value === settings.uiStyle);
  return (
    <GlassCard accent={accent}>
      <div className="set-card__body">
        <SettingsRow
          title="界面风格"
          description={
            current
              ? `当前：${current.label} —— ${current.description}。切换同时作用于悬浮球与设置窗口`
              : '切换同时作用于悬浮球与设置窗口'
          }
        >
          <Segmented<UiStyle>
            value={settings.uiStyle}
            options={UI_STYLE_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onChange={(next) => {
              void window.electronAPI
                .updateSettings({ uiStyle: next })
                .then(() => onToast(next === 'calm' ? '已切换到清爽纸面' : '已切换到极光玻璃'));
            }}
            ariaLabel="界面风格"
          />
        </SettingsRow>
      </div>
    </GlassCard>
  );
}

/** 悬浮球行为偏好。 */
export function BallPrefs({
  settings,
  onToast,
  accent,
}: {
  settings: AppSettings;
  onToast: (message: string, tone?: ToastTone) => void;
  accent?: CardAccent;
}) {
  return (
    <GlassCard accent={accent}>
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
  accent,
}: {
  onToast: (message: string, tone?: ToastTone) => void;
  accent?: CardAccent;
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
    <GlassCard accent={accent}>
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
