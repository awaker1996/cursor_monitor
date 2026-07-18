# Included Usage 列表 UI 美化

- 日期：2026-07-17
- 类型：feature
- 关联文件：src/renderer/components/IncludedUsageTable.tsx、src/renderer/styles.css、src/renderer/App.tsx、electron/main.ts、electron/preload.ts

## 变更摘要

- 移除 Included 视图下模型名强制换行样式，API 名称统一单行展示（`white-space: nowrap`）
- 表格区域支持横向滚动，长模型名可完整查看而不折行
- 美化列表：分类汇总卡片、模型列表左侧色条、行 hover、等宽字体、表头 sticky、用量列强调色

## 补充（同日）

- 取消横向滚动条，表格宽度自适应面板；API 名称仍单行显示，过长时省略号截断（hover 可见完整名称）
- 仅保留纵向滚动条

## 补充（同日续）

- 模型行改为双行布局：名称独占一行完整展示，Tokens/Usage 次行右对齐
- 切换到「明细」页时窗口加宽至 420px，切回「概览」恢复 340px，收起恢复默认尺寸
- 移除名称省略号截断
- 模型行恢复三列单行布局，API 名称与 Tokens/Usage 同一行对齐

## 影响范围

- 悬浮球弹窗「明细」视图的 Included Usage 表格布局与交互

## 验证

- `npm run typecheck`
- 切换到「明细」页，确认模型名（如 `claude-4.6-opus-high-thinking`）单行显示
- 名称过长时可横向滚动查看完整内容
- 表头在纵向滚动时保持固定
