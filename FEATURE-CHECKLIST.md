# FEATURE-CHECKLIST.md — dsh / dsh web 全功能点对比清单

> 基线：DeepSeek Harness checkout（`/Users/mcswift/private/deepseek-harness`）的 dsh CLI/runtime
> 与 web 客户端（`packages/client/ui-*`）。TUI 侧以本仓库实现为准。
> 状态列：✅ 已覆盖 · 🟡 部分覆盖 · ❌ 缺失 · ⛔ 终端不可行/不建议。
> 相关专题分析：GAP-ANALYSIS.md（web 基线）、PI-GAP-ANALYSIS.md（pi 基线）、INTERACTION-PLAN.md。

## A. 消息流与渲染（web: ui-conversation / ui-primitives）

| # | 功能点 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| A1 | 流式文本渲染 | AssistantMarkdown 增量解析、冻结块只解析尾部 | assistant/chunk 流式追加 + 差分重渲染 | ✅ |
| A2 | 推理/思考块折叠 | ReasoningRow：运行时显示最后一行、静止第一行、可展开 | thinking L1/L2/L3 分级着色 + Ctrl+T 全局隐藏；无逐块折叠 | 🟡 |
| A3 | Markdown 管线 | 自研 mdast：GFM + TeX 数学 + 链接协议白名单 | pi Markdown + hljs；无 TeX；链接协议白名单 ✅（fileLink 只放行 http/https/mailto + 本地路径，控制字符剥离） | 🟡 |
| A4 | 代码块高亮 | shiki（懒加载语言、语言横幅 + 复制按钮） | hljs 高亮 + 语言标签（web shiki 色板）；无块级复制按钮 | 🟡 |
| A5 | 数学公式 KaTeX | `$…$`/`$$…$$`/math 围栏，流式字面、settled 渲染 | pi Markdown 内置 renderLatex → Unicode（`x^2`→`x²`，KaTeX 的终端等价） | ✅ |
| A6 | 表格/任务列表/脚注 | GFM 表格、脚注编号区、task 禁用复选框 | pi GFM 子集；无脚注 | 🟡 |
| A7 | 引用来源 citations | 工具结果 WebBlock 有序引用列表 | web_search 结构化 meta（sources/answer）渲染引用卡；web_fetch 无 | 🟡 |
| A8 | 消息操作（复制/分支/评分） | hover 按钮：copy、fork、feedback slot | 键盘等价：Ctrl+X 复制 · Ctrl+B 分支 · Ctrl+Y 评分 | ✅ |
| A9 | 分支到新会话 | 仅已完成轮次末条可 fork | Ctrl+B fork 点选择器 + /clone（同约束） | ✅ |
| A10 | 消息时间戳 | 同日 HH:mm、跨日带日期、跨年 ymd | 同日 HH:MM；跨日 MM-DD、跨年 YYYY-MM-DD | ✅ |
| A11 | 每消息统计页脚 | Ran for 15s · TTFT 1.2s · 34 tok/s | ⏱ · ⚡ TTFT · tok/s + 轮次结局徽标（P0） | ✅ |
| A12 | 消息状态行 | 停止标记、轮次失败行、token 上限提示、重试行（倒计时 + 失败原因可展开） | 结局徽标 + RetryStatusIndicator 倒计时 + 重试行 Tab 聚焦 + Enter 展开失败原因（K1） | ✅ |
| A13 | 用户气泡 + /@ chip 装饰 | 用户右对齐；`/name`、`@name` 渲染 ref-chip | 用户气泡 ✅；chip 装饰无 | 🟡 |

## B. 工具执行（web: ui-tool / ui-primitives）

