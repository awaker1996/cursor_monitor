# 流水页 Command Code 平台与内存缓存

## 日期
2026-09-20

## 类型
feature, refactor

## 关联文件
- `src/renderer/pages/FlowPage.tsx` — 移除模型统计面板；新增 Command Code 平台按钮；进入/切换平台时按缓存回填或自动拉最近 1 天
- `src/renderer/components/UsageFlowModelStats.tsx`（删除）
- `src/renderer/styles.css` — 删除 `.flow-model-stats*` 规则
- `src/shared/types.ts` — 删除 `UsageFlowModelStat(s)` 与 `UsageFlowDisplay.modelStats`；`UsageFlowQuery` 增加 `preset`；新增 `UsageFlowCacheEntry` / `UsageFlowCacheSnapshot`
- `src/shared/subscriptionTypes.ts` — `SubscriptionCredentialKind` 增加 `sessionToken`；`SubscriptionProviderMeta` 增加 `sessionSupported` / `sessionConfigured`
- `src/core/normalizer.ts` — 删除 `buildUsageFlowModelStats`
- `src/core/providers/ProviderManager.ts` — 简化 Cursor 流水（去掉聚合/统计拉取）；新增 `fetchCommandCodeUsageFlow` 与统一列映射；接入内存缓存与 `getCachedUsageFlow`
- `src/core/providers/CookieProvider.ts` — 删除统计专用的 `fetchUsageFlowAggregated`；`fetchUsageFlowEventsForStats` 更名 `fetchUsageFlowEvents`（仅本地分页用）
- `src/core/UsageFlowCache.ts`（新增）— 进程内流水视图缓存
- `src/core/subscriptions/CommandCodeProvider.ts` — 新增会话凭据与 `fetchUsageFlow`（逐条流水）
- `src/core/subscriptions/SubscriptionManager.ts` — `sessionToken` 凭据账户解析；`listProviders` 输出会话凭据状态
- `src/core/subscriptions/types.ts` — `SubscriptionProvider` 增加 `sessionCredentialAccount`
- `src/renderer/pages/SubscriptionsPage.tsx` — Command Code 新增「流水凭据（网页会话）」配置区
- `electron/main.ts`、`electron/preload.ts`、`src/renderer/vite-env.d.ts` — `fetch-usage-flow` 透传 `preset`；新增 `flow-get-cached`

## 变更摘要

### 1. 移除「模型用量统计」面板
- 流水页只保留分页表格；删除 `UsageFlowModelStats.tsx`、`UsageFlowDisplay.modelStats`、`buildUsageFlowModelStats` 与 `.flow-model-stats*` 样式。
- `fetchCursorUsageFlow` 因此不再请求 `get-aggregated-usage-events` 与「为统计拉全量事件」，删去 `CookieProvider.fetchUsageFlowAggregated`；原先为统计与本地分页共用的 `fetchUsageFlowEventsForStats` 仅剩本地分页用途，更名为 `fetchUsageFlowEvents`（避免全量额度上限下往返服务端分页的边界错位）。

### 2. 新增 Command Code 平台（逐条流水）
- `PLATFORM_OPTIONS` 增加 `Command Code`，顺序对齐订阅页：Cursor → Command Code → DeepSeek。
- 关键事实（只读探测确认）：`/internal/usage` 仅接受**浏览器会话**，用 API Key 请求固定返回 `401 You're logged out`（`@commandcode/shared` 常量亦注明“the /internal variant is browser-session only; the CLI cannot reach it”）。因此本页不复用 `/alpha` 的 API Key，而是新增独立凭据：
  - `SubscriptionCredentialKind` 增加 `sessionToken`；`CommandCodeProvider.sessionCredentialAccount = 'commandcode-session'`。
  - 订阅页 Command Code 配置区新增「流水凭据（网页会话）」输入（保存/清除），并接入 `sessionSupported` / `sessionConfigured` 状态与配置区自动展开判断。
  - 凭据形态自适应：含 `=` 视为 Cookie 头，否则视为 `Bearer` Token；请求附 `Origin/Referer: https://commandcode.ai`。
