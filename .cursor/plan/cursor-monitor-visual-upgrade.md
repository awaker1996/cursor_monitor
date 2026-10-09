# Cursor Token Monitor · 视觉升级执行方案

> 生成日期：2026-10-09
> 范围：悬浮球窗口 + 设置窗口，双主题（极光玻璃 aurora / 清爽纸面 calm）
> 现状盘点：双主题令牌、玻璃语汇、`prefers-reduced-motion` 全量降级已完备；本方案聚焦**一致性收口、信息密度、微动效打磨**
> 排期建议：A（0.5 天）→ B（1.5 天）→ C1/C2/C4（1 天）→ D5+D3（1 天）→ C3/C5（1 天）→ D1/D4/D2（按需）
> 项目惯例：每个批次/PR 附 `docs/changes/YYYY-MM-DD-标题.md` 归档文档并更新 `docs/changes/README.md` 索引

---

## 调研确认的关键事实（实现前必读）

1. **跑马灯是死代码**：`.included-usage__name-track` / `.included-usage__name-marquee` / `@keyframes includedUsageNameMarquee`（styles.css 约 2182–2216 行）没有任何 TSX 组件引用，直接删除即可，无需做主题适配。
2. **`IncludedUsageModelRow` 只有格式化字符串**（`model` / `tokens` / `usage`），无数值占比字段——C3 的 mini 占比条需要先在 `src/shared/format.ts` 补字段。
3. **首帧闪烁确认存在**：`useUiStyleSync()`（src/renderer/uiStyle.ts）在 React 挂载后异步 `getSettings()` 才写 `data-ui-style`，calm 用户每次打开窗口首拍必闪深色。
4. **Toast 全是凭据操作反馈**（SubscriptionsPage.tsx 17 处 `showToast` 调用），无成功/失败语气区分——A7 加图标时需要 tone 参数。
5. **`.settings-toast` 重复定义**：styles.css 约 2974 行（旧版）与 4830 行（新版）两处，旧版属性已被覆盖，属死代码。
6. **`.floating-ball__tooltip` 整套样式仍在但 App.tsx 未使用**——C5 可直接复用（约 564–588 行，calm 适配在 6375 行附近）。
7. **窗口尺寸/常量真源在 Electron 层**：`electron/windows/floatingBall.ts`（`ORB_PANEL_WIDTH=300` 等）；面板 CSS 变量 `--orb-panel-width: 276px`（300 − 24 padding）需保持同步。
8. **动效减速机制已有现成先例**：`--glass-speed` 倍率 + `motion-muted` class（数据陈旧/退避时）——D2 电池模式直接复用同构机制。

---

## 批次 A：速赢包（预计半天，全部独立小改）

### A1. 空状态引导可点击
- **文件**：`src/renderer/components/ErrorHint.tsx`、`src/renderer/App.tsx`（约 601–606 行「暂无数据」处）
- **方案**：`ErrorHint` 加可选 props `actionLabel?: string` / `onAction?: () => void`；action 渲染为 `<button className="error-hint__button">`。App.tsx 空数据处传 `actionLabel="打开设置"`、`onAction={() => window.electronAPI.openSettings()}`
- **CSS**：`.error-hint__button`——胶囊描边按钮，色随 tone（info/warn/error），极光与 calm 各一套，视觉语言复用现有 `btn-ghost`

### A2. 跑马灯死代码清理
- **文件**：`src/renderer/styles.css` 约 2182–2216 行
- **方案**：删除 `.included-usage__name-track`、`.included-usage__name-marquee`、`.is-overflow` 规则、`@keyframes includedUsageNameMarquee` 及对应 reduced-motion 块；删后 `grep -i marquee` 确认无残留

### A3. 收起按钮图标化
- **文件**：`src/renderer/App.tsx`（约 555 行 `×` 文本替换）
- **方案**：新增 `IconClose` 组件：16×16 viewBox、`fill="none"`、`stroke="currentColor"`、`strokeWidth="1.5"`、`strokeLinecap="round"` 双线 SVG（与 IconRefresh / IconSettings 同语言）

