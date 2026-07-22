interface UsageFlowPaginationProps {
  page: number;
  totalPages: number;
  totalCount?: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
}

export default function UsageFlowPagination({
  page,
  totalPages,
  totalCount,
  disabled,
  onPageChange,
}: UsageFlowPaginationProps) {
  return (
    <div className="flow-pagination">
      <div className="flow-pagination__info">
        {totalCount != null && <span>共 {totalCount} 条</span>}
        <span>
          第 {page} / {totalPages} 页
        </span>
      </div>
      <div className="flow-pagination__controls">
        <button
          type="button"
          className="btn-secondary btn-secondary--compact"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          上一页
        </button>
        <button
          type="button"
          className="btn-secondary btn-secondary--compact"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
