# 顶层架构：DeepSeek Harness 为 Runtime × pi TUI 为视图

> 目标形态：`dsh tui` —— **DSH 是唯一 runtime**（agent 循环、工具、MCP、目标、子代理、持久化），
> **pi 的 TUI 体系是视图**（引擎 + 交互组件 + 视觉语言）。
> 本文抛开现有实现，只回答一个问题：这两个世界之间，正确的接缝应该划在哪。

## 1. 问题拆解：两个世界在三个面上不同构

| 面 | DSH（runtime 世界） | pi（视图世界） | 接缝 |
|---|---|---|---|
| **数据面** | 单调递增的 `SessionEvent` **事件日志**（turn/assistant/chunk/tool/compaction/…） | **文档模型**：有序条目（消息、工具执行、状态、custom entries），组件按条目渲染 | 需要一个事件→文档的**投影** |
| **控制面** | `agent.followup / cancel / steer`、`ctx.userQuestions.ask()` 审批缝 | UI 动作：提交输入、Esc 中断、审批弹窗、选择器 | 需要一个 UI 动作→agent 指令的**映射** |
| **能力面** | DSH 独有：goal/todo、subagent、MCP、approval | pi 独有：thinking 分级、工具 renderer、theme | 两边各有一批专属渲染器 |

接缝划错了，就会出现现在的现象：**每个 pi 组件都要改写、每项 DSH 能力都要硬塞、两边升级都全量返工。**

## 2. 架构骨架：四层，中间两层是接缝

```
┌─ View 层（pi 体系，可整体替换）──────────────────────────────┐
│  · pi-tui 引擎：TuiAltScreen（布局引擎/滚动/搜索/滚轮）、       │
│    Markdown(hljs 钩子)、Editor(补全)、SelectList、Loader…      │
│  · 原样 vendor 的 pi 交互组件：Assistant/UserMessage、          │
│    ToolExecution(diff/展开)、StatusIndicator(working/retry/     │
│    compaction)、Footer、各选择器                                │
│  · DSH 专属组件：ApprovalDialog、GoalView、TodoPanel、         │
│    SubagentBadge（pi 没有对应物，自研但复用 pi 视觉语言）        │
├─ Document 层（视图契约，纯类型，**跨形态不变式**）─────────────┤
│  ViewDocument = 有序条目：                                     │
│    UserEntry / AssistantEntry(text+thinking) / ToolEntry(       │
│    name,args,output,diff,state) / StatusEntry(working|retry|    │
│    compaction) / CustomEntry(goal|todo|approval|title|…)        │
├─ Projection 层（适配器，纯函数，可单测）──────────────────────┤
│  正向：SessionEvent[] → ViewDocument                           │
│  逆向：UI 动作 → agent.followup / cancel({kind:'user'}) /       │
│        userQuestions 答复 / sessionQuery 选择 / llm 模型表       │
├─ Runtime 层（DSH，一行不改）─────────────────────────────────┤
│  agent/session 事件流 + services（sessionQuery、llm、          │
│  userQuestions、settings）+ jsonl 持久化                        │
└──────────────────────────────────────────────────────────────┘
```

### 关键洞察 1：ViewDocument 是唯一需要稳定的契约

- pi 的 interactive-mode **没有**这个中间层（事件直接映射到组件树）——所以它的组件才那么难拆；
- DSH 也没有（Web 的 host/client 各自投影）。
- 我们把它显式化后：**DSH 升级只影响 Projection 层，pi 升级只影响 View 层**；且这个文档模型就是未来任何协议形态（见 §5）的线上格式。现有 `ChatState`（messages/tools/busy）就是它的贫瘠版——升级路径是把它长成完整的条目化文档。

### 关键洞察 2：pi 组件消费的是"文档条目"，不是"事件"

之前的差距根因在于把 DSH 事件直接投影成极简状态，再让**改写版**组件渲染。
正确姿势（route C 的正式表述）：Projection 的输出**按 pi 组件的数据契约组织**——

- DSH `assistant/message` 的块 → 合成 **pi-ai 形状的 `AssistantMessage`**（text/thinking/tool-call 块）→ 原样用 pi 的 `AssistantMessageComponent`；
- DSH `tool/call`+`tool/result`（输出正文 + `meta` 里的 diff）→ 按 **DSH 工具名注册 `ToolDefinition`**（bash/fs/read/search/mcp-* 各自 renderCall/renderResult）→ 原样用 pi 的 `ToolExecutionComponent`；
- DSH `compaction/*`、`llm/retry*` → pi 的 `CompactionSummaryMessage`、`RetryStatusIndicator`。

