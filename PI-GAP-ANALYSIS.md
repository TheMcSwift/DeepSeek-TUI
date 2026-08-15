# PI-GAP-ANALYSIS.md — 对比 Pi agent 的差距清单

> 基线：earendil-works/pi `pi-coding-agent` interactive mode（0.8x，2026-08 核实，
> [usage.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md) +
> 本仓库 PI-ECOSYSTEM.md 组件清单 + 本地 vendored 源码）。
> 与 GAP-ANALYSIS.md（web 基线）互补：web 基线对齐「能力面」，本文对齐「终端交互形态」。
> 状态列：✅ 已覆盖 · 🟡 部分覆盖 · ❌ 缺失 · ⛔ 终端不可行/不建议。

## A. 输入与编辑器

| # | Pi 能力 | Pi 实现 | DSH TUI 现状 | 状态 |
|---|---|---|---|---|
| A1 | `!command` 执行 shell 并把输出发给模型 | composer 拦截 `!` | 无（`!` 会当普通文本发出去） | ❌ |
| A2 | `!!command` 静默执行（输出不进模型） | 同上 | 无 | ❌ |
| A3 | Ctrl+G 外部编辑器撰写长消息 | `$VISUAL`/`$EDITOR`/nano 临时文件 | 无 | ❌ |
| A4 | Ctrl+X 复制最后一条回复 | pi 剪贴板模块（OSC52） | 无（终端原生选择复制） | ❌ |
| A5 | `@` 模糊搜索文件 | fuzzy | `@/#` 前缀补全（pi-tui CombinedAutocompleteProvider） | ✅ 近似 |
| A6 | Shift+Enter 多行 | — | ✅ | ✅ |
| A7 | Ctrl+V 粘贴图片/拖拽 | kitty 图像协议 | read_image 占位行 | ⛔ 终端限制 |

## B. 消息队列（Pi 的队列语义比我们丰富）

| # | Pi 能力 | Pi 实现 | DSH TUI 现状 | 状态 |
|---|---|---|---|---|
| B1 | **Enter = steering 消息**（当前轮工具调用完成后投递） | `steeringMode` | 单一 follow-up 队列（turn 结束后投递） | 🟡 |
| B2 | **Alt+Enter = follow-up 消息**（全部工作完成后投递） | `followUpMode` | 即我们的队列语义 | ✅（绑定到 Enter） |
| B3 | **Esc 中止并恢复队列消息到编辑器** | 队列回取 | 无（Ctrl+C 只取消当前轮，队列保留） | ❌ |
| B4 | **Alt+Up 逐条取回队列消息** | 队列回取 | 无 | ❌ |
| B5 | 投递模式可配置 | `/settings` | 固定语义 | 🟡 |

> DSH 侧 `agent.steer(message)` 已存在（/plan 命令在用），steering 队列可行。

## C. 会话管理

| # | Pi 能力 | Pi 实现 | DSH TUI 现状 | 状态 |
|---|---|---|---|---|
| C1 | `/name <名称>` 会话命名 | 显示名 | 无（标题由 DSH 自动生成） | ❌（DSH 无 rename API，可 sidecar 或跳过） |
| C2 | `/session` 会话信息（文件/ID/消息数/tokens/成本） | 信息面板 | footer 有 tokens/消息数，无集中面板 | 🟡 |
| C3 | `/tree` 会话树：任意点跳转、废弃分支摘要 | 会话树 | Ctrl+B fork（新会话）+ 搜索 + Ctrl+K 折叠 | 🟡 近似 |
| C4 | `/clone` 复制当前分支为新会话 | 分支复制 | 无（fork 需选消息点；无边界 fork ≈ clone，可补） | ❌ 小 |
| C5 | `/import <jsonl>` 导入并续跑会话 | JSONL 导入 | 无（DSH 持久化有 load 路径，import 语义待验证） | ❌ 待验证 |
| C6 | CLI：`-c` 继续最近会话 / `-r` 启动浏览 / `--no-session` 临时 / `--name` / `--fork` | 启动参数 | 仅 `--resume <id>` | 🟡 |
| C7 | `/share` 私有 gist 分享 | 网络服务 | 无 | ⛔（网络面，DSH 无对应） |
| C8 | `/export` HTML | 渲染器 | 仅 jsonl 路径展示（HTML 导出可补） | 🟡 |

