# Command Code 单凭据与超时修复

日期：2026-10-10
类型：fix, feature, refactor
关联文件：`src/core/subscriptions/CommandCodeProvider.ts`、`src/core/subscriptions/SubscriptionManager.ts`、`src/shared/subscriptionTypes.ts`、`src/renderer/pages/SubscriptionsPage.tsx`、`README.md`

## 变更摘要

### 超时根因修复

- 之前单个 `AbortController` 超时（默认 10 秒）管住全部 4 个请求（whoami → credits/subscriptions 并发 → usage/summary）；实测无鉴权 whoami 空跑约 5.4 秒，弱网下必 `AbortError`，面板只显示「请求超时，请检查网络后重试」。
- 改为每个请求独立占满配置超时（下限 10 秒），credits 与 subscriptions 仍并发，summary 仍串行；请求统一带浏览器 UA。

### 凭据：单框二选一，免装 CLI

- 解析从三级扩展为四级：手动录入 → 环境变量 → `~/.commandcode/auth.json` → 浏览器会话 Token；401/403 自动切下一个候选，超时/5xx 直接报不再换凭据碰运气。
- 单个凭据框同时接受控制台密钥完整内容（`user_` / `sk` 开头，整体复制勿截断）与浏览器 Token（`Authorization: Bearer` 后段或 Cookie 整段）；请求层对含 `=`/`;` 的值自动追加 `Cookie` 头变体（含 `__Secure-authjs.session-token` 提取），`CommandCodeCredentialSource` 新增 `session`。
- 浏览器会话 Token 沿用用量 Token 的 vault 存取链路（`commandcode-session-token`，`CredentialVault` 加密保存）；清除 Command Code 凭据时把历史版本残留的会话账户一并清除。
- 套餐月度映射与社区 CLI 对齐补齐（`individual-pro` 30 / `individual-pro-v1` 80 / `individual-provider` 15 / max-ultra 等），之前 `individual-pro` 会被作用域剥离误算成 80。

### 界面简化

- Command Code 卡片从「API Key 框 + 浏览器 Token 框」合并为单个「Command Code 凭据」框（保存/清除凭据），收起态状态文案改为「凭据 已配置/未配置」；DeepSeek 的用量 Token 框不受影响。

## 影响范围

- 「账户与订阅」Command Code 卡片：未装 CLI 的机器可直接粘贴控制台密钥或浏览器 Token 查询；已存历史浏览器 Token 的用户不受影响（仍参与候选），清除时会一并清理。
- `SubscriptionManager.listProviders` 的 `usageConfigured` 改为只要存在 `usageCredentialAccount` 即上报（不再要求 `fetchUsage` 存在），目前仅 Command Code 命中。
- 超时提示改为「可去数据刷新里调大超时」；401/403 提示指向 `commandcode.ai/settings/keys` 重建或浏览器重拷。

## 验证

- `npm run typecheck` 通过（electron + renderer 两个 tsconfig）。
- `npm run build` 通过。
- 未持有效 Key 的实机验证：无鉴权 `curl https://api.commandcode.ai/alpha/whoami` 返回 401、耗时约 5.4 秒，确认弱网下旧的共享 10 秒超时不足。

## 待人工回归

1. 粘 Studio 密钥完整内容刷新成功，收起态出现套餐 pill 与三段限额小条。
2. 清除凭据后粘浏览器 Bearer / Cookie 整段刷新成功。
3. 弱网下不再误报超时；401 时按新文案重建 Key 后恢复。
