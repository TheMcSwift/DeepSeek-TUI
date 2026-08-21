# BACKLOG-FEATURE-GAP.md — 功能差距实现清单（Part A）

> 来源：[docs/COMMUNITY-COMPARISON.md](COMMUNITY-COMPARISON.md)（ccch1mneyyy/dsh-TUI v0.8.5 对比，2026-08-20）。
> 范围：**远程有而我们没有 / 我们有但不如它**的功能，逐项给出实现方案。
> cc 预设与 Claude Code 的广义交互差距单独跟踪：[BACKLOG-CC-PARITY.md](BACKLOG-CC-PARITY.md)。
> 优先级：P0 交互缺陷（影响日常使用）· P1 高价值（对齐主流体验）· P2 打磨 · P3 评估/远期。
> 工作量：S（≤1 批）· M（1–2 批）· L（多批/需专项设计）。
> 类型：缺失（远程有我们没有）· 弱化（我们有但明显不如）。
> 约束：所有实现必须遵守 AGENTS.md（fold 纯函数、ViewDocument 文档即真相、ctx.get 结构访问、
> 不 import 未在 profile 依赖树的 dsh 包、strings.ts 双语、每批 typecheck+test+E2E）。
> 状态列在批次规划阶段填（未开始/已规划/进行中/完成/不做）。
>
> ## 决策记录（2026-08-20，用户拍板）
> 1. **整体策略：高价值优先**——先 P1 + 高感知项；P3/评估组缓做。
> 2. **大工程：核心子集**——A13 /trace 与 D1 /resume 只做核心能力升级（查询/跳转、行元数据/预览），不做全量版。
> 3. **平台生态：都不做**——G1 插件宿主 / G2 /update / G3 VS Code 扩展 / G8 npm 发布 记录为定位边界（与 out-of-tree 约束及发布流程冲突）。
> 4. **鼠标与图片：都做**——B8 fullscreen 鼠标选区复制（已确认 pi 原生可用）、B4 图片附件（attachment 缝隙已确认）。
> 5. **右键默认归 Warp（2026-08-20）**——SGR 鼠标上报**默认关闭**（`DSH_TUI_MOUSE=1` 或 `PiTuiAppOptions.mouse` 开启）；关闭时右键/滚轮归宿主终端原生行为，B8 选区复制仅在开启后可用。

## A. 命令面（缺口最大，感知最强）

