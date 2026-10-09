import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import pkg from '../../../package.json';

/** 滑移指示器的实测矩形；未测到之前保持 null（指示器不渲染尺寸）。 */
interface ThumbRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

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

  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const [thumb, setThumb] = useState<ThumbRect | null>(null);
  // 过渡开关比几何晚一帧开启：否则首次测量会让指示器从 0×0「长」出来。
  const [thumbReady, setThumbReady] = useState(false);

  // 用实测的 offset* 而不是「索引 × 行高」推算：导航在 ≤640px 会翻成横排，
  // 字号/内边距一旦调整也不会让指示器错位。
  const measure = useCallback(() => {
    const el = activeItemRef.current;
    if (!el) return;
    setThumb({
      top: el.offsetTop,
      left: el.offsetLeft,
      width: el.offsetWidth,
      height: el.offsetHeight,
    });
  }, []);

  useLayoutEffect(measure, [active, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useEffect(() => {
    if (!thumb || thumbReady) return;
    const frameId = requestAnimationFrame(() => setThumbReady(true));
    return () => cancelAnimationFrame(frameId);
  }, [thumb, thumbReady]);

  const thumbStyle: CSSProperties | undefined = thumb
    ? { top: `${thumb.top}px`, left: `${thumb.left}px`, width: `${thumb.width}px`, height: `${thumb.height}px` }
    : undefined;

  return (
    <nav className="settings-nav" aria-label="设置导航">
      <ul className="settings-nav__list">
        {/* 滑移指示器：绝对定位覆盖整片列表，跟随激活项实测矩形滑动。
            放在 li 里是为了保持 ul 的子元素合法。 */}
        <li className="settings-nav__thumb-slot" aria-hidden>
          <span
            className="settings-nav__thumb"
            style={thumbStyle}
            data-ready={thumbReady ? 'true' : 'false'}
          />
        </li>
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                ref={isActive ? activeItemRef : null}
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
