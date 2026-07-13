# First-party models 表述同步

- 日期：2026-07-13
- 类型：fix
- 关联文件：src/shared/format.ts、README.md、requirements.md

## 变更摘要

- 将 Dashboard 指标展示文案从 `Auto + Composer` 同步为 Cursor 官方新口径 `First-party models`
- 常量 `AUTO_COMPOSER_LABEL` 重命名为 `FIRST_PARTY_MODELS_LABEL`
- 更新 README 与 requirements 术语说明，标注原 Auto + Composer 池对应关系

## 影响范围

- 展开面板「今日 / 周期 First-party models」标签与 Cursor Dashboard 一致
- 内部字段名（`auto`、`autoPercentUsed` 等）不变，仍与 API 响应映射一致

## 验证

- `npm run typecheck`