## D. 显示与渲染

| # | Pi 能力 | Pi 实现 | DSH TUI 现状 | 状态 |
|---|---|---|---|---|
| D1 | **Mermaid 图渲染** | markdown-transform 的 mermaid 钩子（终端 ASCII 渲染） | 剥离掉了（vendor 时删） | ❌ |
| D2 | **主题自动明暗检测** | theme-controller（OSC 11 查询终端背景） | 仅 `DSH_TUI_THEME` env | ❌ |
| D3 | **thinking 分级着色**（L1/L2/L3 递减亮度） | 主题 thinking 色阶 | 仅 Ctrl+T 开/关，无分级 | 🟡（INTERACTION-PLAN 1.4 欠账） |
| D4 | Startup header 上下文清单（context 文件/模板/skills/扩展） | 启动横幅 | 注入行 ✅（逐条），无汇总清单 | 🟡 |
| D5 | 成本显示（footer cost） | usage.cost | 无（pi-ai 合成填 0；DSH usage 是否带 cost 待查） | ❌ 低价值 |
| D6 | 自定义消息/技能调用消息渲染 | skill-invocation-message/custom-message | skill-catalog 注入行 ✅ | ✅ 近似 |

## E. 设置与命令

| # | Pi 能力 | Pi 实现 | DSH TUI 现状 | 状态 |
|---|---|---|---|---|
| E1 | `/settings`（thinking 级别/主题/投递模式） | 设置面板 | Ctrl+T + `DSH_TUI_THEME` env + 固定队列 | 🟡 |
| E2 | `/hotkeys` 全部快捷键 | 帮助面板 | footer 静态提示 | 🟡 小 |
| E3 | `/model`（含 scoped-models，Ctrl+P 循环切换模型） | 模型选择器 | Ctrl+G 模型 picker ✅ + effort 二级 ✅ | ✅（pi 的 Ctrl+P 与我们的预设键位同名不同义） |
| E4 | 凭据管理 /login /logout | OAuth | DSH 凭据走 env/credentials 服务 | ✅ 等价（无 UI，YAML/env） |

## F. 运行时能力（非 UI 差距，确认等价）

子代理（Task 工具）、MCP、web 搜索、skills、plan 模式、compaction、持久化 resume —— 双方都有；
DSH 另有 goal 体系、审批瀑布、权限预设、后台任务、消息反馈、协议层（ACP）——Pi 无对应。

---

## 建议实施批次（T5，按价值排序）

| 项 | 内容 | 状态 |
|---|---|---|
| T5① | `!command`/`!!command` shell 注入（cross-spawn 30s 超时，可见→模型、静默→notice） | ✅ |
| T5② | 队列细化：Alt+Enter steer（`agent.steer`）+ Esc(busy)/Alt+Up 取回队列（LIFO） | ✅ |
| T5③ | 主题自动明暗检测（`DSH_TUI_THEME=auto` 显式启用 OSC 11 探测 + 300ms 回退；默认 dark——避免与 TUI 的 stdin raw-mode 交接竞态） | ✅ |
| T5④ | thinking 分级着色（thinkingL1/L2/L3 色阶） | ✅ |
| T5⑤ | Ctrl+X OSC52 复制 + /hotkeys 帮助 | ✅ |
| T5⑥ | Mermaid 终端渲染（grok-mermaid + vendor pi transformer） | ✅ |
| T5⑦ | CLI：-c/-r/--no-session + /clone（forkSession fallbackLast） | ✅ |
| 附加 | 命令面板锚定输入块上方 + 面板/弹窗/header/聚焦帧视觉打磨 | ✅ |
| 跳过 | 图片粘贴、/share、/login UI、HTML 导出、成本显示、--name（DSH 标题自动生成） | ⛔/低价值 |

## 修订记录

- 初稿：以 pi usage.md + PI-ECOSYSTEM 组件清单为基线完成盘点，定义 T5。
