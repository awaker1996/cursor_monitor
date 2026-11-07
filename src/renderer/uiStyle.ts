import { useEffect, useState } from 'react';
import type { AppSettings, EffectiveUiStyle, UiStyleMode } from '../shared/types';
import { resolveEffectiveUiStyle } from '../shared/uiStyle';

/** 设置页「外观」分区与切换控件共用的风格元数据。
 *  顺序按使用习惯排：先自动跟随（跟随系统 / 跟随时间），再手动固定（清爽纸面 / 极光玻璃），
 *  group 用于分段控件在两组之间画一道分隔线。 */
export const UI_STYLE_OPTIONS: Array<{
  value: UiStyleMode;
  label: string;
  /** 短提示：选择卡里的一行说明，比 description 更短，便于并排扫读。 */
  hint: string;
  description: string;
  group: 'auto' | 'manual';
}> = [
  {
    value: 'system',
    label: '跟随系统',
    hint: '随 Windows 深浅色',
    description: '跟着 Windows 的深色 / 浅色设置走，系统换主题时同步切换',
    group: 'auto',
  },
  {
    value: 'auto',
    label: '跟随时间',
    hint: '白天浅色 · 夜间深色',
    description: '白天用清爽纸面，夜间用极光玻璃，时段可自定义',
    group: 'auto',
  },
  {
    value: 'calm',
    label: '清爽纸面',
    hint: '浅色实底 · 高对比',
    description: '浅色实底、高对比文字，白天与强光下更清晰',
    group: 'manual',
  },
  {
    value: 'aurora',
    label: '极光玻璃',
    hint: '深色玻璃 · 极光流光',
    description: '深色玻璃质感与极光流光，夜间与暗光下更柔和',
    group: 'manual',
  },
];

/** 生效风格的展示名，用于设置页状态胶囊与提示文案。 */
export const UI_STYLE_LABELS: Record<EffectiveUiStyle, string> = {
  calm: '清爽纸面',
  aurora: '极光玻璃',
};

/** localStorage 键名：与 index.html / settings.html 的内联脚本约定一致。 */
export const UI_STYLE_STORAGE_KEY = 'ui-style';
/** 自动档的时段镜像（"起点-终点"，单位分钟），供首帧脚本即时算出生效风格。 */
export const UI_STYLE_AUTO_STORAGE_KEY = 'ui-style-auto';
/** 档位镜像：首帧脚本据此区分手动档、时段档与跟随系统。 */
export const UI_STYLE_MODE_STORAGE_KEY = 'ui-style-mode';

/** 自动切换的检查间隔：与整分钟对齐，跨过时段边界后最多 1 分钟内生效。 */
const UI_STYLE_TICK_MS = 60_000;

/** 系统当前是否为深色。Electron 里 prefers-color-scheme 跟随 nativeTheme（默认 themeSource = system），
 *  所以渲染层无需额外 IPC 就能读到系统深浅色；读不到时按深色处理，与默认档位一致。 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 订阅系统深浅色变化：跟随系统档位下，系统换主题即换肤。 */
export function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(systemPrefersDark);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => setDark(event.matches);
    setDark(query.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  return dark;
}

/** 把生效风格写到 <html data-ui-style="…">，CSS 覆盖层据此切换两窗主题。
 *  同时镜像写一份到 localStorage——真源仍是 IPC 返回的设置，
 *  这份副本只用于下次开窗时首帧就能上色，避免 calm 用户每次必闪深色。 */
export function applyUiStyle(style: EffectiveUiStyle): void {
  const root = document.documentElement;
  if (root.dataset.uiStyle !== style) {
    root.dataset.uiStyle = style;
    // 通知主进程同步设置窗底色；只在真正变化时发，避免每分钟一次的无谓 IPC
    window.electronAPI.setEffectiveUiStyle(style);
  }
  try {
    window.localStorage.setItem(UI_STYLE_STORAGE_KEY, style);
  } catch {
    // localStorage 不可用时静默降级：只影响首帧，挂载后 IPC 仍会纠偏
  }
}

/** 首帧镜像：把档位、生效风格与自动档时段写进 localStorage，
 *  index.html / settings.html 的内联脚本据此在首帧就上对色。 */
function mirrorUiStyleForFirstFrame(settings: AppSettings): void {
  const effective = resolveEffectiveUiStyle(
    settings.uiStyle,
    settings.uiStyleDayStartMin,
    settings.uiStyleDayEndMin,
    systemPrefersDark(),
  );
  try {
    window.localStorage.setItem(UI_STYLE_MODE_STORAGE_KEY, settings.uiStyle);
    window.localStorage.setItem(UI_STYLE_STORAGE_KEY, effective);
    if (settings.uiStyle === 'auto') {
      window.localStorage.setItem(
        UI_STYLE_AUTO_STORAGE_KEY,
        `${settings.uiStyleDayStartMin}-${settings.uiStyleDayEndMin}`,
      );
    } else {
      window.localStorage.removeItem(UI_STYLE_AUTO_STORAGE_KEY);
    }
  } catch {
    // localStorage 不可用时静默降级：只影响首帧
  }
}

/** 启动时应用一次并持续跟随设置变化；悬浮球与设置窗口入口共用。
 *  自动档按分钟对齐检查跨时段，跟随系统档监听 prefers-color-scheme 变化。 */
export function useUiStyleSync(): void {
  useEffect(() => {
    let mounted = true;
    // 最新整份设置：改时段时必须读到新的起止值，不能只存档位
    let latest: AppSettings | null = null;
    let lastEffective: EffectiveUiStyle | null = null;

    const applyFromLatest = (): void => {
      if (!latest) return;
      const effective = resolveEffectiveUiStyle(
        latest.uiStyle,
        latest.uiStyleDayStartMin,
        latest.uiStyleDayEndMin,
        systemPrefersDark(),
      );
      mirrorUiStyleForFirstFrame(latest);
      if (effective === lastEffective) return;
      lastEffective = effective;
      applyUiStyle(effective);
    };

    const handleSettings = (settings: AppSettings): void => {
      if (!mounted) return;
      latest = settings;
      applyFromLatest();
    };

    void window.electronAPI.getSettings().then(handleSettings);
    const unsub = window.electronAPI.onSettingsChanged(handleSettings);

    // 对齐到下一整分再按分钟检查：+50ms 避开定时器早触发 1ms 读到上一分钟
    let timeoutTimer = 0;
    let intervalTimer = 0;
    timeoutTimer = window.setTimeout(() => {
      applyFromLatest();
      intervalTimer = window.setInterval(applyFromLatest, UI_STYLE_TICK_MS);
    }, UI_STYLE_TICK_MS - (Date.now() % UI_STYLE_TICK_MS) + 50);

    // 系统深浅色变化：跟随系统档位立即换肤
    const themeQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const handleThemeChange = (): void => applyFromLatest();
    themeQuery?.addEventListener('change', handleThemeChange);

    // 窗口从后台切回时立即纠偏：长时间挂起后定时器可能滞后
    const handleWake = (): void => {
      if (document.visibilityState === 'visible') applyFromLatest();
    };
    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);

    return () => {
      mounted = false;
      unsub();
      window.clearTimeout(timeoutTimer);
      window.clearInterval(intervalTimer);
      themeQuery?.removeEventListener('change', handleThemeChange);
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('focus', handleWake);
    };
  }, []);
}
