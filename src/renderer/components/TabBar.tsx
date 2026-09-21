export interface TabBarItem {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: TabBarItem[];
  activeTab: string;
  onChange: (id: string) => void;
}

export default function TabBar({ tabs, activeTab, onChange }: TabBarProps) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeTab}
          className={
            tab.id === activeTab
              ? 'tab-bar__item tab-bar__item--active'
              : 'tab-bar__item'
          }
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
