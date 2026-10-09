import type { IncludedUsageDisplay } from '../../shared/format';

interface IncludedUsageTableProps {
  display: IncludedUsageDisplay;
}

type CategoryAccent = 'api' | 'auto';

function categoryAccent(key: string): CategoryAccent {
  return key === 'api' ? 'api' : 'auto';
}

function categoryBadge(accent: CategoryAccent): string {
  return accent === 'api' ? 'Other' : 'Cursor';
}

export default function IncludedUsageTable({ display }: IncludedUsageTableProps) {
  return (
    <section className="included-usage included-usage--panel" aria-label={display.title}>
      {/* 面板内不渲染 __header（标题 / 订阅周期）：与「概览」视图同起跑线，
          首个分组块直接顶到面板内容区上沿，切换前后不留落差。
          display.title 仍作为 section 的可访问名保留。 */}
      <div className="included-usage__body">
        {display.categories.map((category) => {
          const accent = categoryAccent(category.key);
          return (
            <section
              key={category.key}
              className={`included-usage__block included-usage__block--${accent}`}
              aria-label={category.label}
            >
              <header className="included-usage__section-head">
                <span className="included-usage__badge">{categoryBadge(accent)}</span>
                {category.label !== categoryBadge(accent) && (
                  <span className="included-usage__section-label">{category.label}</span>
                )}
                <span className="included-usage__section-stats">
                  <span className="included-usage__entry-tokens">{category.tokens}</span>
                  <span className="included-usage__entry-usage">{category.usage}</span>
                </span>
              </header>

              <div className="included-usage__models">
                {category.models.map((model) => (
                  <div
                    key={`${category.key}-${model.model}`}
                    className="included-usage__entry"
                  >
                    <span className="included-usage__entry-name">{model.model}</span>
                    <span className="included-usage__entry-tokens">{model.tokens}</span>
                    <span className="included-usage__entry-usage">{model.usage}</span>
                    <span className="included-usage__entry-share" aria-hidden>
                      <span
                        className="included-usage__entry-share-fill"
                        style={{ width: `${model.shareValue}%` }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {display.showIncompleteHint && (
        <p className="included-usage__hint">部分事件未拉全，明细可能不完整</p>
      )}
    </section>
  );
}
