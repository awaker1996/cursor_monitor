import { useEffect } from 'react';
import type { UiStyle } from '../shared/types';

/** 设置页「外观」分区与切换控件共用的风格元数据。 */
export const UI_STYLE_OPTIONS: Array<{
  value: UiStyle;
  label: string;
  description: string;
}> = [
  {
    value: 'aurora',
    label: 'Aurora 玻璃',
    description: '深色玻璃质感，极光流光动效，视觉华丽',
  },
  {
    value: 'calm',
    label: '清爽纸面',
    description: '浅色实底、高对比文字、去除动效，久看不累',
  },
];

/** 把风格写到 <html data-ui-style="…">，CSS 覆盖层据此切换两窗主题。 */
export function applyUiStyle(style: UiStyle): void {
  document.documentElement.dataset.uiStyle = style;
}

/** 启动时应用一次并持续跟随设置变化；悬浮球与设置窗口入口共用。 */
export function useUiStyleSync(): void {
  useEffect(() => {
    let mounted = true;
    void window.electronAPI.getSettings().then((s) => {
      if (mounted) applyUiStyle(s.uiStyle);
    });
    const unsub = window.electronAPI.onSettingsChanged((s) => {
      applyUiStyle(s.uiStyle);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);
}
