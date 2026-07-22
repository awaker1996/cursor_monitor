# Cursor Token 悬浮球需求说明书

> **说明**：本文档内容已合并至 [README.md](./README.md)（项目参考文档）。  
> 后续请以 README.md 为准；本文件保留作需求追溯。

## 1. 文档信息
- 项目名称：Cursor Token 悬浮球（Windows）
- 文档版本：v1.3
- 状态：已合并至 README.md
- 统一参考文档：[README.md](./README.md)
- 最后更新：2026-07-22

## 2. 背景与目标
- 背景：需要在桌面实时查看 Cursor 账号 token 余量，避免频繁打开网页或控制台。
- 目标：提供一个轻量、常驻、可配置自动刷新的悬浮球，展示 `auto` 与 `api` 用量概览、周期用量明细及余量；并提供对齐控制台的用量流水窗口。
- 目标用户：个人开发者（账号所有者本人）。

## 3. 范围定义
### 3.1 范围内
- Windows 桌面常驻悬浮球（可拖拽、置顶、贴边半隐收起、托盘管理）。
- 显示 `auto` 与 `api` 两类 token 余量及 Dashboard 用量指标（概览 / 用量分段切换）。
- 用量流水独立窗口（日期筛选、分页、手动刷新；字段对齐 cursor.com 控制台）。
- 系统托盘悬停展示概览用量摘要（随快照刷新更新）；右键菜单为流水、设置、退出。
- 自动刷新与可配置刷新间隔。
- 数据来源优先级：官方接口优先，失败后回退 Cookie 接口（`usage-summary` 为主，`get-aggregated-usage-events` 为 Included Usage，`get-filtered-usage-events` 为今日/周期 token、回退补充与用量流水）。
- 设置页支持手动录入 Cookie、刷新配置、连通性测试、贴边开关、自定义图标（凭据与连接优先）。
- 快照本地缓存：启动或请求失败时展示 stale 缓存数据。

### 3.2 范围外
- 不实现跨平台版本（macOS/Linux）。
- 不实现多账号同时在线切换（首版支持单账号）。
- 不实现服务端中转（本地直连接口）。

## 4. 术语说明
- auto：Cursor First-party models 池（原 Auto + Composer，对应 Dashboard 自有模型用量）。
- api：Cursor API 调用相关 token 指标。
- Provider：数据获取实现单元，如 `OfficialProvider`、`CookieProvider`。
- TokenSnapshot：统一后的展示数据结构（不含用量流水列表，流水独立拉取）。
- UsageMetrics：Dashboard 补充指标（总消耗百分比、周期/今日 token 明细等）。
- UsageFlowDisplay：用量流水分页展示结构。
- stale：数据过期或不完整标记，含本地缓存场景。

## 5. 功能需求
### FR-01 悬浮球显示
- 系统启动应用后应显示悬浮球。
- 悬浮球支持拖拽移动与置顶显示。
- 折叠态显示总余量百分比（「余量」）与健康状态点。
- 展开态默认展示概览；有 Included Usage 数据时可切换至用量视图。
- 支持贴边缘自动收起为半隐圆球（闲置约半隐；悬停滑入变实），点击展开或拖出恢复。

### FR-02 明细展示
- **概览视图**至少包括：
  - 总消耗百分比、周期 token 汇总、状态 pill、来源、最近成功刷新时间
  - 四张纵向 metric 卡片：今日 API、今日 First-party models、周期 API、周期 First-party models
  - `auto.remaining`、`auto.limit`、`api.remaining`、`api.limit`（若接口提供，用于余量计算）
- **用量视图**（有 Included Usage 数据时）：
  - 按模型聚合的 Included Usage 列表（API / First-party 分区）
  - `billingCycleStart` / `billingCycleEnd` 展示于用量区块
  - 列表区域独立滚动；概览视图无纵向滚动条
- 当数据过期、拉取失败或使用缓存时，通过状态 pill 等标识提示（stale 时不另设整页缓存提示条）。

### FR-03 自动刷新与间隔配置
- 默认开启自动刷新。
- 默认刷新间隔为 30 秒。
- 用户可在设置页修改刷新间隔（秒），允许范围 **30–3600**。
- 输入不合法时阻止保存，并给出明确错误提示。
- 历史配置若低于 30 秒，启动时自动钳制到合法范围。
- 间隔变更后应立即生效并持久化，下次启动沿用。
- 支持“暂停自动刷新/恢复自动刷新”（设置页与悬浮球）。
- 暂停期间允许手动“立即刷新”。
- 刷新过程中应有可见加载反馈（如旋转刷新按钮、面板电流边框）。

