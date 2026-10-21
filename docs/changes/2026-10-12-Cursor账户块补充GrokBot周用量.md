# Cursor 账户块补充 Grok Bot 周用量与重置时间

## 日期
2026-10-12

## 类型
feature

## 关联文件
- `src/shared/subscriptionTypes.ts`
- `src/core/subscriptions/sandUsage.ts`（新增）
- `src/core/subscriptions/CursorProvider.ts`
- `src/core/subscriptions/SubscriptionManager.ts`
- `src/core/subscriptions/SubscriptionCache.ts`
- `src/core/providers/CookieProvider.ts`
- `src/renderer/components/SubscriptionUtils.ts`
- `src/renderer/components/SubscriptionPanels.tsx`
- `scripts/verify-sand-usage.ts`（新增）
- `scripts/verify-collapsed-usage.ts`
- `tsconfig.verify.json`
- `README.md`
- `docs/changes/README.md`

## 变更摘要
- 设置页「账户与订阅」的 Cursor 卡片新增独立区块「Grok Bot 周用量」：周用量分段计量条 + 重置时间 + 「额度用尽会暂停 / 可设按需额度」提示，对齐 Cursor 控制台对应功能区
- 新增 `sandUsage.ts`：Grok Bot 在 Cursor 后端代号为 **sand**（`SandBillingBrand = CURSOR | GROK`，会话类型 `SESSION_TYPE_SAND_MOBILE` 展示名即「Grok Bot」），封装端点候选 `SAND_USAGE_ENDPOINTS` 与纯函数 `parseSandUsageStatus()`
- `CursorProvider` 由「零请求、只复用 `TokenSnapshot`」改为额外并发请求一次 `POST /api/dashboard/get-sand-usage-status`；构造函数新增 `getSettings`（超时复用 `requestTimeoutSec`）
- `CookieProvider` 的 `normalizeWorkosCookie` 与 `buildDashboardHeaders` 改为导出以便复用（行为不变，与 `isUsableCookieSummary` 的既有做法一致）
- `CursorSubscriptionData` 新增 `grokBot: CursorGrokBotUsage | null`；`subscriptionTypes.ts` 新增 `CursorGrokBotUsage` 与 `RawSandUsageStatusResponse`
- `SubscriptionCache.CACHE_VERSION` 由 2 提升到 3：Cursor info 结构变化，避免旧缓存最长 12h 内看不到新区块
- 展开态抽出通用 `MeterRow`（原 `UsageLimitRow` 的渲染体），Command Code 三条限额条改为复用它，外观不变
- `verify-collapsed-usage.ts` 的 `cursorData()` 夹具补 `grokBot: null`（字段变必填）

## 影响范围
- **数据来源**：`usage-summary` 原始响应（已实测 dump）不含任何 grok/weekly 字段，`get-plan-info` 的 `includedUsagePeriod` 对 Pro 账户为 `MONTHLY`，均无法替代本接口，因此必须新增这一次请求
- **`usagePercent` 口径**：接口原样返回百分比而非 0-1 比例——实测 `0.748597` 对应控制台「Weekly usage 1% used」且进度条近乎空；解析层不做任何缩放，只夹取 0-100
- **降级策略**：未配置 Cookie 直接跳过；网络失败 / 非 2xx / JSON 异常只记 `log.warn` 并返回 `null`，`fetchInfo()` 仍返回成功，Cursor 主体用量不受影响；`grokBot === null` 时区块整体不渲染
- **`hasNonZeroIncludedLimit` 为 false**（套餐不含 Grok Bot 周额度）时不画进度条，改显示「当前套餐未包含 Grok Bot 周额度」
- Grok Bot 的 `grok-bot-*` 模型剔除逻辑（`normalizer.ts`）与本区块无关：本区块是账户级周额度，不参与模型明细
- 收起态小条（`providerCollapsedUsage`）保持不变，未新增 Grok Bot 小条

## 验证
- `npm run typecheck` 通过（主进程与渲染层双套 tsc）
- `npx tsc -p tsconfig.verify.json --noEmit` 通过
- `npx tsx scripts/verify-sand-usage.ts` 通过（以 2026-10-12 实测真实响应为夹具：`usedPercent === 0.748597` 且四舍五入为 1、`resetsAt === '2026-10-15T04:08:41.245Z'`、`brand === 'cursor'`；并覆盖空对象 / `null` 入参 / 字符串数字 / `NaN` / 超 100 / 负数 / 空白串 / GROK 品牌与 `formatSandReset` 的未知、未来、过期三态）
- `npx tsx scripts/verify-collapsed-usage.ts`、`verify-today-percent.ts`、`verify-cookie-summary.ts`、`verify-included-usage.ts` 全部通过（无回归）
- `npm run build` 通过（两入口 + 主进程 / preload）
- 实机验收：`npm run dev` → 设置页「账户与订阅」→ 展开 Cursor 卡片，应见「Grok Bot 周用量」区块约 1% 与「重置：10 月 15 日（N 天后）」，Command Code 三条限额条外观无变化
