import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../../shared/types';
import SettingsPanel, { type SettingsSectionId } from '../components/SettingsPanel';
import SettingsNav from '../components/SettingsNav';
import SettingsTitleBar from '../components/SettingsTitleBar';
import { BallPrefs, DataRefreshPrefs, IconPrefs, AppearancePrefs } from '../components/SettingsTabContent';
import ProjectFeaturesCard from '../components/ProjectFeaturesCard';
import SubscriptionsPage from './SubscriptionsPage';
import { useUiStyleSync } from '../uiStyle';

export type ToastTone = 'ok' | 'error';

const SECTION_TITLES: Record<SettingsSectionId, string> = {
  accounts: '账户与订阅',
  data: '数据刷新',
  appearance: '外观',
  about: '关于',
};

const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  accounts:
    '配置 Cursor、Command Code、DeepSeek 的访问凭据；配置后自动查询订阅额度和用量，凭据仅保存在本机。',
  data: '控制后台多久拉取一次数据，以及今日用量百分比是否计入 Grok Bot 调用。',
  appearance: '界面风格、悬浮球显示与应用图标的个性化设置，改动立即生效，无需重启。',
  about: '本项目的功能范围与设计说明。',
};

export default function SettingsPage() {
  useUiStyleSync();
  const [active, setActive] = useState<SettingsSectionId>('accounts');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'ok') => {
    setToast({ message, tone });
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
      <SettingsTitleBar />
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
              <DataRefreshPrefs accent="data" settings={settings} onToast={showToast} />

            ) : (
              <PanelSkeleton />
            )}
          </SettingsPanel>

          <SettingsPanel
            id="appearance"
            title={SECTION_TITLES.appearance}
            description={SECTION_DESCRIPTIONS.appearance}
            active={active === 'appearance'}
          >
            {settings ? (
              <>
                <AppearancePrefs accent="appearance" settings={settings} onToast={showToast} />
                <BallPrefs accent="ball" settings={settings} onToast={showToast} />
                <IconPrefs accent="icon" onToast={showToast} />
              </>
            ) : (
              <PanelSkeleton />
            )}
          </SettingsPanel>

          <SettingsPanel
            id="about"
            title={SECTION_TITLES.about}
            description={SECTION_DESCRIPTIONS.about}
            active={active === 'about'}
            fill
          >
            <ProjectFeaturesCard />
          </SettingsPanel>
        </div>
      </div>
      {toast && (
        <p className={`settings-toast settings-toast--${toast.tone}`}>
          <span className="settings-toast__icon" aria-hidden>
            {toast.tone === 'ok' ? '✓' : '!'}
          </span>
          {toast.message}
        </p>
      )}
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
