import { useEffect, useState } from 'react';

/**
 * 设置窗口的自绘标题栏（frameless 窗口）。
 * 整条可拖动窗口；右侧三个窗口控制按钮走 IPC。
 */
export default function SettingsTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.electronAPI.settingsWindowIsMaximized().then((v) => {
      if (mounted) setMaximized(v);
    });
    const unsub = window.electronAPI.onSettingsWindowMaximized((v) => {
      if (mounted) setMaximized(v);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return (
    <div className="titlebar" role="titlebar">
      <div className="titlebar__lead">
        <span className="titlebar__logo" aria-hidden>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2.4" />
            <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="titlebar__title">设置</span>
      </div>
      <div className="titlebar__controls">
        <button
          type="button"
          className="titlebar__btn"
          aria-label="最小化"
          onClick={() => window.electronAPI.settingsWindowControl('minimize')}
        >
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden>
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__btn"
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => window.electronAPI.settingsWindowControl('toggle-maximize')}
        >
          {maximized ? (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.5" y="3.5" width="7" height="7" rx="1" />
              <path d="M3.5 3.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="2" y="2" width="8" height="8" rx="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--close"
          aria-label="关闭"
          onClick={() => window.electronAPI.settingsWindowControl('close')}
        >
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden>
            <path d="m2.5 2.5 7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
