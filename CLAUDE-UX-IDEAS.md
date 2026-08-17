# CLAUDE-UX-IDEAS.md — 借鉴 Claude Code 视觉/交互细节的优化提案（dsh-tui）

> 目标：把 Anthropic Claude Code（cli）的标志性视觉语言与交互细节逐条映射到本仓库，
> 产出可直接执行的落地清单。所有结论都基于已读源码（`pi-tui-app.ts` 1544 行、
> `view/components/*`、`view/pi-vendor/*`、`view/theme/*`、`document.ts`、`terminal-app.ts`、
> `FEATURE-CHECKLIST.md`、`INTERACTION-PLAN.md`、`DESIGN.md` 修订记录）。
>
> 硬约束（AGENTS.md）：单向数据流 `SessionEvent → fold() → ViewDocument → app.render()`、
> fold 纯函数（禁 IO）、文档即真相源、cordis 只读白名单服务、文案一律走 `strings.ts` 双语词典。
> 每条提案都标注了「数据从哪来」，绝不建议视图层自造第二份状态。

---

## TL;DR 行动表

> 优先级：P0=半小时内高杠杆 · P1=半天 · P2=一天以上或需研究 pi-tui / dsh runtime 能力。
> 改动量：S=小（改一处渲染/一两个函数）· M=中（新增组件/多条字段或 seam）· L=大（需 runtime 缝隙研究或跨层）。

| # | 提案 | 现状 | 落地位置 | 优先级 | 改动量 |
|---|---|---|---|---|---|
| CC-01 | 权限模式彩色徽标（read-only / workspace-write / full-access 分色） | idle 状态槽纯文本 `ℹ 权限预设：xxx`，无分色、不在 header | `footer.ts` / `pi-tui-app.ts#applyState` + palette 映射 | **P1** | S |
| CC-02 | 权限提示命令高亮 + 影响分析行 | 审批卡只有标题+reason+选项，命令不显示 | `approval-view.ts` + `decision-card.ts` + runner 传参 | **P1** | M |
| CC-03 | 斜杠菜单模糊匹配（子序列打分，容忍笔误） | 前缀/子串匹配，无 typo 容忍 | `pi-tui-app.ts#matchingCommands` | **P1** | S |
| CC-04 | Shift+Tab 权限模式循环 HUD | 无模式循环；预设经 Ctrl+P picker 直切 | `pi-tui-app.ts#handleGlobalKey` + runner seam | P2 | M |
| CC-05 | 权限「总是允许 / 永不」一次性升级 | 仅 allow once / reject（G35） | `approval-view.ts` + runner 写权限规则 | P2 | L |
| CC-06 | 思考点 ⏺●○ 分级脉冲（流式 thinking 指示） | thinking L1/L2/L3 静态着色 + Ctrl+T；无点脉冲 | `assistant-message.ts` footer / `pi-tui-app#createEntryView` | P2 | S |
| CC-07 | 上下文压力分段彩条（request/surface/breakdown） | `ctx N%` + 10 段单色 ▓░，无分段 | `footer.ts` + token-meter 分段读取 | P2 | M |
| CC-08 | 轮次分隔线（turn 边界） | 无显式分隔，靠时钟/统计页脚暗示 | `pi-tui-app#createEntryView` 或 fold | P2/克制 | S |
| CC-09 | 会话恢复/切换 toast 反馈 | picker ● 当前标记 + 相对时间；无切换 banner | runner 切会话后 `toast()` | P2 | S |
| CC-10 | 子代理运行精灵 ▐▓░ 进度 | `◆ subagent` 徽标 + `◆ job ⟳` 耗时；无进度条 | `panels.ts` 子代理行 | P2 | S |
| CC-11 | diff hunk 头 + ✻ 改动标记 | 词级 `+/-` + `✎` 产物 chips；无 hunk 头/✻ | `diff.ts` / `dsh-tools.ts` | P2/克制 | S |
| CC-12 | 每消息成本 $ 显示 | 无定价数据（仅 token 用量） | — | ⛔ 克制 | — |
| CC-13 | git 分支显示 | 无（INTERACTION-PLAN 明示 DSH 无此服务） | runner 读 git（IO 下放 runner） | P2/克制 | S |
| CC-14 | Esc 二次退出 / 部分取消 | Esc 中断已对齐 CC；部分取消需 runtime | — | ⛔ 需研究 | — |