### FR-04 数据源策略与容错
- 优先使用 `OfficialProvider` 获取数据。
- 当首选 Provider 连续失败达到阈值（默认 3 次）后，自动切换到 `CookieProvider`。
- Cookie 方案优先读取 `usage-summary` 汇总数据；`get-aggregated-usage-events` 提供 Included Usage；`get-filtered-usage-events` 作今日/周期 token、回退补充与用量流水。
- 回退后每 120 秒探测首选 Provider 恢复情况，并可自动切回。
- 切换过程应在 UI 上有可见来源标识与状态说明。

### FR-05 Cookie 配置与测试
- 设置页提供手动粘贴 Cookie 的输入区域（`WorkosCursorSessionToken` 值或完整 Cookie）。
- 支持“测试连接”按钮，反馈成功/失败与失败原因摘要。
- 连接成功时展示结构化详情：耗时、数据源、总消耗、账单周期、Token 配额、用量分项、Included Usage 状态等。
- 支持“一键清除凭据”。
- 设置页分区顺序：凭据与连接 → 数据刷新 → 贴边 → 外观。

### FR-06 托盘与生命周期
- 提供托盘菜单：流水、设置、退出（不包含立即刷新与暂停/恢复）。
- 悬停托盘图标时展示多行概览用量摘要（总消耗、今日/周期 API 与 FP 分项、来源与更新时间；无快照时显示「暂无数据」）。
- 摘要随轮询或手动刷新后的快照更新，不额外实时轮询。
- 支持关闭窗口后驻留托盘（不强制退出）。

### FR-07 贴边缘自动收起
- 拖拽悬浮球贴近屏幕边缘松手后自动收起为半隐圆球（四边对称）。
- 悬停滑入变实；点击展开或向外拖出可恢复完整显示。
- 设置项 `edgeAutoDockEnabled`（默认 true）可开关。

### FR-08 自定义应用图标
- 设置页可选择本地图片作为应用图标。
- 托盘与设置窗口即时生效；安装包/任务栏图标需重新打包后更新。
- 支持恢复默认图标。

### FR-09 快照本地缓存
- 成功刷新后将 `TokenSnapshot` 持久化到 `%APPDATA%/cursor-token-monitor/snapshot-cache.json`。
- 启动时加载缓存并标记 `stale = true`；请求失败时保留最近成功快照。

### FR-10 用量流水窗口
- 托盘「流水」打开独立窗口，不依赖 poller 快照自动刷新。
- 通过 `fetch-usage-flow` IPC 手动拉取（打开 / 刷新 / 切换筛选或分页）。
- 日期快捷筛选：1d / 7d / 30d / MTD / Last month，以及自定义日期范围（东八区日历日）。
- 服务端分页：默认每页 100 条。
- 列表五列对齐控制台：Date (UTC+8)、Type、Model、Tokens、Cost。
- 字段映射：`default`→`auto`；`maxMode` 显示 MAX 徽标；Included / Free / Usage-based 等与控制台一致；无 token 显示 `-`。
- 无 Cookie 时提示需配置凭据；数据来自 `get-filtered-usage-events`。

## 6. 非功能需求
### NFR-01 性能
- 冷启动后 5 秒内显示悬浮球。
- 单次刷新请求超时建议默认 10 秒（可配置）。

### NFR-02 稳定性
- 接口失败时不得导致应用崩溃。
- 采用指数退避重试，避免高频失败请求。

### NFR-03 安全
- Cookie 和敏感 Header 不落地明文文件。
- 凭据需存储在系统安全存储（Windows Credential Manager，keytar 失败时 safeStorage 回退）。
- 日志需对敏感信息脱敏后输出。

### NFR-04 可维护性
- Provider 与 UI 解耦，接口变动时优先修改 Provider 层。
- 关键行为（轮询、切换、设置）应具备可追踪日志。
- 代码变更需归档至 `docs/changes/`（见 `.cursor/rules/change-archive.mdc`）。

