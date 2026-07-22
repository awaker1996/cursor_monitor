# 流水 MAX 标识与零 token Free 推断

- 日期：2026-07-22
- 类型：fix
- 关联文件：src/shared/usageFlowFormat.ts、src/renderer/components/UsageFlowTable.tsx、src/shared/types.ts、scripts/analyze-usage-flow-kinds.ts

## 变更摘要

- Model 列：`maxMode: true` 时显示蓝色 **MAX** 徽标（对齐控制台）
- Type/Cost：显式 `kind` 优先；**无 token 消耗**（tokens=0）且非 Usage-based 时默认 **Free**
- 新增 `scripts/analyze-usage-flow-kinds.ts` 可拉取近 1 天数据统计 kind/maxMode 分布

## 验证

- `npx tsx scripts/verify-usage-flow-format.ts`
- `set WORKOS_COOKIE=... && npx tsx scripts/analyze-usage-flow-kinds.ts`
