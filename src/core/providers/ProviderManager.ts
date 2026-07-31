import type {
  DataSource,
  ProviderHealth,
  RawUsageEventsResponse,
  TokenSnapshot,
  UsageFlowFetchResult,
  UsageFlowQuery,
} from '../../shared/types';
import { normalize, buildUsageFlowPage, buildUsageFlowPageFromEvents, buildUsageFlowModelStats, resolveUsageFlowTotalCount } from '../normalizer';
import { SnapshotCache } from '../SnapshotCache';
import { isEmptyUsageSnapshot, mergeCycleTokensFromCache, mergeTodayMetricsFromCache } from '../snapshotMerge';
import { OfficialProvider } from './OfficialProvider';
import { CookieProvider } from './CookieProvider';
import type { SettingsStore } from '../../settings/SettingsStore';
import { DEFAULT_USAGE_FLOW_PAGE_SIZE } from '../../shared/usageFlowPagination';
import { createLogger } from '../../utils/logger';

/** When total events in range are at most this many, paginate in-app after a full fetch. */
const USAGE_FLOW_CLIENT_PAGINATION_MAX = 1000;

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
      const snapshot = mergeCycleTokensFromCache(
        mergeTodayMetricsFromCache(normalized, this.lastSnapshot),
        this.lastSnapshot,
      );
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

    const pageSize = query.pageSize ?? DEFAULT_USAGE_FLOW_PAGE_SIZE;
    const page = query.page >= 1 ? Math.floor(query.page) : 1;
    try {
      const aggregated = await this.cookie.fetchUsageFlowAggregated(
        query.startDateMs,
        query.endDateMs,
      );

      const probe = await this.cookie.fetchUsageFlowPage(
        query.startDateMs,
        query.endDateMs,
        1,
        pageSize,
      );
      const reportedTotal = resolveUsageFlowTotalCount(probe, probe?.usageEventsDisplay?.length ?? 0);

      let eventsForStats: RawUsageEventsResponse | null = null;
      let data;

      if (reportedTotal > 0 && reportedTotal <= USAGE_FLOW_CLIENT_PAGINATION_MAX) {
        const maxPages = Math.max(1, Math.ceil(reportedTotal / 100));
        eventsForStats =
          reportedTotal <= pageSize && probe?.usageEventsDisplay?.length
            ? probe
            : await this.cookie.fetchUsageFlowEventsForStats(
                query.startDateMs,
                query.endDateMs,
                maxPages,
              );
        const allEvents = eventsForStats?.usageEventsDisplay ?? probe?.usageEventsDisplay ?? [];
        data = buildUsageFlowPageFromEvents(
          allEvents,
          { page, pageSize, dateRangeLabel },
          reportedTotal,
        );
      } else {
        const raw =
          page === 1 && probe
            ? probe
            : await this.cookie.fetchUsageFlowPage(
                query.startDateMs,
                query.endDateMs,
                page,
                pageSize,
              );
        data = buildUsageFlowPage(raw, { page, pageSize, dateRangeLabel });
        if (!aggregated?.aggregations?.length) {
          eventsForStats = await this.cookie.fetchUsageFlowEventsForStats(
            query.startDateMs,
            query.endDateMs,
          );
        }
      }

      data.modelStats = buildUsageFlowModelStats(aggregated, eventsForStats);
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