## 实施状态（2026-08 落地记录）

| # | 结论 | 说明 |
|---|---|---|
| CC-01 | ✅ 已落地 | `permissionTone()`：full-access 红 / workspace-write 蓝 / read-only 暗灰，投影与 fold 回退两条路径都分色（`pi-tui-app.ts`） |
| CC-02 | ✅ 已落地 | 审批弹窗命令块：runner 按 callId 回查文档工具调用（`approvalContext`），bash/pwsh 展示 command 原文、write/edit 附带「将修改：路径」，300 字符封顶（`decision-card.ts`/`control/approvals.ts`/`index.ts`） |
| CC-03 | ✅ 已落地 | `subsequenceScore` 子序列打分 + 前缀 +4 优先（`pi-tui-app.ts#matchingCommands`） |
| CC-04 | ⛔ 克制不做 | pi 支持 `shift+tab` 键名，但 Tab/Shift+Tab 已是焦点环的正/反向循环（F4 契约），绑定会破坏反向聚焦；模式切换由 Ctrl+P/`/permission` 覆盖 |
| CC-05 | ⛔ 克制不做 | harness 审批策略是配置层 policy（`ask|never`），answerer 层没有逐工具「always/never」写缝隙；Ctrl+P 预设切换即终端等价 |
| CC-06 | ✅ 已落地（静态版） | `assistantFooter()`：流式 + 空正文 + 有 thinking 时挂 `⏺ ● ○ ○` 静态脉冲（正文出现即摘除），复用 busy Loader 的重绘节奏，零新增定时器 |
| CC-07 | ✅ 已落地（fold 路径） | footer 10 段彩条分段：cache 命中段 info 色、新 surface 段压力色（`footer.ts`，数据来自 `AssistantEntry.usage` 求和）；token-meter 全量 breakdown 仍待上游 |
| CC-08 | ⛔ 克制不做 | turn 分隔线稀释「无重框」原则且与消息时钟冗余 |
| CC-09 | ✅ 已落地 | 会话切换成功后 `toast(已恢复会话 …)`（`index.ts#onSessionPicked`） |
| CC-10 | ✅ 已落地 | 运行中 job 行 4 帧 `▐▓░` 呼吸条（`panels.ts`，随 500ms ticker 重绘推进） |
| CC-11 | ✅ 已落地（hunk 头） | diff 卡每个文件块前加 `@@ -1,N +1,M @@` 行号头（`dsh-tools.ts`）；✻ 语义错位（单栏无侧栏，`✎` chips 已等价）不做 |
| CC-12 | ⛔ 克制不做 | dsh 无定价表，硬编码价格会漂移误导 |
| CC-13 | ⛔ 克制不做 | git 读取需 runner 动工 + 实时性存疑，价值中等，延后 |
| CC-14 | ⛔ 克制不做 | 部分取消是 dsh agent 循环内部语义，TUI 无分离取消缝隙；二次 Esc 与 Ctrl+C/`/quit` 重叠易误触 |
| F2（追加） | ✅ 已落地 | 离开底部时状态行挂 `↓ 回到底部 (End)` 提示：applyStatusLines 抽取 + handleViewportInput hook（pi 先注册并 consume 视口键）+ 输入监听 + 500ms ticker（不受 DSH_TUI_ANIM=0 冻结） |

> 已覆盖、无需再做的 CC 细节（见 §2 逐条「已覆盖」标注）：Esc 中断、Enter 排队 + Alt+Enter steer +
> Alt+Up 取回、消息队列计数、thinking 分级着色 + 全局开关 + 逐块展开、工具卡状态点 + 展开/折叠 + raw input、
> todo ✓/▶/○ 面板、plan ◐ 徽标 + Ctrl+E、jobs ⟳/✓/✗ 实时耗时、diff 词级增删着色、产物文件 ✎ chips（OSC 8 可点）、
> 统计页脚（⏱ ⚡ tok/s + 轮次结局徽标）、跨日时间戳、会话 picker 全文搜索 + ● 当前标记、
> 克制原则（无重框 / DSH_TUI_ANIM=0 冻结动画 / 色彩只留语义状态）。

