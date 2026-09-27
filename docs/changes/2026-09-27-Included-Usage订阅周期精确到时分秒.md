# Included Usage 订阅周期精确到时分秒

- 日期：2026-09-27
- 类型：feature
- 关联文件：src/shared/format.ts

## 变更摘要

悬浮球弹窗 / 「用量」Tab 顶部 "Included Usage" 下方原本只显示日期区间（"Sep 24, 2026 - Oct 24, 2026"），按反馈追加 `HH:MM:SS` 精度，渲染为 "Sep 24, 2026 00:00:00 - Oct 24, 2026 23:59:59"，与 `formatBillingDate`（订阅详情页的「计费周期」行）保持同一档时间精度。

### 修改点

`src/shared/format.ts` 内的私有函数 `formatIncludedUsageDateRange`：

- 内部闭包 `formatOne` 在原有 `toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })` 后追加检测：
  - 复用已有的 `hasTimeComponent(iso)`（`/T\d{2}:\d{2}/`）判断 ISO 串是否携带时间分量
  - 有时间分量时追加 `${pad2(h)}:${pad2(m)}:${pad2(s)}`，时间分隔符用半角空格
  - 无时间分量（仅 `YYYY-MM-DD`）时维持原样只输出日期，不强行补 `00:00:00`，避免误导
- 区间连接符 `-` 与外层包络结构不变

### 输出示例

| 输入（start / end） | 渲染结果 |
|---|---|
| `2026-09-24` / `2026-10-24` | `Sep 24, 2026 - Oct 24, 2026`（保持原样，无时间分量） |
| `2026-09-24T00:00:00+08:00` / `2026-10-24T23:59:59+08:00` | `Sep 24, 2026 00:00:00 - Oct 24, 2026 23:59:59` |

时间取浏览器本地时区（与 `formatBillingDate` 行为一致），订阅详情页的「计费周期」行、悬浮球顶部的「上次刷新」均沿用同一规则，三处时区口径统一。

## 交互细节

- 「Included Usage」标题旁的 `<p className="included-usage__date-range">` 元素与字号 / 颜色不变，仅文本内容变长
- 区间变长后不换行（容器允许横向 `overflow-x: hidden` 在极端窄窗下兜底，与既有策略一致）

## 影响范围

- 仅影响「Included Usage」header 内的 `dateRange` 文本
- 不改数据流、不改类型契约（`IncludedUsageDisplay.dateRange` 仍为 `string | null`）
- 不影响其他位置的日期展示（订阅详情页「计费周期」行的 `formatBillingDate` 行为不变；悬浮球「上次刷新」走另一处格式化逻辑，本次未触碰）

## 验证

- `npm run typecheck`
- `npm run build`
- Node 单测三类输入：
  - `2026-09-24T00:00:00+08:00` + `2026-10-24T23:59:59+08:00` → `Sep 24, 2026 00:00:00 - Oct 24, 2026 23:59:59`
  - `1970-01-01T00:00:00.000Z` → `Jan 1, 1970 08:00:00`（本地 +08:00）
  - `2026-09-24`（纯日期） → `Sep 24, 2026`（不带时间）
- 打开弹窗 → 切到「用量」Tab → 顶部 Included Usage 下方区间行精度为 `HH:MM:SS`