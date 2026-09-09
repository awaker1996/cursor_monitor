import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorHint from '../components/ErrorHint';
import TestConnectionResultPanel from '../components/TestConnectionResultPanel';
import {
  REFRESH_INTERVAL_MAX,
  REFRESH_INTERVAL_MIN,
  type AppSettings,
  type TestConnectionResult,
} from '../../shared/types';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [cookie, setCookie] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [intervalInput, setIntervalInput] = useState('30');
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
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
    window.electronAPI.hasCookie().then(setHasCookie);
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

  const handleSaveCookie = async () => {
    if (!cookie.trim()) {
      showToast('Cookie 不能为空');
      return;
    }
    try {
      await window.electronAPI.saveCookie(cookie.trim());
      setHasCookie(true);
      setCookie('');
      showToast('Cookie 已安全保存');
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearCookie = async () => {
    await window.electronAPI.clearCookie();
    setHasCookie(false);
    showToast('凭据已清除');
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

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await window.electronAPI.testConnection();
    setTestResult(result);
    setTesting(false);
  };

  if (!settings) {
    return (
      <div className="settings-page">
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h1>设置</h1>
      <p className="settings-subtitle">配置凭据、刷新与悬浮球行为</p>

      {!hasCookie && (
        <ErrorHint
          message="尚未配置 Cookie"
          action="配置 Cookie 后可使用 Cookie 回退方案获取 token 余量与用量流水"
        />
      )}

      <section className="settings-section settings-section--primary">
        <h2>凭据与连接</h2>
        <div
          className={`settings-section__status ${hasCookie ? 'settings-section__status--ok' : 'settings-section__status--warn'}`}
        >
          {hasCookie ? '✓ 已配置 Cookie' : '未配置 Cookie'}
        </div>
        <p className="field-hint">
          打开 cursor.com/dashboard/usage 后，从浏览器开发者工具复制 WorkosCursorSessionToken
          的值。也可以粘贴包含该字段的完整 Cookie 字符串。
        </p>
        <div className="form-group">
          <label htmlFor="cookie">WorkosCursorSessionToken</label>
          <textarea
            id="cookie"
            rows={4}
            placeholder="粘贴 WorkosCursorSessionToken 值或完整 Cookie..."
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
          />
        </div>
        <div className="btn-row">
          <button className="btn-primary" onClick={handleSaveCookie}>
            保存 Cookie
          </button>
          <button className="btn-secondary" onClick={handleClearCookie} disabled={!hasCookie}>
            清除凭据
          </button>
          <button className="btn-secondary" onClick={handleTestConnection} disabled={testing}>
            {testing ? '测试中...' : '测试连接'}
          </button>
        </div>
        {testResult && <TestConnectionResultPanel result={testResult} />}
      </section>

      <section className="settings-section">
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

      {toast && <p className="settings-toast">{toast}</p>}
    </div>
  );
}
