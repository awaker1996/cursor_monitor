# 账户与订阅：新增 WorkBuddy、MiniMax Code 积分卡

- 日期：2026-11-01
- 类型：feature
- 关联文件：`src/shared/subscriptionTypes.ts`, `src/core/subscriptions/WorkBuddyProvider.ts`（新增）, `src/core/subscriptions/MiniMaxCodeProvider.ts`（新增）, `src/core/subscriptions/SubscriptionManager.ts`, `src/renderer/components/SubscriptionUtils.ts`, `src/renderer/components/SubscriptionPanels.tsx`, `src/renderer/components/AccountCard.tsx`, `src/renderer/pages/SubscriptionsPage.tsx`, `src/renderer/styles.css`, `src/renderer/mockElectronAPI.ts`, `scripts/verify-credits-providers.ts`（新增）, `tsconfig.verify.json`, `README.md`

## 变更摘要

- 「账户与订阅」新增两个积分制平台，注册顺序排在 DeepSeek 之后：**WorkBuddy**、**MiniMax Code**；卡片沿用现有平台卡（品牌牌 + 顶部品牌细线 + 指标条），WorkBuddy 用蓝青、MiniMax Code 用橙玫
- 卡片常显区按截图的形态呈现，但不含「剩余额度走势」：
  - WorkBuddy：`5,356 / 6,000 积分` + 进度条、`剩余 89.27% · 有效期至 11月4日 07:28 · 3 天后`、`今日已签到 +100 · 连续 33 天`
  - MiniMax Code：`25,015.27 积分`（接口只给剩余，不做假进度条）、`有效期至 … · 7 天内到期 800 积分`、签到状态与「赠送 / 购买」拆分
- 展开区：WorkBuddy 列出各积分包（总量 / 剩余 / 到期 + 合计），MiniMax Code 列出积分批次（剩余 / 到期，按到期升序，最多 20 行）
- 凭据配置改为表驱动（`CREDENTIAL_META`，五个平台各一条文案），新增「测试连接」：非 Cursor 平台直接查一次该平台并给出 toast
- WorkBuddy：Bearer 令牌（在桌面端 Network 面板复制 `Authorization` 里 Bearer 之后的部分）
- MiniMax Code：令牌优先取手动配置；未配置时自动读取桌面端登录态 `~/.minimax/auth/prod/*/mcode-public/auth.json` 的 `access_token`，**只读不写**（刷新令牌会轮换登录态，本应用不得代劳）

## 接口与解析

| 平台 | 接口 | 关键字段 |
|---|---|---|
| WorkBuddy | `POST https://copilot.tencent.com/v2/billing/meter/get-user-resource-summary`（`{}`） | `Packages[].CycleTotalCapacity / CycleRemainCapacity / ExpireAt`、`SubscriptionPackageName`、`IsPaidUser` |
| WorkBuddy | `GET https://copilot.tencent.com/v2/billing/meter/checkin-activity-status` | 签到状态（字段未公开，防御式读取，失败忽略） |
| MiniMax Code | `POST https://agent.minimax.cn/matrix/api/v1/commerce/get_membership_info`（`{}`） | `op_credit_summary.total_remaining_amount / purchased_remaining_amount / free_remaining_amount`（**不读**已废弃的 `total_remains_credit`、`opcredit_balance`） |
| MiniMax Code | `GET https://agent.minimax.cn/minimax-cloud/api/v1/credit/details?page_number=1&page_size=100` | `details[].remaining_amount / expire_at_ms / credit_type` |
| MiniMax Code | `GET https://agent.minimax.cn/minimax-cloud/api/v1/signin/status?timezone_id=Asia/Shanghai` | 签到状态（字段未公开，防御式读取，失败忽略） |

- 两端都复用 `httpRequest`（自动走系统代理）与 `requestTimeoutSec`，请求头带浏览器 UA 与 `Accept-Language: zh-CN`
- 401/403 分别给出「WorkBuddy 令牌无效或已过期」「MiniMax Code 令牌已过期（约 1 小时）」；签到与批次接口失败只降级显示，不阻断额度

