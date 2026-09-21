# 其他订阅 Command Code 用量查询

- 日期：2026-09-18
- 类型：feature、refactor
- 关联文件：src/shared/subscriptionTypes.ts、src/core/subscriptions/CommandCodeProvider.ts、src/core/subscriptions/SubscriptionCache.ts、src/core/subscriptions/SubscriptionManager.ts、electron/main.ts、electron/preload.ts、src/renderer/vite-env.d.ts、src/renderer/pages/SubscriptionsPage.tsx、src/renderer/styles.css

## 变更摘要

### 新增 Command Code 订阅源

- 「其他订阅」新增 `Command Code` 提供方，作为第一个 tab（注册顺序即 tab 顺序），展示：剩余额度与来源拆分、套餐与续期日期、当期消耗/请求数/Tokens、账号，以及 **5 小时 / 每周 / 每月** 三段用量限额计量条
- 新增 `CommandCodeProvider`，调用 Command Code alpha 内部接口（与 `cmd` CLI 的 `/usage` 同源，未公开）：
  - `GET https://api.commandcode.ai/alpha/whoami` —— 账号与 `orgId`
  - `GET /alpha/billing/credits?orgId=` —— `credits`（月度/购买/赠送）与 `windowLimits`（5 小时/每周 used/cap/resetAt）
  - `GET /alpha/billing/subscriptions?orgId=` —— 套餐 id、状态、计费周期起止
  - `GET /alpha/usage/summary?orgId=&since=<周期开始>` —— 周期内 `totalCost`/`totalCount`/`totalTokens`
  - 鉴权统一为 `Authorization: Bearer <API Key>`，无需独立用量 Token
- 凭据三级解析（优先级从高到低）：`CredentialVault` 账户 `commandcode-api-key`（手动录入，可覆盖）→ 环境变量 `COMMAND_CODE_API_KEY`/`COMMANDCODE_API_KEY` → 自动读取 `~/.commandcode/auth.json`（`cmd login` 写入，兼容 `apiKey`/`commandcode`/`command-code` 三种形态及 `{type,access|key}` 结构）；读取失败静默跳过，不记录凭据内容
- 只需实现 `fetchInfo()`：Command Code 的数据是「额度看板」而非按月×模型的用量，因此不实现 `fetchUsage()`，避免改动 `listProviders()` 中「用量凭据与主凭据分离」的既有假设；页面「月度用量」块与月份选择器因 `usageSupported === false` 自动不渲染

### 月度限额口径

- 额度接口只返回剩余量与 5 小时/每周滚动窗口，**不返回月度上限**；月度进度采用「`usage/summary.totalMonthlyCredits`（周期内消耗的月度积分）÷ 套餐月度额度」
- 套餐月度额度按官方 Pricing & Limits 映射（Go 10 / GOAT 70 / Pro 80 / Max 10× 150 / Max 20× 300 / Team Pro 40），并剥离 `individual-`、`team-` 等作用域前缀；套餐无法识别时不渲染月度进度，避免展示口径可疑的百分比
- 实测校验：Go 套餐月度消耗 $0.49 / $10 = 5%，与官方 `/usage` 的 MONTHLY LIMIT 一致

### 查询时机调整

- **取消切换 tab 时自动查询**（原先切 tab 会触发一次请求），改为纯手动刷新 + 每 3 分钟自动刷新
- 自动刷新与手动刷新都覆盖**全部已配置提供方**，不只是当前 tab，使缓存整体保持新鲜

### 结果缓存

- 新增 `SubscriptionCache`：按提供方把**成功**的账户数据与用量数据落盘到 `userData/subscription-cache.json`（带 `version` 字段），供弹窗打开时立即回填
- 渲染进程按提供方维护独立缓存槽，**切换 tab 只读缓存、不发请求**，因此不再出现「切过去一片空白、必须手动刷新」
- 失败不破坏缓存：刷新失败时保留上一次成功结果，另以黄色提示说明「最近一次查询失败，当前显示上次结果」，只有在完全没有可用数据时才用错误占位
- 磁盘缓存读取做防御式校验：版本不符、载荷 `providerId` 与键不符、`success` 非 true、`fetchedAt` 超过 12 小时、JSON 损坏，一律丢弃该条目
- 用量按月查询，`/alpha/usage/summary` 结果带 `month`/`year`；选中月份与缓存月份不一致时隐藏表格并提示「当前显示 X 年 Y 月缓存，点击刷新查询所选月份」，避免把上个月的数据当成所选月份

### 内页布局与 UI 重做