---

## 1. 现状速览（提案的事实基线）

数据流与已实现能力一句话概括：

- **单向数据流**：`SessionEvent → fold()（纯函数）→ ViewDocument → app.render()`。fold 禁 IO，
  所有跨组件状态进 `ViewDocument`（`document.ts`），视图层只读文档 + `meta`（`terminal-app.ts#SurfaceMeta`）
  + runner 推来的 `jobs`/`projections`/`queueCount`。
- **已对齐 CC 语义**：Esc 中断（`pi-tui-app.ts:586`）、Ctrl+C 仅 idle 退出（`:491`）、
  Enter 入队 + Alt+Enter steer + Alt+Up 取回（`:535`、`:543`、`DSH_TUI_ENTER=steer`）、队列计数（`:1203`）。
- **视觉体系**：palette 已逐字采用 dsh web 设计 token（`palette.ts`），语义色分
  `error/success/warning/info/accent/muted/dim`；`DSH_TUI_ANIM=0` 冻结品牌 shimmer（`brand.ts`）。
- **header/footer 信息架构**：header=`dsh tui │ session │ ↳ parent │ title │ ◐ plan`（`:1128`）；
  footer=model · ctx% ▓░ bar · cwd · msgs · in/out token（`footer.ts:39`）+ 统计条（`stats.ts`）。

下面每条 CC 细节按「现状（引证据）→ 方案（文件+改法要点+数据源）→ 优先级」展开。

---

## 2. 逐条映射

### 2.1 状态指示（spinner / 分级 / 消息状态）

**CC-06 思考点 ⏺●○ 分级脉冲（流式 thinking 指示）**
- 现状：thinking 分级着色已存在——`palette.ts:90-92` 定义 `thinkingL1/L2/L3 = gray/dimGray/darkGray`
  （L1 最亮→L3 最暗），`pi-tui-app.ts:565` Ctrl+T 全局开关，`focus-frame.ts:31` 聚焦助手消息 Enter
  逐块展开/收起。但「流式 thinking 进行中」没有 Claude Code 那种 `⏺ ● ○ ○` 点脉冲——正在思考时
  assistant 块若尚无文本，用户看不到「在思考」的进度感。
- 方案（P2 / S，纯视图，不动 fold）：`AssistantEntry` 已带 `state`/`text`/`thinking`/`firstChunkAt`
  （`document.ts:55-80`）。在 `pi-tui-app.ts#createEntryView`（`:928`）与 `updateEntryView`（`:995`）里，
  当 `entry.state === 'streaming' && entry.text === '' && entry.thinking.length > 0` 时，给该助手消息
  加一行 footer：`fg('muted')('⏺ ● ○ ○')`（用现有 Loader 80ms 重绘循环或静态 dim 点即可，不必新定时器——
  复用 `StatusSlot` 已有 spinner 重绘节奏，零额外定时器）。改 `strings.ts` 不必新增键（纯字形）。
- 结论：**P2**，高杠杆低风险，但收益低于 P1 的 CC-01/02/03；流式 thinking 的「有没有字」本就能从
  `text === ''` 推出，无需 fold 变更。

**工具执行 spinner / 消息状态标记**
- 现状：已覆盖。工具卡 running 态经 `ToolExecutionComponent.markExecutionStarted()` + `⏳` 子调用标记
  （`tool-card.ts:66`）；结局徽标 `✓/✗/⏹` 挂 assistant footer（`pi-tui-app.ts:274-278`）；retry/compaction
  有 `RetryStatusIndicator`/`CompactionSummaryMessageComponent`（`status-indicator.ts`）。
- 结论：**已覆盖**，无需新提案。

### 2.2 布局与留白（无重边框、缩进+暗淡元数据、色彩只留状态）

- 现状：已遵循。分层靠 `fg('muted')`/`fg('dim')` 元数据 + 缩进（tool-card 子调用 `  │ ` 树、
  notice `  │ ` 展开体）；全屏仅两条 `DynamicBorder` 细分隔线（`pi-tui-app.ts:470,474`），
  决策卡 `╭─╮` 圆角框是唯一「盒状」元素（`decision-card.ts:58`），属合理例外。
