# Included Usage 自费 key 与 auto 命名

- 日期：2026-07-13
- 类型：fix
- 关联文件：src/core/normalizer.ts、scripts/verify-included-usage.ts

## 变更摘要

- 有成本信号时，零成本模型（自费 API key / BYOK，如 deepseek）Usage 固定为 `0%`，不再按 token 占比分摊套餐用量；Tokens 仍展示
- Included Usage 将 First-party 的 `default` 显示为 `auto`，与 Cursor Billing 面板一致

## 影响范围

- Included Usage 模型行 Usage% 与 Item 文案
- 分类汇总百分比仍来自 `usage-summary`，不受影响

## 验证

- `npx tsc -p tsconfig.verify.json && node .tmp-verify/scripts/verify-included-usage.js`
- `npm run typecheck`
