# 详细设计：DSH Runtime × pi TUI 视图（dsh-tui）

> 本文是 ARCHITECTURE.md 的细化：把四层骨架落成可实现的契约——每个类型字段、每条映射规则、
> 每个控制动作都有核实过的依据（DSH 源码/类型 + pi 0.84.1 源码/npm）。标注 ⚠ 的条目是实现前
> 需最后核对的点。

## 0. 目标与约束

- **DSH 是唯一 runtime**：agent 循环、工具执行、MCP、目标、子代理、持久化全部不动；
- **pi 是视图体系**：引擎（pi-tui）+ 视觉语言 + 交互组件（vendor），组件零改写；
- **唯一稳定契约 = ViewDocument**：DSH 升级只动 Projection 层，pi 升级只动 View 层，未来协议化复用同一契约；
- **TDD 不变**：Projection 纯函数单测 + 假终端组件测试 + PTY E2E。

## 1. 总体结构与目录

```
SessionEvent[] ──Projection──▶ ViewDocument ──Synthesis──▶ pi 组件 ──▶ 屏幕
                 （纯函数）      （条目契约）   （数据合成）   （View 层）
                     ▲                                    │
                     └──── Control（UI 动作 → agent 指令）─┘

src/
  document/document.ts        ViewDocument 类型 + 稳定 id 规则（纯类型，零依赖）
  projection/fold.ts          fold(event, doc) 增量投影（核心，纯函数）
  projection/replay.ts        replay(events) → ViewDocument（resume）
  projection/synthesis/pi-messages.ts   DSH 块 → pi-ai Message 形状
  projection/synthesis/dsh-tools.ts     DSH 工具名 → view-only ToolDefinition 注册表
  projection/synthesis/diff.ts          FsDiffMeta → 渲染数据（沿用 pi diff 组件）
  control/runner.ts           进程内胶水：agent 生命周期 + 事件订阅（现 index.ts 演进）
  control/approvals.ts        approval/request 瀑布 + userQuestions provider
  control/pickers.ts          sessionQuery / llm roster / settings 数据源
  view/app.ts                 PiTuiApp：TuiAltScreen + 布局根 + 组件表（现 pi-tui-app.ts 演进）
  view/pi-vendor/             原样 vendor 目录（文件头保留 pi MIT 声明）
  view/components/            DSH 专属组件：ApprovalDialog / GoalPanel / TodoPanel / Footer
  view/theme/                 theme 单例 shim + palette（现 pi/ 目录演进）
tests/{document,projection,synthesis,view,control}.spec.ts + e2e-pty.py
```

## 2. ViewDocument 契约（document/document.ts）

### 2.1 条目类型

```ts
/** 稳定 id 规则（View 层 reconcile 的唯一依据）：
 *  user       = `u${seq}`                  （事件序号）
 *  assistant  = `${turn}:${step}`          （DSH step 身份，同一步的流式与提交同 id）
 *  tool       = callId
 *  status     = `turn:${n}` / `retry:${retryId}` / `compaction:${compactionId}`
 *  approval   = `approval:${approvalId}`
 *  goal       = `goal`、todo = `todo`（单例条目，原地更新） */
type EntryId = string

interface UserEntry { kind: 'user'; id: EntryId; text: string }

interface AssistantEntry {
  kind: 'assistant'
  id: EntryId
  turn: number; step: number
  text: string              // text-delta 拼接 + assistant/message 权威替换
  thinking: string[]        // 提交后的 reasoning 块（保持分块，供分级着色）
  state: 'streaming' | 'committed'
}

interface ToolEntry {
  kind: 'tool'
  id: EntryId               // = callId
  name: string
  arguments: string         // 模型原始 JSON 字符串（不解析）
  state: 'running' | 'done' | 'error'
  output?: { blocks: DshContentBlock[] }        // tool/result.message.content 原样
  error?: { name: string; code: string }
  meta?: JsonValue          // 原样透传（FsDiffMeta 在此）
}

interface StatusEntry {
  kind: 'status'
  id: EntryId
  status: 'working' | 'retry' | 'compaction'
  // working：无附加字段；retry：attempt/maxAttempts/delayMs（llm/retry-started）
  // compaction：summaryText（ContentBlock 拼接）+ shadowedTokenCount
  detail?: RetryDetail | CompactionDetail
}

interface ApprovalEntry {
  kind: 'approval'
  id: EntryId
  toolName: string; callId?: string; reason?: string
  state: 'pending' | 'decided'
  outcome?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
}

interface GoalEntry {
  kind: 'goal'; id: 'goal'
  objective: string; phase: string          // GoalSnapshot（⚠ 核对 GoalPhase 全部取值）
  blockedReason?: string
  maxGoalRounds: number; roundsStarted: number
}

interface TodoEntry { kind: 'todo'; id: 'todo'; items: { content: string; status: string }[] }

type ViewEntry = UserEntry | AssistantEntry | ToolEntry | StatusEntry | ApprovalEntry | GoalEntry | TodoEntry

interface ViewDocument {
  entries: ViewEntry[]          // 有序；append-only 为主，tool/status/单例条目原地更新
  busy: boolean                 // 状态槽 + 编辑器开关 + Esc 语义
}
```

### 2.2 生命周期规则

- 条目**一旦 committed 不再变文本**（幂等回放友好）；唯一原地更新：流式 assistant、tool state、
  status 增删、approval outcome、goal/todo 快照；
- 同一 id 的 `assistant/message` 重放（compaction/修复）按 upsert 覆盖；空文本不产生条目；
- `reset()`（换会话）清空 entries 与 busy——与现实现一致。

## 3. Projection 层（projection/fold.ts）

### 3.1 事件 → 文档操作映射表（payload 均已核实）

| SessionEvent | 操作 | 字段来源 |
|---|---|---|
| `turn/start {turn}` | busy=true；追加 StatusEntry(working, `turn:${turn}`) | — |
| `step/start` | 流式 assistant 若存在则提交为 committed（保留） | — |
| `user/message` `source.kind==='user'` | 追加 UserEntry（text 块拼接） | `content[].text` |
| `user/message` 其它来源 | 丢弃（注入上下文不上屏；可选未来折叠为 CustomEntry，默认丢弃） | — |
| `assistant/chunk {chunk:text-delta}` | 流式 assistant 追加 `chunk.text`（忽略 index，权威以 message 为准） | `chunk.text` |
| `assistant/chunk {chunk:reasoning-delta}` | 流式 thinking 追加 | `chunk.text` |
| `assistant/chunk {chunk:tool-call-delta}` | 忽略（tool/call 事件携带完整 name/args） | — |
| `assistant/chunk` 其它（block-start/end、usage、finish） | 忽略 | — |
| `assistant/message {turn,step,message,usage?}` | upsert AssistantEntry：text=text 块拼接、thinking=reasoning 块数组、state=committed；usage 存入 entry.usage（footer 用） | `message.content[]` |
| `tool/call {callId,name,arguments}` | 追加 ToolEntry(running) | — |
| `tool/result {message,error?,meta?}` | 按 `message.content[0].toolCallId` 定位 ToolEntry → done/error + output/error/meta | 块内 toolCallId |
| `compaction/start` | 记 compactionId（turn 上下文） | — |
| `compaction/summary {summary,shadowedTokenCount,…}` | 追加/替换 StatusEntry(compaction)（渲染为 pi CompactionSummaryMessage 的合成数据） | — |
| `compaction/end` | 清 compaction 状态 | — |
| `llm/retry-started {retry,retryId,maxRetries,delayMs}` | 追加 StatusEntry(retry, `retry:${retryId}`) | — |
| `llm/retry`（⚠ 核对 payload） | 移除对应 retry status | — |
| `approval/asked {id,toolName,callId?,reason?}` | 追加 ApprovalEntry(pending) | — |
| `approval/decided {id,outcome}` | 对应条目 state=decided + outcome | — |
| `goal/change`（GoalSnapshotChangeMeta） | upsert GoalEntry（objective/phase/maxGoalRounds/roundsStarted/updatedAt） | `goal` + `roundsStarted` |
| `goal/change`（GoalClearChangeMeta, operation:'clear'） | 移除 GoalEntry | — |
| `todo/write {todos[]}` | upsert TodoEntry | — |
| `turn/end` | busy=false；移除 working status | — |
| `session/title` | 不产生条目（供 picker 读取） | — |
| 未知类型 | 原样忽略（DSH 持久层保证未知不可忽略事件不会进入重放） | — |

