# GAP-ANALYSIS.md — dsh web 交互基线 vs TUI 差距清单

> 基线来源：DeepSeek Harness checkout `packages/client/ui-*`（web UI 按功能分包，
> 每个包的组件树即该能力的事实规格）。TUI 现状以本仓库实现与 INTERACTION-PLAN.md 为准。
> 修订：见文末。状态列：✅ 已覆盖 · 🟡 部分覆盖 · ❌ 缺失 · ⛔ 终端不可行/不建议。

## A. 转录与消息

| # | Web 能力 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| A1 | 消息 chrome（复制/分支/时间戳） | `MessageIconActions`：copy、branch（fork 会话）、按天时钟 | 无（终端原生选择/复制；fork 见 T2） | 🟡 |
| A2 | 每条消息统计行 | `StatsLine`：turns/steps、请求墙钟、工具墙钟、TTFT、解码吞吐、成本 | footer 总量 + busy 计时 | ❌ → T1② |
| A3 | 上下文压力表 | `ContextMeter`（`dsh-token-meter` contextPressure 投影，分级着色） | footer `ctx N%`（≥80% 变黄） | 🟡 |
| A4 | 轨迹时间线/搜索 | `ui-trajectory`：step 时间线 + 时长 + 全量搜索索引 | 工具卡 + busy 计时；无 step 耗时；无搜索 | ❌（搜索= T2） |
| A5 | 注入上下文行 | `ContextInjectionRow`：skill catalog / 运行时快照 / workspace 指令，可展开 | fold 丢弃全部非 user 来源消息 | ❌ → T1③ |
| A6 | compaction 触发 | 摘要卡片 + `/compact` 命令 | 摘要条目 ✅ | 🟡 → T1① |
| A7 | 每轮产物文件 chips | `ui-deliverables`：turn 内 produced files，可点开 | 路径散落在工具卡 | 🟡 |
| A8 | 消息反馈 | `ui-message-feedback`：👍/👎 + note → `messageFeedback.put` | 仅展示 `feedback/record` 行 | ❌ → T2 |

## B. 输入与队列

| # | Web 能力 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| B1 | 忙时消息队列 | QueueDock：busy 时多条排队、逐条 steer/删除；`busyEnter` 可设置 | 单条缓冲 + turn 结束自动提交 | ❌ → T1⑤ |
| B2 | 斜杠命令面板 | 全量命令源 `/goal /plan /compact /permission /model /feedback /export` + popup | 仅 `/new /quit`（slash 补全因 pi-tui 0.84.1 Enter-confirms bug 移除） | ❌ → T1① |
| B3 | `@` mention 触发 | `ui-input-trigger`（'/' 与 '@'） | `@/#` 文件路径补全 | 🟡 |
| B4 | 附件/图片 | 拖拽上传、`MessageImage` 画廊、灯箱 | `read_image` 占位行 | ⛔（终端内联图片上限） |

## C. 会话与工作区

| # | Web 能力 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| C1 | 会话列表搜索/分组 | sidebar 搜索 + 按天分组 + workspace 分组 | picker 搜索 ✅，无分组 | 🟡 |
| C2 | 子代理目录 | `SubagentCatalogAction`：父子会话导航、continuable 只读 composer | `subagent/descriptor` 徽标 ✅；picker 平铺 | 🟡 → T1⑥ |
| C3 | 后台任务列表 | `ui-jobs`：subagent 后台任务 live 时长 | 无 | ❌ → T1⑥ |
| C4 | 会话日志导出 | `/export`（浏览器下载 jsonl） | 无 | ❌ → T1⑦ |
| C5 | workspace 应用内切换 | `WorkspacePicker` | 仅 `--workspace` 启动参数 | 🟡（T2 可选） |

## D. 模式与决策

| # | Web 能力 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| D1 | plan 控制 | PlanChip + 退出按钮 + `/plan` 命令 + 决策表单（approve 高亮） | `◐ plan` 徽标 ✅ + Markdown 计划弹窗 ✅；退出按钮/高亮缺失 | 🟡 → T1④ |
| D2 | goal 输入 | GoalBar + `/goal` 命令 | goal/todo 面板 ✅、系统行 ✅ | 🟡 → T1① |
| D3 | 权限预设 | 头部 PermissionSelect + `/permission` | Ctrl+P ✅ | ✅ |

## E. 设置（维持 YAML/env，不做向导 UI）

Web：general（主题/语言/busy-enter）、models（API key、自定义 provider、onboarding）、plugins（bash/agent-loop/web-search 配置表单）。
TUI：`DSH_TUI_THEME` + 用户 settings.yaml —— 结论：⛔ 终端配置向导价值低，README 补示例。

## F. 终端的天然优势（web 无对应）

原生 scrollback（alt screen 之外）、原生选择/复制、Ctrl+K 转录折叠、大粘贴保护、IME 光标锚定。

---

## 实施批次

### T1（本轮目标）

