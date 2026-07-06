# Cursor Token 悬浮球需求说明书

> **说明**：本文档内容已合并至 [README.md](./README.md)（项目参考文档）。  
> 后续请以 README.md 为准；本文件保留作需求追溯。

## 1. 文档信息
- 项目名称：Cursor Token 悬浮球（Windows）
- 文档版本：v1.1
- 状态：已合并至 README.md
- 统一参考文档：[README.md](./README.md)
- 最后更新：2026-07-06

## 2. 背景与目标
- 背景：需要在桌面实时查看 Cursor 账号 token 余量，避免频繁打开网页或控制台。
- 目标：提供一个轻量、常驻、可配置自动刷新的悬浮球，展示 `auto` 与 `api` 两类余量及 Dashboard 用量指标。
- 目标用户：个人开发者（账号所有者本人）。

## 3. 范围定义
### 3.1 范围内
- Windows 桌面常驻悬浮球（可拖拽、置顶、贴边收起、托盘管理）。
- 显示 `auto` 与 `api` 两类 token 余量及 Dashboard 用量指标（百分比、账单周期、token 明细）。
- 自动刷新与可配置刷新间隔。
- 数据来源优先级：官方接口优先，失败后回退 Cookie 接口（`usage-summary` 为主，`get-filtered-usage-events` 为 token 明细补充）。
- 设置页支持手动录入 Cookie、刷新配置、连通性测试、贴边开关、自定义图标。
- 快照本地缓存：启动或请求失败时展示 stale 缓存数据。

### 3.2 范围外
- 不实现跨平台版本（macOS/Linux）。
- 不实现多账号同时在线切换（首版支持单账号）。
- 不实现服务端中转（本地直连接口）。

## 4. 术语说明
- auto：Cursor 自动额度或自动计费相关 token 指标。
- api：Cursor API 调用相关 token 指标。
- Provider：数据获取实现单元，如 `OfficialProvider`、`CookieProvider`。
- TokenSnapshot：统一后的展示数据结构。
- UsageMetrics：Dashboard 补充指标（总消耗百分比、周期/今日 token 明细等）。
- stale：数据过期或不完整标记，含本地缓存场景。

## 5. 功能需求
### FR-01 悬浮球显示
- 系统启动应用后应显示悬浮球。
- 悬浮球支持拖拽移动与置顶显示。
- 悬浮球折叠态显示总览信息，展开态显示明细信息。
- 支持贴边缘自动收起为 peek tab，点击或拖出恢复。

### FR-02 明细展示
- 展示字段至少包括：
  - `auto.remaining`、`auto.limit`（若接口提供）
  - `api.remaining`、`api.limit`（若接口提供）
  - `metrics`（总消耗百分比、auto/api 百分比、周期与今日 token 明细）
  - `billingCycleStart` / `billingCycleEnd`（账单周期）
  - 数据来源（official/cookie）
  - 最近成功刷新时间
- 当数据过期、拉取失败或使用缓存时，显示状态提示。

### FR-03 自动刷新与间隔配置
- 默认开启自动刷新。
- 默认刷新间隔为 30 秒。
- 用户可在设置页修改刷新间隔（秒），允许范围 10-3600。
- 输入不合法时阻止保存，并给出明确错误提示。
- 间隔变更后应立即生效并持久化，下次启动沿用。
- 支持“暂停自动刷新/恢复自动刷新”。
- 暂停期间允许手动“立即刷新”。

### FR-04 数据源策略与容错
- 优先使用 `OfficialProvider` 获取数据。
- 当首选 Provider 连续失败达到阈值（默认 3 次）后，自动切换到 `CookieProvider`。
- Cookie 方案优先读取 `usage-summary` 汇总数据；`get-filtered-usage-events` 仅作 token 明细补充。
- 回退后每 120 秒探测首选 Provider 恢复情况，并可自动切回。
- 切换过程应在 UI 上有可见来源标识与状态说明。

### FR-05 Cookie 配置与测试
- 设置页提供手动粘贴 Cookie 的输入区域（`WorkosCursorSessionToken` 值或完整 Cookie）。
- 支持“测试连接”按钮，反馈成功/失败与失败原因摘要。
- 支持“一键清除凭据”。

### FR-06 托盘与生命周期
- 提供托盘菜单：立即刷新、打开设置、暂停/恢复、退出。
- 支持关闭窗口后驻留托盘（不强制退出）。

### FR-07 贴边缘自动收起
- 拖拽悬浮球贴近屏幕边缘松手后自动收起为 peek tab。
- 点击或向外拖出可恢复完整显示。
- 设置项 `edgeAutoDockEnabled`（默认 true）可开关。

### FR-08 自定义应用图标
- 设置页可选择本地图片作为应用图标。
- 托盘与设置窗口即时生效；安装包/任务栏图标需重新打包后更新。
- 支持恢复默认图标。

### FR-09 快照本地缓存
- 成功刷新后将 `TokenSnapshot` 持久化到 `%APPDATA%/cursor-token-monitor/snapshot-cache.json`。
- 启动时加载缓存并标记 `stale = true`；请求失败时保留最近成功快照。

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
  - `billingCycleStart` / `billingCycleEnd`（可选）
  - `fetchedAt`
  - `stale`
  - `rawVersion`
- Provider 只负责抓取和初步解析，字段规范化统一在 normalizer 层完成。

## 8. 交互与界面需求
- 悬浮球折叠态：总览 + 健康点。
- 贴边收起态：peek tab + 健康点。
- 展开态：总消耗进度条、账单周期、metric 明细行、来源、最后更新时间、错误提示。
- 设置页：自动刷新、刷新间隔、贴边开关、自定义图标、Cookie 输入、连接测试、清除凭据。
- 错误态提示应简洁明确，优先可操作建议（如“检查 Cookie 是否过期”）。

## 9. 验收标准
- 启动后 5 秒内出现悬浮球并可拖拽/置顶/贴边收起。
- 能稳定展示 `auto` 与 `api` 两类数据及 Dashboard 指标，且标识数据来源。
- 自动刷新默认开启；修改间隔后立即生效并持久化。
- 非法间隔输入被拦截，不导致轮询异常。
- 首选接口故障后可自动回退 Cookie 方案，并在界面提示。
- 清除凭据后，敏感请求停止并给出配置引导。
- 快照缓存在启动/失败时可展示 stale 数据并提示。
- 自定义图标可即时生效于托盘与设置窗。
- 安装包可在目标 Windows 环境安装并运行。

## 10. 风险与假设
- 风险：官方接口不可用或变更频繁，导致首选 Provider 不稳定。
- 风险：Dashboard 事件明细接口可能限流或字段变化，token 明细缺失但汇总百分比仍可展示。
- 风险：Cookie 获取方式可能因平台策略调整而变化。
- 假设：用户可合法获取并维护本人账号 Cookie。
- 假设：首版不要求离线缓存历史统计图表。

## 11. 版本计划
- v1（当前）：单账号、实时显示、自动刷新、双 Provider 回退、Dashboard 指标、贴边收起、自定义图标、快照缓存。
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

### 12.4 Usage Events 明细补充
- 补充端点：`get-filtered-usage-events`（周期内 token 总量、今日 token/消耗）。
- 依赖 Cookie 中的 `userId`（从 `userId::jwt`、URL 编码或 JWT `sub` 提取）。
- 事件接口失败时保留 `usage-summary` 汇总数据，token 明细为 `null`。

### 12.5 缺失字段与异常处理规则
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
