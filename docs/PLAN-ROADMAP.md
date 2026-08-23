# PLAN-ROADMAP.md — 未动工 backlog 全量实现规划（路线图）

> 范围：所有**已计划但未开工**内容——BACKLOG-FEATURE-GAP 批次 1–7 +
> 批次外条目（B12/A15）、BACKLOG-CC-VISUAL-PARITY 剩余（V3/V4/V5/V7/V8）、
> BACKLOG-CC-PARITY 剩余（Ctrl+J 兜底）、BOUNDARY-DESIGN 边界结论中的
> 独立项（A21 技能包）与唯一随插件注册项（tui 手册技能，专项规划见
> [PLAN-BUNDLED-SKILL.md](PLAN-BUNDLED-SKILL.md)）。
> 排序原则（沿用 2026-08-20 用户拍板）：**高价值优先**（P1 + 高感知先）、
> **低风险高感知先行**、**缝隙验证先行**（依赖 dsh 服务能力或 seam 的项先探再排）。
> 边界判定：每条标注「内部」或「独立」（判据见 [BOUNDARY-DESIGN.md](BOUNDARY-DESIGN.md) §2）。
> 状态：🕐 未开工。验收通则：每批 `pnpm typecheck` + `pnpm test`（351 全绿）+
> 至少一轮完整 PTY E2E；新事件补 `tests/projection.spec.ts`；新文案进
> [src/view/strings.ts](../src/view/strings.ts) 双语。
> ⚠️ 前置工作：**本路线图所有批次开工前，先完成阶段 1 的第 1 项（tui 手册注册）**——
> 它让 `/skills` 里的来源（custom/user/project）可肉眼验证，是最便宜的经验探针。

---

## 阶段 1 · 基础批（无外部依赖、低风险高感知，建议先做）

| # | 项 | 优先级/量 | 边界 | 前置 | 验收要点 |
|---|---|---|---|---|---|
| 1 | tui 手册技能随插件注册 | P0 / S | 内部（唯一例外） | 无 | ✅ 已落地（2026-08-22）：`--dump-config` 见 customSkillDirs；`/skills` 出现 tui（custom 源）；任意 cwd 可用。**专项规划：[PLAN-BUNDLED-SKILL.md](PLAN-BUNDLED-SKILL.md)** |
| 2 | C1 TPS 仪表（流式 1/8 格 gauge + 回合 min-max sparkline，12 样本，语义色） | P1 / M | 内部 | stats.ts tok/s 窗口序列 | ✅ 已落地（2026-08-22）：`decodeSamples` + `liveGauge`/`sparkline` 纯函数（chars≈4 tok 近似），busy 行 `▰▰▱▱… N tok/s`（≥50 success/≥20 warning/<20 error），回合后条目 footer 加 sparkline |
| 3 | C2 缓存命中率进状态行（1 位小数常驻） | P1 / S | 内部 | stats.ts | ✅ 已覆盖（E2 统计条，2026-08-22 判定）：web `StatsLine` 为整数口径（`roundedIntegerPercent`），本地统计条含 `缓存命中 N%`，保持 web 对齐、不改为 1 位小数 |
| 4 | A3 `/context` loaded-context 明细（system prompt 分节/工作区指令/动态上下文/技能目录/工具清单，各自截断） | P2 / M | 内部 | 注入行数据源（E12） | ✅ 已落地（2026-08-22）：`contextReport` 纯函数按 kind 分组注入行 + `/context` 命令（notice + Enter 展开全文） |
| 5 | A18 `/tips` 提示面板（精简 5 组：快捷键/命令/工作流/个性化/避坑，中英双语） | P2 / S | 内部 | strings.ts | ✅ 已落地（2026-08-22）：`TipsPanel` 覆盖面板 + `/tips` 命令；splash 首屏轮换缓做（装饰性，避免快照脆化） |
| 6 | V3 thinking `Thinking for Ns` 实时计数 + CC 式 ≤10 行折叠 | P1 / M | 内部 | 现有 thinking 渲染 | ✅ 已落地（2026-08-22）：折叠行 `Thinking for Ns`（流式实时/committed 定格，`setThinkingClock` 时钟窗口）；≤10 行摘要保持现有单行折叠 + 分级着色（记录于 BACKLOG-CC-VISUAL） |
| 7 | V4 输入框 `❯` 前缀 + 权限语义边框色（pi `borderColor`，cc 预设） | P1 / M | 内部 | pi Editor seam（borderColor 已确认可用） | ✅ 部分落地（2026-08-22）：边框色随权限语义（cc 预设，`editor.borderColor` 运行时赋值；pi 还原主题边框）；**`❯` 前缀与 B15 同受限**（无 prompt 槽，包装影响 editor 宽度/光标锚定） |
| 8 | V5 `↓ N tokens` 后缀（busy 行，usage.outputTokens 累计） | P1 / M | 内部 | 流式 outputTokens 可用性评估 | ✅ 已落地（2026-08-22）：cc 预设 busy 行 ` · ↓ N tokens`（decodeSamples 字符累计/4 近似——流式无逐 token usage，评估结论：近似展示） |

