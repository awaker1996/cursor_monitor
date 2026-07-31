import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorHint from '../components/ErrorHint';
import UsageFlowFilters from '../components/UsageFlowFilters';
import UsageFlowModelStatsPanel from '../components/UsageFlowModelStats';
import UsageFlowPagination from '../components/UsageFlowPagination';
import UsageFlowTable from '../components/UsageFlowTable';
import type { UsageFlowDisplay } from '../../shared/types';
import {
  resolveUsageFlowPreset,
  type UsageFlowDateRange,
  type UsageFlowPreset,
} from '../../shared/usageFlowDates';
import {
  DEFAULT_USAGE_FLOW_PAGE_SIZE,
  type UsageFlowPageSize,
} from '../../shared/usageFlowPagination';

export default function FlowPage() {
  const [hasCookie, setHasCookie] = useState<boolean | null>(null);
  const [preset, setPreset] = useState<UsageFlowPreset>('1d');
  const [dateRange, setDateRange] = useState<UsageFlowDateRange>(() => resolveUsageFlowPreset('1d'));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<UsageFlowPageSize>(DEFAULT_USAGE_FLOW_PAGE_SIZE);
  const [flowDisplay, setFlowDisplay] = useState<UsageFlowDisplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const loadFlow = useCallback(
    async (
      range: UsageFlowDateRange,
      targetPage: number,
      activePreset: UsageFlowPreset,
      targetPageSize: UsageFlowPageSize = pageSize,
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
          },
          range.label,
        );

        if (fetchId !== fetchIdRef.current) return;

        if (!result.hasCookie) {
          setHasCookie(false);
          setFlowDisplay(null);
          setError(result.message ?? '需配置 Cookie 后查看用量流水');
          return;
        }

        setHasCookie(true);
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
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
        }
      }
    },
    [pageSize],
  );

  useEffect(() => {
    void window.electronAPI.hasCookie().then(setHasCookie);
    const initial = resolveUsageFlowPreset('1d');
    void loadFlow(initial, 1, '1d');
  }, [loadFlow]);

  const handleRefresh = () => {
    void loadFlow(dateRange, page, preset);
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
    void loadFlow(dateRange, nextPage, preset, pageSize);
  };

  const handlePageSizeChange = (nextPageSize: UsageFlowPageSize) => {
    setPageSize(nextPageSize);
    setPage(1);
    void loadFlow(dateRange, 1, preset, nextPageSize);
  };

  const emptyMessage =
    hasCookie === false
      ? '需配置 Cookie 后查看用量流水'
      : error
        ? null
        : flowDisplay && !flowDisplay.available
          ? '暂无流水记录'
          : null;

  return (
    <div className="flow-page">
      <header className="flow-page__header">
        <h1>用量流水</h1>
        <button
          type="button"
          className="btn-primary btn-primary--compact"
          onClick={handleRefresh}
          disabled={loading || hasCookie === false}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      <UsageFlowFilters
        preset={preset}
        dateRange={dateRange}
        disabled={loading || hasCookie === false}
        onPresetChange={handlePresetChange}
        onCustomRangeApply={handleCustomRangeApply}
      />

      {error && <p className="flow-page__error">{error}</p>}

      {flowDisplay?.incomplete && (
        <p className="flow-page__hint">部分数据未拉全</p>
      )}

      {emptyMessage ? (
        <ErrorHint message={emptyMessage} />
      ) : flowDisplay && flowDisplay.available ? (
        <>
          {flowDisplay.modelStats?.available && (
            <UsageFlowModelStatsPanel stats={flowDisplay.modelStats} />
          )}
          <div className="flow-page__content">
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
        </>
      ) : (
        <div className="flow-page__loading">
          <p>{loading ? '加载中…' : emptyMessage ?? '暂无流水记录'}</p>
        </div>
      )}
    </div>
  );
}