### A4. 红黄绿灯缩小
- **文件**：`styles.css` `.traffic-light`（约 1443 行）、`.floating-ball__brand-row`（约 1589 行）
- **方案**：17px → 11px（macOS 灯实际约 12px，17px 明显过大）；brand-row gap 12px → 10px；极光与 calm 两套 keyframes 无需改（渐变/shadow 为相对值，自适应）

### A5. 对比度与小字号提升（极光主题）
- **目标**：深底二级文字 ≥ 4.5:1（AA）
- **改动点**：
  - `.metric-card__detail`、`.dashboard-summary__detail`、`.dashboard-summary__billing-label`、`.dashboard-summary__billing-tag`、`.meta-time__label`：`#6b7280` → `#94a3b8`
  - `.included-usage__entry-tokens`、`.sub-table th`、`.sub-metric__label` 等 `#9ca3af` 二级文字按核对结果提亮
- **字号**：`.floating-ball__total-label` 9px → 10px
- **验证**：浏览器 DevTools contrast checker 逐个核对，两主题肉眼回归

### A6. 中文字体显式声明
- **文件**：`styles.css` 第 8 行 body font-family
- **方案**：`'Segoe UI', 'Microsoft YaHei UI', system-ui, -apple-system, sans-serif`

### A7. Toast 状态化
- **文件**：`src/renderer/pages/SubscriptionsPage.tsx`（17 处调用）、`src/renderer/pages/SettingsPage.tsx`（showToast 定义与透传）、`src/renderer/components/SettingsTabContent.tsx`（如有调用）、`styles.css`
- **方案**：`showToast(message, tone?: 'ok' | 'error')`；「已保存/已清除」标 ok，「不能为空/请先配置/异常 message」标 error；`.settings-toast--ok`（✓ 图标 + ok 色）、`.settings-toast--error`（! 图标 + bad 色）各一套；图标内联 SVG
- **同步**：`SettingsTabContent` 中 DataRefreshPrefs / BallPrefs / IconPrefs 的 onToast 类型如有需要一并放宽签名

### A8. `settings-toast` 重复定义清理
- **文件**：`styles.css` 约 2974 行
- **方案**：删除旧版定义（保留 4830 行新版）

---

## 批次 B：设计系统统一（预计 1.5 天，后续所有视觉工作的地基）

### B1. 语义色令牌
- **定义**（`:root` + `html[data-ui-style='calm']` 两套映射）：每状态四档
  `--{ok|warn|bad|info|neutral}-{fg|bg|soft|border}`
- **calm 映射源**：现有 `--calm-ok #0f8a4d` / `--calm-warn #b26205` / `--calm-bad #d43c3c` / `--calm-info #1d5fd8` 及各 `*-soft`
- **极光映射源**：现有发光色系（`#34d399` / `#f59e0b` / `#f87171` / `#60a5fa` 族）收敛——当前同语义至少 6 种绿、5 种黄、5 种红散落各处
- **替换范围**：`health-pill`、`source-tag`、`metric-card__value/__fill`、`dashboard-summary__fill`、`sub-badge`、`limit-chip`、`account-card__status`、`error-hint`、`test-result`、`traffic-light`、orb 健康态
- **明确不动**：orb 的 `--glass-1/2/3` 渐变叠色（色相跨度 45° 的玻璃调色逻辑独立，不并入纯色令牌）
- **执行方式**：先建令牌 → 全局 search-replace → 每改一处 dev 肉眼核对两主题

### B2. 动效令牌
- **定义**：
  - `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`
  - `--ease-spring: cubic-bezier(0.34, 1.4, 0.5, 1)`
  - `--ease-smooth: cubic-bezier(0.4, 0, 0.2, 1)`
  - `--dur-fast: 0.16s`、`--dur-base: 0.25s`、`--dur-slow: 0.34s`
- **现状问题**：设置页有 `--set-ease` 但悬浮球侧散落 4+ 种曲线；时长 0.12–0.34s 无规律
- **替换**：统一引用新令牌；两窗共用（本就单 CSS 文件）；reduced-motion 块同步引用

