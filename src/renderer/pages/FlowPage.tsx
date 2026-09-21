import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorHint from '../components/ErrorHint';
import UsageFlowFilters from '../components/UsageFlowFilters';
import UsageFlowPagination from '../components/UsageFlowPagination';
import UsageFlowTable from '../components/UsageFlowTable';
import type {
  FlowPlatform,
  UsageFlowCacheEntry,
  UsageFlowCacheSnapshot,
  UsageFlowDisplay,
} from '../../shared/types';
import {
  resolveUsageFlowPreset,
  type UsageFlowDateRange,
  type UsageFlowPreset,
} from '../../shared/usageFlowDates';
import {
  DEFAULT_USAGE_FLOW_PAGE_SIZE,
  normalizeUsageFlowPageSize,
  type UsageFlowPageSize,
} from '../../shared/usageFlowPagination';

const PLATFORM_OPTIONS: { id: FlowPlatform; label: string }[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'commandcode', label: 'Command Code' },
  { id: 'deepseek', label: 'DeepSeek' },
];

const DEFAULT_PRESET: UsageFlowPreset = '1d';

const EMPTY_CACHE: UsageFlowCacheSnapshot = { lastPlatform: null, entries: {} };

function formatRangeLabel(range: UsageFlowDateRange): string {
  const start = new Date(range.startDateMs);
  const end = new Date(range.endDateMs);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  return `${fmt(start)} ~ ${fmt(end)}`;
}