### 3.2 增量算法

- `fold(event, doc)`：返回**新文档**（结构共享 + 尾段拷贝，避免整数组深拷贝）；View 层按 id
  reconcile（现有 append-only 复用逻辑的推广版）；
- `replay(events)` = fold 左折叠——与增量收敛一致（单测钉死该性质）；
- 性能预算：每事件 O(1) 摊销（流式追加）、渲染由 pi 差分引擎承接。

## 4. 数据合成层（projection/synthesis/）

**原则：pi 组件零改写，只合成它们要的数据。**

### 4.1 DSH 块 → pi-ai 形状（已核实 pi 0.84.1 类型）

| DSH | pi-ai | 备注 |
|---|---|---|
| `{type:'text',text}` | `TextContent{type:'text',text}` | 直接 |
| `{type:'reasoning',…}`（⚠ 核对块字段名） | `ThinkingContent{type:'thinking',thinking}` | DSH reasoning 块文本 |
| `{type:'tool-call',…}` | `ToolCall{type:'toolCall',id,name,arguments}` | arguments 解析为对象 |
| `{type:'tool-result',…}` | `ToolResultMessage{role:'toolResult',toolCallId,toolName,content,isError}` | 工具结果渲染用 |
| `{type:'image',…}` | `ImageContent{type:'image',data,mimeType}` | kitty 协议渲染（M4） |

`AssistantMessage` 必填字段合成：`api`（置 pi 默认值，⚠ 核对 Api 类型最小构造）、
`provider/model`（DSH message.source）、`usage`（event.usage，缺省零值）、
`stopReason`（committed 统一映射，⚠ 核对 pi StopReason 枚举值）。

### 4.2 DSH 工具定义注册表（view-only ToolDefinition）

每个定义只实现 `renderCall/renderResult/renderShell`（`execute` 为抛错桩——**执行永远走 DSH**）：

| DSH 工具 | renderCall | renderResult |
|---|---|---|
| `bash` / `pwsh` | 命令 + 描述 | 输出正文（截断 + 展开）、error 标红 |
| `read`（fs） | 文件路径 | 内容片段（行号 + 截断） |
| `write` / `str-replace-editor`（edit） | 路径 + 变更摘要 | **FsDiffMeta.diffs 逐 hunks 渲染**（pi 词级红绿 diff 组件） |
| `fs-search` / grep 类 | 模式 | 命中列表（路径:行） |
| `mcp-*` | 服务器名 + 参数 JSON | 文本输出 |
| `goal` / `ralph` / `skill` / 其它 | name + 参数摘要 | 文本输出 |
| 未注册工具 | 通用 fallback（name + args + 输出） | 同左 |

diff 数据流：`tool/result.meta`（`FsDiffMeta{diffs:[{path,oldText,newText}]}`，已核实由
`packages/fs/tool-fs/src/diff.ts` 的 `computeHunkDiffs` 产出）→ 直接喂 pi 的
`renderDiff`（已发布导出）。

## 5. 控制面契约（control/）

| UI 动作 | DSH 缝隙（已核实） | 语义细节 |
|---|---|---|
| 提交输入 | `agent.followup(createUserMessage(...))` | busy 时忽略（编辑器 disableSubmit 双保险） |
| Esc（busy） | `agent.cancel({kind:'user'})` | Claude Code 语义：Esc 中断当前轮 |
| Ctrl+C（idle）/ Ctrl+D / /quit | flush → dispose → stop → `exit(0)` + 2s unref 看门狗 | 保留现修复 |
| 会话选择 Ctrl+R | `sessionQuery.listSessions()` + `readTitle(id)` | 新→旧排序，标题回退 id |
| 模型选择 Ctrl+G | `llm.listProviders()` + `listModels(provider)` + `agentDefaultModel.saveSelection` | 影响后续会话 |
| 换会话 | flush + dispose + `agents.resume`（或 create） | boot 前 `app.reset()` |
| **审批** | 见 5.1 / 5.2 | — |

### 5.1 审批（工具权限）——`approval/request` 瀑布

- 注册 `ctx.on('approval/request', handler)` 为**链尾交互回答者**：
  `handler = async (req, next) => { const outcome = await next(); if (outcome !== 'unavailable') return outcome; return this.presentApproval(req) }`
  （⚠ 核对：`next()` 无回答者时的返回值是否为 fail-closed 的 `'unavailable'`——以此区分"该问人"）
- `presentApproval(req)`：由 `req.toolName/callId/reason` 定位文档中 ToolEntry 做上下文，
  弹 ApprovalDialog（overlay），用户选 **Allow once → 'allowed-once'** / **Reject → 'rejected'**；
  `req.signal` 中止 → 'cancelled'；超时（默认 120s，可配）→ fail-closed；
- `approval/asked`/`decided` 审计事件同时落 ApprovalEntry（历史可回放）。

### 5.2 提问（agent 主动问人）——`userQuestions` provider

- 注册为 `ctx.userQuestions` 的 UI provider：`ask(request) → Promise<Answer>`；
- request.items → 同一套 Dialog 组件（支持 options 菜单 + plan-review intent 的 approve/decline 呈现）；
- Answer 编码：`{ answers: [{ id, selected: [label], custom? }] }`（已核实类型）。

### 5.3 会话与模型数据源

- 现有 pickers.ts 逻辑保留，补齐：readTitle 失败回退 id、模型列表按 provider 分组。

## 6. View 层契约（view/）

### 6.1 引擎组装（保留现实现并演进）

- `TuiAltScreen` + 布局根 `VStack`（transcript ScrollView `grow:1`、composer 钉底）——**现状保留**；
- 原生滚动/搜索（补 search 样式 + Ctrl+F 绑定）、Editor slash/路径补全（`CombinedAutocompleteProvider`）；
- 状态槽（Loader/IdleStatus）、footer 提示行——保留。

### 6.2 条目 → 组件表

| ViewEntry | 组件 | 来源 |
|---|---|---|
| UserEntry | `UserMessageComponent` | pi vendor 原样 |
| AssistantEntry（committed/streaming） | `AssistantMessageComponent` | pi vendor 原样（streaming 走 updateContent） |
| ToolEntry | `ToolExecutionComponent` + dsh-tools 注册表 | pi vendor 原样 |
| StatusEntry(working/retry/compaction) | `WorkingStatusIndicator` / `RetryStatusIndicator` / `CompactionSummaryMessageComponent` | pi vendor 原样 |
| ApprovalEntry | `ApprovalDialog`（overlay）+ 文档内一行审批记录 | 自研（pi 视觉语言） |
| GoalEntry | `GoalPanel`（头部固定区：objective/phase/rounds） | 自研 |
| TodoEntry | `TodoPanel`（工具卡片下方：✓/○ 列表） | 自研 |
| （footer） | cwd + token/上下文占比（⚠ session-stats 服务核对） | 自研（pi Footer 模式） |

### 6.3 三个 shim

1. **theme 单例**：以我们 palette 初始化，满足 vendor 组件 `import { theme }` 的引用（对象形状
   对照 pi theme.ts 的 `fg/bg/bold/underline/inverse` 成员，⚠ 实现时按组件实际引用收窄）；
2. **键位**：pi-tui 自带 keybindings 管理器，加载 pi 默认绑定表（组件内 `keyHint()` 依赖它）；
3. **工具注册表**：§4.2 的 view-only ToolDefinition 表。

### 6.4 完整键位表（目标态）

