# 补记：托盘摘要列对齐与 ErrorHint 分级

## 日期
2026-09-20（补记 2026-09-18 批次遗漏项）

## 类型
fix, feature

## 关联文件
- `src/shared/format.ts` — `formatTrayTooltip` 列对齐与合并行
- `src/renderer/components/ErrorHint.tsx` — 新增 `tone` 分级
- `src/renderer/styles.css` — `.error-hint--info/warn/error` 分级配色

## 背景
以下两处改动属于 2026-09-18 批次（与 [其他订阅 Command Code 用量查询](./2026-09-18-其他订阅CommandCode用量查询.md)、[订阅流水设置页功能区调整](./2026-09-18-订阅流水设置页功能区调整.md) 同批未提交改动），但当时三篇归档文档均未列入关联文件，属归档遗漏，现补记。

## 变更摘要

### 1. 托盘悬停摘要对齐（`format.ts`）
1. `formatTrayTooltip` 用 `padEnd` 把模型名补齐到 `CURSOR_MODELS_LABEL` / `OTHER_MODELS_LABEL` 两者中较长的宽度，使「今日 / 周期」四行的百分比数值纵向对齐成列
2. 「来源」「更新」由两行合并为一行（`来源 X  更新 Y`），摘要从 7 行降到 5 行，减少托盘悬停气泡高度
3. 同步更新函数 JSDoc，说明对齐规则与「来源 + 更新时间共用末行」
4. 仍遵守 2026-07-24 定下的「一项一行」原则（指标之间不拼行），仅把来源与时间这两项元信息合并

### 2. ErrorHint 分级（`ErrorHint.tsx` + `styles.css`）
1. 新增 `tone?: 'info' | 'warn' | 'error'`（默认 `warn`），据此输出 `error-hint--{tone}` 类与对应图标（`info` → `i`，`warn` / `error` → `!`）
2. 无障碍：容器补 `role="status"`，图标加 `aria-hidden`；状态由文案 + 颜色共同表达，不单独依赖颜色
3. 配套样式：`info` 蓝色（`#bfdbfe` 描边 + 蓝底）、`warn` 琥珀（`#fde68a` + `#fffbeb`）、`error` 红色（`#fecaca` + `#fef2f2`）；悬浮球深色面板沿用既有 `.floating-ball .error-hint` 暗色覆盖，观感不变
4. 使用方：`FlowPage`（未加载时 `info` 引导「点击「刷新」按钮加载数据」、拉取失败 `error`、空结果 `info`）；`SubscriptionsPage`（凭据 / 用量失败 `error`、缓存过期 `warn`、空月份 `info`）

## 影响范围
- 托盘悬停气泡文案行数与对齐方式（用户可见）
- 流水页、订阅页的错误/提示条配色与图标（用户可见）；默认档为 `warn`，未传 `tone` 的调用保持原有琥珀观感
- 无接口、无数据结构变更

## 验证
- 托盘摘要：四行指标百分比在等宽字体下对齐；来源与更新时间同行显示
- ErrorHint：`FlowPage` / `SubscriptionsPage` 三档 `tone` 均按预期配色渲染；`?raw` 之外无构建期影响
- 待用户执行：悬停托盘图标确认 5 行摘要、列对齐；在流水页/订阅页触发各类提示确认配色分级

## 备注
- `ErrorHint.tsx` 当前文件末尾缺少换行符（`\ No newline at end of file`），建议后续顺手补上，避免 diff 噪声