- 结论：**已覆盖（克制原则）**。若追求更极致 CC 化，可把决策卡圆角框改为左侧竖线 + 无上下框，
  但当前读感已接近 pi/web 语言，收益低，**不建议改**。

### 2.3 header / footer 信息架构（模型 / cwd / git / 权限徽标）

**CC-01 权限模式彩色徽标**
- 现状：header 无权限徽标；权限以纯文本 `ℹ 权限预设：xxx` 落在 idle 状态槽（`pi-tui-app.ts:1221-1225`），
  无分色，看不出 read-only（安全）vs full-access（危险）的区别。
- 方案（**P1 / S**）：新增一个 preset→tone 映射（视图层纯函数，不落文档）：
  `read-only → dim`、`workspace-write → info`、`danger-full-access → error`、其余 `→ muted`。
  数据源二选一，优先 `ProjectionRow`（`terminal-app.ts:53`，key==='permissions' 的 `currentValue`），
  回退 `doc.permissionPreset`（`document.ts:201`）。改两处：
  1. `pi-tui-app.ts:1214-1225` 的 projectionLine / permissionPreset 分支，把 `当前值` 用对应 tone 着色
     （例 `ℹ 权限：{fg('error')(current)}`），并可在值前加颜色点 `●`；
  2. 可选：把权限徽标上移到 header（`:1136` 旁），与 `◐ plan` 并列，空闲/忙碌恒显（CC 的 status line 语义）。
  文案复用 `strings().permission`（已存在，`strings.ts:231`），无需新键；颜色名沿用 palette 既有语义色。
- 结论：**P1**，半小时内可做，直接提升「当前权限模式」的可感知性。

**CC-13 git 分支显示**
- 现状：无。`INTERACTION-PLAN.md:80` 已明示「git 分支：DSH 无此服务，不引入」。
- 方案（P2/克制 / S）：若要做，**IO 必须下放到 runner 层**（fold 禁 IO）——在 runner 启动/切会话时
  同步读一次 `.git/HEAD`（`git rev-parse --abbrev-ref HEAD`，失败静默），塞进 `SurfaceMeta`（新增
  `gitBranch?: string` 字段，`terminal-app.ts:63`），footer 渲染 `{fg('muted')(branch)}` 一列。
  代价：进程内再 spawn 一次 git，且 branch 不会实时刷新（dsh 无 VCS 事件）。
- 结论：**P2 / 克制**——价值中等、需 runner 动工 + 实时性存疑，建议延后；若不改则明确记录「克制不做」。

### 2.4 上下文条 / token 用量（压力环的终端等价）

**CC-07 上下文压力分段彩条**
- 现状：footer 已有 `ctx N%` + 10 段 `▓░` 单色压力条，超 60% 转 warning、超 80% 转 error
  （`footer.ts:57-63`）；数据来自 `SurfaceMeta.contextWindow` + `AssistantEntry.usage` 求和（`footer.ts:43-49`）。
  缺 web 的「分段 breakdown」（request/surface/cache 各自占比的彩条）——FEATURE-CHECKLIST G42/E3 也标 🟡。
- 方案（P2 / M）：需要 token-meter 的分段数据。两条路径（按 research 成本排序）：
  1. **纯 fold 路径（推荐先探）**：`AssistantEntry.usage` 已含 `inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens`
     （`document.ts:77`），fold 逐事件累计 `surface`（非 cache 的 input）与 `cacheRead` 两个桶，
     在 footer 画两段彩条 `▓░`（cache 段用 `info`、surface 段用 `accent`）。改动仅 `footer.ts` + `stats.ts`
     聚合，**零服务耦合**，符合「文档即真相源」。
  2. token-meter 服务读取（web G42 的 request/surface/breakdown 全量）：需核对 `sessionProjections`
     是否暴露 request-level 分段；若无，标 P2 依赖上游。
- 结论：**P2**（先走路径 1，半天内可出两段彩条；全量分段需上游核对）。

### 2.5 权限提示（命令高亮 / 影响分析 / 一次性·总是 / Shift+Tab 循环）