## 影响范围

- `SubscriptionProviderId` 增加 `'workbuddy' | 'minimaxcode'`；`SubscriptionData` 增加 `WorkBuddySubscriptionData` / `MiniMaxCodeSubscriptionData`，并新增 `CreditsPackage` / `CreditsLot` / `CreditsCheckin` 三个通用结构
- 缓存层零改动：`SubscriptionCache.isValidResult` 以 `data.providerId === key` 校验，新 provider 自动兼容；`CACHE_VERSION` 不变
- IPC / preload 零改动：订阅通道本来就是按 `providerId` 泛化传参
- `SubscriptionManager` 注册两个 Provider；两者都不实现 `fetchUsage`，因此 `usageSupported` 自动为 false，页面不会给它们渲染「用量月份」
- `SubscriptionPanel` 的分发由「兜底走 DeepSeek」改为显式匹配，未知 provider 返回 `null`，避免将来新增平台误渲染
- `CREDENTIAL_META` 统一了五个平台的凭据文案，「用量 Token」子块仍只对支持用量的平台出现
- 浏览器预览 `mockElectronAPI` 补齐两个平台的演示数据，纯浏览器打开 `/settings.html` 即可看到五张卡

## 风险与限制

- 两套接口都是**客户端内部接口**，无公开文档，客户端改版可能失效；失败时保留上次成功缓存并给出提示
- 仅支持 WorkBuddy 中国区（`copilot.tencent.com`）与 MiniMax Code 中国区（`agent.minimax.cn`）
- **只读**：不调用签到 `/signin/claim`、`daily-checkin` 等写接口，不做自动签到
- MiniMax Code 令牌约 1 小时有效；桌面端未安装或未登录时需手动粘贴，过期后需重新获取
- **不能改用 Cookie 请求**：两家的内部接口都只认 `Authorization: Bearer`（WorkBuddy 的 `buildAuthHeaders` 只拼 Authorization / X-User-Id；MiniMax 的会员接口以 `mmoat_` OAuth 令牌鉴权），Cookie 发过去会直接 401。全项目只有 Cursor 的接口是 Cookie 鉴权

## 补充（同日）：凭据输入清洗

- 新增 `src/core/subscriptions/credentialToken.ts`：`normalizeCredentialToken` 统一处理用户从 DevTools 复制的内容
  - 整行 `Authorization: Bearer xxx` → `xxx`；裸 `Bearer xxx` → `xxx`；首尾引号自动去掉
  - 若粘贴的是 Cookie 串，只在出现已知令牌字段（`access_token` / `mmoat_token` / `token` / `session_token` 等）时取出该字段的值；带 `=` 的 base64 令牌不会被误拆
- 两个 Provider 读取凭据（含 MiniMax 本地登录态）时都会先过这层清洗；配置界面的占位与提示同步改成「可整行粘贴」

## 验证

- `npm run typecheck` 通过（主进程 + 渲染层两套 tsconfig）
- `npm run build` 通过（双 HTML 入口 + 主进程 + preload）
- `npx tsc -p tsconfig.verify.json && node .tmp-verify/scripts/verify-credits-providers.js`：新增脚本 38 项断言全绿（两个平台的正常值、缺字段降级、低余量档位、7 天内到期合计、未配置 / providerId 不匹配返回 null、千分位格式化、凭据清洗的 8 种粘贴形态）
- 说明：`scripts/verify-collapsed-usage.ts` 引用了早已删除的 `collapsedUsageAriaLabel` / `providerCollapsedUsage`，`tsconfig.verify` 编译本来就会报这三条错（与本次改动无关，本次未处理）；tsc 仍会产出 JS，新增脚本可正常执行
- 浏览器预览（`dist` 静态服务 + mock，Chromium 截图）核对：两套主题下的五张卡、WorkBuddy 展开后的积分包表格、MiniMax Code 的批次与「7 天内到期」注释
- Electron 实例未实机启动：真实令牌未在本轮验证；接口字段依据 WorkBuddy 客户端包与社区插件文档核对
