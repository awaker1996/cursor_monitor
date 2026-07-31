import {
  USAGE_FLOW_PAGE_SIZES,
  type UsageFlowPageSize,
} from '../../shared/usageFlowPagination';

interface UsageFlowPaginationProps {
  page: number;
  totalPages: number;
  totalCount?: number;
  pageSize: UsageFlowPageSize;
  disabled?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: UsageFlowPageSize) => void;
}

export default function UsageFlowPagination({
  page,
  totalPages,
  totalCount,
  pageSize,
  disabled,
  onPageChange,
  onPageSizeChange,
}: UsageFlowPaginationProps) {
  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  return (
    <div className="flow-pagination">
      <div className="flow-pagination__info">
        {totalCount != null && <span>共 {totalCount} 条</span>}
        <label className="flow-pagination__size">
          <span className="flow-pagination__size-label">每页</span>
          <select
            className="flow-pagination__size-select"
            value={pageSize}
            disabled={disabled}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as UsageFlowPageSize)}
            aria-label="每页条数"
          >
            {USAGE_FLOW_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span className="flow-pagination__size-label">条</span>
        </label>
      </div>

      <div className="flow-pagination__nav">
        <span className="flow-pagination__page-indicator">
          第 {page} / {totalPages} 页
        </span>
        <div className="flow-pagination__controls">
          <button
            type="button"
            className="btn-secondary btn-secondary--compact"
            onClick={() => onPageChange(1)}
            disabled={disabled || atFirst}
          >
            首页
          </button>
          <button
            type="button"
            className="btn-secondary btn-secondary--compact"
            onClick={() => onPageChange(page - 1)}
            disabled={disabled || atFirst}
          >
            上一页
          </button>
          <button
            type="button"
            className="btn-secondary btn-secondary--compact"
            onClick={() => onPageChange(page + 1)}
            disabled={disabled || atLast}
          >
            下一页
          </button>
          <button
            type="button"
            className="btn-secondary btn-secondary--compact"
            onClick={() => onPageChange(totalPages)}
            disabled={disabled || atLast}
          >
            末页
          </button>
        </div>
      </div>
    </div>
  );
}
