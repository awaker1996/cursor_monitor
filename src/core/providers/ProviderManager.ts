import type {
  DataSource,
  ProviderHealth,
  TokenSnapshot,
  UsageFlowCacheSnapshot,
  UsageFlowDisplay,
  UsageFlowEntry,
  UsageFlowFetchResult,
  UsageFlowQuery,
  FlowPlatform,
} from '../../shared/types';
import type {
  RawDeepSeekUsageAmountResponse,
  RawDeepSeekUsageBizData,
} from '../../shared/subscriptionTypes';
import { normalize, buildUsageFlowPage, buildUsageFlowPageFromEvents, resolveUsageFlowTotalCount } from '../normalizer';
import { SnapshotCache } from '../SnapshotCache';
import { UsageFlowCache } from '../UsageFlowCache';
import { isEmptyUsageSnapshot, mergeCycleTokensFromCache, mergeTodayMetricsFromCache } from '../snapshotMerge';
import { OfficialProvider } from './OfficialProvider';
import { CookieProvider } from './CookieProvider';
import { DEEPSEEK_USAGE_CREDENTIAL_ACCOUNT } from '../subscriptions/DeepSeekProvider';
import {
  CommandCodeProvider,
  type CommandCodeUsageFlowItem,
} from '../subscriptions/CommandCodeProvider';
import { credentialVault } from '../../security/CredentialVault';
import type { SettingsStore } from '../../settings/SettingsStore';
import { DEFAULT_USAGE_FLOW_PAGE_SIZE } from '../../shared/usageFlowPagination';
import { formatUsageFlowDate } from '../../shared/format';
import { formatUsageFlowTokens } from '../../shared/usageFlowFormat';
import { createLogger } from '../../utils/logger';

/** When total events in range are at most this many, paginate in-app after a full fetch. */
/** Fetch full event list and paginate locally (needed for Grok Bot filtering + page boundaries). */
const USAGE_FLOW_CLIENT_PAGINATION_MAX = 3000;

/** Command Code 单次成本额度很小，按量级控制小数位，避免全部显示为 $0.00。 */
function formatCommandCodeCost(costUsd: number | null): string {
  if (costUsd === null || !Number.isFinite(costUsd) || costUsd <= 0) return '-';
  const decimals = costUsd >= 1 ? 2 : costUsd >= 0.01 ? 4 : 6;
  return `$${costUsd.toFixed(decimals)}`;
}

const log = createLogger('ProviderManager');

export class ProviderManager {
  private official: OfficialProvider;
  private cookie: CookieProvider;
  private commandCode: CommandCodeProvider;
  private snapshotCache: SnapshotCache;
  private flowCache = new UsageFlowCache();
  private activeProvider: DataSource = 'official';
  private health: Record<DataSource, ProviderHealth> = {
    official: { name: 'official', available: true, consecutiveFailures: 0 },
    cookie: { name: 'cookie', available: false, consecutiveFailures: 0 },
  };
  private lastSnapshot: TokenSnapshot | null = null;

  constructor(private settingsStore: SettingsStore) {
    this.official = new OfficialProvider(() => this.settingsStore.get());
    this.cookie = new CookieProvider(() => this.settingsStore.get());
    this.commandCode = new CommandCodeProvider(() => this.settingsStore.get());
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
    const platform: FlowPlatform = query.platform ?? 'cursor';

    let result: UsageFlowFetchResult;
    if (platform === 'deepseek') {
      result = await this.fetchDeepSeekUsageFlow(query, dateRangeLabel);
    } else if (platform === 'commandcode') {
      result = await this.fetchCommandCodeUsageFlow(query, dateRangeLabel);
    } else {
      result = await this.fetchCursorUsageFlow(query, dateRangeLabel);
    }

    // 失败不覆盖上一次成功结果，保证重新进入页面仍能回填旧数据。
    if (result.success) {
      this.flowCache.save({
        platform,
        startDateMs: query.startDateMs,
        endDateMs: query.endDateMs,
        dateRangeLabel: dateRangeLabel ?? '',
        preset: query.preset ?? 'custom',
        page: query.page,
        pageSize: query.pageSize ?? DEFAULT_USAGE_FLOW_PAGE_SIZE,
        result,
        fetchedAt: new Date().toISOString(),
      });
    }

    return result;
  }