### B3. 圆角 / 字号档位收敛
- **圆角令牌**：`--radius-panel: 12px`、`--radius-card: 10px`、`--radius-chip: 8px`（替换 4/6/7/8/9/10/11/12/14 散值；badge 4px 可保留特例）
- **字号令牌**：`--fs-mini: 10px`、`--fs-caption: 11px`、`--fs-body: 12.5px`、`--fs-title: 13.5px`、`--fs-headline: 20px`
  - 现状 10/11/12/12.5/13/13.5 粒度过细；12/12.5/13 并入 body，13.5 并入 title
- **注意**：面板高度 `--orb-panel-height: 402px` 是按当前字号精确配平的，字号档位收敛后**必须重新核对概览视图无滚动无溢出**（flex 填充机制有弹性，但需肉眼确认）

---

## 批次 C：悬浮球面板体验（预计 2 天）

### C1. 入场 stagger 动画
- **文件**：`App.tsx`（metricItems.map 处）、`styles.css`
- **方案**：`panelAnimOpen` 为 true 后，`.metric-card` 按索引注入 `style={{ '--stagger-i': i }}`；CSS：
  `animation: staggerFadeUp 0.3s var(--ease-out) both; animation-delay: calc(var(--stagger-i) * 40ms)`
  keyframes：`from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; }`
- **降级**：reduced-motion 下 `animation: none`；calm 保留（一次性入场动画不违背「静态久看不累」原则）

### C2. 概览 ⇄ 用量切换过渡
- **文件**：`App.tsx`（panelView 切换处）、`styles.css`
- **方案**：body 内容按 `panelView` 加 key 重挂载 + `fadeSlideIn 0.12s var(--ease-out)`（fade + 4px 位移）；胶囊滑移 0.34s 保持不变，与内容过渡形成整体节奏
- **注意**：概览视图高度是精确配平的，过渡动画不能改变布局终态（用 transform/opacity，不用 height）

### C3. 用量行 mini 占比条
- **文件**：`src/shared/format.ts`、`src/renderer/components/IncludedUsageTable.tsx`、`styles.css`
- **数据**：`IncludedUsageModelRow` 加 `shareValue: number`（该模型 tokens / 本分区最大模型 tokens × 100，构造 display 时计算）
- **UI**：每行 `entry` 底部加 2px 轨道 + 分区 accent 色填充条，`width` 过渡 `var(--dur-base)`
- **主题**：api 区复用绿、auto 区复用蓝（极光=现有 `#34d399`/`#60a5fa`，calm=`--calm-ok`/`--calm-accent`）

### C4. orb 数字 count-up
- **文件**：`App.tsx`
- **方案**：自定义 `useCountUp(target: number | null, duration = 300)` hook（rAF + easeOutCubic），对 `orbSummary.percentValue` 补间；展示格式与现有 `orbSummary.value` 规则一致（`Math.round` 后拼 `%`）
- **配合**：现有 `.floating-ball__total-value` 的 `key={orbSummary.value}` 触发 pulse 机制改为补间终值时触发一次
- **降级**：`matchMedia('(prefers-reduced-motion: reduce)')` 直接跳变

### C5. 折叠态 hover tooltip 复活
- **文件**：`App.tsx`、`styles.css`（复用约 564–588 行现成样式 + 6375 行 calm 适配）
- **方案**：球体 hover（非拖拽中、非 docked 半隐态）显示四行：状态标签 / 今日 Cursor x% / 今日 Other y% / 来源 · 上次刷新时间；数据取 `formatOrbSummary` / `buildDashboardSummary` / `metricItems` 现成结果
- **注意**：tooltip 在窗口内渲染（右下角布局时向左上展开），窗口 300×448 有足够空间；拖拽与 docked 态不显示

---

## 批次 D：高级感大招（每项独立，按需排期）

### D1. 玻璃噪点纹理（半天）
- **方案**：SVG `feTurbulence` base64 data-URI，`.floating-ball__panel` 与 `.set-card` 新增一层 `::after`（注意两类的 ::before/::after 已被占用——panel 的 ::before 是极光画布、::after 是流光边框，**需改用内部专用 wrapper 元素或复用 panel 的流光层叠加**）叠 2.5% 透明度噪点，`mix-blend-mode: overlay`
- **范围**：仅极光主题；calm（纸面无玻璃）不加；静态零动画成本，reduced-motion 天然兼容

