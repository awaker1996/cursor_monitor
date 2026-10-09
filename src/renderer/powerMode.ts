import type { PowerMode } from '../shared/types';

/**
 * 把供电模式写到 `<body data-power="…">`，CSS 据此关停持续动效。
 *
 * 与主题同步不同，这一步刻意放在 React 之外、模块加载时就执行——
 * 越早落属性，电池模式下就越少有一拍「全速动效」。
 * 真源仍是主进程的 powerMonitor，事件到达时覆盖纠偏。
 */
export function applyPowerMode(mode: PowerMode): void {
  document.body.dataset.power = mode;
}

/** dev 调试口：台式机没有电池，powerMonitor 永远不会广播，用它在控制台手动模拟。
 *  生产构建下不存在（import.meta.env.DEV 为 false，整段被 tree-shake）。 */
export function installPowerModeDebugHook(): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as Record<string, unknown>).__setPowerMode = (mode: PowerMode) => {
    applyPowerMode(mode);
  };
}

export function startPowerModeSync(): void {
  const api = window.electronAPI;
  if (!api?.getPowerMode || !api?.onPowerMode) return;

  void api.getPowerMode().then(applyPowerMode);
  api.onPowerMode(applyPowerMode);
}