**CC-02 权限提示命令高亮 + 影响分析行**
- 现状：审批卡 `DecisionCard` 渲染 title + reason 摘要 + 编号选项（`decision-card.ts:69-99`），
  `ApprovalEntryView` 折叠行只有 `⏳ approval {toolName} — {reason}`（`approval-view.ts:64-73`）。
  命令本身（要执行的 bash 正文）与「会读写哪些文件」不显示——CC 的权限弹窗核心是把**具体命令**高亮出来。
- 方案（**P1 / M**）：命令正文已在文档里——`ToolEntry.arguments`（`document.ts:88`，bash 工具即命令文本）。
  改 `approval-view.ts#presentApprovalDialog`：新增 `commandText?: string` 与 `impactLines?: string[]` 两个入参，
  由 runner 在触发审批时从对应 `ToolEntry` 取 `arguments`（及 `tool/result.meta` 的 diff 路径）传入；
  `DecisionCard` 在 title 与选项之间插入一段 `fg('toolOutput')` 的命令块（`╭`/`│`/`╰` 或直接
  `fg('toolTitle')` + dim 缩进），影响行用 `fg('warning')(`将修改 ${paths.join(', ')}`)`。
  文案需新增 strings 键（如 `permissionCommand`/`permissionImpact`，zh/en 双语）。
- 结论：**P1**，直接影响「要不要允许」的决策质量；改动跨 view + runner 传参，半天。

**CC-05 权限「总是允许 / 永不」一次性升级**
- 现状：G35 明确 TUI 审批只有 `allow once / reject`（`approval-view.ts:158` 起的 `options`），
  「always/never」属权限规则域，当前经 Ctrl+P/`/permission` 预设切换可达，但**不能在审批当场**升级。
- 方案（P2 / L）：需研究 dsh 审批瀑布是否暴露「写一条持久规则」的缝隙（approval/request 的 answerer
  返回值目前是 `allowed-once/rejected/cancelled/unavailable` 四态，`document.ts:131`）。若 runtime 有
  `always allow this tool` 的写入口，则在 `DecisionCard` 加第三/第四选项并映射；若无，标 ⛔ 依赖上游。
- 结论：**P2**（先做 seam 核对，再决定是否落地）。

**CC-04 Shift+Tab 权限模式循环 HUD**
- 现状：无模式循环键；预设切换是 Ctrl+P 弹窗（`pi-tui-app.ts:561`）或 `/permission`。
- 方案（P2 / M）：`pi-tui-app.ts#handleGlobalKey` 加 `shift+tab` 分支（需先确认 pi-tui `matchesKey`
  能识别 `shift+tab`，否则用原始字节），触发新 handler `onPermissionCycleRequest?()`；runner 维护
  预设序表（read-only→workspace-write→full-access→custom…），每次循环调 `permissionPresets.set`，
  用 `toast()` 即时反馈新值（复用 `presetSwitched` 文案，`strings.ts:239`）。full-access 仍要确认弹窗。
- 结论：**P2**（键识别 + runner seam + 循环序表，半天到一天）。

### 2.6 Esc 中断语义 / Enter 排队 / 消息队列计数

- 现状：**已覆盖**。Esc 中断（`:586`）+ 聚焦态 Esc 返回输入（`:582`）；Enter 排队（上限 10，runner 侧）、
  Alt+Enter steer（`:535`）、Alt+Up 取回（`:543`）、`DSH_TUI_ENTER=steer`（`:408`）；队列计数进 busy 槽
  （`:1203-1205`）。`/hotkeys` 面板已文档化这些键（`strings.ts:151-199`）。
- 结论：**已覆盖**，与 CC 语义一致，无需改动。

**CC-14 Esc 二次退出 / 部分取消**
- 现状：Esc 只做「整轮中断」，无「先取消当前工具、再 Esc 取消整轮」的部分取消；退出走 Ctrl+C(idle)/Ctrl+D/`/quit`。
- 结论：**⛔ 需研究 / 克制**——部分取消是 dsh agent 循环的内部语义，TUI 侧拿不到「当前工具 vs 整轮」的
  分离取消缝隙；二次 Esc 退出与现有 Ctrl+C/`/quit` 语义重叠且易误触。**不建议做**，记录即可。

### 2.7 斜杠菜单 / 命令 discoverability