## 阶段 2 · 会话与输入

| # | 项 | 优先级/量 | 边界 | 前置 | 验收要点 |
|---|---|---|---|---|---|
| 9 | D2 会话 MRU 持久化（`tui-mru.json`，LRU 裁剪） | P1 / S | 内部（TUI 私有偏好） | sidecar 模式现有 | ✅ 已落地（2026-08-22）：`tui-mru.json`（epoch、LRU 300 裁剪）；records 先按 MRU 排序再 map（回填索引对齐） |
| 10 | D1 `/resume` 浏览器核心子集（全屏布局 + 行元数据 时间/分支/大小/模型/子数 + Tab 预览 + 标题证据分级着色） | P1 / M | 内部 | sessionQuery/searchSessions | ✅ 轻量子集（2026-08-22）：行元数据 = 相对时间 + agentPreset + 子会话计数（仅 header 字段，不深读日志）；**省略项**：模型/大小（需深读日志，代价高）、Tab 宽屏预览（需 picker 宽屏布局）、标题证据分级着色（缓存命中即准确显示）——记录为后续增强 |
| 11 | A14 `/workspace resume\|rename\|open` 补齐（子命令解析 + `open` 绝对/相对/`file://` URI 并新建会话） | P1 / M | 内部 | workspace.ts 现有逻辑 | ✅ 已落地（2026-08-22） |
| 12 | B5 Ctrl+R 输入历史搜索（⌕ 搜索框 + 相对时间 + Enter 回填） | P2 / S | 内部 | tui-history.json | ✅ 已落地（2026-08-22）：Alt+R（Ctrl+R 已被会话/重命名占用），showChoicePicker 弹层 + 回填输入框（最近优先）；相对时间略（历史行无时间戳） |
| 13 | B6 全文搜索扩展（用户/助手/思考/**工具参数与结果**/local 输出；n/N 跳转） | P2 / M | 内部 | 文档条目数据源 | ✅ 已落地（2026-08-22） |
| 14 | B7 Shift+Up 消息选择模式（↑/↓ 移动、Enter 展开单条、Esc 退出） | P1 / M | 内部 | 与 Tab 焦点环交互优先级定义 | ✅ 已落地（2026-08-22） |
| 15 | B12 `!` 本地命令行渲染（转录加 `local` 命令 echo + `local-output` 缩进 dim） | P2 / S | 内部 | 拦截逻辑已有 | ✅ 已落地（2026-08-22） |
| 16 | V7 会话标题 chip 落到输入区下方（确认而非改形态） | P2 / S | 内部 | — | ✅ 已确认（2026-08-22） |
| 17 | V8 footer/status line 对齐 CC（配置化 + 右对齐徽标） | P2 / M | 内部 | — | ✅ 已落地（2026-08-22，与 F3 合并）：footer 三档 full/compact/minimal（V8 视觉部分 = compact 档去掉路径/计数；右对齐徽标为终端 CSS-less 呈现，不适用） |
| 18 | F3 statusBar.* 15 项可配置（tui 命名空间 + /settings 行） | P2 / M | 内部 | settings seam | ✅ 已落地（2026-08-22）：**15 项简化为三档**（full/compact/minimal——footer 是统计条整行 + facts 行结构，逐项开关与现有布局不匹配；档位模式与 BACKLOG 配置目标等价），/settings 行 + tui 命名空间持久化 + 启动回填 |
| 19 | F4 渲染选项（diffLayout/thinkingFold/toolBackground 三偏好进 /settings） | P2 / S | 内部 | settings seam | 🕐 与 E1 同批（diffLayout 依赖分屏 diff 落地；thinkingFold/toolBackground 与现有折叠语义确认后随行） |
| 17 | V8 footer/status line 对齐 CC（配置化 + 右对齐徽标） | P2 / M | 内部 | — | 与 F3 设置项联动；cc 预设视觉确认 |
| 18 | F3 statusBar.* 15 项可配置（tui 命名空间 + /settings 行） | P2 / M | 内部 | settings seam | 15 项开关生效；/settings 面板行；持久化 |
| 19 | F4 渲染选项（diffLayout/thinkingFold/toolBackground 三偏好进 /settings） | P2 / S | 内部 | settings seam | 三选项即时生效；与 E1 联动 |

