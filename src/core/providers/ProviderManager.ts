import type {
  DataSource,
  ProviderHealth,
  TokenSnapshot,
  UsageFlowFetchResult,
  UsageFlowQuery,
} from '../../shared/types';
import { normalize, buildUsageFlowPage } from '../normalizer';
import { SnapshotCache } from '../SnapshotCache';
import { isEmptyUsageSnapshot, mergeTodayMetricsFromCache } from '../snapshotMerge';
import { OfficialProvider } from './OfficialProvider';
import { CookieProvider } from './CookieProvider';
import type { SettingsStore } from '../../settings/SettingsStore';
import { createLogger } from '../../utils/logger';

const log = createLogger('ProviderManager');

export class ProviderManager {
  private official: OfficialProvider;
  private cookie: CookieProvider;
  private snapshotCache: SnapshotCache;
  private activeProvider: DataSource = 'official';
  private health: Record<DataSource, ProviderHealth> = {
    official: { name: 'official', available: true, consecutiveFailures: 0 },
    cookie: { name: 'cookie', available: false, consecutiveFailures: 0 },
  };
  private lastSnapshot: TokenSnapshot | null = null;

  constructor(private settingsStore: SettingsStore) {
    this.official = new OfficialProvider(() => this.settingsStore.get());
    this.cookie = new CookieProvider(() => this.settingsStore.get());
    this.snapshotCache = new SnapshotCache();
  }

  async initialize(): Promise<void> {
    const cached = this.snapshotCache.load();
    if (cached) {
      this.lastSnapshot = cached;
      log.info('Loaded snapshot from disk cache', { fetchedAt: cached.fetchedAt });
    }

    const cookieConfigured = await this.cookie.isConfigured();
    if (cookieConfigured) {
      this.activeProvider = 'cookie';
      this.health.cookie.available = true;
      log.info('Cookie configured, using cookie provider');
    } else {
      this.activeProvider = 'official';
      log.info('No cookie configured, using official provider');
    }
  }

  getActiveProvider(): DataSource {
    return this.activeProvider;
  }

  getLastSnapshot(): TokenSnapshot | null {
    return this.lastSnapshot;
  }

  getHealth(): ProviderHealth[] {
    return Object.values(this.health);
  }

  async fetch(): Promise<TokenSnapshot> {
    const cookieConfigured = await this.cookie.isConfigured();
    const source: DataSource = cookieConfigured ? 'cookie' : 'official';
    this.activeProvider = source;
    const provider = source === 'cookie' ? this.cookie : this.official;

    try {
      const result = await provider.fetch();
      const normalized = normalize(result.raw, result.source);
      const snapshot = mergeTodayMetricsFromCache(normalized, this.lastSnapshot);
      if (isEmptyUsageSnapshot(snapshot)) {
        throw new Error(
          source === 'cookie'
            ? 'Cookie API returned empty usage summary. Please update your cookie or retry.'
            : 'Official API returned empty usage data.',
        );
      }
      this.lastSnapshot = snapshot;
      this.snapshotCache.save(snapshot);
      this.health[source] = {
        ...this.health[source],
        available: true,
        consecutiveFailures: 0,
        lastSuccessAt: new Date().toISOString(),
        lastError: undefined,
      };
      log.info('Fetch succeeded', { source });
      return snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const h = this.health[source];
      h.consecutiveFailures += 1;
      h.lastError = message;
      h.available = false;

      log.warn('Fetch failed', {
        source,
        failures: h.consecutiveFailures,
        error: message,
      });

      if (this.lastSnapshot) {
        return { ...this.lastSnapshot, stale: true };
      }

      throw err;
    }
  }

  async testCookieConnection(): Promise<TokenSnapshot> {
    const prev = this.activeProvider;
    this.activeProvider = 'cookie';
    try {
      return await this.fetch();
    } finally {
      this.activeProvider = prev;
    }
  }

  async fetchUsageFlow(
    query: UsageFlowQuery,
    dateRangeLabel?: string,
  ): Promise<UsageFlowFetchResult> {
    const hasCookie = await this.cookie.isConfigured();
    if (!hasCookie) {
      return {
        success: false,
        hasCookie: false,
        message: '需配置 Cookie 后查看用量流水',
      };
    }

    const pageSize = query.pageSize ?? 100;
    try {
      const raw = await this.cookie.fetchUsageFlowPage(
        query.startDateMs,
        query.endDateMs,
        query.page,
        pageSize,
      );
      const data = buildUsageFlowPage(raw, {
        page: query.page,
        pageSize,
        dateRangeLabel,
      });
      return { success: true, hasCookie: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Usage flow fetch failed', { error: message });
      return { success: false, hasCookie: true, message };
    }
  }

  destroy(): void {
    // no-op
  }
}