- `CommandCodeProvider.fetchUsageFlow(from,to,limit)` → `GET /internal/usage`，响应做防御式解析（数组容错 `data`/`items`/`usage`/`rows`/`events`；字段容错 `createdAt|created_at|timestamp`、`model|modelId`、`tokensIn|inputTokens`、`tokensOut|outputTokens`、`tokensTotal`、`totalCost|cost`、`status`），401/403 提示重新登录。
- **接口契约（联调实测确定）**：`GET /internal/usage?userId&from&to&limit`（ISO 时间）→ `{ "usages": [ … ] }`；`limit` 上限 100（超出 400），响应按时间倒序且**单次固定截断到 100 条、`offset` 不生效**。单行字段：`createdAt`、`tokensIn`/`tokensOut`（字符串）、`status`、`type`、`mode`，成本在 `meta.totalCost`、模型在 `meta.model`。
  - **按时间回溯翻页**：既然 `offset` 不生效，改用「取 [from, upper] 内最新 100 条 → 以本批最旧时间作为下一轮 `to`」逐步前推，直到不足 100 条或触达 `from`；最多 20 轮（≈2000 条），触顶置 `incomplete`。按 `id` 去重，若某轮无新增即停止（防 `to` 被忽略时死循环）。
  - 排查过程：首次 400 因 `limit=1000` 超上限（错误体明确 `Too big: expected number to be <=100 at "limit"`）；随后 200 但「无记录」因响应数组键为 `usages`；再之后只出 100 条，因 `offset` 不生效、服务端固定截断。
  - `userId` 取自 `/alpha/whoami`（可选，接口未要求；带上以兼容团队账号）；成本按量级取 2/4/6 位小数，避免小额显示成 `$0.00`。
- `ProviderManager.fetchCommandCodeUsageFlow` 取回后客户端分页（与 DeepSeek 同款 slice 逻辑）。

### 3. 三平台统一列
- 各平台统一为 **Date / Type / Model / Tokens / Cost**：
  - Cursor：沿用控制台映射不变。
  - Command Code：Type = `Completed` / `Failed`（无 status 时 `Usage-based`），Tokens 走 `formatUsageFlowTokens`（万/亿，零显示 `-`），Cost = `$x.xx`（无成本显示 `-`）。
  - DeepSeek：保持 `Type=Included`、`Cost=-`，Tokens 同样走万/亿格式。

### 4. 默认最近 1 天 + 内存缓存
- 默认预设固定为 `1d`（`DEFAULT_PRESET`）。
- 新增进程内 `UsageFlowCache`（不落盘）：按平台保存「查询条件 + 上次成功结果 + 时间」，失败不覆盖（对齐订阅缓存原则）。`ProviderManager.fetchUsageFlow` 成功后写入，`getCachedUsageFlow` 经 `flow-get-cached` 暴露。
- FlowPage 进入时：读缓存 → 用 `lastPlatform`（默认 cursor）与该平台缓存直接回填；无缓存则自动请求最近 1 天。切换平台时命中该平台缓存即回填，否则重置为最近 1 天并自动请求。
- **刷新/翻页重算相对范围（联调修复）**：原先拉取直接复用组件内保存的 `dateRange`，相对预设（1d/7d/30d/MTD）的 `to` 会停在首次进入/切换预设的时刻，刷新后仍缺最近几分钟的数据（表现为面板有 12:49 的记录而流水没有）。现统一经 `resolveActiveRange()`：相对预设每次拉取（刷新 / 翻页 / 每页条数）都重新解析到现在，`custom` 仍用用户选定的固定范围。

## 影响范围
- 流水页不再有模型统计条形图；首屏会在无缓存时自动发起一次最近 1 天请求（此前为完全手动刷新）。
- 流水数据改为进程内缓存：切换 Tab / 重开设置窗口会回填上次结果；应用重启后清空。
- 新增 Command Code 流水会话凭据（`commandcode-session`，与 `commandcode-api-key` 分离）；未配置时流水页提示「需配置对应平台凭据」。
- Command Code 逐条流水的接口路径/参数/字段为内部接口（Studio 网页端同源，未公开），已做容错解析。

## 验证
- `npx tsc -p tsconfig.electron.json --noEmit` 与 `npx tsc -p tsconfig.json --noEmit` 均通过（同时消除了 `ProviderManager.ts` 改动前遗留的未使用声明报错）。
- `npx tsx scripts/verify-usage-flow-format.ts` 全部用例通过（流水字段映射未回归）。
- 只读探测（临时脚本，用本机 `~/.commandcode/auth.json` 凭据，仅 GET，不打印凭据内容；验证后已删除）：
  - `api.commandcode.ai/alpha/whoami` → 200；
  - `api.commandcode.ai/internal/usage`（含各种 from/to/limit/page 组合）→ 401 `You're logged out`，确认 API Key 无法访问逐条流水；
  - `commandcode.ai/*` → 404（接口只在 api 子域）。
- 联调（会话凭据实测）：`limit=1000` → 400（`expected number to be <=100 at "limit"`）；改为 `limit=100` 并识别响应键 `usages` 后，成功取到逐条流水（`createdAt`/`tokensIn`/`tokensOut`/`status`/`meta.totalCost`/`meta.model`）。定位所用的临时「原始响应落盘」诊断（写 `.tmp-verify/`）已随修复移除。
- 人工验证（待用户执行）：流水页三个平台切换、无统计面板、Command Code 列出逐条调用（Date/Type/Model/Tokens/Cost）且分页正常；切 Tab 再回来直接展示上次结果；点「刷新」更新。