三个 shim 即边界成本：theme 实例（pi 的 theme 单例换成我们的调色板初始化）、键位管理器（pi-tui 自带，接 pi 绑定表）、工具定义表（DSH 版）。

### 关键洞察 3：控制面必须走 DSH 的正式缝隙

| UI 动作 | DSH 缝隙（已核实存在） |
|---|---|
| 提交输入 | `agent.followup(createUserMessage(...))` |
| 中断当前轮 | `agent.cancel({ kind: 'user' })` |
| **审批弹窗** | 注册为 `ctx.userQuestions` 的 **UI provider**（`ask(request)→answer`）——DSH 明确为此设计；pi 没有审批概念，这是 DSH 专属组件的典型 |
| 会话/模型选择 | `sessionQuery.listSessions/readTitle` + `llm.listProviders/listModels` + settings 持久化 |

## 3. 事件 → 文档条目映射表（Projection 层契约）

| DSH 事件 | ViewDocument 操作 |
|---|---|
| `turn/start` | 追加 StatusEntry(working) |
| `user/message`（`source.kind==='user'`） | 追加 UserEntry |
| `user/message`（plugin/skill-catalog/goal/…） | 丢弃（注入上下文不上屏；或折叠为 CustomEntry，默认丢弃） |
| `assistant/chunk` text-delta | AssistantEntry 流式追加文本 |
| `assistant/chunk` reasoning-delta | AssistantEntry.thinking 追加（分级着色/可隐藏） |
| `assistant/chunk` tool-call-delta | ToolEntry 参数分片 |
| `assistant/message` | 提交 AssistantEntry（text+thinking 权威内容） |
| `tool/call` | 追加 ToolEntry(running, name, args) |
| `tool/result` | ToolEntry 完成：output 正文（content 块）+ `error` + `meta` diff |
| `compaction/start→end` | CustomEntry(compaction 摘要) |
| `llm/retry-started` | StatusEntry(retry, 倒计时) |
| `approval/asked→decided` | ApprovalEntry（→ userQuestions provider 弹窗） |
| `goal/change`、`todo/write` | GoalEntry / TodoEntry（DSH 专属渲染） |
| `session/title` | 会话列表标题（sessionQuery.readTitle 侧） |
| `step/end`、`turn/end` | 提交流式、结束 StatusEntry |

## 4. 渲染器契约（View 层）

- **pi 组件的输入是合成数据**：pi-ai `Message`/`ContentBlock` 形状、`ToolDefinition` 表、状态枚举——Projection 层负责合成，组件零改写；
- **DSH 专属条目走自研渲染器**，但复用 pi 视觉语言（palette、Box 卡片、DynamicBorder、StatusIndicator 模式）；
- **布局/交互全部走 pi-tui 引擎**：布局根 VStack、primary ScrollView（滚动/搜索/滚轮原生）、Editor 补全、SelectList 弹层。

## 5. 部署形态与演进路径

| 阶段 | 形态 | 说明 |
|---|---|---|
| **M1（现在）** | 进程内直连 | Projection 在插件内存内，View 同进程消费——无序列化边界，直接可达全部 DSH services |
| **M2（需求出现时）** | 协议化远程 | ViewDocument（或最小事件集）上协议；DSH 已有 ACP 桥（automation-only，README 明示"交互渲染属于 host+client，不属于 transport"），走远程需扩展 ACP 能力广告或自建协议（可参考 pi-protocol） |

M1 先行、Document 层留缝，是"DSH 为 runtime + pi 为视图"下成本最低且不堵死未来的路径。

## 6. 与现有实现的差距（诚实清单）

1. `ChatState` 投影过贫瘠：丢弃了 tool 输出/diff、thinking、compaction/retry/approval 事件 → **升级为条目化 ViewDocument**；
2. 组件是"改写版" → **改为原样 vendor + 数据契约合成**（三个 shim）；
3. 缺 DSH 专属渲染器（goal/todo/approval）→ 新增（approval 接 `userQuestions` provider 缝）；
4. 测试策略不变：Projection 纯函数单测 + 假终端组件测试 + PTY E2E。

## 7. 风险

- DSH 0.x 事件词表漂移 → 全部收敛在 Projection 层单测；
- pi 0.x 组件/引擎演进 → vendor 目录集中 diff，引擎锁定 0.84.1；
- 两者语义错位（如 pi 的 tool-call 模型 vs DSH 的 call/result 配对）→ 映射表逐项单测钉死。