  /** 各平台上一次成功查询的流水视图，供弹窗重新打开时回填。 */
  getCachedUsageFlow(): UsageFlowCacheSnapshot {
    return this.flowCache.getSnapshot();
  }

  private async fetchCursorUsageFlow(
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
      const probe = await this.cookie.fetchUsageFlowPage(
        query.startDateMs,
        query.endDateMs,
        1,
        pageSize,
      );
      const reportedTotal = resolveUsageFlowTotalCount(probe, probe?.usageEventsDisplay?.length ?? 0);

      let data;

      if (reportedTotal > 0 && reportedTotal <= USAGE_FLOW_CLIENT_PAGINATION_MAX) {
        // 拉全量再本地分页：避免服务端分页边界错位，并准确剔除 Grok Bot 后重算条数/页码。
        const allEventsResponse =
          reportedTotal <= pageSize && probe?.usageEventsDisplay?.length
            ? probe
            : await this.cookie.fetchUsageFlowEvents(
                query.startDateMs,
                query.endDateMs,
                Math.max(1, Math.ceil(reportedTotal / 100)),
              );
        const allEvents = allEventsResponse?.usageEventsDisplay ?? probe?.usageEventsDisplay ?? [];
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
      }

      return { success: true, hasCookie: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Usage flow fetch failed', { error: message });
      return { success: false, hasCookie: true, message };
    }
  }