| # | 项 | 优先级/工作量/类型 | 现状（本地） | 方案要点 | 依赖/约束 |
|---|---|---|---|---|---|
| A1 | `/status` 会话信息 | P1 / M / 缺失 | 数据已散落在 footer 统计条与 meta（模型/effort/tokens/缓存命中率/上下文%），无 git 分支读取 | 新增 `statusReport()` 纯函数汇总：模型+effort、busy/idle、会话 id、cwd+git 分支（`git rev-parse --abbrev-ref HEAD`，best-effort）、Tokens in→out、缓存命中率（cacheRead/(input+cacheRead+cacheWrite)，1 位小数）、ctx %、标题；结果走 notice 行（可折叠） | stats.ts 数据源；git 调用放 control 层（fold 保持纯） |
| A2 | `/tokens` + `/cost` | P1 / S / 缺失 | stats.ts 已有 usage 累加 | 单命令双输出：紧凑 token 格式（988/3.4k/1.0M）+ 缓存命中率 + 注释行 | stats.ts |
| A3 | `/context` loaded-context 明细 | P2 / M / 缺失 | 已有注入上下文行（E12，单行预览 + Enter 展开全文） | 扩展为报告视图：system prompt 分节、工作区指令文件（AGENTS.md 族）、动态运行时上下文、技能目录、工具清单（各自截断），复用注入行数据 | 注入行数据源 |
| A4 | `/doctor` 环境自检 | P2 / S / 缺失 | — | 模型+provider、cwd、上下文窗口、API key 配置状态（脱敏）、会话 id、配置候选路径 | llm.resolveModelInfo；env 检查 |
| A5 | `/init` 创建 AGENTS.md | P2 / S / 缺失 | — | 会话 cwd 写 AGENTS.md 模板骨架（项目/约定两节），已存在则提示 | fs 写（control 层） |
| A6 | `/agents` 子代理列表 | P2 / M / 缺失 | 只有 `◆ subagent` 徽标行（subagent/descriptor 事件） | 从文档 subagent 条目聚合列表（id/label/状态/one-shot），无 live 服务依赖 | fold 已折叠 subagent 条目 |
| A7 | `/skills` 技能目录 | P2 / S / 缺失 | user-invocable 技能已进 `/` 菜单（skill-catalog.ts） | 加命令列出完整目录（名称 + 来源 + 简述），Enter 填 `/name ` 回输入框 | ctx.get('skills') |
| A8 | `/mcp` MCP 状态 | P2 / S / 缺失 | mcp__* 工具走通用卡渲染 | 若组合挂载 mcp 服务则列出服务器与工具数；未挂载时给出 insert 示例提示 | **约束**：mcp 服务不在 ctx 白名单，需先确认组合中服务名可结构读取，否则降级为提示命令 |
| A9 | `/provider` 9 步向导 | P1 / M / 弱化 | /config 已有添加向导（路由/显示名/baseURL/协议/apiKeyEnv） | 对齐远程 9 步：内置 catalog 路由选择（只需 API key）、自定义端点、**草稿凭据探测模型目录**（失败手输 ≤3 次重试）、多选、确认摘要 + 已存在警告、先写 credentials（0600）再写 profile 可回滚、完成后可一键切模型；key 输入 `••••••` 脱敏 | settings seam + llm.listConfigurableProviders（已有）；credentials 写入需确认 settings 服务能力 |
| A10 | `/preset` Agent preset 选择器 | P1 / M / 缺失 | G49 🟡：无 preset 管理 UI | `/preset` 枚举选择 + `/preset <id>` 直切 + blank-only 规则（已开始会话锁定，选择保存为新默认）；默认值持久化到 tui 命名空间 settings | **约束**：依赖 `dsh-agent-presets` 服务（`dsh-presets` 类），需先验证 profile 组合中可 ctx.get 结构读取；不可行则做"选择持久化 + 提示"降级 |
| A11 | `/rewind` 时间回溯 | P1 / L / 缺失 | 已有 forkSession（Ctrl+B 分支点选择器 + /clone） | ① 空输入双击 Esc 打开用户消息选择器（newest-first）；② 确认页；③ 找到消息所属 turn 起点，fork 分支 + 回放边界前历史（复用 forkSession cut 语义）+ 原消息放回输入框；④ busy 时先取消（≤30s 等落定）；不能回退到第一条 | fork.ts 复用；选择器复用 FilterablePicker；`/rewind` 命令 + 双击 Esc 双入口 |
| A12 | `/btw` 侧问 | P1 / M / 缺失 | — | 复用当前会话上下文做**无工具单轮** LLM 调用（llm 服务 stream）；浮层面板显示答案（可滚动、`c` 复制、Esc 关）；**不进 session log、不计 token**（面板关闭即消失）；再次触发中止上一个；busy 可触发不打断 | ctx.get('llm') stream；浮层组件仿 DecisionCard/BtwPanel 形态；**注意**：不写日志=不经过 fold，需独立于文档流的 UI 状态（与决策卡同类的瞬态组件） |
| A13 | `/trace` 轨迹场景 | P1 / M / 弱化 | 已有 /trajectory + Ctrl+L 面板（seq 事件日志、过滤、翻页） | **决策：核心子集**——现有面板升级：查询语言（tool:/kind:/turn:/err:/run:/>10s/tok>1k，多条 AND + 命中高亮）、`[`/`]` 跳失败点、`{`/`}` 跳轮次；不做全屏波形带/热点视图 | 现有 trajectory-panel 数据源扩展；查询解析纯函数可单测 |
| A14 | `/workspace resume|rename|open` | P1 / M / 弱化 | /workspace 最近列表 + Ctrl+W 切换 + /rename 的目录目标（H11 已有 fs.rename 半套） | 补齐子命令解析（resume/rename/open + 无参数列出子命令）、`open <目标>` 支持绝对路径/相对路径/file:// URI 并创建全新会话 | workspace.ts 现有逻辑扩展 |
| A15 | `/activity` 动画选择器 | P2 / M / 缺失 | 品牌 shimmer + spinner（DSH_TUI_ANIM 冻结） | 帧动画系统：内置 8–12 帧预设（moon8/claude/star2/sand 等取 pi 联合帧数据）+ `/activity frames <名>` + 选择器 + 持久化到 tui 命名空间；状态行忙碌时播帧动画 | **约束**：dsh-working-activity 不在 profile 依赖树——vendor 帧数据或自建轻量帧表（勿 import 官方包）；动画走现有 shimmer 重绘循环 |
| A16 | `/thinking` 命令 | P2 / S / 缺失 | Ctrl+T 全局开关已有 | 加命令入口（`/thinking` 弹 Enabled/Disabled 选择），保持不持久化语义 | 复用 thinking toggle 逻辑 |
| A17 | `/clear` 清屏语义 | P3 / S / ⛔ 不做 | `clear` 是 `/new` 别名（web 语义） | **决策（2026-08-20）：保持现状**（web 对齐优先），不做独立清屏 | — |
| A18 | `/tips` 提示面板 | P2 / S / 缺失 | — | 精简 tips 池（5 组：快捷键/命令/工作流/个性化/避坑）中英双语 + 面板；空态 splash 首屏轮换 | strings.ts 双语 |
| A19 | `/debug-prompt` | P3 / S / 缺失 | — | llm/stream 边界捕获最后请求上下文快照（≤8 个），命令原子写 `.dsh-prompt-debug.json`（0600）；当前轮未结束拒绝 | **约束**：捕获点需在 llm 服务 seam，结构读取可行性需验证 |
| A20 | `/update` 自更新 | P3 / L / ⛔ 不做 | — | **决策（2026-08-20）：不做**——记录为定位边界（需 npm 发布流程） | 定位边界 |
| A21 | 打包技能（7 个） | P2 / L / 缺失 | 无打包技能（DSH 侧技能经 / 菜单可达） | 设计本地技能集（audit/bug/review/practice/pr_comments/release-notes/vuln-check 或按本地风格裁剪），`skills/<name>/SKILL.md` 随包注册（需确认 out-of-tree 下注册缝隙；不可行则文档级技能说明） | **约束**：技能注册路径需验证（本地无 plugin 挂载 skills 目录的机制，可能仅能文档化） |
| A22 | `/export` Markdown 导出 | P2 / M / 弱化 | /export 展示 jsonl 路径 + flush（web 语义） | 加 `--md` 或双命令：导出 `dsh-tui-export-<ts>.md`（用户/思考/助手/工具分节 + 模型/会话/目录/时间），写入会话 cwd | 文档流已有全文（transcriptText 机制可复用） |
| A23 | `/login /logout /permissions /add-dir /hooks` 状态类 | P2 / S 各 / 缺失 | — | 各打印说明行（凭证状态脱敏 / 权限策略 / 文件策略作用域 / hooks 占位说明），不改行为 | 组合服务结构读取，无则提示不可用 |