## 阶段 3 · 深度能力（缝隙验证先行）

| # | 项 | 优先级/量 | 边界 | **前置验证** | 验收要点 |
|---|---|---|---|---|---|
| 20 | A10 `/preset` Agent preset 选择器 | P1 / M | 内部 | ⚠️ 验证 `dsh-agent-presets` 服务可 `ctx.get` 结构读取；不可行→降级「选择持久化 + 提示」 | 🕐 记录降级（2026-08-22 探针）：`agentPresets` 服务注册在 **agent 组合**（agent.cordis.yml），主组合（TUI profile）不可读；且 `/preset` 命令名已被「键位+主题一键切换」占用——不做新命令，保持现状+文档说明 |
| 21 | A9 `/provider` 向导（**克制版**：直切 + 简单表单；数据层走 dsh settings 服务） | P1 / M | 内部（克制） | ⚠️ 确认 settings 服务可写 credentials（0600）；不可→保持 /config 现状并记录 | ✅ 判定已覆盖（2026-08-22 探针）：`/config` 的 `addProviderWizard`（K2）即克制版（路由→字段→settings.update 写入并热生效）；BACKLOG 的 9 步深度向导（探测/回滚/多选）不引入 |
| 22 | A13 `/trace` 核心子集（查询语言 tool:/kind:/turn:/err:/run:/>10s/tok>1k，AND + 命中高亮；`[`/`]` 跳失败点、`{`/`}` 跳轮次） | P1 / M | 内部 | 无 | ✅ 已落地（2026-08-22）：`matchTraceQuery` 纯函数（`tool:`/`kind:`/`turn:`/`err:` 前缀 + 关键词 AND）；面板 `[`/`]`（错误行）与 `{`/`}`（轮次边界）跳转；**省略**：`>10s`/`tok>1k`（行为行无结构化时长/token 字段——探针记录）、命中高亮（回退文本匹配，打磨项） |
| 23 | A16 `/thinking` 命令（Enabled/Disabled 选择，不持久化） | P2 / S | 内部 | 复用 Ctrl+T 逻辑 | ✅ 已落地（2026-08-22）：`/thinking` 弹层（Enabled/Disabled）+ `setHideThinking` 接口（与 Ctrl+T 共用 applyThinking） |
| 24 | A12 `/btw` 侧问（无工具单轮 LLM + 浮层；不写日志、不计 token、busy 可触发不打断） | P1 / M | 内部 | ⚠️ 确认 llm 服务可 stream 且不污染 agent 循环 | ✅ 已落地（2026-08-22）：探针确认 llm.stream 可直调（`@deepseek-ai/dsh-llm` 在依赖树）；`/btw [问题]`（裸命令弹问句）→ 当前模型流式进 `BtwPanel` 浮层（`c` 复制/`Esc` 关）；再次触发中止上一个（AbortController）；不写日志（浮层瞬态，不进 fold） |
| 25 | D4 子 agent 会话折叠（默认折叠 + 计数 + 展开缩进） | P2 / M | 内部 | listSessions 元数据 | 🕐 未开工 |
| 26 | D3 会话删除/清理 | P2 / M | 内部 | ⚠️ 验证 sessionQuery/persistence 删除缝隙；无→记录不做 | ✅ 记录不做（2026-08-22 探针）：session-query/session-persistence 均**无公开删除 API**（coordinator 仅内部 livemap 清理）——与 BACKLOG 预判一致 |