| 键 | 动作 |
|---|---|
| Enter / Shift+Enter | 提交 / 换行（Editor 内建） |
| Esc | busy→中断（Claude Code 语义）；否则关闭弹窗/取消卡片焦点 |
| Ctrl+C | idle→退出（busy 时吞掉，不中断） |
| Ctrl+D、`/quit` | 退出 |
| Ctrl+R / Ctrl+G | 会话 / 模型选择（overlay） |
| PgUp/PgDn/Home/End/滚轮 | 转录区滚动（alt screen 原生） |
| Ctrl+F | （已评估后**暂缓**：发布版 pi-tui 0.84.1 无 alt-screen 搜索，该能力仅在 pi main 分支；等上游发布后纯接线即可） |
| Ctrl+U/Ctrl+K | 审批弹窗 Allow / Reject（dialog 聚焦时） |
| Tab | 补全接受（Editor 内建） |
| Esc | 关闭弹窗 |

## 7. 测试策略

| 层 | 测试 | 手段 |
|---|---|---|
| Document | id 规则、生命周期状态机 | 纯单测 |
| Projection | **映射表逐事件**（§3.1 每行一测）、增量=回放等价性、未知事件、注入过滤、跨 turn 重置 | SessionStore 真实 append 构造事件（现有基建） |
| Synthesis | DSH 块→pi 形状逐类型、ToolDefinition 表完整性、FsDiffMeta→renderDiff 数据 | 纯单测 + pi diff 组件快照 |
| Control | followup/cancel/审批瀑布（fake answerer）/question provider/选择器 | runner bench（现有基建）+ approval 桩 |
| View | 组件表渲染、reconcile 复用、布局钉底、弹窗交互、滚动 | FakeTerminal + TuiAltScreen（现有基建） |
| E2E | 对话→工具卡+diff 渲染→审批弹窗→goal 面板→持久化→resume 回放→干净退出 | e2e-pty.py（mock LLM 扩展 tool/approval 脚本） |

## 8. 实施阶段与迁移路径

| 阶段 | 内容 | 验收 | 迁移 |
|---|---|---|---|
| **M1 Document+Projection** | ViewDocument 类型、fold/replay、映射表全量 | 映射表逐事件单测全绿；现有 UI 行为不变（投影喂旧组件） | 替换 `state.ts`；`ChatState` 退役 |
| **M2 原样 vendor + 合成** | pi 组件原样入库、三个 shim、dsh-tools 注册表 | 工具卡含输出/展开/diff 渲染、thinking 展示、retry/compaction 状态 | 替换 `message-view/tool-panel`；`pi/` 目录重组 |
| **M3 DSH 专属渲染** | ApprovalDialog（双缝：approval/request + userQuestions）、GoalPanel、TodoPanel | 审批弹窗端到端（mock 触发） | 新增 |
| **M4 打磨** | footer 真数据、搜索样式、补全、image(kitty)、间距/主题补齐 | 视觉验收 + 全量回归 | 增量 |

## 9. 开放问题（实现前最后核对，均标注在文内 ⚠）

1. `approval/request` 瀑布中 `next()` 无回答者时的返回值（判断"该问人"的依据）；
2. DSH `assistant/message` 的 reasoning 块字段名与 `usage` 缺省形状；
3. pi `Api`/`StopReason` 的最小合法构造值；
4. `session-stats` 服务的公开读取接口（footer 数据源）；
5. `llm/retry`（完成事件）payload；
6. pi theme.ts 中 vendor 组件实际引用的成员集合（shim 形状收窄）。

## 10. 实施后的修订记录

- **输入键路由与面板撤场（0.2.1 后续，本轮）**：① **Home/End 键位冲突修复**——pi 键表把 home/end 同时绑在 `altScreen.top/bottom`（视口滚动）与 `editor.cursorLineStart/End`（光标行首行尾），而 alt-screen 的 handleViewportInput 在构造期第一个注册、先于编辑器消费，导致输入框聚焦时 Home/End 滚转录而非移光标；修复在 hookAltScreen 的包装里：输入框聚焦（focusIndex=-1 且无浮层）时把 home/end 转发给编辑器，焦点环聚焦消息时仍保留视口滚动；② **todo 完成即撤场**——CapabilityPanel 在 todo 全部完成（无 pending/in-progress）时不再渲染 ◆ todo 块（记录保留在文档 todo/write 日志，新会话自然无条目），完成的任务不再钉在转录顶部；单测 316→318。

