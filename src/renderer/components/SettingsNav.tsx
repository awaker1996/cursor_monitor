import type { ReactElement } from 'react';
import pkg from '../../../package.json';

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
      label: '账户',
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
      label: '数据',
    },
    {
      id: 'appearance',
      icon: (
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="6.8" />
          <path d="M10 3.2a6.8 6.8 0 0 1 0 13.6Z" fill="currentColor" stroke="none" />
        </svg>
      ),
      label: '外观',
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
      <div className="settings-nav__footer" aria-hidden>
        <span className="settings-nav__footer-logo">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2.4" />
            <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="settings-nav__footer-text">
          <span className="settings-nav__footer-name">Cursor Monitor</span>
          <span className="settings-nav__footer-ver">v{pkg.version}</span>
        </span>
      </div>
    </nav>
  );
}