## 阶段 4 · 渲染观察与主题

| # | 项 | 优先级/量 | 边界 | 前置 | 验收要点 |
|---|---|---|---|---|---|
| 27 | C4 context bar 5 段（system/prompt/assistant/thinking/tools 分色 + 最大余数法分配 + 标签自适应收缩 + free 段读数） | P2 / M | 内部 | contextBreakdown（G42 已有） | ✅ 记录数据源限制（2026-08-22 探针）：token-meter `contextBreakdown` 仅三段（system/tools/messages），无 prompt/assistant/thinking 细分——5 段不可行；保持 G42 三段 10 段彩条 + ctx % 读数 |
| 28 | C5 loaded-context 面板（转录空时顶部折叠摘要，与 A3 共用数据源） | P2 / M | 内部 | A3 数据源 | ✅ 判定等价覆盖（2026-08-22）：E12 注入行逐条可见 + A3 `/context` 全量报告——空会话用户已能感知加载内容，不重复实现折叠摘要 |
| 29 | C6 effort 滑杆（←/→ 每步实时生效 + 档位名 + 当前 ✓；0/1 档不弹滑杆） | P2 / M | 内部 | llm.resolveModelInfo efforts | ✅ 判定等价覆盖（2026-08-22）：/effort 现为 askDialog 数字直选（档位名 + 当前标记 + 1/2 直选）；滑杆为远程外观打磨，且 effort 无实时预览闭环（下次请求才生效） |
| 30 | E1 SplitDiffView 分屏 diff（≥110 列双栏 + /settings diffLayout auto/split/unified） | P2 / M | 内部 | diff 数据已有；F4 联动 | 🕐 暂缓（2026-08-22 判定）：仅 ≥110 列宽生效（多数终端 <110），收益低；diffLayout 设置面随 E1 联动——随宽屏需求再排 |
| 31 | C3 工作动画 + A15 `/activity` 帧动画系统（内置 8–12 帧预设 + 选择器 + 持久化；自建帧表勿 import 官方包） | P1 / M | 内部（模块 + 交换缝） | **约束**：dsh-working-activity 不在依赖树→独立 `src/working-activity/` 纯函数帧表 | ✅ 已落地（2026-08-22）：`src/app/pi/frames.ts` 自建帧表（star/moon/dots，纯数据+标识符解析）；StatusSlot.setFrames 换帧（busy 中重建重启）；`/activity`（选择器）+ `frames <id>` 直切 + tui 命名空间持久化 + 启动回填；**C3 其余**：`⚠ ctx N%` 压力前缀（≥80 amber/≥95 red，busy 行）✅；ice-blue sweep 已有 shimmer ✅；token 后缀即 V5 ✅；空闲回合摘要省略（stats footer 已有） |
| 32 | F1 自定义 JSON 主题（`~/.dsh/tui-themes/<名>.json`：base + colors 覆盖 + 校验 + `/theme` 热切换） | P2 / M | 机制内部/内容独立 | palette.ts 运行时覆盖层评估 | ✅ 已落地（2026-08-22）：`tui-themes/<名>.json`（colors 覆盖，已知语义角色 + 合法 hex 才收，损坏/未知跳过，文件名路径穿越防护）；palette 覆盖层 `applyCustomThemeColors`/`customColor`（resolveHex 优先）+ `/theme <名>` 热切换/选择器列出（自定义在前）+ 持久化（theme-preset.txt）+ 启动回填；**base（light/dark）简化记录**：沿用当前预设明暗（覆盖层语义） |
| 33 | F2 dark-ansi 16 色兼容回退 | P3 / S | 内部 | palette 扩展 | 🕐 暂缓（P3 远期，现代终端 truecolor 普及，收益极小——记录） |
| 34 | B11 终端 tab 标题动画（`⠂/⠐ 🐋 <标题>` 仅聚焦 + 空闲 `✦`；OSC 设置） | P3 / S | 内部 | header 数据已有 | 🕐 暂缓（P3 打磨——记录） |