## B. 输入与交互

| # | 项 | 优先级/工作量/类型 | 现状（本地） | 方案要点 | 依赖/约束 |
|---|---|---|---|---|---|
| B1 | Ctrl+Enter 打断并发送 | P1 / S / 缺失 | 无此键（中断只有 Esc/Ctrl+C） | keymaps 增动作 `interruptSend`（busy=interrupt 并立即投递输入；idle=直接发送）；opencode/pi 预设不绑或按画像自定 | keymaps.ts 动作表；投递复用 followup 路径 |
| B2 | Tab（busy）= follow-up | P1 / M / 缺失 | Tab 恒为焦点环 | busy 且输入非空时 Tab = follow-up（排入当前回合之后，提示"将在回合后处理"）；输入为空保持焦点环 | 队列机制已有（Enter queue），加一条 follow-up 路由；**注意**焦点环语义冲突需文档化 |
| B3 | `@` 文件引用增强 | P1 / M / 弱化 | `@/#` 路径补全（无 basename、无引号、无附加） | ① 任意位置 `@` 打开补全（前缀**或 basename** 匹配、目录可深入、带空格路径自动 `@"path"`）；② 发送时文本文件内容/目录列表自动附加到消息；③ Esc 只关当前 `@` token | 现有 CombinedAutocompleteProvider 扩展；附加逻辑在提交路径（composer 拦截） |
| B4 | 图片附件（剪贴板位图/图片文件） | P2 / L / 已决策做 | read_image 占位行；粘贴仅文本（image-convert 是空 stub） | **决策（2026-08-20）：做**。① 剪贴板位图保存到附件库 + 输入框 `[Image #N]`（文本不含 base64）；② 图片文件粘贴自动转 `@` 引用；③ 附件服务不可用降级临时文件引用 | **约束 ✅ 已探明（2026-08-20）**：`dsh-attachment-local` 在 dsh-base 组合的 `base/cordis.patch.yml` 已挂载——附件服务可用，可走真附件路径 |
| B5 | Ctrl+R 输入历史搜索 | P2 / S / 缺失 | ↑/↓ 历史回显（tui-history.json 200 条） | 历史搜索对话框（⌕ 搜索框 + 相对时间 + 重复按/Down 下移 + Enter 回填） | tui-history.json 现有数据 |
| B6 | 全文搜索扩展 | P2 / M / 弱化 | Ctrl+F 本地条目搜索（不含工具参数/结果） | 搜索目标扩展：用户/助手/思考/**工具参数与结果**/local 输出；结果间 n/N 跳转 | 文档条目数据源 |
| B7 | Shift+Up 消息选择模式 | P1 / M / 缺失 | 无 | Shift+Up 进入选择模式：↑/↓ 移动（user/assistant/tool/thinking/notice 可选行）、Enter 展开单条、Esc 退出 | 与 Tab 焦点环并存需定义交互优先级 |
| B8 | fullscreen 鼠标选区复制 | P2 / ✅ 完成 | 明确键盘化（不监听点击）；仅滚轮 | **结论（2026-08-20）**：**pi 原生已可用，零代码实现**——拖拽选区 + 松开即复制（OSC 52 + 引擎内 "Copied!" 闪烁）、双击/三击选词选行、单击 URL 均由 TuiAltScreen 内置（本地 `mouse: true` 已启用）。验证测试：`tests/pi-tui-app.spec.ts`「copies a drag selection via OSC 52 on release」——SGR 按下/拖动/释放 → 断言 OSC 52 base64 内容来自屏幕消息行 | 注意：FakeTerminal 的 feed tokenizer 不识别 `\x1b[<…` SGR 前缀，测试须用 feedRaw |
| B9 | Ctrl+X 编辑当前输入 | P1 / S / 弱化 | /compose + pi 预设 Ctrl+G（openExternalEditor 已有） | cc 预设 Ctrl+X 从"复制回复"改绑"编辑当前输入"（或双绑：空输入=编辑、有内容=复制，需决策）；复用 openExternalEditor 挂起编辑回填 | 与 Part B 的 Ctrl+X 语义决策联动 |
| B10 | Shift+Tab 会话模式循环 | P1 / M / 缺失 | 无 modes 概念 | Shift+Tab 循环：默认 → 计划 → 完全访问（plan/sandbox/approval 原子组合，仿远程 sessionModes 纯函数 + 配置）；模式当前值进状态行 chip | 需组合服务：plan-mode、sandbox-policy、approval 策略切换的缝隙验证 |
| B11 | 终端 tab 标题动画 | P3 / S / 缺失 | 无 | `⠂/⠐ 🐋 <标题>` 旋转动画（仅聚焦时）+ 空闲 `✦`；OSC 设置 tab title | 标题数据已有（header） |
| B12 | `!` 本地命令行渲染 | P2 / S / 弱化 | composer 拦截 `!cmd`（输出发模型）/`!!cmd`（静默 notice） | 转录内加 `local`（命令 echo）+ `local-output`（缩进 dim）双行形态 | 拦截逻辑已有，补投影条目 |
| B13 | StickyPromptHeader + NewMessagesPill | P2 / M / 弱化 | 仅「↓ 回到底部 (End)」提示（500ms 轮询） | 向上滚动时钉住最后一条用户消息（1 行）+ `↓ N new messages` 计数 pill（点击/Enter 回底） | 滚动状态在 pi ScrollView seam |
| B14 | steer/follow-up 未领取区 | P2 / S / 弱化 | busy 状态行队首预览 | 输入框上方分 `⚡steer 区` + `⏳follow-up 区`（`↳` 缩进展示待领消息） | 队列模型扩展（区分 steer/follow-up 两种放置位置） |