| # | 功能点 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| B1 | 工具调用/结果卡片 | 摘要行点击展开、状态点、错误首行折叠 | 工具卡展开/折叠、状态着色、错误摘要 | ✅ |
| B2 | 工具分类变体标题 | bash/pwsh/read/web/grep/glob/write/edit/run_code/cordis_* | dsh-tools 部分标题映射 | 🟡 |
| B3 | 递归子调用树 | ToolCallTree 根/子递归 | `tool/code-dispatch-start`/`code-dispatch` 折叠进父卡 `children` 树（`run_code` 子调用递归缩进渲染：状态点 + 名称 + 参数 + 输出摘要） | ✅ |
| B4 | 终端卡片 | ANSI 彩色输出、退出码 pill、复制原始、16 行中折 | 退出码/killed pill（`[exit code: N]` marker 契约解析）+ ANSI 透传 + 折叠；无块级复制 | 🟡 |
| B5 | Diff 渲染 | write/edit applied diff（聊天 8 行上限） | diff meta + 增删着色；产物文件 chips | 🟡 |
| B6 | Read 卡片 | 行号 + 语法高亮文件窗口 | 行号 + hljs 高亮（按扩展名选语言）+ 40 行截断 | ✅ |
| B7 | Search 卡片 | grep/glob 分组匹配 + 恢复定位 footer | grep 按 path:line 分组（路径头 + 行号）+ glob 路径列表 | ✅ |
| B8 | Web 卡片 | web_search 答案 + 引用 / web_fetch URL + 状态 | web_search 答案 + 引用卡（结构化 meta）✅；web_fetch URL 头 + 正文（无 HTTP 状态） | 🟡 |
| B9 | 文件路径链接 | 点击用宿主默认应用打开 | OSC 8 超链接（read/write/edit/diff/grep/web 卡片路径与 URL，支持终端 Cmd 点击打开） | ✅ |
| B10 | 详情面板 | 选中调用 Input(JSON) + Output 双栏 | 聚焦卡 `i` 键展开 raw input JSON（12 行封顶）+ Enter 展开输出；无分栏 | 🟡 |
| B11 | Inspect 跳转 trajectory | 展开体 Inspect → 轨迹视图 | Ctrl+L/`/trajectory` 轨迹视图（原始事件日志窗口：seq/时间戳/类型分色/单行摘要/过滤/翻页）；无「从消息跳转到对应事件」锚点 | 🟡 |
| B12 | 专用工具行 | todo/ask_user_question/skill 专属渲染 | todo 面板 ✅ · 提问对话框 ✅ · skill 注入行 🟡 | 🟡 |

## C. 审批与提问（web: ui-conversation / ui-user-questions / ui-permission-presets）

| # | 功能点 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| C1 | 审批对话框 | 占位 composer：理由 + 命令代码 + 拒绝/允许一次（one-shot 闩锁） | 审批弹窗 allow once/reject + 审计行 + Esc 取消 | ✅ |
| C2 | 用户提问 | 多题分页、单选/多选、自由文本、跳过、上一/下一题、进度、推荐徽标 | 多题顺序呈现 + `i / n` 进度；单选/多选（数字/空格切换、Enter 确认）；自由文本；`上一题`/`跳过本题` footer（web 文案逐字复用）；选项描述 + header；推荐以 `(Recommended)` 标签标注 | ✅ |
| C3 | 计划审批 | 计划待审卡（审批/拒绝/去聊天讨论）+ markdown 计划体 | detailMarkdown 渲染 + approve ✓；无"去讨论"选项 | 🟡 |
| C4 | Full-access 确认 | RiskConfirmation 勾选确认 + 启用/取消 | 确认对话框（acknowledge 选项，web 文案复用） | ✅ |

## D. Composer（web: ui-conversation skeleton / input machine）