## 阶段 5 · 独立包与大工程

| # | 项 | 优先级/量 | 边界 | 前置 | 验收要点 |
|---|---|---|---|---|---|
| 35 | A21 打包技能（7 个：audit/bug/review/practice/pr_comments/release-notes/vuln-check，按本地风格裁剪） | P2 / L | **独立技能包** | 注册缝隙已验证（用户级 `~/.dsh/skills/<名>/` 或 `customSkillDirs`，BOUNDARY §3.2） | 7 个 SKILL.md（front matter 规范）+ 安装脚本/文档（同名覆盖语义）；**不含 tui 手册（例外，阶段 1）**；技能内容本地化评审 |
| 36 | B4 图片附件（剪贴板位图/图片文件；附件库 + `[Image #N]` + 图片文件转 `@` 引用；降级临时文件引用） | P2 / L | 内部（数据走 dsh 服务） | `dsh-attachment-local` 已挂载 ✅；剪贴板协议（OSC 52/53）评估 | **需专项设计文档**（先于实现）：附件库交互、`[Image #N]` 装饰、粘贴路径、渲染；E2E（mock LLM + 图片引用） |

## 阶段 6 · 记录项与外部依赖（缓做/暂缓）

| # | 项 | 优先级/量 | 边界 | 阻塞 | 备注 |
|---|---|---|---|---|---|
| 37 | E3 布局级虚拟化 / E4 回放合并 + 有界缓存 | P3 / M·L | 内部 | pi 引擎布局 seam 需探明 | 性能记录项，不阻塞功能 |
| 38 | A19 `/debug-prompt`（llm/stream 边界快照 ≤8 个，原子写 0600） | P3 / S | 内部 | ⚠️ llm seam 可行性 | 捕获点需在 llm 服务 seam |
| 39 | G4 childStderr 捕获（patch spawn fd2 → pipe + ANSI 剥离 + 冷却合并） | P2 / M | 内部 | 进程级 patch 与 pi/终端集成验证 | 需专项验证 |
| 40 | G6 退出漏斗加固 / G7 输入管线加固 | P2 / S | 内部 | — | teardown 区分 + Enter 去重窗口 |
| 41 | 转录区搜索（会话内全文搜索） | — | 内部 | **pi-tui 0.84.1 alt-screen 无搜索（main 分支才有）** | 等上游发布后纯接线 |
| 42 | B15 输入框圆角边框 + `❯` 完整形态 | P2 / L | 内部 | **pi Editor seam：边框内部绘制、无 prompt/圆角选项** | 暂缓；阶段 1 的 V4 已覆盖部分（`❯` + borderColor） |
| 43 | G44 反馈 sidecar 下沉（dsh storage 域插件） | — | 下沉 | **dsh 未开放 storage 域挂载（out-of-tree 约束）** | 等 dsh 开放即做；现 sidecar 已文档标注 |
| 44 | Ctrl+J / Option+Enter 换行兜底确认 + B19/CC 剩余 P3 项 | P3 / S | 内部 | — | 纯确认性小项 |

## ⛔ 明确不做（定位边界，不进路线图）

A17 `/clear` 独立清屏、A20 `/update`、G1 全量 13 接缝插件宿主、G2/G3/G8（VS Code 扩展/发布）、
G44 之外的所有「平台生态」项 —— 记录于 BOUNDARY-DESIGN.md §3.4 与 BACKLOG 各 ⛔ 行。

---

## 执行建议

1. **阶段 1 先行**（1–8 项，约 2–3 个功能批）：tui 手册注册先探路（1 项），随后批次 1 观察类
   （2–5 项）与 cc 视觉补齐（6–8 项）可并行两批；
2. **每阶段开批前的微探针清单**：阶段 3 的 20/21/24/26 需先做缝隙验证（约 30 分钟/项），
   验证结论写回对应 BACKLOG 行的「约束」列；
3. **阶段 5 需专项设计后开工**：35（技能包：内容创作为主）、36（附件：交互与存储设计先行）；
4. 外部依赖项（41/42/43）挂起自动激活——pi/dsh 上游发布时按「纯接线」执行；
5. 每批合入都按 AGENTS.md 验收通则，批次拆合建议 2–4 项/批。
