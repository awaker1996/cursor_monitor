# 流水 Free 与 default 模型映射

- 日期：2026-07-22
- 类型：fix
- 关联文件：src/shared/usageFlowFormat.ts、src/core/normalizer.ts、scripts/verify-usage-flow-format.ts

## 变更摘要

- Model：`default` → `auto`（与 Cursor Billing 一致）
- Type/Cost：`USAGE_EVENT_KIND_FREE` → `Free`
- Tokens：无 token 时显示 `-`（对齐控制台）

## 验证

- `npx tsx scripts/verify-usage-flow-format.ts`
