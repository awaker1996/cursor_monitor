import { useCallback, useEffect, useState } from 'react';
import ErrorHint from '../components/ErrorHint';
import {
  REFRESH_INTERVAL_MAX,
  REFRESH_INTERVAL_MIN,
  type AppSettings,
} from '../../shared/types';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [cookie, setCookie] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [intervalInput, setIntervalInput] = useState('30');
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(
    null,
  );
  const [testing, setTesting] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconMessage, setIconMessage] = useState<string | null>(null);

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

  const validateInterval = useCallback((value: string): string | null => {
    const num = Number(value);
    if (!Number.isInteger(num)) return '刷新间隔必须是整数';
    if (num < REFRESH_INTERVAL_MIN || num > REFRESH_INTERVAL_MAX) {
      return `刷新间隔必须在 ${REFRESH_INTERVAL_MIN}-${REFRESH_INTERVAL_MAX} 秒之间`;
    }
    return null;
  }, []);

  const handleIntervalChange = (value: string) => {
    setIntervalInput(value);
    setIntervalError(validateInterval(value));
  };

  const handleSaveSettings = async () => {
    const err = validateInterval(intervalInput);
    if (err) {
      setIntervalError(err);
      return;
    }

    try {
      const updated = await window.electronAPI.updateSettings({
        refreshIntervalSec: Number(intervalInput),
        autoRefreshEnabled: settings?.autoRefreshEnabled ?? true,
      });
      setSettings(updated);
      setSaveMessage('设置已保存并立即生效');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (e) {
      setIntervalError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleToggleAutoRefresh = async () => {
    if (!settings) return;
    const updated = await window.electronAPI.updateSettings({
      autoRefreshEnabled: !settings.autoRefreshEnabled,
    });
    setSettings(updated);
  };

  const handleSaveCookie = async () => {
    if (!cookie.trim()) {
      setSaveMessage('Cookie 不能为空');
      return;
    }
    try {
      await window.electronAPI.saveCookie(cookie.trim());
      setHasCookie(true);
      setCookie('');
      setSaveMessage('Cookie 已安全保存');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearCookie = async () => {
    await window.electronAPI.clearCookie();
    setHasCookie(false);
    setSaveMessage('凭据已清除');
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleToggleEdgeDock = async () => {
    if (!settings) return;
    const updated = await window.electronAPI.updateSettings({
      edgeAutoDockEnabled: !settings.edgeAutoDockEnabled,
    });
    setSettings(updated);
  };

  const handleSelectIcon = async () => {
    const result = await window.electronAPI.selectCustomIcon();
    if (result.preview) setIconPreview(result.preview);
    if (result.message) {
      setIconMessage(result.message);
      setTimeout(() => setIconMessage(null), 3000);
    }
  };

  const handleClearIcon = async () => {
    const result = await window.electronAPI.clearCustomIcon();
    setIconPreview(result.preview ?? null);
    setIconMessage('已恢复默认图标');
    setTimeout(() => setIconMessage(null), 3000);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await window.electronAPI.testConnection();
    setTestResult(result);
    setTesting(false);
  };

  if (!settings) {
    return <div className="settings-page"><p>加载中...</p></div>;
  }

  return (
    <div className="settings-page">
      <h1>Cursor Token Monitor</h1>
      <p className="settings-subtitle">设置</p>

      <section className="settings-section">
        <h2>自动刷新</h2>
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
          />
          {intervalError && <p className="field-error">{intervalError}</p>}
          <p className="field-hint">
            允许范围: {REFRESH_INTERVAL_MIN}-{REFRESH_INTERVAL_MAX} 秒，当前默认 30 秒
          </p>
        </div>

        <button
          className="btn-primary"
          onClick={handleSaveSettings}
          disabled={!!intervalError}
        >
          保存刷新设置
        </button>
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
        <h2>应用图标</h2>
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
        {iconMessage && <p className="field-success">{iconMessage}</p>}
      </section>

      <section className="settings-section">
        <h2>Cookie 配置</h2>
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
        </div>
        {hasCookie && <p className="field-success">✓ 已配置 Cookie</p>}
      </section>

      <section className="settings-section">
        <h2>连接测试</h2>
        <button className="btn-primary" onClick={handleTestConnection} disabled={testing}>
          {testing ? '测试中...' : '测试连接'}
        </button>
        {testResult && (
          <div className={`test-result test-result--${testResult.success ? 'ok' : 'fail'}`}>
            {testResult.message}
          </div>
        )}
      </section>

      {saveMessage && <p className="save-message">{saveMessage}</p>}

      {!hasCookie && (
        <ErrorHint
          message="尚未配置 Cookie"
          action="配置 Cookie 后可使用 Cookie 回退方案获取 token 余量"
        />
      )}
    </div>
  );
}
