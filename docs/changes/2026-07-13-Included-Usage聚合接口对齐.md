# Included Usage 聚合接口对齐

- 日期：2026-07-13
- 类型：fix, feature
- 关联文件：src/core/providers/CookieProvider.ts、src/core/normalizer.ts、src/shared/types.ts、src/shared/format.ts、src/renderer/App.tsx、scripts/verify-included-usage.ts、README.md、requirements.md

## 变更摘要

- 核查与 Cursor Billing Included Usage 差距：根因是仅用 `get-filtered-usage-events` 分页重建明细（上限约 1500 条），模型列表与 Tokens 明显偏少
- 新增调用 `get-aggregated-usage-events`（控制台同源按模型聚合），优先用于 Included Usage；失败时回退事件聚合
- 去除总消耗区「账单周期 起/止」展示（日期保留在 Included Usage 标题下）
- Included Usage 区块下移到展开面板底部（操作按钮之上）

## 影响范围

- Cookie 数据源刷新时并行拉取聚合接口；事件分页超时不再拖死 Included Usage
- 官方数据源仍不展示 Included Usage
- 展开面板布局：总消耗 → metric cards →（可选提示）→ Included Usage → 刷新/设置

## 验证

- `npx tsx scripts/verify-included-usage.ts`
- `npm run typecheck`