| # | 项 | 内容 | 状态 |
|---|---|---|---|
| T1① | 斜杠命令面板 | Ctrl+/ 弹 `FilterablePickerPanel`；枚举 `ctx.commands` 注册命令；有 input 提示的走自由文本 askDialog；执行 `handler({agent, rawInput})`；结果渲染为 notice 行 | ✅ |
| T1② | 消息统计行 | 投影：turn/start 时间戳 → assistant 条目 `stats{runMs,ttftMs,tokensPerSecond}`；渲染在 assistant 消息下 | ✅ |
| T1③ | 注入上下文行 | fold 不再丢弃非 user 来源；渲染 `注入 · <kind> · <name>` 系统行（含首行预览） | ✅ |
| T1④ | plan 增强 | plan-review 弹窗 approve 选项 `✔` 高亮；Ctrl+E 退出 plan 模式（`/plan off`） | ✅ |
| T1⑤ | 消息队列 | busy 时 Enter 直接入队（web QueueDock 语义）；状态槽「队列 N · Ctrl+C 中断」；turn 结束 FIFO 逐条发送 | ✅ |
| T1⑥ | 后台任务 + 子代理分组 | `ctx.jobs` 活跃任务行（dsh-base 已挂 jobs-local）；picker 中 `parentSession` 子会话 `↳` 缩进 | ✅ |
| T1⑦ | 会话导出 | `/export`（命令面板原生项）：flush + `sessionPersistence.locate` 展示 jsonl 路径 | ✅ |

### T2（已完成）

| # | 项 | 实现 | 状态 |
|---|---|---|---|
| T2① | fork | Ctrl+B 分支点选择器 → `agents.create(seed)`（host 同款 cut 语义，parentSession 谱系） | ✅ |
| T2② | 消息反馈 | `/rate` → 👍/👎 + 备注；**sidecar 持久化**（`$DSH_HOME/tui-feedback.json`，重评覆盖、回放摘要行）——messageFeedback 服务需 web profile 的 storage 插件，而 out-of-tree profile 的 loader 只从 dsh 安装解析 bundle 行（实测挂载即静默挂死），详见修订记录 | ✅（sidecar 方案） |
| T2③ | effort | 模型 → 「推理强度」二级弹窗 → `ModelSelection.reasoningEffort` | ✅ |
| T2④ | workspace | Ctrl+W 输入目录 → 校验 → 新会话（meta.cwd 同步） | ✅ |
| T2⑤ | 搜索 | Ctrl+F → 匹配列表 → 渲染行高累加 `ScrollView.scrollTo` 跳转 | ✅ |

### T3（已完成）

| # | 项 | 实现 | 状态 |
|---|---|---|---|
| T3① | 消息时间戳 | user/assistant 条目 `at` → HH:MM 时钟 footer | ✅ |
| T3② | 工具耗时 | `calledAt`/`durationMs` 投影 → 工具卡 footer | ✅ |
| T3③ | fork 锚点扩展 | committed assistant 消息也可作分支点 | ✅ |
| T3④ | 消息焦点环 | FocusableFrame 包装全部消息行加入 Tab 循环；搜索跳转以聚焦帧作高亮；`/rate` 作用于聚焦回复；顺带修复焦点环旧条目不可达 bug | ✅ |
| T3⑤ | 会话相对时间 | 描述改为「N 小时前」等 | ✅ |

### T4（已完成）

| # | 项 | 实现 | 状态 |
|---|---|---|---|
| T4① | 上下文压力条 | footer `ctx N%` + 10 格 ▓░ 条，60/80 阈值三级着色 | ✅ |
| T4② | 每轮产物文件 | ToolEntry 带 turn/step，assistant 统计行 `✎ 文件` chips | ✅ |
| T4③ | Ctrl+Y 聚焦反馈 | 与 /rate 同路径，聚焦帧优先 | ✅ |
| T4④ | E2E 交互场景 | 第六场景：搜索/聚焦帧/fork//rate/命令面板全链路 | ✅ |

**已确认跳过**：@mention（web '@' = subagent 定位触发器，TUI 已具 @/# 文件路径补全）；
行内反馈按钮（TUI 用聚焦帧 + Ctrl+Y//rate 等价）。

---

## 修订记录

- 初稿：以 `packages/client/ui-*` 为基线完成差距盘点，定义 T1/T2。
- T1 全部落地（命令面板/消息统计/注入行/plan 增强/队列/jobs+子代理分组/export）。
- T2 全部落地（fork/反馈/effort/workspace/搜索）。
- **约束发现**：out-of-tree profile 的 bundle patch 行只能引用 dsh 安装（apps/cli/node_modules）已携带的插件；storage 系列不在其中，挂载会让 loader 静默挂起（无报错）。T2② 因此改为 TUI 自有 sidecar（`tui-feedback.json`，与历史文件同目录），与 web 的 messageFeedback 存储分离——若未来安装携带 storage 栈，可切回服务实现。