**CC-03 斜杠菜单模糊匹配**
- 现状：`matchingCommands`（`pi-tui-app.ts:711-716`）做 `startsWith`（value/alias）+ label 子串包含，
  无 typo 容忍；菜单已有 name + hint + description + 别名 + Tab 补全（`slash-menu.ts:52-86`）。
- 方案（**P1 / S**）：把 `matchingCommands` 换成子序列打分：对 query 逐字符做子序列匹配
  （value、每个 alias、label 去 `/` 与 hint），命中者按「连续命中>命中率>别名/名称优先」排序，
  无命中再回退现有子串匹配。纯函数改动一处，`tests/pi-tui-app.spec.ts` 已有多条别名/过滤用例
  （`:1201`、`:1222`）可追加一条 typo 用例。
- 结论：**P1**，半小时内，直接提升命令 discoverability（CC 的模糊补全体验）。

**命令参数提示**
- 现状：已覆盖——`/name <hint>` 标签 + description（`CommandChoice.label` 经 `slash-menu.ts:68` 渲染），
  内联参数直切（`/model provider/model`）已实现（`pi-tui-app.ts:445`）。
- 结论：**已覆盖**。

### 2.8 diff / 文件修改可视化

**CC-11 diff hunk 头 + ✻ 改动标记**
- 现状：diff 词级增删已覆盖——`diff.ts#renderDiff` 做 `+/-` 行 + 单行改动 intra-line inverse 高亮
  （`diff.ts:26-138`），色板 `toolDiffAdded/Removed/Context`（`palette.ts:120-122`）；产物文件用
  `✎` chips + `📂`（OSC 8 可点，`pi-tui-app.ts:253-272`）。
- 方案（P2/克制 / S）：
  1. **hunk 头**：`FsDiffMeta` 只给 `{path, oldText, newText}`（DESIGN.md §4.2），无 `@@ -x,y +a,b` 行号，
     合成 hunk 头需在 `dsh-tools.ts` 侧自算 old/new 行数并拼 `@@` 头——纯展示，半天内可做，价值中等。
  2. **✻ 标记**：CC 的 ✻ 是**文件列表侧栏**里「新/改文件」的标记，TUI 单栏无侧栏；`✎` chips 已等价
     覆盖「本轮改了哪些文件」。**不建议**硬塞 ✻（语义错位）。
- 结论：hunk 头 **P2 可选**；✻ **克制不做**。

### 2.9 子代理 / 后台任务 / todo / plan 模式

**CC-10 子代理运行精灵 ▐▓░ 进度**
- 现状：`◆ subagent` 徽标行（DESIGN.md §10 ②⑨，无树/指标，FEATURE-CHECKLIST E9 🟡）+ `◆ job` 行带
  `⟳/✓/✗` 与实时耗时（`panels.ts:94-109`）。无 CC 那种 `▐▓░` 运行进度条。
- 方案（P2 / S）：子代理是「无明确总量」的长期任务，CC 的精灵本质是「还活着」的脉动而非真进度。
  可在 `panels.ts` 子代理/运行 job 行加一个 4 段 `▐▓░` 呼吸动画（复用 jobs 500ms idle ticker，
  `pi-tui-app.ts:1284` 的 `syncIdleTicker` 已在 job running 时重绘），零新增定时器。
- 结论：**P2**，半天内，纯视觉增益。

**todo 面板 / plan 模式 / goal 面板**
- 现状：**已覆盖**。todo 计数头 `◆ todo ✓N ▶N ○N` + >6 折叠（`panels.ts:72-93`）；plan `◐ plan` 徽标 +
  Ctrl+E 退出 + plan-review approve `✔`（`pi-tui-app.ts:1136`、`:511`、`approval-view.ts:75`）；goal 面板
  `◆ goal ● objective · round N/M`（`panels.ts:59-71`）。
- 结论：**已覆盖**（CC 的 todo/plan 实时状态在本仓库以「固定面板 + 状态字形」等价呈现）。

### 2.10 轮次分隔 / 时间戳 / 成本 / 会话切换恢复

**CC-08 轮次分隔线**
- 现状：无显式 turn 分隔；靠每消息时钟（`clockFooter`，`pi-tui-app.ts:221-238`，含跨日/跨年）+ 统计页脚
  （`:240-279`）暗示边界。
