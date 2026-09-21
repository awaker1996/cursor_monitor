import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type {
  SubscriptionCacheSnapshot,
  SubscriptionInfoResult,
  SubscriptionProviderId,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';

const CACHE_FILE = 'subscription-cache.json';
const CACHE_VERSION = 2;
/** 超过该时长的缓存不再展示，避免把过期数据当成当前值。 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface CacheFile {
  version: number;
  entries: SubscriptionCacheSnapshot;
}

/** 只接受成功结果，且载荷里的 providerId 必须与所属键一致。 */
function isValidResult(value: unknown, providerId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (obj.success !== true) return false;
  const data = obj.data;
  if (!data || typeof data !== 'object') return false;
  return (data as Record<string, unknown>).providerId === providerId;
}

function isFresh(value: { fetchedAt?: string }): boolean {
  if (!value.fetchedAt) return false;
  const time = Date.parse(value.fetchedAt);
  return Number.isFinite(time) && Date.now() - time <= MAX_AGE_MS;
}

export class SubscriptionCache {
  private filePath: string;
  private entries: SubscriptionCacheSnapshot | null = null;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), CACHE_FILE);
  }

  /** 读取并校验磁盘缓存；损坏、版本不符或过期的条目一律丢弃。 */
  private load(): SubscriptionCacheSnapshot {
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
      if (!raw || typeof raw !== 'object') return {};
      const file = raw as Partial<CacheFile>;
      if (file.version !== CACHE_VERSION) return {};
      if (!file.entries || typeof file.entries !== 'object') return {};

      const snapshot: SubscriptionCacheSnapshot = {};
      for (const [id, entry] of Object.entries(file.entries)) {
        if (!entry || typeof entry !== 'object') continue;
        const info =
          isValidResult(entry.info, id) && isFresh(entry.info as SubscriptionInfoResult)
            ? (entry.info as SubscriptionInfoResult)
            : undefined;
        const usage =
          isValidResult(entry.usage, id) && isFresh(entry.usage as SubscriptionUsageResult)
            ? (entry.usage as SubscriptionUsageResult)
            : undefined;
        if (info || usage) {
          snapshot[id as SubscriptionProviderId] = {
            ...(info ? { info } : {}),
            ...(usage ? { usage } : {}),
          };
        }
      }
      return snapshot;
    } catch {
      return {};
    }
  }

  private ensureLoaded(): SubscriptionCacheSnapshot {
    if (this.entries === null) this.entries = this.load();
    return this.entries;
  }

  private persist(): void {
    try {
      const file: CacheFile = { version: CACHE_VERSION, entries: this.ensureLoaded() };
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    } catch {
      // 非致命：内存缓存仍然可用
    }
  }

  getSnapshot(): SubscriptionCacheSnapshot {
    return { ...this.ensureLoaded() };
  }

  /** 查询失败时不写入，保留上一次成功结果，避免面板被清空。 */
  saveInfo(providerId: SubscriptionProviderId, result: SubscriptionInfoResult): void {
    if (!result.success) return;
    const entries = this.ensureLoaded();
    entries[providerId] = { ...entries[providerId], info: result };
    this.persist();
  }

  saveUsage(providerId: SubscriptionProviderId, result: SubscriptionUsageResult): void {
    if (!result.success) return;
    const entries = this.ensureLoaded();
    entries[providerId] = { ...entries[providerId], usage: result };
    this.persist();
  }
}
