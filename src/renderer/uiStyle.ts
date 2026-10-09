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
    label: '极光玻璃',
    description: '深色玻璃质感，极光流光动效，视觉华丽',
  },
  {
    value: 'calm',
    label: '清爽纸面',
    description: '浅色实底、高对比文字、去除动效，久看不累',
  },
];

/** localStorage 键名：与 index.html / settings.html 的内联脚本约定一致。 */
export const UI_STYLE_STORAGE_KEY = 'ui-style';

/** 把风格写到 <html data-ui-style="…">，CSS 覆盖层据此切换两窗主题。
 *  同时镜像写一份到 localStorage——真源仍是 IPC 返回的设置，
 *  这份副本只用于下次开窗时首帧就能上色，避免 calm 用户每次必闪深色。 */
export function applyUiStyle(style: UiStyle): void {
  document.documentElement.dataset.uiStyle = style;
  try {
    window.localStorage.setItem(UI_STYLE_STORAGE_KEY, style);
  } catch {
    // localStorage 不可用时静默降级：只影响首帧，挂载后 IPC 仍会纠偏
  }
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
