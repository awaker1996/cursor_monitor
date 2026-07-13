# Included Usage 周期明细

- 日期：2026-07-13
- 类型：feature
- 关联文件：src/shared/types.ts、src/core/normalizer.ts、src/shared/format.ts、src/renderer/components/IncludedUsageTable.tsx、src/renderer/App.tsx、src/renderer/styles.css、scripts/verify-included-usage.ts

## 变更摘要

- 在展开面板新增 **Included Usage** 三列表格（Item / Tokens / Usage），展示当前账单周期内按模型聚合的用量明细
- `normalizer` 新增 `aggregateIncludedUsageByModel`，基于 `cycleEvents` 按 model 汇总 tokens 与 cost 分摊 usage%
- 扩展 `isAutoModel` 识别 `grok`，使 First-party 分类与 Dashboard 一致
- 新增万/亿 token 格式化与 `IncludedUsageTable` 组件，UI 适配深色窄面板

## 影响范围

- Cookie 数据源且 cycleEvents 可用时，在总消耗与 metric-card 之间展示周期模型明细
- 官方数据源或无 events 时不展示该区块
- 分页未拉全时展示已有数据并提示「部分事件未拉全」
- 原有 4 张 metric-card 保持不变

## 验证

- `npx tsx scripts/verify-included-usage.ts`
- `npm run typecheck`