export default function FlowPage() {
  const [platform, setPlatform] = useState<FlowPlatform>('cursor');
  const [preset, setPreset] = useState<UsageFlowPreset>(DEFAULT_PRESET);
  const [dateRange, setDateRange] = useState<UsageFlowDateRange>(() =>
    resolveUsageFlowPreset(DEFAULT_PRESET),
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<UsageFlowPageSize>(DEFAULT_USAGE_FLOW_PAGE_SIZE);
  const [flowDisplay, setFlowDisplay] = useState<UsageFlowDisplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchIdRef = useRef(0);
  const cacheRef = useRef<UsageFlowCacheSnapshot>(EMPTY_CACHE);
  const initRef = useRef(false);

  const applyCacheEntry = useCallback((entry: UsageFlowCacheEntry) => {
    setPlatform(entry.platform);
    setPreset(entry.preset);
    setDateRange({
      startDateMs: entry.startDateMs,
      endDateMs: entry.endDateMs,
      label: entry.dateRangeLabel,
    });
    setPage(entry.page);
    setPageSize(normalizeUsageFlowPageSize(entry.pageSize));
    setFlowDisplay(entry.result.data ?? null);
    setError(entry.result.success ? null : entry.result.message ?? null);
    setHasFetched(entry.result.success);
  }, []);

  const loadFlow = useCallback(
    async (
      range: UsageFlowDateRange,
      targetPage: number,
      activePreset: UsageFlowPreset,
      targetPageSize: UsageFlowPageSize = pageSize,
      targetPlatform: FlowPlatform = platform,
    ) => {
      const fetchId = ++fetchIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const result = await window.electronAPI.fetchUsageFlow(
          {
            startDateMs: range.startDateMs,
            endDateMs: range.endDateMs,
            page: targetPage,
            pageSize: targetPageSize,
            platform: targetPlatform,
            preset: activePreset,
          },
          range.label,
        );

        if (fetchId !== fetchIdRef.current) return;

        if (!result.hasCookie) {
          setFlowDisplay(null);
          setError(result.message ?? '需配置凭据后查看用量流水');
          return;
        }

        if (!result.success) {
          setFlowDisplay(null);
          setError(result.message ?? '加载失败');
          return;
        }

        setFlowDisplay(result.data ?? null);
        if (result.data && targetPage !== result.data.page) {
          setPage(result.data.page);
        }
        setPreset(activePreset);
        setDateRange(range);
        setPageSize(targetPageSize);
        setHasFetched(true);

        // 与主进程内存缓存保持一致，便于切换平台时立即回填。
        cacheRef.current = {
          lastPlatform: targetPlatform,
          entries: {
            ...cacheRef.current.entries,
            [targetPlatform]: {
              platform: targetPlatform,
              startDateMs: range.startDateMs,
              endDateMs: range.endDateMs,
              dateRangeLabel: range.label,
              preset: activePreset,
              page: targetPage,
              pageSize: targetPageSize,
              result,
              fetchedAt: new Date().toISOString(),
            },
          },
        };
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
        }
      }
    },
    [pageSize, platform],
  );

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      const snapshot = await window.electronAPI.getCachedUsageFlow();
      cacheRef.current = snapshot;

      const startPlatform: FlowPlatform = snapshot.lastPlatform ?? 'cursor';
      const cached = snapshot.entries[startPlatform];
      if (cached) {
        applyCacheEntry(cached);
        return;
      }

      const range = resolveUsageFlowPreset(DEFAULT_PRESET);
      setPlatform(startPlatform);
      setPreset(DEFAULT_PRESET);
      setDateRange(range);
      setPage(1);
      setPageSize(DEFAULT_USAGE_FLOW_PAGE_SIZE);
      await loadFlow(range, 1, DEFAULT_PRESET, DEFAULT_USAGE_FLOW_PAGE_SIZE, startPlatform);
    })();
  }, [applyCacheEntry, loadFlow]);

  // 相对预设（1d/7d/30d/MTD）每次拉取都重新解析，否则 to 会停在首次进入的时刻；
  // custom 用用户选定的固定范围。
  const resolveActiveRange = useCallback(
    (): UsageFlowDateRange => (preset === 'custom' ? dateRange : resolveUsageFlowPreset(preset)),
    [preset, dateRange],
  );

  const handleRefresh = () => {
    void loadFlow(resolveActiveRange(), page, preset);
  };

  const handlePresetChange = (nextPreset: UsageFlowPreset, range: UsageFlowDateRange) => {
    setPage(1);
    void loadFlow(range, 1, nextPreset);
  };

  const handleCustomRangeApply = (range: UsageFlowDateRange) => {
    setPage(1);
    void loadFlow(range, 1, 'custom');
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    void loadFlow(resolveActiveRange(), nextPage, preset, pageSize);
  };

  const handlePageSizeChange = (nextPageSize: UsageFlowPageSize) => {
    setPageSize(nextPageSize);
    setPage(1);
    void loadFlow(resolveActiveRange(), 1, preset, nextPageSize);
  };

  const handlePlatformChange = (nextPlatform: FlowPlatform) => {
    if (nextPlatform === platform) return;

    const cached = cacheRef.current.entries[nextPlatform];
    if (cached) {
      applyCacheEntry(cached);
      return;
    }

    const range = resolveUsageFlowPreset(DEFAULT_PRESET);
    setPlatform(nextPlatform);
    setPreset(DEFAULT_PRESET);
    setDateRange(range);
    setPage(1);
    setPageSize(DEFAULT_USAGE_FLOW_PAGE_SIZE);
    setFlowDisplay(null);
    setError(null);
    setHasFetched(false);
    void loadFlow(range, 1, DEFAULT_PRESET, DEFAULT_USAGE_FLOW_PAGE_SIZE, nextPlatform);
  };

  const emptyMessage =
    hasFetched && flowDisplay && !flowDisplay.available ? '暂无流水记录' : null;

  const metaLeft = `${formatRangeLabel(dateRange)}（${dateRange.label}）`;
  const metaRight =
    flowDisplay?.available && flowDisplay.totalCount !== undefined
      ? `共 ${flowDisplay.totalCount.toLocaleString('zh-CN')} 条 · 第 ${flowDisplay.page} / ${flowDisplay.totalPages} 页`
      : null;

  return (
    <div className="page-shell page-shell--flow">
      <header className="page-shell__header">
        <div className="page-shell__title-wrap">
          <h1>用量流水</h1>
          <p className="page-shell__subtitle">查看所选时间段内的模型调用明细</p>
        </div>
        <div className="page-shell__actions">
          <div className="flow-platform-filter">
            {PLATFORM_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`flow-platform-filter__btn${platform === opt.id ? ' flow-platform-filter__btn--active' : ''}`}
                onClick={() => handlePlatformChange(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary btn-primary--compact"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      {(metaLeft || metaRight) && (
        <div className="page-shell__meta">
          <span className="page-shell__meta-left">{metaLeft}</span>
          <span className="page-shell__meta-right">{metaRight}</span>
        </div>
      )}

      <UsageFlowFilters
        preset={preset}
        dateRange={dateRange}
        disabled={loading}
        onPresetChange={handlePresetChange}
        onCustomRangeApply={handleCustomRangeApply}
      />

      {error && <ErrorHint tone="error" message={error} />}

      {!hasFetched && !loading && !error && (
        <ErrorHint tone="info" message="点击「刷新」按钮加载数据" />
      )}

      {flowDisplay?.incomplete && (
        <p className="page-shell__hint">部分数据未拉全</p>
      )}

      {emptyMessage ? (
        <ErrorHint tone="info" message={emptyMessage} />
      ) : error ? null : flowDisplay && flowDisplay.available ? (
        <div className="page-shell__body">
          <div className="page-shell__content">
            <UsageFlowTable display={flowDisplay} />
            <UsageFlowPagination
              page={flowDisplay.page}
              totalPages={flowDisplay.totalPages}
              totalCount={flowDisplay.totalCount}
              pageSize={pageSize}
              disabled={loading}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        </div>
      ) : (
        <div className="page-shell__loading">
          <p>{loading ? '加载中…' : emptyMessage ?? '暂无流水记录'}</p>
        </div>
      )}
    </div>
  );
}
