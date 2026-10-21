import type { IncludedUsageDisplay } from '../../shared/format';
import { OTHER_MODELS_LABEL } from '../../shared/format';

interface IncludedUsageTableProps {
  display: IncludedUsageDisplay;
}

type CategoryAccent = 'api' | 'auto';

function categoryAccent(key: string): CategoryAccent {
  return key === 'api' ? 'api' : 'auto';
}

/**
 * 分区头的池名统一取官方全名。
 * 旧实现是「实心徽标（Cursor / Other）+ 名称」并排：徽标把名称首词又说了一遍，
 * 白占约 46px；右侧「总量 + 占比」又不压缩，于是统计值更宽的 Other 分区
 * （2727.3万 / 100.00%）把名称挤成 "Other Mod…"，Cursor 分区（4.2亿）却还完整。
 * 现在去掉徽标、只留全名，两区结构一致；分区识别交给底色与统计值颜色。
 */
function categoryTitle(label: string): string {
  return label === 'Other' ? OTHER_MODELS_LABEL : label;
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
          const title = categoryTitle(category.label);
          return (
            <section
              key={category.key}
              className={`included-usage__block included-usage__block--${accent}`}
              aria-label={title}
            >
              <header className="included-usage__section-head" title={title}>
                {/* 池名（可压缩、整词换行）与统计值（不压缩）分列两端：
                    窄面板下先换行、再省略，绝不把池名截成 "Other Mod…"。 */}
                <span className="included-usage__section-label">{title}</span>
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