| # | 功能点 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| D1 | 输入框 | textarea 镜像层、14 行上限滚动、caret reveal | pi Editor + 硬件光标（IME 锚定） | ✅ |
| D2 | busy Enter 行为设置 | queue vs steer 可选，Cmd/Ctrl+Enter 反向 | `DSH_TUI_ENTER=steer` 切换 busy Enter 为 steer（默认 queue）+ Alt+Enter 恒为 steer | ✅ |
| D3 | Shift+Enter / IME 守卫 | 组合输入不发送 | Shift+Enter 换行 ✅、IME 光标修复 ✅ | ✅ |
| D4 | 停止生成按钮 | running 时主按钮变停止；子代理独立停止 | Esc 中断（状态槽提示） | ✅ |
| D5 | 斜杠命令面板 | combobox 分组（命令/技能/子智能体）、焦点留 textarea | 内联 slash 菜单（nonCapturing）+ Ctrl+/ 面板；无分组 | 🟡 |
| D6 | @-mention | token 装饰 chip + 序列化 | @/# 文件路径补全；无 mention 语义 | 🟡 |
| D7 | 命令选项弹层 | popupSelect：搜索过滤 + 确认流程 | 命令面板 + 过滤 + 风险确认 | ✅ |
| D8 | 文件/图片附件 | 拖拽/粘贴、缩略图轨道、灯箱、limits 预检 | ⛔ 终端无附件；read_image 结果占位行 | ⛔ |
| D9 | 目录选择器 | Miller 双栏浏览器 / 原生选择器 | Ctrl+W 自由文本路径 + 校验 | 🟡 |
| D10 | 大段粘贴 | 单事务粘贴 + 异步升级 | 30 行粘贴确认弹窗 | ✅ |
| D11 | 撤销/重做 | Cmd/Ctrl+Z/Y 事务日志 | Ctrl+Z / Ctrl+Shift+Z 重绑定（pi 原生 undo 栈；Ctrl+Y 为评分键） | ✅ |
| D12 | 多态 placeholder | plan/goal/默认/子代理等占位文案 | footer/状态槽提示；composer 无占位 | 🟡 |
| D13 | Toast/通知条 | 图片拒绝、prompt 失败、模型选择失败提示 | P2 状态槽 toast（命令/effort/lang/copy/rate） | ✅ |

## E. 会话级 UI（web: ui-conversation skeleton / 各功能包）

| # | 功能点 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| E1 | 队列 dock | 计数头可折叠、每行编辑/删除/插话、单条直接显示 | Enter 入队（上限 10）+ 状态槽计数 + Alt+Up 取回 + Alt+Enter steer + `/queue` dock（逐项取回/删除） | ✅ |
| E2 | 统计条 | turns/steps · LLM/工具时长 · TTFT 平均 · tok/s · 缓存命中 · 输入/输出，hover tooltip | 会话统计条（stats.ts 逐字对齐，空闲状态槽） | ✅ |
| E3 | 上下文压力环 | SVG 环 + 面板（百分比/token/分段彩条） | footer `ctx N%` + 10 段彩条（cache 段 info 色 + surface 段压力色，CC-07）；无全量 breakdown 面板 | 🟡 |
| E4 | 会话头 | 父→子面包屑 + 视图 Tab 切换 | header：会话 id + `↳ 父会话` 面包屑 + 标题 + plan 徽标；无视图 Tab | ✅ |
| E5 | Plan 模式徽标 | `Plan ×` chip 点击执行 /plan off | `◐ plan` 徽标 + Ctrl+E 退出 | ✅ |
| E6 | Goal 面板 | 阶段标签 + 暂停/恢复/编辑/清除 + 内联编辑 + blocked tooltip | goal 行（阶段/目标/轮次/blocked 原因）；操作经 /goal 命令 | 🟡 |
| E7 | Todo 面板 | 完成/进行中/待处理计数、折叠展开、状态字形 | 计数头 `◆ todo ✓N ▶N ○N` + 状态字形 + >6 项折叠 | ✅ |
| E8 | Jobs 面板 | 状态点 + 类型 + 标签 + 实时耗时 | ◆ job 行（状态点 + 运行期 ▐▓░ 呼吸条 + 标签 + 实时/结算耗时，500ms ticker）；>1 收敛 Ctrl+O 展开 | ✅ |
| E9 | 子代理徽标/树 | 头操作展开树（计数、运行点、惰性子孙、token/时长） | ◆ subagent 徽标行；无树/指标 | 🟡 |
| E10 | 只读子代理 composer | one-shot / 父离线只读说明 | one-shot 子代理会话（`subagent/descriptor` mode）只读：🔒 提示行 + 提交拦截（/quit 等命令仍可用） | ✅ |
| E11 | 反馈行 | 每条已结束消息 👍/👎 + 备注编辑器 | /rate + Ctrl+Y（聚焦帧优先）+ 负评备注；持久化 sidecar | ✅ |
| E12 | 上下文注入行 | 按 form 展开（instructions/catalog/snapshot/notice/relay/recall） | `注入 · kind — 预览` 单行，聚焦 + Enter 展开全文（12 行封顶） | ✅ |
| E13 | 压缩标记 | 自动压缩行（可展开摘要）+ /compact 命令卡 running 态 | compaction 状态 + 摘要卡 + 通知 | ✅ |
| E14 | 产出文件行 | 轮末 6 个可点 chip + 剩余计数 + 在文件夹中显示 | 统计页脚 `✎` chips（OSC 8 可打开，4+ 计数） | ✅ |
| E15 | Workflow 运行面板 | run/phase/member 层级披露 | `◆ workflow <name> · ✓N/M · N ⟳` 面板块 + 成员行（phase 标签 + 状态点，8 行封顶折叠）+ 文档流 run 边界审计行（tool-workflow 四事件结构化 fold） | ✅ |
| E16 | 空态 Hero | 鱼 logo + 预览版徽章 + 工作区 chip + 辉光 | 品牌 splash：像素鲸 + DEEPSEEK 渐变词标 + 标语 + shimmer | ✅ |
| E17 | 轮次加载信号 | Deep diving... + 15s 后已用时长 | Deep diving... + 时钟（web 文案/规则一致）+ 渐变 shimmer | ✅ |

