import type { IncludedUsageDisplay } from '../../shared/format';

interface IncludedUsageTableProps {
  display: IncludedUsageDisplay;
}

type CategoryAccent = 'api' | 'auto';

function categoryAccent(key: string): CategoryAccent {
  return key === 'api' ? 'api' : 'auto';
}

function categoryBadge(accent: CategoryAccent): string {
  return accent === 'api' ? 'API' : 'FP';
}

export default function IncludedUsageTable({ display }: IncludedUsageTableProps) {
  return (
    <section className="included-usage included-usage--panel" aria-label={display.title}>
      <div className="included-usage__header">
        <h2 className="included-usage__title">{display.title}</h2>
        {display.dateRange && (
          <p className="included-usage__date-range">{display.dateRange}</p>
        )}
      </div>

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