### D2. 电池模式降动效（1 天）
- **主进程**：`electron/main.ts` 加 `powerMonitor.on('on-battery' / 'on-ac')` → IPC 广播 `power-mode`
- **渲染层**：两窗口入口 hook 后写 `document.body.dataset.power = 'battery' | 'ac'`
- **CSS**：`[data-power='battery']` 下复用现有减速机制——`--glass-speed: 2.4`、关停 `orbBreathe` / `glassShine`（×5 处）/ `pageAuroraDrift` / `glowOrbit` / 三灯轮播；机制与 `motion-muted` 完全同构，一条属性级联即可
- **注意**：preload 需暴露 IPC 订阅；dev 模式无电池时可用 `window.__setPowerMode` 调试口模拟

### D3. 设置窗大屏适配（半天）
- **问题**：`.settings-panel` 固定 `max-width: 720px` 且不居中，2K/4K 拉宽后内容挤左侧大量留白
- **方案**：`.settings-page__panels` 内容居中（`margin: 0 auto` 保留 max-width）；`@media (min-width: 1280px)` 下 `.settings-panel` 放宽至 860px
- **回归**：窄窗 720px 最小宽度下布局不变

### D4. 侧导航滑移指示器（1 天）
- **文件**：`src/renderer/components/SettingsNav.tsx`、`styles.css`
- **方案**：列表加 `.settings-nav__thumb`（绝对定位，`top` 由 active index × 行高计算，`transition: top var(--dur-slow) var(--ease-spring)`）；视觉与 `panel-view-switch__thumb` 同语言——极光=玻璃胶囊（斜向高光渐变+顶部内高光+蓝外发光），calm=白底蓝描边胶囊
- **同步**：极光主题补 active 左侧索引条（对齐 calm 已有的 5164 行实现，消除两主题不对称）
- **降级**：reduced-motion 下 thumb 瞬移（transition: none）
- **注意**：nav item 高度需固定（当前 padding 7px + 字号可推算），或用 ref 实测 active 项 offsetTop

### D5. 首帧主题闪烁修复（半天）
- **文件**：`settings.html`、`index.html`（`<head>` 内联脚本）、`src/settings/SettingsStore.ts`（保存时镜像写 localStorage）
- **方案**：
  ```html
  <script>
    try { var s = localStorage.getItem('ui-style'); if (s) document.documentElement.dataset.uiStyle = s; } catch (e) {}
  </script>
  ```
  真源仍是 IPC（`useUiStyleSync` 不变，挂载后覆盖纠偏）
- **已知取舍**：localStorage 与实际设置不一致时首拍错主题、随后自动纠正——远好于现状（calm 用户每次必闪深色）
- **注意**：`settings.ts` 的 `backgroundColor` 已按 uiStyle 设底色，内联脚本后二者时序对齐

### D6. Win11 真 acrylic（不排期，待议）
- transparent 窗口上 Chromium 无法采样窗外内容（backdrop-blur 不可用）；`backgroundMaterial: 'acrylic'` 与点击穿透（setIgnoreMouseEvents）冲突
- 若做：实验开关 + 面板独立子窗口承载；维持长线观察

---

## 主观可选项（尊重既有迭代，供斟酌，未排期）

- **刷新反馈收敛**：刷新时同时有扫光条 + 双电流边框 + 卡片压暗 0.72 + 按钮 spin + pill 变「刷新中」五个渠道表达一件事；可考虑保留电流边框为特色、去掉卡片压暗（或反之）
- **数值格式统一**：token 数有「6947.4万」混合格式，建议统一千分位/单位规则；溢出场景用 title 显示精确值

---

## 每批次验收清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run dev` 双主题肉眼回归（悬浮球折叠/展开/贴边三态 × 概览/用量两视图 × 极光/纸面两主题）
- [ ] `prefers-reduced-motion` 模拟下（DevTools rendering 面板）动效正确降级
- [ ] 概览视图无滚动无溢出（字号改动后重点核对 `--orb-panel-height: 402px` 配平）
- [ ] calm 主题无新增持续动效（一次性入场动画除外）
- [ ] `docs/changes/` 归档 + README 索引更新
