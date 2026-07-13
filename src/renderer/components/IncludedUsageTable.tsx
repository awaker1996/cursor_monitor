import type { IncludedUsageDisplay } from '../../shared/format';

interface IncludedUsageTableProps {
  display: IncludedUsageDisplay;
}

export default function IncludedUsageTable({ display }: IncludedUsageTableProps) {
  const [itemCol, tokensCol, usageCol] = display.columns;

  return (
    <section className="included-usage" aria-label={display.title}>
      <div className="included-usage__header">
        <h2 className="included-usage__title">{display.title}</h2>
        {display.dateRange && (
          <p className="included-usage__date-range">{display.dateRange}</p>
        )}
      </div>

      <div className="included-usage__table" role="table">
        <div className="included-usage__head" role="row">
          <span className="included-usage__cell included-usage__cell--item" role="columnheader">
            {itemCol}
          </span>
          <span className="included-usage__cell included-usage__cell--tokens" role="columnheader">
            {tokensCol}
          </span>
          <span className="included-usage__cell included-usage__cell--usage" role="columnheader">
            {usageCol}
          </span>
        </div>

        {display.categories.map((category) => (
          <div key={category.key} className="included-usage__category">
            <div className="included-usage__group" role="row">
              <span className="included-usage__cell included-usage__cell--item" role="cell">
                {category.label}
              </span>
              <span className="included-usage__cell included-usage__cell--tokens" role="cell">
                {category.tokens}
              </span>
              <span className="included-usage__cell included-usage__cell--usage" role="cell">
                {category.usage}
              </span>
            </div>

            {category.models.map((model) => (
              <div key={`${category.key}-${model.model}`} className="included-usage__row" role="row">
                <span
                  className="included-usage__cell included-usage__cell--item included-usage__cell--model"
                  role="cell"
                  title={model.model}
                >
                  {model.model}
                </span>
                <span className="included-usage__cell included-usage__cell--tokens" role="cell">
                  {model.tokens}
                </span>
                <span className="included-usage__cell included-usage__cell--usage" role="cell">
                  {model.usage}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {display.showIncompleteHint && (
        <p className="included-usage__hint">部分事件未拉全，明细可能不完整</p>
      )}
    </section>
  );
}