## F. 交互细节（web: ChatView / InputBar）

| # | 功能点 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| F1 | 滚动锚定 | 底部跟随、上翻保持锚点、Tab 回来恢复 | follow: end + 底部锚定（BottomPad） | ✅ |
| F2 | 自动滚动开关 + 回底按钮 | 离开底部显示 ↓ 按钮 | End 原生回底；离开底部时状态行挂 `↓ 回到底部 (End)` 提示（500ms 轮询 + 视口键 hook，动画冻结下仍工作）；自动滚动开关不可行（pi `followEnd` 构造期固定，上翻即停推已覆盖主场景） | 🟡 |
| F3 | 逐消息 hover 操作 | hover/focus 露出按钮 | 键盘等价：Tab 焦点环 + Ctrl+Y/X | 🟡 |
| F4 | 键盘快捷键 | Enter/Shift+Enter/Cmd-Enter/↑↓/Escape/撤销重做 | Esc 中断 · / 斜杠菜单（含命令别名 exit/clear/?/m/perm/language）· Ctrl+R/G/P/F/B/Y/X/W/T/K/O/E/D · Tab 焦点环 + Enter 展开/收起（thinking/工具卡/长消息）· Alt+Enter/Up · Ctrl+Z/Shift+Z 撤销重做；Cmd-Enter 无 | 🟡 |
| F5 | 错误/重试/压缩状态行 | turn-error 红点、max-tokens 黄点、重试倒计时、compaction running | 结局徽标（✗/⏹）+ 重试倒计时（真实 delay）+ 压缩状态；重试行 Tab 聚焦 + Enter 展开失败原因（code: message） | ✅ |
| F6 | 语言 zh/en 切换 | 每包独立 locale 字典 | strings.ts 双词典 + /lang + DSH_TUI_LANG；web 表外硬编码文案不国际化 | ✅ |

## G. dsh CLI / Runtime（apps/cli · packages/core · packages/*）

