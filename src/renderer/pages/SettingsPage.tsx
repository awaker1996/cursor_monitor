import { useState, useCallback } from 'react';
import TabBar from '../components/TabBar';
import SettingsTabContent from '../components/SettingsTabContent';
import SubscriptionsPage from './SubscriptionsPage';

export type SettingsTab = 'subscriptions' | 'settings';

const TABS = [
  { id: 'subscriptions' as const, label: '订阅' },
  { id: 'settings' as const, label: '其他' },
];

function resolveInitialTab(): SettingsTab {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'subscriptions' || hash === 'settings') {
    return hash;
  }
  return 'subscriptions';
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>(resolveInitialTab);

  const handleTabChange = useCallback((id: string) => {
    setActiveTab(id as SettingsTab);
    window.location.hash = id;
  }, []);

  return (
    <div className="settings-page">
      <TabBar tabs={TABS} activeTab={activeTab} onChange={handleTabChange} />
      <div className="settings-page__body">
        {activeTab === 'subscriptions' && <SubscriptionsPage />}
        {activeTab === 'settings' && <SettingsTabContent />}
      </div>
    </div>
  );
}
