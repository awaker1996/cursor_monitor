import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REFRESH_INTERVAL_MAX,
  REFRESH_INTERVAL_MIN,
  type AppSettings,
} from '../../shared/types';
import ProjectFeaturesCard from './ProjectFeaturesCard';

export default function SettingsTabContent() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [intervalInput, setIntervalInput] = useState('30');
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const intervalSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    window.electronAPI.getSettings().then((s) => {
      setSettings(s);
      setIntervalInput(String(s.refreshIntervalSec));
    });
    window.electronAPI.getIconPreview().then(setIconPreview);

    const unsub = window.electronAPI.onSettingsChanged((s) => {
      setSettings(s);
      setIntervalInput(String(s.refreshIntervalSec));
    });
    return unsub;
  }, []);

  useEffect(() => {
    return () => {
      if (intervalSaveTimer.current) clearTimeout(intervalSaveTimer.current);
    };
  }, []);

  const validateInterval = useCallback((value: string): string | null => {
    const num = Number(value);
    if (!Number.isInteger(num)) return '刷新间隔必须是整数';
    if (num < REFRESH_INTERVAL_MIN || num > REFRESH_INTERVAL_MAX) {
      return `刷新间隔必须在 ${REFRESH_INTERVAL_MIN}-${REFRESH_INTERVAL_MAX} 秒之间`;
    }
    return null;
  }, []);

  const saveInterval = useCallback(
    async (value: string) => {
      const err = validateInterval(value);
      if (err) {
        setIntervalError(err);
        return;
      }
      setIntervalError(null);
      try {
        const updated = await window.electronAPI.updateSettings({
          refreshIntervalSec: Number(value),
        });
        setSettings(updated);
        showToast('刷新间隔已保存');
      } catch (e) {
        setIntervalError(e instanceof Error ? e.message : String(e));
      }
    },
    [showToast, validateInterval],
  );

  const handleIntervalChange = (value: string) => {
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

  const handleIntervalBlur = () => {
    if (intervalSaveTimer.current) {
      clearTimeout(intervalSaveTimer.current);
      intervalSaveTimer.current = null;
    }
    if (!intervalError) {
      void saveInterval(intervalInput);
    }
  };

  const handleToggleAutoRefresh = async () => {
    if (!settings) return;
    const updated = await window.electronAPI.updateSettings({
      autoRefreshEnabled: !settings.autoRefreshEnabled,
    });
    setSettings(updated);
    showToast(updated.autoRefreshEnabled ? '已启用自动刷新' : '已暂停自动刷新');
  };

  const handleToggleIncludeGrokBot = async () => {
    if (!settings) return;
    const updated = await window.electronAPI.updateSettings({
      includeGrokBotUsage: !settings.includeGrokBotUsage,
    });
    setSettings(updated);
    showToast(
      updated.includeGrokBotUsage
        ? '已计入 Grok Bot 用量'
        : '已剔除 Grok Bot 用量',
    );
  };

  const handleToggleEdgeDock = async () => {
    if (!settings) return;
    const updated = await window.electronAPI.updateSettings({
      edgeAutoDockEnabled: !settings.edgeAutoDockEnabled,
    });
    setSettings(updated);
    showToast(updated.edgeAutoDockEnabled ? '已启用贴边收起' : '已关闭贴边收起');
  };

  const handleSelectIcon = async () => {
    const result = await window.electronAPI.selectCustomIcon();
    if (result.preview) setIconPreview(result.preview);
    if (result.message) showToast(result.message);
  };

  const handleClearIcon = async () => {
    const result = await window.electronAPI.clearCustomIcon();
    setIconPreview(result.preview ?? null);
    showToast('已恢复默认图标');
  };

  if (!settings) {
    return (
      <div className="page-shell page-shell--settings">
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="page-shell page-shell--settings">
      <section className="settings-section settings-section--primary settings-section--tile">
        <h2>数据刷新</h2>
        <div className="settings-section__body">
          <div className="settings-toggles">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.autoRefreshEnabled}
                onChange={handleToggleAutoRefresh}
              />
              <span>启用自动刷新</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.includeGrokBotUsage}
                onChange={handleToggleIncludeGrokBot}
              />
              <span>计入 Grok Bot 用量</span>
            </label>
          </div>
          <div className="form-group form-group--flush">
            <label htmlFor="interval">刷新间隔（秒）</label>
            <input
              id="interval"
              type="number"
              min={REFRESH_INTERVAL_MIN}
              max={REFRESH_INTERVAL_MAX}
              value={intervalInput}
              onChange={(e) => handleIntervalChange(e.target.value)}
              onBlur={handleIntervalBlur}
            />
            {intervalError && <p className="field-error">{intervalError}</p>}
          </div>
        </div>
        <p className="settings-section__footnote field-hint">
          按间隔拉取用量；关闭 Grok Bot 时今日统计与流水不含 Bot 调用，周期账单占比仍以官方为准。
        </p>
      </section>

      <section className="settings-section settings-section--tile">
        <h2>悬浮球</h2>
        <div className="settings-section__body">
          <label className="toggle-row toggle-row--solo">
            <input
              type="checkbox"
              checked={settings.edgeAutoDockEnabled}
              onChange={handleToggleEdgeDock}
            />
            <span>贴边缘自动收起</span>
          </label>
        </div>
        <p className="settings-section__footnote field-hint">
          拖至屏幕边缘松手后收起为细条，向外拖出即可恢复完整显示。
        </p>
      </section>

      <section className="settings-section settings-section--tile">
        <h2>外观</h2>
        <div className="settings-section__body">
          <div className="icon-picker">
            <div className="icon-picker__preview">
              {iconPreview ? (
                <img src={iconPreview} alt="当前图标" className="icon-picker__image" />
              ) : (
                <div className="icon-picker__placeholder">无图标</div>
              )}
            </div>
            <div className="icon-picker__actions">
              <button type="button" className="btn-secondary" onClick={handleSelectIcon}>
                选择图标
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleClearIcon}
                disabled={!settings.customIconPath}
              >
                恢复默认
              </button>
            </div>
          </div>
        </div>
        <p className="settings-section__footnote field-hint">
          即时更新托盘与设置窗口图标；建议 256×256 正方形 PNG。任务栏图标需重新安装后生效。
        </p>
      </section>

      <ProjectFeaturesCard />

      {toast && <p className="settings-toast">{toast}</p>}
    </div>
  );
}
