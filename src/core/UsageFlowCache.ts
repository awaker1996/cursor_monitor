import type { FlowPlatform, UsageFlowCacheEntry, UsageFlowCacheSnapshot } from '../shared/types';

/**
 * 进程内流水视图缓存：只保留各平台最近一次成功查询的查询条件与结果，
 * 供重新进入流水页时回填。不落盘，应用重启即清空。
 */
export class UsageFlowCache {
  private entries = new Map<FlowPlatform, UsageFlowCacheEntry>();
  private lastPlatform: FlowPlatform | null = null;

  getSnapshot(): UsageFlowCacheSnapshot {
    return {
      lastPlatform: this.lastPlatform,
      entries: Object.fromEntries(this.entries) as Partial<
        Record<FlowPlatform, UsageFlowCacheEntry>
      >,
    };
  }

  save(entry: UsageFlowCacheEntry): void {
    this.entries.set(entry.platform, entry);
    this.lastPlatform = entry.platform;
  }

  clear(platform?: FlowPlatform): void {
    if (platform) {
      this.entries.delete(platform);
      if (this.lastPlatform === platform) this.lastPlatform = null;
      return;
    }
    this.entries.clear();
    this.lastPlatform = null;
  }
}
