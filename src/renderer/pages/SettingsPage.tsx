import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../../shared/types';
import SettingsPanel, { type SettingsSectionId } from '../components/SettingsPanel';
import SettingsNav from '../components/SettingsNav';
import { BallPrefs, DataRefreshPrefs, IconPrefs } from '../components/SettingsTabContent';
import ProjectFeaturesCard from '../components/ProjectFeaturesCard';
import SubscriptionsPage from './SubscriptionsPage';

const SECTION_TITLES: Record<SettingsSectionId, string> = {
  accounts: '账户与订阅',
  data: '数据刷新',
  ball: '悬浮球',
  icon: '应用图标',
  about: '关于',
};

const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  accounts:
    '配置 Cursor、Command Code、DeepSeek 的访问凭据；配置后自动查询订阅额度和用量，凭据仅保存在本机。',
  data: '控制后台多久拉取一次数据，以及今日用量百分比是否计入 Grok Bot 调用。',
  ball: '桌面悬浮球的显示方式。改动立即生效，无需重启应用。',
  icon: '替换系统托盘和设置窗口左上角的应用图标，不会影响悬浮球。',
  about: '本项目的功能范围与设计说明。',
};

export default function SettingsPage() {
  const [active, setActive] = useState<SettingsSectionId>('accounts');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    let mounted = true;
    window.electronAPI.getSettings().then((s) => {
      if (mounted) setSettings(s);
    });
    const unsub = window.electronAPI.onSettingsChanged((s) => {
      if (mounted) setSettings(s);
    });
    return () => {
      mounted = false;
      unsub();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const handleSelect = useCallback((id: string) => {
    setActive(id as SettingsSectionId);
  }, []);

  return (
    <div className="settings-page">
      <header className="settings-page__topbar">
        <h1>设置</h1>
        <p>Cursor Token Monitor 偏好设置 · 改动即时保存</p>
      </header>
      <div className="settings-page__layout">
        <SettingsNav active={active} onChange={handleSelect} />
        <div className="settings-page__panels">
          <SettingsPanel
            id="accounts"
            title={SECTION_TITLES.accounts}
            description={SECTION_DESCRIPTIONS.accounts}
            active={active === 'accounts'}
          >
            <SubscriptionsPage />
          </SettingsPanel>

          <SettingsPanel
            id="data"
            title={SECTION_TITLES.data}
            description={SECTION_DESCRIPTIONS.data}
            active={active === 'data'}
          >
            {settings ? (
              <DataRefreshPrefs settings={settings} onToast={showToast} />

            ) : (
              <PanelSkeleton />
            )}
          </SettingsPanel>

          <SettingsPanel
            id="ball"
            title={SECTION_TITLES.ball}
            description={SECTION_DESCRIPTIONS.ball}
            active={active === 'ball'}
          >
            {settings ? (
              <BallPrefs settings={settings} onToast={showToast} />
            ) : (
              <PanelSkeleton />
            )}
          </SettingsPanel>

          <SettingsPanel
            id="icon"
            title={SECTION_TITLES.icon}
            description={SECTION_DESCRIPTIONS.icon}
            active={active === 'icon'}
          >
            <IconPrefs onToast={showToast} />
          </SettingsPanel>

          <SettingsPanel
            id="about"
            title={SECTION_TITLES.about}
            description={SECTION_DESCRIPTIONS.about}
            active={active === 'about'}
          >
            <ProjectFeaturesCard />
          </SettingsPanel>
        </div>
      </div>
      {toast && <p className="settings-toast">{toast}</p>}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="set-card">
      <div className="set-card__body">
        <div className="set-skeleton" aria-hidden>
          <span className="set-skeleton__bar" style={{ width: '38%' }} />
          <span className="set-skeleton__bar" style={{ width: '72%' }} />
          <span className="set-skeleton__bar" style={{ width: '55%' }} />
        </div>
      </div>
    </div>
  );
}