## 7. 数据与接口需求
- 统一输出对象 `TokenSnapshot` 包含：
  - `source`: `official | cookie`
  - `auto`: `{ remaining, limit, resetAt? }`
  - `api`: `{ remaining, limit, resetAt? }`
  - `metrics`: `UsageMetrics`（百分比、token 明细等）
  - `includedUsage`（可选）
  - `billingCycleStart` / `billingCycleEnd`（可选）
  - `fetchedAt`
  - `stale`
  - `rawVersion`
- 用量流水使用独立结构 `UsageFlowDisplay`，经 `fetch-usage-flow` 拉取，**不写入** `TokenSnapshot`。
- Provider 只负责抓取和初步解析，字段规范化统一在 normalizer / usageFlowFormat 层完成。

## 8. 交互与界面需求
- 悬浮球折叠态：余量百分比 + 健康点 + 圆环进度。
- 贴边收起态：半隐圆球（闲置半隐 + 半透明；悬停滑入变实）。
- 展开态 · 概览：总消耗 dashboard、4 张纵向 metric 卡片、状态/来源/时间、刷新/设置/收起；面板进出场动画。
- 展开态 · 用量：Included Usage 分区列表；有数据时底部分「概览 / 用量」分段切换；长模型名自动换行。
- 未贴边窗口固定 300×548；贴边 peek 高度 448（宽度同 300）；展开/收起与视图切换不改变未贴边窗体尺寸。
- 设置页：凭据与连接 → 数据刷新（30–3600 秒）→ 贴边开关 → 外观（自定义图标）。
- 用量流水窗：日期筛选、手动刷新、分页表格（五列对齐控制台）。
- 托盘悬停：多行概览用量摘要（见 FR-06）；右键仅流水 / 设置 / 退出。
- 错误态提示应简洁明确，优先可操作建议（如“检查 Cookie 是否过期”）。

## 9. 验收标准
- 启动后 5 秒内出现悬浮球并可拖拽/置顶/贴边半隐收起。
- 折叠态显示余量百分比；展开概览可见总消耗与 4 张纵向 metric 卡片。
- 有 Included Usage 时可在概览/用量间切换，概览无纵向滚动。
- 能稳定展示 `auto` 与 `api` 两类数据及 Dashboard 指标，且标识数据来源。
- 自动刷新默认开启；修改间隔（30–3600 秒）后立即生效并持久化。
- 非法间隔输入被拦截，不导致轮询异常。
- 首选接口故障后可自动回退 Cookie 方案，并在界面提示。
- 清除凭据后，敏感请求停止并给出配置引导。
- 快照缓存在启动/失败时可展示 stale 数据（状态 pill 标识）。
- 托盘悬停显示多行概览用量，随刷新更新；右键仅流水、设置、退出。
- 流水窗可按日期筛选与分页手动刷新，五列与控制台一致。
- 设置页连接测试展示结构化成功/失败详情；凭据区位于最上方。
- 自定义图标可即时生效于托盘与设置窗。
- 安装包可在目标 Windows 环境安装并运行。

## 10. 风险与假设
- 风险：官方接口不可用或变更频繁，导致首选 Provider 不稳定。
- 风险：Dashboard 事件明细接口可能限流或字段变化，token 明细或流水缺失但汇总百分比仍可展示。
- 风险：Cookie 获取方式可能因平台策略调整而变化。
- 假设：用户可合法获取并维护本人账号 Cookie。
- 假设：首版不要求离线缓存历史统计图表。

## 11. 版本计划
- v1（当前）：单账号、自动刷新、双 Provider 回退、Dashboard 概览/用量、用量流水窗、贴边半隐、托盘悬停用量、自定义图标、快照缓存、连接测试详情。
- v1.1（可选）：开机自启、主题适配、简易历史趋势。
- v1.2（可选）：多账号支持、告警阈值通知。

## 12. 接口字段映射样例
### 12.1 统一输出结构（TokenSnapshot）
```json
{
  "source": "cookie",
  "auto": { "remaining": 12, "limit": 20, "resetAt": "2026-07-31T00:00:00Z" },
  "api": { "remaining": 18, "limit": 20, "resetAt": "2026-07-31T00:00:00Z" },
  "metrics": {
    "totalUsedPercent": 40,
    "autoUsedPercent": 30,
    "apiUsedPercent": 10,
    "totalTokens": 1500000
  },
  "billingCycleStart": "2026-07-01T00:00:00Z",
  "billingCycleEnd": "2026-07-31T00:00:00Z",
  "fetchedAt": "2026-07-06T04:00:00Z",
  "stale": false,
  "rawVersion": "cookie:usage-summary:v1"
}
```

