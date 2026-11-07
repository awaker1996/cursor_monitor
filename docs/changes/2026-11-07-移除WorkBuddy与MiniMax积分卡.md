# 账户与订阅：移除 WorkBuddy、MiniMax Code 积分卡

- 日期：2026-11-07
- 类型：refactor
- 关联文件：`src/shared/subscriptionTypes.ts`, `src/core/subscriptions/WorkBuddyProvider.ts`（删除）, `src/core/subscriptions/MiniMaxCodeProvider.ts`（删除）, `src/core/subscriptions/credentialToken.ts`（删除）, `src/core/subscriptions/SubscriptionManager.ts`, `src/renderer/components/SubscriptionUtils.ts`, `src/renderer/components/SubscriptionPanels.tsx`, `src/renderer/components/AccountCard.tsx`, `src/renderer/pages/SubscriptionsPage.tsx`, `src/renderer/styles.css`, `src/renderer/mockElectronAPI.ts`, `scripts/verify-credits-providers.ts`（删除）, `tsconfig.verify.json`, `README.md`

## 变更摘要

- 「账户与订阅」去掉了两个积分类平台卡片，界面只保留 Cursor / Command Code / DeepSeek 三张账户卡
- 删除 `WorkBuddyProvider` 与 `MiniMaxCodeProvider`，`SubscriptionManager` 不再注册这两个提供方；`SubscriptionProviderId` 联合类型同步收窄，注册顺序即卡片顺序
- 删除仅服务于这两家的 `credentialToken.ts`（Bearer / Cookie 令牌清洗），Command Code 与其余平台不依赖它
- 类型层清理：移除 `WorkBuddySubscriptionData` / `MiniMaxCodeSubscriptionData` 及配套的 `CreditsPackage` / `CreditsLot` / `CreditsCheckin`，`SubscriptionData` 联合类型只保留三家
- 渲染层清理：删除两家的收起态视图构建（`buildWorkBuddyCardView` / `buildMiniMaxCodeCardView` 与积分 / 到期 / 签到辅助函数）、展开态明细（积分包表、积分批次表）、凭据表单文案、平台牌首字母映射与四条品牌配色规则
- 浏览器预览 mock 同步删除两家的演示数据与分发分支；积分卡回归脚本 `verify-credits-providers.ts` 一并删除，`tsconfig.verify.json` 移除对应入口
- README 的范围内清单、FR-10 / FR-11、目录结构、风险与版本规划同步改为三平台口径

## 影响范围

- 「账户与订阅」卡片数量由五张回到三张，已保存的 `workbuddy-access-token` / `minimaxcode-access-token` 凭据不再被读取（凭据库中可能残留，不再有入口清除，不影响运行）
- 订阅缓存中的 `workbuddy` / `minimaxcode` 条目不再被解析（类型收窄后忽略），不影响其余平台的缓存命中
- 其余平台（Cursor / Command Code / DeepSeek）的查询、刷新、凭据与缓存链路不变
- 不涉及主链路 token 快照与悬浮球逻辑

## 验证

- `npm run typecheck`：`tsconfig.electron.json` 与 `tsconfig.json` 均通过
- `npm run build`：Vite 生产构建通过，无残留对已删除模块的引用
- 全仓检索 `workbuddy|minimaxcode|MiniMax|WorkBuddy`：源码与脚本中无命中，仅历史归档文档保留原始记录
