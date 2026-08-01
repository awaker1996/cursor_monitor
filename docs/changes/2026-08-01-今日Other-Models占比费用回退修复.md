# 今日 Other Models 占比费用回退修复

- 日期：2026-08-01
- 类型：fix
- 关联文件：src/core/normalizer.ts、src/core/providers/CookieProvider.ts、scripts/verify-today-percent.ts

## 变更摘要

- 根因 1：07-13 将今日百分比固定为纯费用口径后，费用份额显著高于 token 份额时会虚高「今日 Other Models」
- 根因 2：周期 events 仅拉取最多 15 页；分页截断时今日占比退回纯费用，而 UI 上的周期 token（如 98.7M）来自 aggregated，分母不一致，刷新后仍显示约 22%
- 恢复费用/token 双口径择优：份额对齐时优先费用；费用份额高出 token ≥5% 时回退 token 份额
- 周期 token 分母优先使用 `get-aggregated-usage-events`（与展示一致），完整 events 作为回退
- 触达 `maxPages` 且末页仍满页时标记 `eventsComplete=false`，避免截断样本被当成完整周期

## 影响范围

- 概览「今日 Cursor Models / 今日 Other Models」在费用虚高或 events 截断时贴近真实 token 占比
- 费用与 token 一致时仍走费用口径
- 周期百分比本身不受影响

## 验证

- `npx tsx scripts/verify-today-percent.ts` 全部通过
