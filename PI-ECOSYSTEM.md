# pi 生态盘点（供技术决策）

> 目标：为"如何充分复用 pi 生态"的顶层决策提供事实依据。全部事实于 2026-08 从
> npm registry 与 github.com/earendil-works/pi（main 分支）核实；pi 全家桶版本 **0.84.1**，MIT。

## 1. 分层总览

```
┌────────────────────────────────────────────────────────────────────────┐
│ 应用层  pi-coding-agent (npm ✓)                                         │
│   ├─ modes/interactive   ★ 40+ 组件：消息/工具执行/diff/状态/footer/选择器 │
│   ├─ modes/print-mode   非交互输出     ├─ modes/rpc  远程会话模式          │
│   ├─ core/tools         ★ 每个工具有 renderCall/renderResult 渲染器        │
│   ├─ core/extensions    扩展 API（defineTool/MessageRenderer/EntryRenderer）│
│   ├─ core/session-manager / agent-session / keybindings / messages       │
│   └─ 依赖: photon-node(wasm) jiti mermaid hljs diff typebox chalk …      │
├────────────────────────────────────────────────────────────────────────┤
│ 控制核心 pi-agent-core (npm ✓)                                           │
│   agent 状态机 + agent-loop + harness(session/tools/messages/prompt)     │
│   依赖: pi-ai, pi-telemetry, diff, ignore, typebox, yaml                 │
├────────────────────────────────────────────────────────────────────────┤
│ 传输层  pi-protocol (npm ✓, CBOR) ─ pi-client (npm ✓) ─ pi-server (npm ✓)│
│   远程 pi 会话的编解码/客户端/实验服务器                                    │
├────────────────────────────────────────────────────────────────────────┤
│ 类型/LLM 层  pi-ai (npm ✓)                                               │
│   Message/UserMessage/AssistantMessage/ContentBlock(text|thinking|       │
│   tool-call|tool-result|image)/Usage 类型 + 多供应商适配器                │
│   依赖: openai/anthropic/google/mistral/bedrock SDK + typebox            │
├────────────────────────────────────────────────────────────────────────┤
│ 框架层  pi-tui (npm ✓)  ★ 唯一纯视图、无重依赖（仅 marked）                │
│   TUI/TuiAltScreen(布局引擎+搜索+滚轮)/Markdown(hljs钩子)/Editor(补全)     │
│   SelectList/SettingsList/ScrollView/Box/VStack/Loader/Image(kitty)      │
│   键位管理器/剪贴板/LaTeX/截图工具  —— 我们的运行底座，已用                │
├────────────────────────────────────────────────────────────────────────┤
│ 遥测  pi-telemetry (npm ✓, 零依赖)   存储 session-backends (仓库内, 未发布) │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. 包清单与复用价值

| 包 | 发布 | 职责 | 对 DSH TUI 的复用价值 |
|---|---|---|---|
| `pi-tui` | ✓ | 终端渲染引擎 | **底座（已在用）**：布局/滚动/搜索/补全/图片全在此层 |
| `pi-ai` | ✓ | LLM 类型 + 适配器 | **类型契约**：可仅用其 Message 类型做合成目标，不必用其适配器 |
| `pi-agent-core` | ✓ | agent 状态机/循环 | 仅当"放弃 DSH agent、换 pi 做脑"时才有用（route B 的核心件） |
| `pi-protocol` / `pi-client` / `pi-server` | ✓ | 远程会话传输 | 远期：DSH↔pi 协议桥、headless DSH 挂 pi 客户端；当前无用 |
| `pi-telemetry` | ✓ | 遥测契约（零依赖） | 无（DSH 有自己的遥测） |
| `pi-coding-agent` | ✓ | 完整应用（UI+tools+会话） | **组件仓库**：vendor 视图组件（route C）；整嵌风险大（barrel 拖 wasm/jiti） |
| `session-backends` | ✗ 未发布 | pi 会话存储 | 不用（DSH 有自己的持久化） |
| `pi-agent` / `pi-evals` / `pi-mcp` / `pi` | ✗ 未发布 | 仓库内部 | — |

## 3. interactive-mode 组件清单（route C 的 vendor 候选）

消息：`assistant-message`、`user-message`(+selector)、`custom-message`、`skill-invocation-message`、`branch/compaction-summary-message`
工具：`tool-execution`、`bash-execution`、`diff`（词级红绿）
状态：`status-indicator`(working/retry/compaction)、`bordered-loader`、`countdown-timer`、`footer`(cwd/tokens/上下文%)、`keybinding-hints`
选择器：`model-selector`、`session-selector`(+search)、`theme-selector`、`thinking-selector`、`config/settings/trust/oauth-selector`
渲染工具：`markdown-transform`、`visual-truncate`、`dynamic-border`、`mermaid`、`tree-selector`
主题：`theme/dark.json`+`light.json`、`theme.ts`(39KB, typebox 校验, 40+ 语义色+thinking 分级)、`theme-controller.ts`(自动明暗检测)

关键事实：
- 组件**依赖 pi 内部全局**：`theme` 单例（initTheme 读 pi 配置目录）、`getKeybindings` 键位管理器、`createAllToolDefinitions`（pi 自己的工具表）——route C 需要三个小 shim。
- 组件**数据输入**：`AssistantMessage`（pi-ai 类型，纯数据可合成）、`ToolDefinition.renderCall/renderResult`（DSH 按工具名提供自己的实现即可）。

## 4. 复用边界的五个选项

| 选项 | 边界 | 保真度 | 主要代价 |
|---|---|---|---|
| **A 渐进改写**（现状） | 组件改写为 DSH 类型 | 中，逐项追 | 每组件重写+跟随 pi 演进 |
| **C 原样 vendor+数据合成** | 组件不动；DSH 事件→pi 类型纯函数映射器 + 3 个 shim | 高 | 映射器工作量；跟随 pi 演进（但只 diff vendor 目录） |
| **B 整嵌 interactive-mode** | 跑 pi 完整应用 | 最高 | 双控制器；DSH 目标/子代理/MCP/审批无渲染 |
| **B′ pi-agent-core 做脑** | 用 pi 的 agent 核心 + pi UI，DSH 仅当工具源 | 最高 | 放弃 DSH agent 全家（与项目初衷相反） |
| **D 协议桥** | DSH 会话经 pi-protocol 暴露，pi 客户端/UI 接入 | 远期 | 工程量大；DSH 事件词表↔pi 协议映射 |

## 5. 第三方生态（质量参差，仅列值得注意的）

- `@danypops/pi-tui-harness` 0.0.2 — 用 @xterm/headless + golden 快照测试 pi-tui 组件（我们的 FakeTerminal 方案的增强候选）
- `@narumitw/pi-tui-kit` 0.54.0 — 声明式流程/导航助手（非官方，收益不明确）
- `@oh-my-pi/pi-tui` 17.x — pi-tui 的独立复刻分支（与官方分叉，不推荐）
- 其余 `pi-*` 扩展包为 pi 应用的扩展插件，对 DSH 无直接价值

## 6. 决策前提（事实）

1. pi 全家桶 **0.84.1 活跃演进**，0.x 无兼容承诺——任何 vendor 都要留版本 diff 流程；
2. `pi-coding-agent` 的 barrel import 不可接受（photon-node wasm、jiti、undici），故 C 必须是"文件级 vendor"而非包依赖；
3. pi-ai 的类型可**零成本合成**（纯数据，DSH 块→pi 块的映射是纯函数）——这是 C 的可行性根基；
4. pi-tui 是唯一"干净"的包依赖（无重依赖、发布稳定），继续作为底座无争议。