- 方案（P2/克制 / S）：可在 fold 层给每个 `turn/start` 后的首条之前插一条 dim 分隔（如
  `fg('dim')('─'.repeat(width))` 或 `· ── turn N ──`），但会**稀释「无重框」克制原则**且与消息时钟冗余。
  建议**克制不做**；若要做，仅在「两个 turn 之间无任何消息」时补一条极淡分隔。
- 结论：**P2 / 克制**（默认不做）。

**CC-09 会话恢复/切换 toast 反馈**
- 现状：picker 有 `●` 当前标记 + 相对时间 + 全文搜索（`pi-tui-app.ts:679`、`showSessionPicker`）；切换后
  无「已恢复」banner，只靠 header 的 session id/title 变化。
- 方案（P2 / S）：runner 在 `onSessionPicked` 成功后调 `app.toast(`已恢复会话 ${title ?? id}`, 'info')`
  （`toast` 已存在，`pi-tui-app.ts:1312`；文案走 strings 新增 `resumedSession(session)` 键 zh/en）。
- 结论：**P2**，半小时内，低成本高感知。

**CC-12 每消息成本 $ 显示**
- 现状：有 token 用量（`AssistantEntry.usage` 求和 → footer in/out + 缓存命中率，`stats.ts`），**无 $ 成本**。
- 结论：**⛔ 克制**——dsh 无定价表（token-meter 不给 $），硬编码价格会漂移/误导；token 用量已是终端可得的
  最诚实等价物。**不做**。

### 2.11 其他克制的 CC 细节（明确不做，记录理由）

| CC 细节 | 判断 | 理由 |
|---|---|---|
| 无重边框 / 无动画噪音 | ✅ 已遵循 | 仅两条 `DynamicBorder` 分隔 + 决策卡圆角框；`DSH_TUI_ANIM=0` 冻结 shimmer |
| 色彩只留给状态/强调 | ✅ 已遵循 | palette 语义色 `error/success/warning/info/accent/muted/dim`，无装饰色 |
| 缩进 + 暗淡元数据分层 | ✅ 已遵循 | tool-card 子调用树、notice 展开体、dim 时钟/统计页脚 |
| 上下文压力环（SVG 环） | ⛔ 终端不可行 | 环是 web 的 SVG；终端等价已用 `ctx N%` + ▓░ 条覆盖 |
| 拖拽重排会话/工作区 | ⛔ 终端不可行 | FEATURE-CHECKLIST H9 已标 ⛔ |
| 图片画廊/灯箱 | ⛔ 终端不可行 | H29 已标 ⛔；read_image 结果占位行 |
| 侧栏 / 三栏布局 | ⛔ 终端单栏 | H25 已标 ⛔ |
| 轨迹视图（Inspect） | ❌ 未做 | B11/H31；独立大特性，超出「视觉/交互细节」范畴 |

---

## 3. 建议实施顺序（给主代理的动手清单）

1. **第一批（P1，半天内，高杠杆）**：CC-01 权限彩色徽标 → CC-03 斜杠模糊匹配 → CC-02 审批命令高亮。
   - 三者都落在 `view/` 单层 + runner 少量传参，无需动 fold 纯函数，回归面小。
   - 每项补 `tests/pi-tui-app.spec.ts` 一条用例（权限徽标分色、模糊命中 typo、审批卡命令块）。
2. **第二批（P2，视需求）**：CC-06 思考点脉冲、CC-09 会话切换 toast、CC-10 子代理精灵、
   CC-07 上下文分段（fold 路径）、CC-11 hunk 头、CC-08/CC-13 视「克制 vs 要做」取舍。
3. **需先研究再定**：CC-04（pi-tui `shift+tab` 识别）、CC-05（dsh 审批规则写缝隙）、
   CC-07 全量分段（token-meter 读取 API）。

> 约束复核：所有提案均满足——fold 纯函数不变（CC-06/07/10 用现有文档字段 + 视图纯计算）；
> 文案新增键集中进 `strings.ts`；cordis 仅经 `ctx.get`/runner 既有 seam；不改 `src/tests/scripts` 代码、
> 不跑构建/E2E（本报告为只读分析 + 本文档）。
