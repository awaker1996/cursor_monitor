---
trigger: always_on
---

# 变更归档规则

任何涉及**源码、配置、构建脚本**的改动，必须在同一次工作中完成归档。

## 必须归档

- `electron/`、`src/` 下的代码变更
- `package.json`、`vite.config.ts`、`tsconfig*.json`、`electron-builder.yml` 等配置
- 构建脚本（`scripts/`）

## 归档步骤

1. 在 `docs/changes/` 新增 `YYYY-MM-DD-<中文简述>.md`（简述必须使用中文）
2. 使用模板（与现有归档文档保持一致）：

   ```markdown
   # <标题>

   - 日期：YYYY-MM-DD
   - 类型：feature / fix / refactor / build / docs（可多选，逗号分隔）
   - 关联文件：<以顿号分隔的文件路径列表>

   ## 变更摘要

   - <每条一个要点>

   ## 影响范围

   - <受影响的功能/模块>

   ## 验证

   - <执行过的命令与结果，如 npm run typecheck、npx tsx scripts/verify-*.ts>
   ```

3. 更新 `docs/changes/README.md` 索引表（按日期追加一行：日期、标题、类型、文件链接）

## 可合并归档

- 纯 typo、注释微调可与同主题已有条目合并，不单独建档
- 仅文档改动（无代码）可单独建 `docs` 类型条目

## 示例文件名

- `2026-07-06-EXE体积优化-第一阶段.md`
- `2026-07-25-token明细不可用网络重试与缓存回填.md`