  private async fetchDeepSeekUsageFlow(
    query: UsageFlowQuery,
    dateRangeLabel?: string,
  ): Promise<UsageFlowFetchResult> {
    const token = await credentialVault.getSecret(DEEPSEEK_USAGE_CREDENTIAL_ACCOUNT);
    if (!token || !token.trim()) {
      return {
        success: false,
        hasCookie: false,
        message: '需配置 DeepSeek 用量 Token 后查看流水',
      };
    }

    const settings = this.settingsStore.get();
    const pageSize = query.pageSize ?? DEFAULT_USAGE_FLOW_PAGE_SIZE;
    const page = query.page >= 1 ? Math.floor(query.page) : 1;

    try {
      // DeepSeek usage amount 接口按月查询，返回按天按模型的明细
      const startDate = new Date(query.startDateMs);
      const endDate = new Date(query.endDateMs);
      const entries: UsageFlowEntry[] = [];

      // 遍历日期范围内的每个月
      let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(settings.requestTimeoutSec, 15) * 1000);

      try {
        while (current <= endMonth) {
          const month = current.getMonth() + 1;
          const year = current.getFullYear();

          const url = `https://platform.deepseek.com/api/v0/usage/amount?month=${month}&year=${year}`;
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token.trim()}`,
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              'x-app-version': '1.0.0',
            },
            signal: controller.signal,
          });

          if (response.status === 401 || response.status === 403) {
            return {
              success: false,
              hasCookie: false,
              message: 'DeepSeek 用量 Token 无效或已过期，请重新获取',
            };
          }

          if (!response.ok) {
            log.warn('DeepSeek usage flow fetch failed', { status: response.status, month, year });
            current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
            continue;
          }

          const raw = (await response.json()) as RawDeepSeekUsageAmountResponse;
          const bizData = raw.data?.biz_data ?? raw.biz_data;
          if (bizData) {
            const monthEntries = this.deepSeekBizDataToFlowEntries(bizData, query.startDateMs, query.endDateMs);
            entries.push(...monthEntries);
          }

          current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
        }
      } finally {
        clearTimeout(timeout);
      }

      entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const totalCount = entries.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const clampedPage = Math.min(page, totalPages);
      const startIdx = (clampedPage - 1) * pageSize;
      const pageEntries = entries.slice(startIdx, startIdx + pageSize);

      const data: UsageFlowDisplay = {
        available: totalCount > 0,
        totalCount,
        page: clampedPage,
        pageSize,
        totalPages,
        dateRangeLabel: dateRangeLabel ?? '',
        entries: pageEntries,
      };

      return { success: true, hasCookie: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('DeepSeek usage flow fetch failed', { error: message });
      return { success: false, hasCookie: false, message };
    }
  }

  private deepSeekBizDataToFlowEntries(
    bizData: RawDeepSeekUsageBizData,
    startDateMs: number,
    endDateMs: number,
  ): UsageFlowEntry[] {
    const entries: UsageFlowEntry[] = [];
    for (const dayData of bizData.days ?? []) {
      const dateStr = dayData.date ?? '';
      if (!dateStr) continue;
      const dayMs = new Date(dateStr).getTime();
      if (dayMs < startDateMs || dayMs > endDateMs + 86_400_000) continue;

      for (const item of dayData.data ?? []) {
        const model = item.model ?? '-';
        let totalTokens = 0;
        let requests = 0;
        for (const usage of item.usage ?? []) {
          const amount = typeof usage.amount === 'number' ? usage.amount : Number(usage.amount ?? 0);
          if (usage.type === 'REQUEST') requests += amount;
          else totalTokens += amount;
        }
        if (totalTokens <= 0 && requests <= 0) continue;

        entries.push({
          timestamp: new Date(dateStr).toISOString(),
          date: formatUsageFlowDate(new Date(dateStr).toISOString()),
          type: 'Included',
          model,
          tokens: formatUsageFlowTokens(totalTokens),
          cost: '-',
          platform: 'deepseek',
        });
      }
    }
    return entries;
  }

  private async fetchCommandCodeUsageFlow(
    query: UsageFlowQuery,
    dateRangeLabel?: string,
  ): Promise<UsageFlowFetchResult> {
    const pageSize = query.pageSize ?? DEFAULT_USAGE_FLOW_PAGE_SIZE;
    const page = query.page >= 1 ? Math.floor(query.page) : 1;

    try {
      const result = await this.commandCode.fetchUsageFlow(query.startDateMs, query.endDateMs);
      if (!result.success) {
        return { success: false, hasCookie: result.configured, message: result.message };
      }

      const entries = this.commandCodeItemsToFlowEntries(result.items ?? []);
      entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const totalCount = entries.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const clampedPage = Math.min(page, totalPages);
      const startIdx = (clampedPage - 1) * pageSize;

      const data: UsageFlowDisplay = {
        available: totalCount > 0,
        incomplete: result.truncated || undefined,
        totalCount,
        page: clampedPage,
        pageSize,
        totalPages,
        dateRangeLabel: dateRangeLabel ?? '',
        entries: entries.slice(startIdx, startIdx + pageSize),
      };

      return { success: true, hasCookie: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Command Code usage flow failed', { error: message });
      return { success: false, hasCookie: true, message };
    }
  }

  /** Map Command Code calls onto the shared Date / Type / Model / Tokens / Cost columns. */
  private commandCodeItemsToFlowEntries(items: CommandCodeUsageFlowItem[]): UsageFlowEntry[] {
    return items.map((item) => {
      const tokenTotal = item.tokensTotal ?? (item.tokensIn ?? 0) + (item.tokensOut ?? 0);
      return {
        timestamp: item.timestamp ?? '',
        date: item.timestamp ? formatUsageFlowDate(item.timestamp) : '--',
        type:
          item.status === 'failed'
            ? 'Failed'
            : item.status === 'completed'
              ? 'Completed'
              : 'Usage-based',
        model: item.model ?? '-',
        tokens: formatUsageFlowTokens(tokenTotal),
        cost: formatCommandCodeCost(item.costUsd),
        platform: 'commandcode',
      };
    });
  }

  destroy(): void {
    // no-op
  }
}