## C. 状态观察（远程大幅领先区）

| # | 项 | 优先级/工作量/类型 | 现状（本地） | 方案要点 | 依赖/约束 |
|---|---|---|---|---|---|
| C1 | TPS 仪表 | P1 / M / 缺失 | 统计条有 tok/s 汇总但无实时仪表 | 流式时 1/8 格 gauge + 回合后 min-max sparkline（12 样本）+ 语义色（≥50 绿/≥20 黄/<20 红）；纯渲染函数可单测 | stats.ts 的 tok/s 序列（需保留解码时间戳窗口） |
| C2 | 缓存命中率进状态行 | P1 / S / 缺失 | 统计条已有缓存命中 share | footer/状态行常驻显示缓存命中率（1 位小数） | stats.ts |
| C3 | working-activity 工作状态行动画 | P1 / M / 缺失 | 品牌 shimmer + spinner | 忙碌时状态行播帧动画（8–12 帧预设）+ ice-blue sweep + `⚠ ctx N%` 压力前缀（amber ≥80/red ≥95）+ token 后缀；空闲显示回合摘要 | **约束**：勿 import dsh-working-activity（不在依赖树）——自建帧表 + 状态机（纯函数可测）；动画走现有重绘循环 |
| C4 | context bar 5 段升级 | P2 / M / 弱化 | footer 10 段三段彩条（system/tools/messages） | 升级为 5 段（system/prompt/assistant/thinking/tools 分类着色 + 最大余数法列分配 + 标签自适应收缩 system→sys→s + free 段右对齐读数） | contextBreakdown 数据（G42 已有） |
| C5 | loaded-context 面板（Ctrl+P） | P2 / M / 缺失 | 无 | 转录空时顶部「已加载上下文」折叠摘要（▶/▼）：system prompt 分节/工作区指令/动态上下文/技能目录/工具清单 | 与 A3 共用数据源 |
| C6 | effort 滑杆 | P2 / M / 弱化 | /effort 枚举选择 | 滑杆交互（←/→ 每步实时生效 + 档位名称行 + 当前 ✓）；0/1 档路由不弹滑杆 | llm.resolveModelInfo efforts（已有） |

