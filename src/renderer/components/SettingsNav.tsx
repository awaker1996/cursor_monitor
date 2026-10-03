import type { ReactElement } from 'react';

export default function SettingsNav({
  active,
  onChange,
}: {
  active: string;
  onChange: (id: string) => void;
}) {
  const items: Array<{
    id: string;
    icon: ReactElement;
    label: string;
  }> = [
    {
      id: 'accounts',
      icon: (
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="6.6" r="3.1" />
          <path d="M3.6 16.2c.9-3 3.4-4.6 6.4-4.6s5.5 1.6 6.4 4.6a.9.9 0 0 1-.86 1.16H4.46A.9.9 0 0 1 3.6 16.2Z" />
        </svg>
      ),
      label: '账户与订阅',
    },
    {
      id: 'data',
      icon: (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M3 4.5h14M3 10h14M3 15.5h14" strokeLinecap="round" />
          <circle cx="7.2" cy="4.5" r="1.7" fill="var(--set-bg, #f4f6fb)" stroke="none" />
          <circle cx="13.4" cy="10" r="1.7" fill="var(--set-bg, #f4f6fb)" stroke="none" />
          <circle cx="8.6" cy="15.5" r="1.7" fill="var(--set-bg, #f4f6fb)" stroke="none" />
          <circle cx="7.2" cy="4.5" r="1.7" />
          <circle cx="13.4" cy="10" r="1.7" />
          <circle cx="8.6" cy="15.5" r="1.7" />
        </svg>
      ),
      label: '数据刷新',
    },
    {
      id: 'ball',
      icon: (
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="6.2" />
          <path d="M4.4 13.4c1.5-1.2 3.4-1.9 5.6-1.9s4.1.7 5.6 1.9" strokeLinecap="round" />
        </svg>
      ),
      label: '悬浮球',
    },
    {
      id: 'icon',
      icon: (
        <svg viewBox="0 0 20 20" aria-hidden>
          <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="3.4" />
          <circle cx="7.8" cy="7.8" r="1.6" />
          <path d="m4.4 13.8 3.2-3.2a1.6 1.6 0 0 1 2.3 0l4.6 4.6" strokeLinecap="round" />
        </svg>
      ),
      label: '应用图标',
    },
    {
      id: 'about',
      icon: (
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="6.8" />
          <path d="M10 9.2v4" strokeLinecap="round" />
          <circle cx="10" cy="6.6" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      ),
      label: '关于',
    },
  ];

  return (
    <nav className="settings-nav" aria-label="设置导航">
      <ul className="settings-nav__list">
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`settings-nav__item${isActive ? ' is-active' : ''}`}
                aria-current={isActive}
                onClick={() => onChange(item.id)}
              >
                <span className="settings-nav__icon">{item.icon}</span>
                <span className="settings-nav__text">
                  <span className="settings-nav__label">{item.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