| # | 功能点 | dsh 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| G1 | launcher 参数（--profile/--patch/--dump-config） | `apps/cli/src/args.ts` | 经 `dsh --profile tui` 使用；自身 flags 见 startup.ts | ✅ 复用 |
| G2 | `web` 别名 / `plugin` 子命令 | `apps/cli/src/args.ts` | 不涉及（dsh 本体） | ✅ 复用 |
| G3 | profile patch 分层（bundle→profile→home→--patch） | `apps/cli/src/profile-boot.ts` | 本仓库 cordis.patch.yml 即 profile 层；约束已文档 | ✅ |
| G4 | HMR / 配置热重载 | `apps/cli/src/profile-boot.ts` | bundle patch 显式关闭（hmr disabled 行） | ✅ 决策关闭 |
| G5 | --dump-config 组合打印 | `apps/cli/src/dump-config.ts` | dsh 本体 | ✅ 复用 |
| G6 | 有界进程关停（SIGINT/SIGTERM + 5s 强杀） | `apps/cli/src/process-shutdown.ts` | quit：flush→dispose→exit(0) + 2s 看门狗；Esc/Ctrl+C 绑定 | ✅ |
| G7 | headless one-shot profile | `packages/bundle/headless` | 不适用（TUI profile 并列） | ⛔ N/A |
| G8 | telemetry 环境开关（DSH_TELEMETRY_*） | base cordis | 运行时行为，TUI 不感知 | ✅ N/A |
| G9 | session 事件日志 / fork / repair | `packages/core/session` | 全量消费（fold 投影 + resume/fork） | ✅ |
| G10 | JSONL 持久化（zstd） | `packages/session/session-persistence-jsonl` | flushSettled 双 flush + resume 回放（zstd 由 dsh 侧处理） | ✅ |
| G11 | SQLite 检索索引 | `packages/session/session-persistence-sqlite` | 不依赖（openAt 默认关）；picker 走 sessionQuery | 🟡 |
| G12 | session query/listing/trace | `packages/session-query/session-query` | listSessions/readTitle → 会话 picker | ✅ |
| G13 | session 检索工具（session_search 等） | `tool-session-query` | agent 侧工具，工具卡通用渲染 | ✅ |
| G14 | 标题生成（LLM + fallback） | `packages/session/session-title*` | session/title → header + 收敛通知行 | ✅ |
| G15 | transcript/export（/export 下载 ZIP） | `session-log-export` | /export 原生等价：展示 jsonl 路径 + flush | ✅ |
| G16 | fork/seed lineage | `packages/core/session` | Ctrl+B 分支点 + /clone + parentSession 谱系 | ✅ |
| G17 | attachment 本地存储 | `packages/attachment` | ⛔ 终端无附件；read_image 结果占位行 | ⛔ |
| G18 | agent 核心（followup/steer/cancel/inbox） | `packages/core/agent` | Enter followup · Alt+Enter steer · Esc cancel | ✅ |
| G19 | goals 域（create/rounds/blocked/pause/resume/edit/clear） | `packages/goal/*` | goal 面板展示 + /goal 命令全操作可达 | 🟡 |
| G20 | todos（todo_write 全量替换） | `packages/todo/tool-todo` | todo_write → todo 面板（✓/▶/○） | ✅ |
| G21 | subagents（spawn/fork/list/send/interrupt） | `packages/subagent/*` | ◆ subagent 徽标行 + 工具卡；无树/导航 UI | 🟡 |
| G22 | skills catalog（SKILL.md + skill 工具） | `packages/skill/*` | skill-catalog 注入行列目录 + user-invocable skills 进 `/` 菜单（选中插入 composer）+ skills/change 重同步 + skill 工具通用卡 | ✅ |
| G23 | plan mode（exit_plan_mode + /plan） | `packages/plan/plan-mode` | ◐ 徽标 + Ctrl+E 退出 + plan-review approve ✓ | ✅ |
| G24 | background jobs（job_list/output/kill） | `packages/jobs/*` | ◆ job 行 + Ctrl+O 收敛展开 | ✅ |
| G25 | LLM retries | `packages/llm/llm-retry` | RetryStatusIndicator 倒计时（esc to cancel） | ✅ |
| G26 | compaction（手动/自动/overflow） | `packages/compaction/*` | /compact + 状态行 + 摘要卡 | ✅ |
| G27 | workflows & ralph | `packages/workflow/*` | WorkflowRunPanel 面板 run→member 层级披露（与 E15 同实现） | ✅ |
| G28 | ask_user_question | `packages/interaction/user-questions` | 提问对话框（选项数字直选 + 自由文本） | ✅ |
| G29 | /goal /compact /feedback /permission /plan /export 命令目录 | `packages/interaction/commands` 及各 command-* | 命令面板 + 内联斜杠菜单全量可达 | ✅ |
| G30 | tools registry / defineTool | `packages/core/tools` | resolveToolDefinition + 工具卡渲染 | ✅ |
| G31 | 文件工具（read/write/edit/read_image/glob/grep/str_replace_editor） | `packages/fs/tool-*` | 工具卡 + diff 着色 + ✎ 产物 chips；read_image 占位 | ✅ |
| G32 | shell 工具（bash/pwsh/持久会话/后台） | `packages/shell/tool-*` | bash 终端卡；pwsh 通用卡 | 🟡 |
| G33 | terminal 工具（open/list/send/…） | `packages/terminal/tool-terminal` | 通用工具卡 | 🟡 |
| G34 | web 工具（web_search/web_fetch） | `packages/web/tool-web` | 原始文本展示；无 WebBlock 引用卡 | 🟡 |
| G35 | 审批瀑布（ask-once/always/never） | `packages/interaction/user-approval` | 审批弹窗 allow once/reject + 审计行（E2E 验证） | ✅ |
| G36 | 权限预设（read-only/workspace-write/danger-full-access/custom） | `packages/interaction/permission-presets` | Ctrl+P 切换（K3 投影 chip + 通用枚举 picker）+ `/permission [预设]`（枚举选择/参数直切）+ full-access 确认 + preset 通知行 | ✅ |
| G37 | sandbox 模式折叠 | `packages/sandbox/*` | 随预设切换（sandbox+approval 一体） | ✅ |
| G38 | workspace 切换 | `packages/workspace/workspace` | --workspace + Ctrl+W 切换 | ✅ |
| G39 | provider/model listing + 默认模型持久化 | `packages/llm/llm`、`core/agent-default-model` | Ctrl+G picker + `/model [provider/model]`（枚举选择/参数直切）+ agentDefaultModel.saveSelection | ✅ |
| G40 | reasoning effort 层级（不支持显式拒绝） | `packages/llm/llm` | /effort 独立选择；无 efforts 时 notice | ✅ |
| G41 | token 计量（input/output/cacheRead/cacheWrite） | `packages/llm/token-meter` | 会话统计条 + 每消息 usage + 缓存命中率 | ✅ |
| G42 | 上下文压力计（request/surface/breakdown） | `packages/llm/token-meter` | footer ctx N% + ▓░ 压力条；无分段 breakdown | 🟡 |
| G43 | session telemetry（OTLP） | `packages/*/session-telemetry-otel` | 运行时行为（env 控制），TUI 不感知 | ✅ N/A |
| G44 | 消息反馈（rate + note，版本化） | `packages/feedback/message-feedback` | /rate + Ctrl+Y + 负评备注；out-of-tree 无法挂 storage → TUI sidecar（与 web 存储分离，已文档） | 🟡 |
| G45 | /feedback 会话反馈 | `packages/feedback/command-feedback` | 命令面板可达 → feedback/record 系统行 | ✅ |
| G46 | bundle patch / include / `!!js` | `packages/bundle/base` | 使用中（persona/hmr/tools 行 + insert 三行） | ✅ |
| G47 | cordis services / inject / dispose | `@deepseek-ai/cordis` | tui-startup + tui-runner 两个插件 | ✅ |
| G48 | storage 域 | `packages/storage/*` | ⛔ out-of-tree profile 不可挂载（loader 静默挂起）→ sidecar 替代 | ⛔ |
| G49 | agent presets | `packages/preset/agent-presets` | 无 preset 管理 UI；Ctrl+G 即模型默认 | 🟡 |
| G50 | MCP client（mcp__srv__tool 桥接） | `packages/mcp/mcp-client` | mcp__* 工具通用卡渲染 | ✅ |