## D. 会话管理

| # | 项 | 优先级/工作量/类型 | 现状（本地） | 方案要点 | 依赖/约束 |
|---|---|---|---|---|---|
| D1 | /resume 浏览器升级 | P1 / M / 弱化 | picker（列表 + 搜索 + 标题缓存回填） | **决策：核心子集**——① 全屏布局 + 行元数据（时间/分支/大小/模型/子数）；② Tab 预览（宽屏并排）；⑥ 标题证据分级着色；③④⑤（跨项目/删除/子 agent 折叠）不做 | sessionQuery/searchSessions 现有 |
| D2 | 会话 MRU 持久化 | P1 / S / 缺失 | 排序按 listSessions 新→旧 | `tui-mru.json` sidecar（session-id → epoch，LRU 裁剪）驱动 picker 排序 | sidecar 模式现有（tui-*.json） |
| D3 | 会话删除/清理 | P2 / M / 缺失 | 无 | 若 sessionQuery/persistence 有删除缝隙则做（确认行）；无则记录不做 | 服务能力验证 |
| D4 | 子 agent 会话折叠 | P2 / M / 弱化 | 子会话在 picker 内 `↳` 缩进 | 默认折叠 + 计数 + 展开为缩进行（origin 判据） | listSessions 元数据 |