### 12.2 OfficialProvider 映射规则（示例）
- 输入示例（字段名可能变化，仅作实现参考）：
```json
{
  "autoRemaining": 120000,
  "autoLimit": 200000,
  "autoResetAt": "2026-07-31T00:00:00Z",
  "apiRemaining": 80000,
  "apiLimit": 100000,
  "apiResetAt": "2026-07-31T00:00:00Z"
}
```
- 映射规则：
  - `autoRemaining -> TokenSnapshot.auto.remaining`
  - `autoLimit -> TokenSnapshot.auto.limit`
  - `autoResetAt -> TokenSnapshot.auto.resetAt`
  - `apiRemaining -> TokenSnapshot.api.remaining`
  - `apiLimit -> TokenSnapshot.api.limit`
  - `apiResetAt -> TokenSnapshot.api.resetAt`
  - `source = "official"`
  - `rawVersion` 按接口版本记录，如 `official:v1`

### 12.3 CookieProvider 映射规则（usage-summary）
- 主数据来源：`usage-summary` 端点（多端点候选，见 README §6）。
- 输入示例：
```json
{
  "billingCycleStart": "2026-07-01T00:00:00Z",
  "billingCycleEnd": "2026-07-31T00:00:00Z",
  "individualUsage": {
    "plan": {
      "limit": 20,
      "remaining": 12,
      "totalPercentUsed": 40,
      "apiPercentUsed": 10,
      "autoPercentUsed": 30
    }
  }
}
```
- 映射规则：
  - `individualUsage.plan.autoPercentUsed + limit` → `auto.remaining` / `auto.limit` / `metrics.autoUsedPercent`
  - `individualUsage.plan.apiPercentUsed + limit` → `api.remaining` / `api.limit` / `metrics.apiUsedPercent`
  - `individualUsage.plan.totalPercentUsed` → `metrics.totalUsedPercent`
  - `billingCycleStart` / `billingCycleEnd` → `TokenSnapshot.billingCycleStart` / `billingCycleEnd`
  - `source = "cookie"`
  - `rawVersion` 按接口版本记录，如 `cookie:usage-summary:v1`

### 12.4 Usage Events / Aggregated 明细补充
- 优先端点：`get-aggregated-usage-events`（Billing Included Usage 同源按模型聚合）。
- 补充端点：`get-filtered-usage-events`（周期内 token 总量、今日 token/消耗；聚合不可用时回退构建 Included Usage；用量流水同源分页拉取）。
- 事件接口依赖 Cookie 中的 `userId`（从 `userId::jwt`、URL 编码或 JWT `sub` 提取）。
- 事件接口失败时保留 `usage-summary` 汇总数据，token 明细为 `null`。

### 12.5 用量流水字段映射（对齐控制台）
- Date：`timestamp` 毫秒字符串先转 number，格式化为东八区。
- Type：显式 `kind` 优先（Included / Free / Usage-based 等）；无 token 且非 Usage-based 时默认 Free。
- Model：`default` → `auto`；`maxMode: true` 时附加 MAX 徽标。
- Tokens：有用量用「万」等格式；零/空显示 `-`。
- Cost：Included / Free 显示文案本身；Usage-based 等显示金额。
- 实现：`src/shared/usageFlowFormat.ts`、`src/core/normalizer.ts`（`buildUsageFlowPage`）。

### 12.6 缺失字段与异常处理规则
- 某字段缺失时使用 `null`，但不得影响其它字段展示。
- 两类余量都缺失时标记 `stale = true`，并展示“数据不完整”提示。
- 事件明细失败时保留汇总数据，仅缺失 token 明细。
- 响应解析失败时保留最近一次成功快照并进入退避重试。
- 所有异常日志不得输出完整 Cookie/Authorization 值。

## 13. 自动刷新状态机补充
- 状态：`idle`、`running`、`backoff`、`paused`。
- 事件：
  - `start`：进入 `running`
  - `refreshSuccess`：保持 `running` 并重置失败计数
  - `refreshFail`：失败计数 +1，必要时转 `backoff`
  - `pause`：进入 `paused`
  - `resume`：从 `paused` 回到 `running`
  - `manualRefresh`：在任意状态允许触发一次刷新（`paused` 下不改变暂停状态）
- 退避策略：`30s -> 60s -> 120s -> 300s`，成功后恢复到用户设置间隔。