## H. Web 壳 / 设置 / 会话管理（packages/client: ui-sidebar · ui-workspace · ui-settings-* · ui-layout · ui-theme · web）

| # | 功能点 | Web 实现 | TUI 现状 | 状态 |
|---|---|---|---|---|
| H1 | 新建会话 | 侧栏按钮 / 空态 Hero | /new + /clone + 品牌 splash 空态 | ✅ |
| H2 | 侧栏折叠/动画/滚动条皮肤 | SidebarRoot + quietBars | ⛔ 终端无侧栏 chrome；信息经 picker | ⛔ |
| H3 | 工作区浏览区域 | ui-workspace 槽 | Ctrl+W 自由文本路径 + 校验 | 🟡 |
| H4 | 分组/平铺视图 + 排序选项 | tree.ts deriveGrouped/deriveFlat + ViewOptionsMenu | picker 平铺 + 过滤；无分组/排序 | 🟡 |
| H5 | 会话搜索（标题/内容全文） | 250ms 防抖 + 后端检索 | picker 输入 250ms 防抖 → `searchSessions` 后端全文命中合并（snippet 预览 + 相对时间），空查询保留全列表 | ✅ |
| H6 | 会话行状态点 + hover 卡 | sessionStatuses 7 态 | 相对时间 ✅；无状态点/hover 卡 | 🟡 |
| H7 | 会话重命名 | 浏览器持有对话框 | `/rename`：固定会话标题（`sessionTitle.rename`，自动生成停止）；内联参数直切或对话框补问 | ✅ |
| H8 | 会话归档 | archiveSession | ⛔ `workspaceRegistry` 服务未挂载于 tui profile（bundle 无 workspace 插件，挂载会因缺 storageDomain 静默挂起） | ⛔ |
| H9 | 拖拽重排（会话/工作区） | HTML5 DnD | ⛔ | ⛔ |
| H10 | 相对时间显示 | relativeTime 双语 | 刚刚/N 分钟前/N 小时前/N 天前/日期 | ✅ |
| H11 | 工作区重命名/删除对话框 | WorkspaceBrowser | 无 | ❌ |
| H12 | 会话导出/下载 UI | 客户端无此功能（grep 确认）；runtime /export | /export 展示 jsonl 路径（原生等价） | ✅ |
| H13 | 设置面板（模态 + 导航 + General 区） | ui-settings-general | 无设置面板；env + /lang + pickers 等价 | 🟡 |
| H14 | 语言选择（zh/en + 持久化） | locale LanguageRow | /lang + DSH_TUI_LANG + strings() 双词典 | ✅ |
| H15 | 外观主题（浅/深/跟随系统） | ui-theme AppearanceRow | DSH_TUI_THEME=light/dark/auto（OSC11 探测）；色板逐字采用 web token | ✅ |
| H16 | Enter 行为设置（queue/steer） | EnterBehaviorRow | 固定 Enter 入队 + Alt+Enter steer；无设置 | 🟡 |
| H17 | 模型默认设置 | ui-agent-preset AgentPresetRow | Ctrl+G 选择 + 持久化 | ✅ |
| H18 | 权限默认设置 | ui-permission-presets PermissionRow | Ctrl+P + full-access 确认 | ✅ |
| H19 | 模型设置页（API key/provider/模型目录/onboarding） | ui-settings-models | `/config`：供应商列表 + 添加向导（路由/显示名/baseURL/协议/apiKeyEnv，经 settings seam 热生效）+ 预览/$EDITOR 编辑 settings.yaml（K2） | 🟡 |
| H20 | 插件设置页（Bash/AgentLoop/WebSearch 卡） | ui-settings-plugins | 无 | ❌ |
| H21 | 插件清单 tab | ui-settings-plugin-inventory | 无 | ❌ |
| H22 | 主题服务/偏好持久化/boot 防闪 | ui-theme + ui-layout | 无 DOM 投影；palette 切换 + 启动应用 | ✅ N/A |
| H23 | 设计 token（--dsw-*） | design-platform.css | palette.ts 逐字取值（dark/light 两套 + shiki 色） | ✅ |
| H24 | 字体栈 / 动效曲线 / 滚动条 | base.css / scrollbar.css | ⛔ 终端字体与滚动由终端决定 | ⛔ |
| H25 | 三栏布局/列宽/拖拽手柄 | ui-layout AppFrame | ⛔ 终端单栏布局 | ⛔ |
| H26 | 启动加载页/失败页 | web/src/AppRoot | spinner + 品牌 splash；错误通知行 | ✅ |
| H27 | 应用壳（slot 单页、无路由、Vite/HMR） | web/src/* | cordis profile 启动（tui-runner） | ✅ N/A |
| H28 | 目录选择器（native + Miller 双栏） | ui-directory-picker-* | Ctrl+W 文本路径；无浏览器 UI | 🟡 |
| H29 | 附件轨道/拖放覆盖/灯箱/图片画廊 | ui-attachment | ⛔ | ⛔ |
| H30 | 产物文件（打开/在文件夹显示） | ui-deliverables | ✎ chips OSC 8 打开 + `📂` 目录链接（Finder 定位产物，H30 在文件夹显示） | ✅ |
| H31 | 轨迹视图（时间线/搜索/分页/虚拟行） | ui-trajectory | Ctrl+L/`/trajectory`：seq 升序事件日志窗口（类型分色 + 时间戳 + 摘要 + 本地过滤 + 翻页，B11 同实现）；无后端搜索/虚拟行 | 🟡 |
| H32 | 工作流运行视图（分阶段成员） | ui-workflow-run | 面板 run→member 层级披露（E15 同实现；成员 ≤8 行，超限折叠） | ✅ |
| H33 | skill 目录触发菜单（/ 候选） | ui-skill | `/` 菜单含 user-invocable skills（`ctx.skills` 结构化读取，无 dsh-skill 依赖） | ✅ |

---

## 汇总（148 个功能点）

| 区 | ✅ | 🟡 | ❌ | ⛔ | 备注 |
|---|---|---|---|---|---|
| A 消息流与渲染 | 7 | 6 | 0 | 0 | 协议白名单/块级复制未做 |
| B 工具执行 | 5 | 7 | 0 | 0 | Inspect 跳转锚点未做（轨迹视图已补） |
| C 审批与提问 | 3 | 1 | 0 | 0 | — |
| D Composer | 8 | 4 | 0 | 1 | 附件终端不可行 |
| E 会话级 UI | 14 | 3 | 0 | 0 | — |
| F 交互细节 | 3 | 3 | 0 | 0 | Cmd-Enter 未做；自动滚动开关不可行（↓ End 提示已补） |
| G dsh CLI/Runtime | 38 | 9 | 0 | 3 | runtime 能力基本全可达 |
| H Web 壳/设置 | 16 | 8 | 3 | 6 | 设置页/插件页为主要缺口 |
| **合计** | **94** | **41** | **3** | **10** | 覆盖率 ✅+🟡 ≈ 91%（不含 ⛔ 的 138 项中 ≈ 98%） |

> 修订：本清单基于 dsh checkout 与 web 客户端逐包审计（CLI/runtime 8 区、会话面 6 区、壳/设置 5 区），
> 每条含可核对的源文件路径。TUI 侧状态与本仓库实现同步；后续功能落地时以本清单为对比基线。