- **opencode 斜杠语式纠偏（0.2.1 后续，本轮）**：原 `slash: 'panel'` 把「opencode 有命令面板」误读成「面板取代 `/` 弹层」——上游实际是两条入口**并存**（`/` suggestions popup + `ctrl+p` command_list，见 [opencode#38043](https://github.com/anomalyco/opencode/issues/38043)「command aliases not shown in /-suggestions popup」与修复 PR [#38086](https://github.com/anomalyco/opencode/pull/38086)）。故新增第 4 种语式 `popup` 并让 `OPENCODE_KEYMAP` 选它：方角边框（区别于 pi 圆角）+ 标题计数行（`命令 · N 项`）+ 整行铺满的选中态 + 描述列 + 底栏 `Ctrl+P 面板` 入口；`panel` 语式保留在类型里给「只要面板」的键位方案（当前无预设选用，`updateSlashMenu` 仍据此抑制弹层，Enter 提交的 `/xxx` 行照旧按目录解析执行）。顺带修边框行右边框对齐（`truncateToWidth(…, pad)` 补满内宽，pi `boxed` 圆角框一并受益——原样式边框贴着文字跑），文案入 strings 双语（`slashPopupTitle`/`slashPopupHint`——窄终端优先保住面板入口，故该行不列 Esc）。单测 312→316（新增 `tests/slash-menu.spec.ts` 覆盖 plain/boxed/popup 三语式与等宽断言）。

- **交互画像铺满三维（0.2.1，本轮）**：`enumIdiom` 升级为 `Keymap.interaction: InteractionProfile`，三个维度——① `enum`（枚举语式：cc 行内 ←/→ 循环 / pi、opencode 列表菜单，上轮已落地）；② `card`（审批/提问卡形态：cc `plain` 无边框纯文本 + 数字选择、pi `boxed` 圆角卡（现状）、opencode `centered` 居中弹窗——DecisionCard 增 style 分支渲染，presentApprovalDialog 增 style + 锚点参数，askDialog 按当前键位预设透传）；③ `slash`（斜杠菜单语式：cc `spacious` 名称/提示/描述全量、pi `compact` 仅名称与提示、opencode `panel` 不弹内联菜单——命令走 Ctrl+P 面板，Enter 提交的 `/xxx` 仍按目录解析）。E2E approval/questions 场景在 cc plain 卡下全绿（无边框渲染端到端验证）；单测 307→312。

- **预设驱动的广义交互层（0.2.1，本轮）**：① 预设从「键位+配色」扩展到**交互语式**——`Keymap.enumIdiom`：cc = `inline-cycle`（行内 ←/→ 循环切换值，Claude Code 式），pi/opencode = `list`（单列选择菜单）；② `/settings` 面板五条可枚举行（语言/主题/Enter/键位/动画）在 cc 语式下携带 cycle 数据：行上 ←/→ 直接切换并即时生效 + toast + 就地刷新，提示行补「←/→ 切换值」；③ **Ctrl+P 在 cc 语式下循环权限预设**（permissions 投影存在时行内切下一个预设，full-access 确认保留，switchPreset 复用），pi/opencode 保持枚举 picker；④ 顺带修 `/lang` 支持内联参数直切（`/lang zh`），与其它枚举命令对齐；⑤ 枚举选择器（/theme、/keymap、/preset、Enter 行为）改为带 ● 当前标记的单列 picker；hotkeys 面板 cc 区同步「Ctrl+P 权限预设循环」；单测 304→307。

- **/plugins + /workspace 批（0.2.1，本轮，M3/M4 收官）**：① `/plugins` 能力清单——`src/view/components/plugins-panel.ts`，命令/技能/投影三区代理视图（tui profile 无插件 registry，按来源分区；数据源诚实声明入组件注释与 SETTINGS 文档）；行级动作：命令 Enter 执行、技能 Enter 插入 composer（`__skill:` 前缀复用）、select 投影 Enter 开通用枚举 picker（H20 的终端等价设置路径）、结构化投影灰显；② `/workspace` 最近工作目录列表——sessionQuery cwd 去重 + 会话计数 + 最近优先 + 当前标记，选中经 `applyWorkspacePath`（与 Ctrl+W 共用：目录校验 → workspaceRef/meta/footer 同步 → 新会话）；③ FEATURE-CHECKLIST 的 ❌ 列**归零**（H20 转 🟡、H21 转 ✅，合计 99✅/39🟡/0❌/10⛔，不含 ⛔ 的可执行项 100% 覆盖）；单测 298→304。

- **/settings 聚合面板批（0.2.1，本轮）**：① `src/view/components/settings-panel.ts`——六行聚合面板（语言/主题/Enter 行为/键位预设/动画/配置文件），窗口滚动 + 数字直选 + Enter 执行 + Esc 关闭，**纯语义色零硬编码 hex，随主题预设（web/cc/pi/opencode）自动换肤**；面板是瞬态派生视图（打开时实时收集现状值，不落文档），行操作全部跳转既有命令/闭包；② Enter 行为与动画开关补了**写路径与持久化**——settings seam 的 `tui` 命名空间（`tui.enterBehavior`/`tui.anim`，best-effort），启动时 env 未显式设置则回填（hydration）；动画运行时切 `piTuiInternals.animFrameMs`（shimmer/脉冲随开关即时冻结/恢复）；③ 面板内切换主题/键位后就地刷新行（重复 `showSettings` 调 `setRows`），换肤后颜色随新预设重绘；④ `/settings` 命令入目录，E2E surface 场景补面板打开断言；单测 290→298。

- **主题预设批（0.2.1，本轮）**：① **视觉主题四预设 web/cc/pi/opencode**——palette.ts 重构出 `PaletteSet`（vars+colors）与 `WEB_PALETTE`，新增 `theme-presets.ts`：pi 取官方 dark.json/light.json 逐字、opencode 取默认主题 opencode.json 逐字（defs 展开）、cc 为 Claude Code 视觉特征诠释（暖橙 accent #D97757、近无边框灰阶、GitHub 系语法色）；`applyPalette(preset, variant)` 双参数化（明暗与预设正交），`/theme [web|cc|pi|opencode]` 热切换（palette + `refreshTheme()` 重建消息视图与 markdown 主题，composer 文本保留；编辑器边框/补全弹层因 pi-tui 无 setTheme 保持重启后生效——已文档化）+ `DSH_TUI_THEME_PRESET` env + `$DSH_HOME/tui-theme-preset.txt` sidecar；② **opencode 键位预设**——`KeymapId` 扩为 cc/pi/opencode，keymaps 增 `leader` 字段与 `resolveLeaderChord`/`isLeaderKey`，PiTuiApp 增 leader 等待态（Ctrl+X 前缀 + 2s 超时，stop 清理）；opencode 语义：Ctrl+C busy 清空输入（input_clear）/idle 退出、Ctrl+P 命令面板、Ctrl+R 重命名、`<leader>l/n/m/g/e/t/y/x/h/c` 和弦（会话/新会话/模型/轨迹/撰写/主题/复制/导出/thinking/压缩），新增动作 clearInput/newSession/rename/theme/export/compact；③ **`/preset [cc|pi|opencode]`** 一键同切键位+主题（两侧 sidecar 同写）；④ hotkeys 面板三套分区表（双语）；单测 279→290，E2E surface 场景覆盖 /keymap、/theme、/preset 往返切换。

- **快捷键与设置批（0.2.1 起点，本轮）**：① **cc/pi 快捷键双预设**——handleGlobalKey 的按键分支声明化为动作表（`src/app/pi/keymaps.ts`：KeyAction + 两张键位图 + `resolveKeyAction(data, busy)` 时机过滤），Tab 焦点环与 Esc 焦点复位不进预设；cc 预设 = 既有键位（Esc 中断、idle Ctrl+C 退出、busy Ctrl+C 吞掉），pi 预设 = pi usage.md 语义（Ctrl+C busy 中断/idle 退出、Ctrl+G 编辑器撰写、Ctrl+P 模型、权限走 /permission）；切换路径 `/keymap [cc|pi]`（裸命令弹双选）+ `DSH_TUI_KEYMAP` env + `$DSH_HOME/tui-keymap.txt` sidecar 持久化，hotkeys 面板随预设切换（strings 双语言各持两套分区表）；② **pi A3 编辑器撰写**——`composeInEditor()`：临时草稿（首行占位注释）→ openExternalEditor 挂起编辑 → 读回提交，空草稿 toast；pi 预设 Ctrl+G 直达、cc 预设经 `/compose`；③ **H11 工作区重命名**——裸 `/rename` 弹「会话标题/工作区目录」目标选择，目录目标单段名校验后 `fs.rename` 并同步 workspaceRef/meta/footer，内联参数保持会话重命名的直切语义；④ 新增 `SETTINGS-WORKSPACE-DESIGN.md`（/settings 聚合面板 + /plugins 代理清单 + /workspace 列表的 M1–M4 方案，参考 Claude Code 命令式设置与 web ui-settings-*）；单测 268→279。

- **综合优化批（本轮，0.2.0）**：① **发布卫生**——engines `node>=22.19.0`、`packageManager` pnpm@11.21.0、commander 精确锁定、npm 产物排除 `*.js.map`（208.9→156.8 kB）、依赖升级（chalk 6/diff 9/highlight.js 11.12/pi-ai 0.84.2）、`.npmrc` minimumReleaseAge=1440、CI audit 卡点；② **highlight.js core 子集**（46 语法 + 别名，包体积与 auto 探测耗时双减，未注册围栏语言回退探测不抛错）；③ **OSC 8 协议白名单**（http/https/mailto，C0 控制字符剥离，堵终端注入面）；④ **UX 借鉴 Claude Code**（CC-01 权限徽标分色 / CC-02 审批命令高亮+影响文件 / CC-03 斜杠模糊匹配 / CC-06 思考脉冲 / CC-07+**G42 上下文三段彩条**（token-meter contextBreakdown 投影 → system/tools/messages 分色）/ CC-09 会话切换 toast / CC-10 job 呼吸条 / CC-11 diff hunk 头；CC-04/05/08/12/13/14 评估后克制不做，理由见 CLAUDE-UX-IDEAS.md）；⑤ **F2 ↓ End 回底提示**——applyStatusLines 抽取，`handleViewportInput` 实例级 hook（pi 构造期先注册并 consume 视口键，监听器收不到 PgUp）+ 输入监听 + 500ms ticker（不受 DSH_TUI_ANIM=0 冻结）；⑥ **轨迹视图 B11/H31**——Ctrl+L/`/trajectory` 打开原始事件日志窗口（session.events → 类型分色/时间戳/摘要/过滤/翻页；Ctrl+I 与 Tab 同字节故用 L）；⑦ **拆分**——`src/session/feedback.ts`、`src/control/summaries.ts`、`src/app/pi/command-match.ts` 出仓（index.ts 1494→1358、pi-tui-app.ts 1645→1624）；⑧ **E2E 6→8 场景**（surface/trajectory 新增，路径推导去本机写死）+ **npm 供应链审计**（131 项 IOC 0 命中，报告 docs/security/supply-chain-audit-2026-08-17.md）；单测 245→268，FEATURE-CHECKLIST 汇总 97✅/38🟡/3❌/10⛔。

- **footer 数据源**：改为**从 ViewDocument 计算**（assistant 条目 usage 求和 + 消息数）而非 session-stats 服务——文档即真相源，零服务耦合；
- **转录区搜索暂缓**：发布版 pi-tui 0.84.1 的 alt screen 无搜索实现（main 分支才有），上游发布后补接线；当前 PgUp/PgDn/滚轮已覆盖导航；
- **ApprovalPresenter 超时**：弹窗超时与 abort 均 fail-closed（`unavailable`/`cancelled`），与 DSH 语义一致；
- **slash 补全移除**：pi-tui 0.84.1 的 Editor 在 slash 补全打开时，Enter 是"确认建议"而非"提交"，会把 `/quit` 变成 `/quiquit` 并误发为聊天消息（实机抓包确认）；移除 slash 命令注册（保留 @/# 路径补全），`/quit` 回归直接提交，并加了回归测试；
- **审批 E2E 场景落地**（`scripts/e2e-pty.py` + `scripts/fixtures/`）：① 权限审批——CC 风格 PreToolUse hook（`e2e-hooks.json`，对 bash 返回 `permissionDecision: ask`）+ overlay 挂载 `dsh-hooks-claude-code`，隔离 DSH_HOME 排除用户 settings 的 `permission.defaultPreset`（实为 `danger-full-access` → 会话钉 `approval: never`，弹窗永远不会出现——这是 DSH 正确行为而非 bug）；② 决策表单——mock 脚本化 `ask_user_question` 工具调用，回答回传后 agent 继续；
- **审批弹窗焦点恢复 bug 修复**：`showOverlay(容器)+setFocus(内部列表)` 会破坏 pi-tui hide() 的焦点身份恢复（焦点留在已移除的列表上，后续输入全部丢失）；改为可聚焦 DialogPanel 包装标题+列表，overlay 直接聚焦面板自身；
- **实测 UX 修复（弹窗）**：弹窗从居中改为**锚定输入块上方**（`bottom-center, offsetY -6`）；无选项问题（自由文本）渲染 `Input` 输入行（自带光标/IME 支持 + `Enter 提交 · Esc 取消` 提示），答案经 `custom` 槽回传；选项问题加 `↑/↓ 选择 · Enter 确认 · Esc 取消` 提示与选中行背景高亮；
- **交互优化批（INTERACTION-PLAN.md P0/P1）**：① P0——工具卡展开/折叠（Enter 展开、Tab/Esc 焦点循环、超长输出 `… N more lines` 截断计数）、错误 turn 生成 NoticeEntry（`Error: code: message`）、中断/上限/策略拦截各自通知；② P1——Ctrl+T thinking 折叠（全局开关作用于全部 assistant 视图）、代码块语言标签（`codeLabelTransformer` 注入用户/助手消息渲染）、系统行（会话标题/权限预设/plan 进出）、busy 排队提示（状态槽 `Working… · 输入保留`）、header 会话标题与 `◐ plan` 徽标、picker 搜索过滤 + `●` 当前项标记、`/new` 新会话（runner `swap(undefined)`）、Ctrl+P 预设切换（`permissionPresets.set(session, name)` + `names`/`optionOf`/`current`）、plan-review 意图的 `detailMarkdown` 渲染（Markdown 详情封顶 12 行，超出省略）；\n- **交互优化批（P2 打磨，INTERACTION-PLAN.md）**：① busy 缓冲输入**自动提交**（turn 结束边界检测 `wasBusy→!busy` 且 composer 有文本时清空并路由——`/quit` 在 busy 期间输入也能退出；修复 E2E questions 场景竞态）；② 输入历史持久化（`$DSH_HOME/tui-history.json`，200 条上限、连续去重、Up/Down 回显）；③ 大粘贴确认（>30 行弹窗「发送/取消」）；④ 长消息折叠（>40 行折叠为 12 行预览，Tab/Enter 展开，与工具卡共享焦点环）；⑤ read_image 结果图片占位行（终端不渲染内联图片）；⑥ 状态槽耗时（`Working… Ns`）；⑦ 上下文相关 footer（busy 时「Ctrl+C 中断 · 输入将保留」，卡片聚焦时展开提示，`ctx N%` 来自 `resolveModelInfo().context.contextWindow`）；⑧ Ctrl+K 视图级折叠（旧条目折为一条横幅，30 条保留）；⑨ 子代理徽标（`subagent/descriptor` → `◆ subagent · label`）与反馈系统行（`feedback/record`）；⑩ 浅色主题（`DSH_TUI_THEME=light`，palette 可切换 + chalk 缓存重建，视图构建前生效）；⑪ 视觉快照测试（富转录 `toMatchSnapshot`）；\n- **web 基线对齐批（GAP-ANALYSIS.md T1）**：① Ctrl+/ 命令面板——枚举 `ctx.commands.list(agent)`，输入提示走自由文本弹窗，`commands.execute(agent, '/name args')` 执行，结果 notice 行；web 的 `/export` 是浏览器专属，TUI 原生等价（`sessions.flush` + `sessionPersistence.locate(session.header).path` 展示 jsonl 路径）；② 消息统计行——fold 携带 turn/start 时间戳与首 chunk 时间戳，assistant/message 计算 `stats{runMs,ttftMs,tokensPerSecond}`，vendored assistant 组件加 `setFooter` 渲染 dim 统计行；③ 注入上下文行——非 user 来源消息不再丢弃，投影为 `注入 · <kind> · <name> — <首行预览>` 系统行（skill-catalog 列技能名、goal 列轮次、plugin 列插件名）；④ plan 增强——plan-review 弹窗 approve 选项 `✔` 前缀（value 保持协议原文），Ctrl+E 在 planMode 时执行 `/plan off`；⑤ 消息队列——composer 恒可用，busy 时 Enter 入队（上限 10），turn/end 边沿 FIFO 逐条 followup，状态槽 `队列 N · Ctrl+C 中断`（替换原单条缓冲自动提交，web Enter-as-Queue 语义）；⑥ 后台任务——`ctx.jobs.list(agent)` + `onJobsChanged` 刷新，CapabilityPanel 渲染 `◆ job ⟳ label · status`；会话 picker 子会话 `↳` 缩进（`header.parentSession`）；⑦ 见① export。\n- **web 基线对齐批（GAP-ANALYSIS.md T2）**：① fork——Ctrl+B 列出用户消息分支点，`agents.create({sessionId, seed: events.slice(0, cut), meta: {cwd, parentSession, seedLength}, agentOptions, setup})`（镜像 host 的 fork：cut = 首个 seq≥锚点的 turn/end 后沿，扩展到下个 turn/start 前）；未完成轮次报「无法分支」；② 消息反馈——`cordis.patch.yml`（dsh.bundle.patch）挂 storage/storage-json/storage-domain/message-feedback（web profile 同款），`/rate` 对最近一条 assistant 回复 👍/👎+备注，`messageFeedback.list→put(ifVersion)` 重评安全；③ effort——模型选定后若 `resolveModelInfo().reasoning.efforts` 非空弹二级「推理强度」，写入 `ModelSelection.reasoningEffort`（prompt assembly 生效，`saveSelection` 持久化）；④ workspace——Ctrl+W 校验绝对路径后 `workspaceRef` 更新 + swap 新会话（`meta.cwd` 与 autocomplete 基路径同步）；⑤ 搜索——Ctrl+F 自由文本查询 → 条目级匹配列表（±25/40 字符预览）→ Enter 按渲染行高累加 `ScrollView.scrollTo` 跳转并聚焦可聚焦条目。\n- **out-of-tree profile 的 bundle patch 约束（重要）**：① bundle 的 `cordis.patch.yml` 是**必填**声明（缺失直接报错）；② 其 insert 行只能引用 **dsh 安装（apps/cli/node_modules）已携带**的插件——storage 系列不在其中，挂载会让 loader 静默挂起（无报错、无退出，事件循环空转）；③ patch 文件内容需包含本包的 startup/runner 行（`tui-startup` + `tui-runner`，runner 行须 `inject: [tuiStartup]` 才能读 `ctx.tuiStartup.*`），空补丁会导致 TUI 行未挂载而静默空转。实施 T2② 时曾覆盖该文件导致 E2E 全挂，后按 PLAN.md + headless 模板重建（persona/hmr/tools 三行 + insert 三行）。T2② 因此采用 TUI 自有 sidecar（`tui-feedback.json`），与 web 的 messageFeedback 存储分离；\n- **web 基线对齐批（T3）**：① 消息时间戳——user/assistant 条目带 `at`（event.time），气泡下渲染 HH:MM 时钟；② 工具耗时——`calledAt`/`durationMs` 投影计算，工具卡 footer 显示 wall time；③ fork 锚点扩展到 committed assistant 消息（边界语义不变：首个 `turn/end` ≥ seq）；④ 消息焦点环——`FocusableFrame` 包装 user/assistant/notice/approval 视图加入 Tab 循环（焦点帧 = 搜索跳转的高亮 + `/rate` 的聚焦目标），并修复了焦点环潜在 bug（原实现 Tab 只在 composer↔最新条目间往返，旧条目永不可达；改为 newest→oldest 单向遍历）；⑤ 会话列表相对时间（刚刚/N 分钟前/N 小时前/N 天前/日期）。\n- **web 基线对齐批（T4）**：① 上下文压力条——footer `ctx N%` + 10 格 ▓░ 压力条，60/80 阈值分 text/warning/error 三级着色；② 产物文件——ToolEntry 携带 turn/step（tool/call 事件），assistant 统计行追加同轮工具 diff meta 路径的 `✎ a.txt, b.txt` chips（跨轮不泄漏）；③ Ctrl+Y 聚焦反馈快捷键（与 `/rate` 同一执行路径，聚焦帧目标优先）；④ E2E 第六场景 `scenario_interactions`（隔离 DSH_HOME：搜索跳转+聚焦帧、fork 点列表、/rate 全链路、命令面板过滤选择）；@mention 明确跳过（web 的 '@' 是 subagent 定位触发器，TUI 已有 @/# 文件路径补全，记录于 GAP-ANALYSIS）。\n- **Pi 基线对齐批（PI-GAP-ANALYSIS.md T5）+ 视觉打磨**：① 命令面板（及全部选择器）改为**锚定输入块上方**（bottom-center, offsetY -6），面板 chrome 统一：`▸` accent 标题 + 查询显示 + 分隔线 + dim 提示，审批弹窗标题同款标记，header 改 `▍ dsh tui │ model │ session` 分隔样式，聚焦帧 affordance 用 accent 标记；② `!command`/`!!command`（cross-spawn 30s 超时，输出经 `onShellResult`：可见→入队、静默→notice 行）；③ 队列细化：Alt+Enter steer（`agent.steer`）、Esc(busy)/Alt+Up 取回队列到编辑器（LIFO）；④ 主题自动明暗：`resolveThemeVariant`（env > OSC 11 检测 > dark）+ 纯函数 `themeFromOsc11` 测试；⑤ thinking 分级：palette 新增 thinkingL1/L2/L3 色阶，vendored assistant 按块递减强度渲染；⑥ Ctrl+X OSC52 复制最后回复 + `/hotkeys` 帮助；⑦ Mermaid：新增依赖 `grok-mermaid`，vendor pi 的 mermaid transformer（codeSpan 行内代码技巧 + border/text/edge/title 分级着色，流式期间不渲染）；⑧ CLI：`-c/--continue`（`__latest__` 哨兵 → sessionQuery 最近会话）、`-r/--browse`、`--no-session`（quit 跳过 flush；commander 的 `--no-` 前缀映射为 `session===false`）、`/clone`（forkSession 提取 + fallbackLast 语义，host 的 omitted-atSeq 路径）。\n- **cc/pi 风格交互重构**：① **slash 菜单改为内联菜单**——composer 保留输入文本（`/` 不再被吞），菜单以 `nonCapturing` overlay 渲染在输入框上方只显示不动焦点，onChange 驱动过滤（label 首词展示、内部值解析映射 `quit`→`__quit`），Enter 携带内联参数执行（`/name args` 不再弹二级对话框）、Tab 补全命令名、Esc 关闭并清空；Ctrl+/ 保留浏览式面板（同一 catalog，`app.setCommands` 推送）；未知命令 runner 报 `未知命令：/name` notice；② **决策表单改为 cc/pi 风格非阻塞卡片**——`DecisionCard` 带边框（╭─/│/╰─）选项卡片以 nonCapturing overlay 渲染，方向键+Enter 全局监听路由，**输入框全程可用（消息照常排队）**，approve 选项带 ✓，自由文本问题保留捕获式 Input 对话框（IME 需要）；③ **quit/swap 双 flush 静置**（`flushSettled`：flush → 400ms → flush，`internals.flushSettleMs` 可注入）——修复 whenIdle 后标题/审计等尾部事件后置提交导致的持久化截断（E2E 偶发，会话日志缺 assistant 尾部）；④ **E2E 核心场景隔离 home**（`/tmp/dsh-tui-e2e-core-home`）——与用户活跃会话共享真实 DSH_HOME 时，并发写入曾间歇性丢失持久化事件；wait_exit 收割线程改为轮询直到退出码可得。\n- **文案复用与双语（T8/T9）**：`src/view/strings.ts` 集中承载用户文案，zh/en 双词典逐字复用 dsh web 客户端 locale 表（确定/取消/停止生成/发送消息/N 条排队消息/运行中…/上下文已压缩/首 token/好的回答·有问题的回答/推理等级/选择本会话使用的模型/权限·选择新会话的默认权限模式/确认启用 Full access？全套确认文案等）；视图经 `strings()` 渲染时读取，`DSH_TUI_LANG=zh|en` 启动选择、`/lang` 运行时切换即时重渲染；新增 Full access 切换确认（acknowledge 文案复用）；footer 提示、picker/菜单 hint 改为渲染期读取；\n- **cc 风格左对齐表单**：slash 菜单、命令面板、决策卡片与自由文本弹窗全部改为 **bottom-left 左对齐**（贴左侧边距，位于输入框上方）；决策卡片标题带图标（授权 `⚠`、提问 `？`），选项带 **1./2. 数字序号 + 数字键直选**（显示层数字，选中值仍为协议原文），approve 选项 ✓ 保留；\n- **regular 模式决策与转录回写**：pi 的 regular 模式（TuiMainScreen）**没有布局引擎**（`setLayoutRoot`/VStack/grow/ScrollView 是 `ViewportTUI`＝仅 TuiAltScreen 的专属），切换需要按 pi 的 regular 组合方式重写排版；而 Warp 的两个收益已用更小代价获得——关闭鼠标捕获后右键走 Warp 原生、滚轮滚 Warp 的 block scrollback。补齐最后一项 pi regular 收益：**quit 时把转录回写 scrollback**（`transcriptText(doc)` 纯函数 + `internals.writeStdout` seam，pi 的 `fullscreenExitOutput:'transcript'` 等价物），退出后会话仍留在终端可见；\n- **Warp 右键菜单修复**：TuiAltScreen 默认开启 SGR 鼠标捕获（`mouse ?? true`），终端把右键等所有鼠标事件转发给应用，Warp 所在 panel 的原生右键菜单因此失效——改为默认 `mouse: false`（`DSH_TUI_MOUSE=1` 可恢复滚轮与 TUI 内选择），键盘滚动不受影响；\n- **交互修正批（T7）**：① 决策卡片与 slash 菜单宽度自适应终端（`overlayWidth = min(72, cols-4)`，DecisionCard 按实际宽度渲染，此前固定 72/64 在窄终端溢出）；② model 与 effort **分离选择**——模型选择不再链式弹「推理强度」对话框，新增 `/effort` 独立选择（当前项标记「（当前）」，适配器无 efforts 时报 notice）；③ 模型信息从顶部 header **移到底部 footer**（pi/cc 语义：footer = model · ctx 压力条 · cwd · msgs · in/out，压力条前移避免窄终端截断）；④ **转录底部锚定**——文档容器前置 BottomPad（高度 = viewport - 内容行数），内容不足一屏时消息紧贴输入区上方，满屏后滚动行为不变。\n- **视觉优化批（T6）**：① 全新调色板——深色改 midnight-slate 分层（正文 `#e2e8f0`、muted `#94a3b8`、气泡 `#283548`、选中条 `#1f3a5f`），品牌青 accent `#5eead4` + cyan `#22d3ee`，语义色 info `#38bdf8`/success `#4ade80`/warning `#fbbf24`(amber 替代刺眼纯黄)/error `#f87171`，语法高亮整体重调（紫/天蓝/绿/琥珀），浅色系同步重做；② 排版——notice 行图标化（`ℹ/✓/✗` 分级着色）、footer hints **右对齐**（ANSI 感知宽度，窄屏回退仅统计行）、header 模型名 cyan、统计行/时钟 dim italic、SelectList 选中行加 selectedBg 高亮条、编辑器边框 accent；IDLE_HINTS 精简以保证 100 列终端可容纳。全部既有文本字面量不变（E2E 断言兼容），theme.spec 色值与快照同步更新。\n- **stdin 竞态（T5③ 修订）**：OSC 11 主题探测默认关闭——在 TUI 接管终端前 `resume()/pause()` stdin 会与 ProcessTerminal 的 raw-mode 交接竞态，导致 PTY 下键盘输入非确定性丢失（E2E 审批场景偶发挂死：对话框的 `\r` 永远到不了）。`DSH_TUI_THEME=auto` 才显式启用探测（默认 dark；探测也只挂 300ms 监听、不再 pause）；\n- **E2E 驱动健壮性**：pty 子进程退出在 macOS 上可能既不给 master EOF、又让 `os.waitpid(WNOHANG)` 阻塞（曾卡死 15 分钟）；`wait_exit` 改为工作线程收割 + EOF 双通道，`kill()` 不再阻塞 wait；核心场景断言从「注入上下文不得渲染」更新为「渲染为 `注入 ·` 系统行」；\n- **中文 IME 修复**：TuiAltScreen 开启 `showHardwareCursor`——终端硬件光标跟随编辑/输入光标，IME 候选框锚定在光标处而非输入块起始（此前光标隐藏导致候选框错位遮挡已输入内容）。
- **Esc 中断 + web 主题色**：① 中断键改为 **Esc**（Claude Code 语义：busy 时 Esc → `agent.cancel`，队列取回只剩 Alt+Up；Ctrl+C 仅 idle 退出，busy 时吞掉）；footer busy 提示、`/hotkeys` 帮助（顺带双语化）与测试同步更新；② 调色板整体替换为 **dsh web 设计 token**（`packages/client/ui-theme/src/styles/design-platform.css` + `shiki.css` 逐字取值：品牌 blue `deepseek-500 #4176E6`/`deepseek-400 #679EFE`、暗色中性 `neutral-bluish-50/300/400/750/850`、气泡 `#2C2C2E`、语义色 `green-400 #4ED17E`/`red-400 #F25A5A`/`amber-400 #F7AD31`、shiki 语法色阶），浅色系同源重做；web 表外硬编码文案（`Deep diving...`、`tok/s`）保持跨语言一致不国际化。
- **DeepSeek 品牌区**（参考 github.com/ccch1mneyyy/dsh-TUI）：`src/view/brand.ts` 移植其品牌区设计——手绘像素鲸（half-block 双像素技法 13 行）旁置 5 行大号 `DEEPSEEK` 块字（brand 渐变 `deepseek-450 #5686FE → deepseek-300 #B7C8FE`，即 web token）+ `✦ dsh tui` wordmark + 标语（zh `探索未至之境！`/en `Explore the uncharted!`）；渲染位置改为**转录顶部**（会话尚无 user/assistant 消息时显示，底部锚定使其紧贴输入区上方，会话开始后自然滚走——不像参考实现那样常驻 header）；宽度分级：≥92 列鲸与字标并排、64–91 列仅鲸、<64 列纯文字；顺带修复 reset() 反复 addChild(bottomPad) 导致的换会话重复顶衬垫堆积 bug（改为先 removeChild 再按 [bottomPad, brandView] 顺序重挂）。
- **渐变动效字体（web 风格 shimmer）**：`gradientText/sweepText`（移动高亮窗 + 亮度正弦脉冲，60ms 帧）驱动两处——① 品牌区开场动画（~3.4s 一次，随后定格静态渐变，定时器清零，`BrandView` 带 `onFrame` 重绘缝、单测用假定时器）；② busy 状态行 `Deep diving...` 渲染为 brand 渐变并**复用 Loader 的 80ms spinner 重绘循环**做 shimmer（零额外定时器，turn 结束自然停止）。`DSH_TUI_ANIM=0` 整体冻结为静态渐变；动画只改颜色不改字形（字节级布局稳定，E2E/快照不受影响）。
- **系统信息降噪批（P0–P3）**：① **轮次结局 → 消息徽标**——turn/end 的 已中断/token 上限/被策略阻止/Error 不再落独立通知行，而是挂在**该轮最后一条 assistant 消息的 footer 徽标**（`⏹`/`✗` tone 着色，`AssistantEntry.outcome` 由 fold 在 turn/end 写入；该轮无任何消息时仍回退通知行，如首请求即失败的 Error）；② **同类通知收敛**——视图层 `convergeNotices` 把连续同 group（title/preset/plan）通知并成一行并加 `×N` 计数（文档保持 append-only，首个 id 稳定）；③ **临时反馈 toast**——命令成功结果、effort 切换、语言切换、Ctrl+X 复制、/rate 记录改为状态槽 2.5s 瞬时提示（busy 时挂起、turn 结束边沿补显），错误与有审计价值的事件（export/fork/shell/权限切换/反馈摘要）仍落转录行；④ **面板瘦身**——jobs>1 收敛为一行 `◆ jobs ×N · Ctrl+O 展开`（Ctrl+O 切换；不用 Ctrl+J 因其字节 `\x0a` 与多行粘贴的换行冲突）。E2E 兼容：toast 文案仍进入 PTY 输出流，`wait_for` 扫描累积缓冲不受 2.5s 消失影响。
- **会话统计条（web StatsLine 对齐）**：`src/projection/stats.ts` 纯函数移植 web `StatsLine.tsx` 的 fallback fold——`sessionStats(doc)`（轮数去重、步数、LLM/工具时长求和、TTFT 平均、解码吞吐 = Σ输出token/Σ解码时长、计费输入 = input+cacheRead+cacheWrite 与缓存命中率）+ `formatTokens`（`12.3K`/`677M`）/`formatDuration`（`2m42s`）/`formatTokensPerSecond`（<10 一位小数）逐字同 web；`statsStrip(doc, strings)` 按 web 分组语义（counts | durations | speeds | cache·tokens，无数据整组隐去，steps=0 无条）组合，文案复用 web locale（新增 `stats.llm/toolCall/ttftAverage/cacheHit` 双语键，`LLM 340m42s` 等含不国际化单位）；渲染在**空闲状态槽**（busy 显 spinner、toast 覆盖），`usage` 缓存桶由 fold 从 `assistant/message.usage`（dsh-llm TokenUsage 的 `cacheReadTokens/cacheWriteTokens`）透传进 `AssistantEntry.usage`。
- **功能对齐批①（FEATURE-CHECKLIST.md 工具卡专业化）**：`dsh-tools.ts` 新增专属结果卡——① bash/pwsh **终端卡**：移植 dsh-shell `parseExitStatus` marker 契约（`[exit code: N]`/`[killed by signal: X]` 尾随标记）拆出 `✓ exit 0`/`✗ exit N` pill，正文 ANSI 透传 + 折叠；② **read 卡**：行号 + hljs 按扩展名高亮（shiki 色板映射）+ 40 行截断；③ **grep 卡**：`path:line:content` 按路径分组（路径头 + dim 行号），**glob 卡**：路径列表；④ **web_search 卡**：解析 tool/result 结构化 meta（`sources/answer/truncated`，dsh tool-web 契约）渲染答案 + 有序引用（标题→hostname 回退 + URL + snippet），web_fetch 卡带 URL 头。快照更新 + `tests/dsh-tools.spec.ts` 6 项。
- **功能对齐批②（FEATURE-CHECKLIST.md 交互细节）**：① **撤销/重做**——重绑 `tui.editor.undo`/`yankPop` 为 Ctrl+Z / Ctrl+Shift+Z（pi 默认 Ctrl+- / Alt+Y；Ctrl+Y 保持评分键）；② **跨日时间戳**——消息时钟同日 HH:MM、跨日 `MM-DD HH:MM`、跨年 `YYYY-MM-DD`（对齐 web message-chrome 日历日拆分）；③ **jobs 实时耗时**——JobRow 携带 `startedAt/finishedAt`（runner 从 JobRecord 透传），面板渲染 `⏱ 1m10s`；④ **↓ End 回底提示**——`isFollowingEnd=false` 时 footer 提示替换（End 为 pi 原生回底键），与 jobs 计时共用 500ms 轻量 idle ticker（`animFrameMs=0` 时关闭，测试确定性）。`/hotkeys` 与清单同步。
- **功能对齐批③（FEATURE-CHECKLIST.md）**：① **TeX 数学**——pi Markdown 内置 `renderLatex`（默认开启）把 `$…$` 渲染为 Unicode（`mc^2`→`mc²`），即 web KaTeX 的终端等价，补测试标记 ✅；② **注入行可展开**——NoticeEntry 增 `detail`（fold 对注入消息存全文），新 `ExpandableNoticeView`（Focusable + Enter 展开、12 行封顶、`… 还有 N 行`），注入行进入 Tab 焦点环（focusableItems 扩型）；③ **todo 计数与折叠**——面板计数头 `◆ todo ✓N ▶N ○N` + 超过 6 项只显示前 6 与 `… 还有 N 项`（web TodoPanel 同语义）。
- **功能对齐批④（FEATURE-CHECKLIST.md）**：① **OSC 8 文件链接**——`file-link.ts` 把 read/write/edit/diff 的路径头、grep 分组头、web 引用 URL、统计页脚 `✎` chips 全部包装为 OSC 8 超链接（pi 的 truncateToWidth 原生处理 OSC 宽度），支持终端 Cmd 点击打开；② **busy Enter 行为**——`DSH_TUI_ENTER=steer` 切换 busy Enter 为 steer（默认 queue，web EnterBehaviorRow 语义）；③ **父会话面包屑**——SurfaceMeta 增 `parentSession`（runner 从 session.header 透传），header 渲染 `↳ 父会话`（子代理/fork 会话）；④ **会话全文搜索**——FilterablePickerPanel 增 `setRows`/`onFilter`（remote 行绕过本地过滤），Ctrl+R picker 输入 250ms 防抖后调 `sessionQuery.searchSessions`，命中会话（snippet 预览 + 相对时间）合并进打开中的 picker。
- **regular 模式备忘（未来可能实现）**：当前固定 `TuiAltScreen`（fullscreen 视口，见上文"regular 模式决策与转录回写"）；若未来需要"输出像普通命令一样天然留在终端 scrollback"的产品形态，可新增 `TuiMainScreen`（regular）渲染路径。该模式（pi 文档明示无 viewport 语义，`isViewportTUI` 为 false）将**有意放弃**以下能力：布局引擎（`setLayoutRoot`/VStack/HStack/grow 区域分配）、应用自管滚动（`ScrollView`/`follow:end`/`scrollTop`——Ctrl+K 视图折叠、Ctrl+F 跳转、鼠标行命中点击均依赖文档坐标换算）、overlay 锚定（`anchor`/`offsetY`/`maxHeight`，slash 菜单/决策卡/picker 将退化为堆叠渲染）、鼠标事件路由（`routeWheel`/`handleViewportInput` 为 TuiAltScreen 专属，滚轮路由与 SGR 点击展开不可用）、鼠标选择与滚动条。**保留**：消息/工具卡渲染、键盘交互与 Tab 焦点环、退出时转录回写 scrollback。实现建议：与现有 surface 共享 ViewDocument/投影/合成层，仅替换渲染根（§6.1 引擎组装处按 `isViewportTUI` 分支），并同步调整 E2E 断言与快照。
- **审查修订批（pro 审查）**：① **H8 归档不可实现**——`/archive` 命令移除：`workspaceRegistry` 服务未挂载于 tui profile（bundle 无 workspace 插件，挂载会因缺 storageDomain 静默挂起——同 DESIGN 前记约束），H8 标 ⛔；`/rename` 可用（`sessionTitle.rename` 挂载于 base bundle，PTY 验证通过）；② **E10 只读守卫补漏**——`onSteerRequest` 的 busy 分支（`agent.steer`）曾绕过只读守卫，已补 readOnlyHint 拦截（Alt+Enter steer 亦被拒）；③ **点击展开改为小图标监听**——CollapsibleMessage/ToolCard/RetryRow/ExpandableNoticeView 首行行尾 `⏎`、思考块 `▸/▾` 图标，`clickIcon(row,col)` 列级命中，正文点击 inert；`handleEntryClick` 改用 `document.render` 反推 leading 行（吸收 brand splash 在 ScrollView 中的 ghost 行——brand 隐藏后滚动偏移可含其 16 行，pad+brand+entries 同源映射）；④ **权限预设状态区**——`permission/preset` 除文档流 notice 外，idle 时钉入输入区之上状态槽（`ℹ 权限预设：xxx`，busy 隐藏）；⑤ **鼠标默认开启的 Warp tradeoff**——此前"默认 mouse:false"是为 Warp 面板原生右键菜单；现默认开启以支持图标点击/滚轮（用户要求），Warp 右键菜单随之失效（`DSH_TUI_MOUSE=0` 可回退），特记；
- **键盘交互批（K1–K3，本轮）**：① **K1 键盘展开/收起，废除鼠标点击监听**（pi 风格）——删除点击命中管线（`clickableRows`/`clickEntryAt`/`clickThinkingToggle`/`handleEntryClick` 与 TuiAltScreen 的 `handleViewportInput` 左键拦截、各组件 `clickIcon`），▸/▾/⏎ 图标保留为**纯状态标记**；展开/收起全部走键盘：Tab 焦点环 + Enter 切换（焦点助手消息→thinking 块（`FocusableFrame` 转发 Enter）、工具卡→输出、折叠长消息→全文、retry/注入行→详情），Ctrl+T 保持全局 thinking 开关；`hookAltScreen` 只保留 slash 菜单滚轮路由；② **K2 /model /permission /config 与命令别名**——`/model`/`/permission` 在 slash 菜单中提供**枚举切换**（裸命令开 picker，复用 Ctrl+G/Ctrl+P 数据源）并支持**参数直切**（`/model provider/model`、`/permission preset`，full-access 保留确认；插件注册的自由文本 `/permission` 从目录剔除以免重复行）；新增 `/config`（供应商列表/添加向导——经 `ctx.settings` 结构化读写 `llm-pi-ai.providers`、settings.yaml 预览/`$EDITOR` 挂起编辑（`openExternalEditor`：tui.stop → spawn inherit → tui.start → 重挂输入监听）/OSC52 复制路径）；别名表 `exit→quit · clear→new · ?→hotkeys · m→model · perm→permission · language→lang` 挂在 `CommandChoice.aliases`，解析链/菜单过滤/Tab 补全统一经 `matchingCommands`；`/hotkeys` 改为分组对齐列的 `HotkeysPanel`（窗口滚动 + PgUp/PgDn）；③ **K3 插件投影感知**——`ctx.sessionProjections` 结构化读取：`onChanged`/`snapshot` 驱动 `ProjectionRow`（select 形态 options/currentValue），空闲状态行渲染为通用投影 chips（permissions 复用 `strings().permission` 标签），Ctrl+P 通用枚举 picker（多投影先选投影）；写路径：`permissions` 特例走 `switchPreset`（含确认），其余投影经**同名注册命令** `/key value` 执行，无同名命令报 `projectionUnwritable`；无注册表时回退 permission-presets 直连路径。回归：`tests/keyboard-toggle.spec.ts`（原 click-hit.spec 重写）、runner +13、pi-tui-app +5，共 245 项。

