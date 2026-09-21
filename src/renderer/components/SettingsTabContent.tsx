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
      <section className="settings-section settings-section--primary">
        <h2>数据刷新</h2>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.autoRefreshEnabled}
            onChange={handleToggleAutoRefresh}
          />
          <span>启用自动刷新</span>
        </label>

        <div className="form-group">
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
          <p className="field-hint">
            允许范围: {REFRESH_INTERVAL_MIN}-{REFRESH_INTERVAL_MAX} 秒；修改后自动保存
          </p>
        </div>
      </section>

      <section className="settings-section">
        <h2>悬浮球</h2>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.edgeAutoDockEnabled}
            onChange={handleToggleEdgeDock}
          />
          <span>贴边缘自动收起</span>
        </label>
        <p className="field-hint">
          拖拽悬浮球贴近屏幕边缘松手后自动收起；向外拖出即可恢复完整显示。
        </p>
      </section>

      <section className="settings-section">
        <h2>外观</h2>
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
        <p className="field-hint">
          自定义图标即时生效于托盘与设置窗口。安装包/任务栏固定图标需重新打包安装后更新。
        </p>
        <p className="field-hint">
          建议使用 <strong>正方形 PNG</strong>，尺寸 <strong>256×256</strong> 以上，位深 32bit。
          非正方形图片将自动居中裁剪为正方形；尺寸过小会在高 DPI 屏幕上显示模糊。
        </p>
      </section>

      <ProjectFeaturesCard />

      {toast && <p className="settings-toast">{toast}</p>}
    </div>
  );
}