- 原样式是围绕旧结构零散堆叠的 `subscription-*` 类，块与块之间用虚线分隔、月份选择器与刷新按钮挤在同一工具栏，层级混乱。本次重做为统一的 `sub-*` 系统并整块替换旧样式（旧类无其他引用，已全部删除）
- 结构改为：页头 → tabs + 刷新按钮同行 → 查询时间与自动刷新说明 → 三张面板（账户额度 / 用量限额 / 凭据配置），面板复用既有 `.settings-section` 视觉语言，不再卡片嵌套
- 月份选择器从全局工具栏移入「月度用量」面板头部，紧邻其作用的表格
- 新增分段式用量计量条（24 段），按用量分级配色（<70% 绿 / 70–89% 琥珀 / ≥90% 红），百分比文字始终显示，状态不依赖颜色单独承载；配 `role="meter"` 与 `aria-valuenow`/`aria-valuetext`
- DeepSeek 月度用量表格改为无边框行分隔样式；指标改用 16.5M / 500.0k 压缩记法，完整数值保留在 `title` 中

## 影响范围

- 「其他订阅」弹窗：新增 Command Code tab 与三张面板，DeepSeek tab 的数据内容不变但视觉随新样式体系调整
- `SubscriptionProviderId` 联合类型扩展、`SubscriptionData` 可辨识联合新增成员；`CommandCodeWindowLimit` 由统一的 `CommandCodeLimit` 取代
- 旧 `subscription-*` 样式类被移除，`src/renderer/styles.css` 订阅段落整体替换
- IPC 层（`electron/main.ts`、`preload.ts`、`vite-env.d.ts`）与托盘、窗口创建均按 `providerId` 参数化，无需改动
- 依赖 `~/.commandcode/auth.json`、`COMMAND_CODE_API_KEY` 环境变量（可选）与第三方 alpha 接口；接口变动会导致对应数据段不可用

## 验证

- `npm run typecheck` 通过（electron 与 renderer 两套 tsconfig）；`npm run build` 通过
- 接口实测（本机凭据，只读 GET）：四个 alpha 接口均返回 200，解析结果与官方 `/usage` 口径一致；另确认 `windowLimits.resetAt` 原始值为**毫秒**，归一化逻辑已正确处理
- 用本地 electron 加载构建产物 + mock 数据做布局量化审计（无法肉眼查看截图，改为测量真实渲染），覆盖 420 / 520 / 700 三种宽度：
  - 无横向溢出，无元素越出面板内边距
  - 计量条恒为 24 段且段宽一致，填充段数（3/2/1）与百分比（13%/9%/5%）一致；接近上限时配色正确降级为琥珀/红
  - **修复**：DeepSeek 表格在 420px 下曾溢出面板 6.9px 且单元格折行（行高 49.3px）。改为 `table-layout: fixed` + 数字列定宽 + 模型名超出省略，并在表头收窄文案，复测溢出为 0、行高回到单行 32px、最长模型名 `deepseek-v4-flash` 未截断
  - **修复**：`.sub-metrics` 原用 `auto-fit` 产生多余空轨道（3 个指标却算出 4 列），改为显式 `--2`/`--3` 修饰类
- 行为验证（注入计数器，关闭 contextIsolation 的临时测试壳）：
  - 打开弹窗仅查询 1 次（原先是仅首个提供方）；**切换 tab 双向均不产生查询**；手动刷新按提供方各新增 1 次
  - 定时器注册间隔为 180000ms（3 分钟）
  - 缓存命中：把实时查询人为延迟 4 秒，打开后 1.5 秒时面板已显示磁盘缓存值（$7.77，时间为 1 小时前的缓存时间戳），刷新返回后替换为实时值（$9.49）
  - 失败保留：令刷新全部失败后，面板仍显示 $9.49 并出现黄色提示「最近一次查询失败，当前显示上次结果」，未变成空白
  - 月份门控：选中月份与缓存月份不一致时表格隐藏，提示「当前显示 2026 年 9 月缓存，点击刷新查询所选月份」
- `SubscriptionCache` 用真实实现编译后跑单元验证，11/11 通过：落盘读回、新实例可读回磁盘数据、失败结果不写盘、载荷 `providerId` 不符丢弃、文件内失败结果丢弃、版本不符丢弃、13 小时过期丢弃、6 小时保留、损坏 JSON 安全返回空、多提供方互不干扰
- 人工验证（待用户执行）：托盘右键「其他订阅」→ Command Code 为第一个 tab 并展示余额/套餐/三段限额条；切换 tab 立即有内容；填错误 Key 报「API Key 无效或已过期」；清除手动 Key 后回退自动读取
