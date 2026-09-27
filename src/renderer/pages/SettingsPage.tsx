import { useState, useCallback } from 'react';
import TabBar from '../components/TabBar';
import SettingsTabContent from '../components/SettingsTabContent';
import FlowPage from './FlowPage';
import SubscriptionsPage from './SubscriptionsPage';
import AgentPage from './AgentPage';

export type SettingsTab = 'flow' | 'subscriptions' | 'settings' | 'agent';

const TABS = [
  { id: 'agent' as const, label: '智能体' },
  { id: 'subscriptions' as const, label: '订阅' },
  { id: 'flow' as const, label: '流水' },
  { id: 'settings' as const, label: '其他' },
];

function resolveInitialTab(): SettingsTab {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'flow' || hash === 'subscriptions' || hash === 'settings' || hash === 'agent') {
    return hash;
  }
  return 'agent';
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
        {activeTab === 'agent' && <AgentPage />}
        {activeTab === 'subscriptions' && <SubscriptionsPage />}
        {activeTab === 'flow' && <FlowPage />}
        {activeTab === 'settings' && <SettingsTabContent />}
      </div>
    </div>
  );
}