## E. 渲染

| # | 项 | 优先级/工作量/类型 | 现状（本地） | 方案要点 | 依赖/约束 |
|---|---|---|---|---|---|
| E1 | SplitDiffView 分屏 diff | P2 / M / 弱化 | 词级红绿 + hunk 头（B5） | 双栏 diff 渲染（≥110 列时）+ `/settings` diffLayout 选项（auto/split/unified） | diff 数据已有；布局用现有 VStack/HStack |
| E2 | MarkdownTable 表格增强 | P2 / S / 弱化 | pi GFM 子集 | 表格列宽对齐/截断增强（GFM 完整：对齐、转义） | pi Markdown 能力内 |
| E3 | 布局级虚拟化 | P2 / L / 弱化 | O(n) 全量布局（依赖 compaction） | 屏外消息行高度占位（上次测量高度）+ 有界高度缓存；painted-once 纪律（resume 首帧全量挂载） | **约束**：pi 引擎布局 seam 需探明；列为性能记录项优先，不阻塞功能 |
| E4 | 回放合并 + 有界缓存 | P3 / M / 弱化 | 流式合帧 + 条目身份增量更新 | 历史回放合并连续 token chunk；transcript/渲染/测量缓存设上限 | 性能记录项 |

## F. 主题与设置

| # | 项 | 优先级/工作量/类型 | 现状（本地） | 方案要点 | 依赖/约束 |
|---|---|---|---|---|---|
| F1 | 自定义 JSON 主题 | P2 / M / 缺失 | 四预设 × 双明暗（palette.ts 硬编码） | `~/.dsh/tui-themes/<名>.json`：base（light/dark）+ colors 部分覆盖 + 校验（未知键跳过、损坏跳过、路径穿越防护）；`/theme <名>` 热切换 + 持久化；选择器列出自定义主题 | palette.ts 需支持运行时覆盖层（评估：现为构造期烘焙，部分需重启——文档化限制） |
| F2 | dark-ansi 兼容回退 | P3 / S / 缺失 | 无 16 色 ANSI 主题 | 只依赖 16 色 ANSI 的暗色变体 | palette 扩展 |
| F3 | statusBar.* 15 项可配置 | P2 / M / 缺失 | footer/状态行字段固定 | tui 命名空间加 statusBar 组（compact/model/thinking/cwd/contextUsage/cache/tokens/tps/gitBranch/sessionTitle/mode/contextBar/activity/trajectory/shortcutHint），/settings 面板增行 | settings seam + /settings 面板扩展 |
| F4 | 渲染选项（diffLayout/thinkingFold/toolBackground） | P2 / S / 缺失 | — | 三个显示偏好进 tui 命名空间 + /settings 行 | 与 E1/C 联动 |

## G. 平台 / 生态（架构评估组）

> 以下各项受 out-of-tree 约束或需要发布/外部流程支撑，先评估可行性再排期；评估结论
> 记录在本节表格的「约束」列。

| # | 项 | 优先级/工作量/类型 | 方案要点 | 约束/评估要点 |
|---|---|---|---|---|
| G1 | 插件宿主（13 接缝） | P3 / XL / ⛔ 不做 | **决策（2026-08-20）：不做**——记录为定位边界（与 out-of-tree 硬约束冲突） | 插件系统：接缝（快捷键/状态行/托管对话框/决策事件/全屏场景/设置区块/渲染器…）+ 授权 + 存储 | **架构冲突**：AGENTS.md 硬约束「insert 行只能引用 dsh 安装已携带的插件」「不 import 未在 profile 依赖树的 dsh 包」；远程靠挂官方 storage/workspace 等插件实现。评估：能否在约束内提供「进程内扩展注册表」（仅 TUI 内部 API，不经 cordis）——可以的话先做 tuiShortcuts/tuiStatus 两个轻接缝验证 |
| G2 | /update 自更新 | P3 / L / ⛔ 不做 | 见 A20 | **决策：不做**（定位边界） |
| G3 | VS Code companion 扩展 | P3 / XL / ⛔ 不做 | 真实集成终端承载 + 侧栏会话历史 | **决策：不做**（独立仓库 + Marketplace，定位边界） |
| G4 | childStderr 捕获 | P2 / M / 缺失 | patch child_process.spawn 继承 fd2 → pipe 逐行 drain + ANSI 剥离 + 去重折叠（1.5s/30s cooldown）+ 错误色通知 | 进程级 patch，需与 pi/终端集成验证 |
| G5 | promptDebug | P3 / S / 缺失 | 见 A19 | llm seam 可行性 |
| G6 | 退出漏斗加固 | P2 / S / 弱化 | 区分用户退出与 teardown（teardown 只 unmount 不退出进程）；退出还原全部终端状态（光标/鼠标/键盘协议） | pi 终端恢复已有部分，补 teardown 区分 |
| G7 | 输入管线加固 | P2 / S / 弱化 | Enter 去重窗口（防 cmd 管道一次 Enter 报成 Return+CR/LF）、批内同步 ref 镜像 | pi StdinBuffer seam |
| G8 | npm 发布/CI 对齐 | P3 / M / ⛔ 不做 | 发布流 + 版本检查 + 安装向导 | **决策：不做**（定位边界；现有 CI 已覆盖 typecheck/test/build） |

## 批次建议（第一轮实现顺序）

| 批次 | 内容 | 预期收益 | 备注 |
|---|---|---|---|
| 批次 0 ✅（Part B 联动） | B1 Ctrl+Enter、B2 Tab follow-up、B9 Ctrl+X、A11 /rewind、B3 @引用、A1/A2/A4–A8/A23 命令面、A22 /export md、B10 Shift+Tab、B13/B14 | 交互闭环 + 命令面已落地（BACKLOG-CC-PARITY 完成） | — |
| 批次 1（观察与状态） | C1 TPS 仪表、C2 缓存命中率、A3 /context、A18 /tips | 可观察性追平 | 低风险高感知 |
| 批次 2（会话管理） | D2 MRU、D1 浏览器核心子集、A14 /workspace 补齐 | 会话工作流追平 | 依赖 sessionQuery 能力 |
| 批次 3（输入体验） | B5 历史搜索、B6 全文搜索扩展、B7 消息选择模式 | 输入体验追平 | — |
| 批次 4（深度能力） | A9 /provider 向导对齐、A10 /preset、A13 /trace 核心子集、A16 /thinking、A12 /btw | 深度能力追平 | 服务缝隙验证先行 |
| 批次 5（鼠标与图片） | B8 鼠标选区复制、B4 图片附件 | 远程强项补位 | 先探 pi 鼠标事件面与 attachment 缝隙 |
| 批次 6（观察渲染） | C3 工作动画、C4 context bar 5 段、C5 loaded-context、C6 effort 滑杆、E1 分屏 diff、F1 自定义主题、F3/F4 设置项 | 视觉与渲染追平 | — |
| 批次 7（记录项） | E3/E4 性能、A19 /debug-prompt、G4 childStderr、G6/G7 加固 | 记录或缓做 | P3/评估组 |

> 验收通则：每批 `pnpm typecheck` + `pnpm test`（351 项全绿）+ 至少一轮完整 PTY E2E；
> 新事件类型补 `tests/projection.spec.ts` 回归；新文案进 `src/view/strings.ts` 双语。
