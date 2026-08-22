# DeepSeek-TUI

`dsh --profile tui`：给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）加上**终端聊天界面**。安装一个插件，在终端里与智能体持续对话——审查工具执行、随时插话、排队追问，交互体验与官方 web 客户端对齐，但不需要浏览器。

`dsh` 的 headless 形态适合一次性任务（提交即跑、结果进 stdout）；需要持续会话时，用 `dsh --profile tui`。

[English version](README_EN.md) · 功能对照清单 [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) · 选择建议见 [和其他 dsh 客户端怎么选](#和其他-dsh-客户端怎么选)

---

## 特色

**与官方 web 同一套智能体**：会话记录、设置、权限/计划/工作流插件全部共享——终端里聊的就是 web 里那个智能体，不经过 HTTP 中转，无功能降级。

**交互与文案逐项对齐 web**：以官方 web 客户端为功能基线，148 项功能逐项对照（覆盖率 ≈ 93%）；双语界面（zh/en）文案逐字复用、视觉配色取自 web 实现，状态区布局同源——终端体验向 web 看齐，而不是另造一套。

**渲染与工具执行可视化**：流式 Markdown、推理块分级着色、代码高亮、TeX 数学、Mermaid 图；工具执行卡片——终端卡（退出码）、Read 高亮卡、grep/glob 分组卡、web_search 引用卡、`run_code` 子调用树；产物文件 OSC 8 链接（Cmd 点击打开）。

**安装即用，不碰 dsh 本身**：以插件形式挂载到 `tui` profile，不改 dsh 源码、不打依赖补丁；渲染引擎 pi（earendil-works 开源终端 UI 库）以 vendor 快照形式内嵌，版本固定、升级可控。

**键盘驱动**：Tab 焦点环 + Enter 展开/收起（思考块/工具卡/长消息）；Ctrl+Enter 打断并发送、Shift+Tab 会话模式循环（默认/计划/完全访问）；三套键位预设——Claude Code / pi / OpenCode 风格（`/keymap` 切换）；`/model`、`/permission` 支持枚举选择，也可带参数直接切换；@ 文件引用补全（发送时自动附加内容）、`$EDITOR` 编辑配置与当前输入、命令别名、OSC 52 复制。

**会话级面板**：goal / todo / jobs / workflow 运行树（run→member 完整层级）；`/status`、`/tokens`、`/cost` 会话信息；`/config` 供应商管理（列表 / 添加向导 / `$EDITOR` 编辑 settings.yaml）。

## 安装

**前置要求**：可用的 dsh 环境（Node ≥ 22.19、pnpm）。

```bash
# 从 npm 安装（推荐）
dsh plugin --profile tui add @mcswift/dsh-tui

# 本地开发：挂载源码（lib/ 是 profile 的加载入口，改完 pnpm build 生效）
git clone https://github.com/TheMcSwift/DeepSeek-TUI.git
dsh plugin --profile tui add link:/path/to/DeepSeek-TUI
cd DeepSeek-TUI && pnpm install && pnpm build
```

安装即自带 **`/tui` 操作手册技能**（`/` 菜单可入、`/skills` 可见）：由本 bundle 的
`cordis.patch.yml` 注册进 dsh 技能 registry（custom 源，任意 cwd 可用，随包版本同步）。

## 快速开始

```
$ dsh --profile tui                     # 新会话
$ dsh --profile tui --resume <id>       # 恢复指定会话
$ dsh --profile tui -c                  # 恢复最近会话
$ dsh --profile tui                     # 默认 regular 渲染：主屏输出留在终端 scrollback（无应用内滚动/鼠标，`[` 导出转录）
$ dsh --profile tui --fullscreen         # 切回 alt-screen 视口模式（旧的默认：应用内滚动/鼠标/搜索跳转）
```

```
dsh tui — DeepSeek Harness 终端客户端
Esc/Ctrl+C 中断（busy） · Ctrl+C 再按退出（idle） · Ctrl+Enter 打断并发送 · / 斜杠菜单 · Ctrl+/ 命令面板
Ctrl+R 会话 · Ctrl+G 模型 · Ctrl+P 权限预设 · Ctrl+F 搜索 · Ctrl+B 分支 · Ctrl+Y 评分
Ctrl+X 用 $EDITOR 编辑输入 · Ctrl+W 工作区 · Ctrl+T 思考 · Ctrl+K 折叠 · Ctrl+E 退出 plan
Ctrl+O jobs 折叠/展开 · Ctrl+L 轨迹 · Alt+Enter 插话 · Alt+Up 取回队列 · Tab 焦点环/follow-up · Enter 发送（busy=steer）/展开收起
```

## 使用

### 命令

| 命令 | 说明 |
|---|---|
| `/new` `/quit` `/clone` `/hotkeys`(`?`) | 会话控制 |
| `/rename <标题>` | 固定会话标题（替代自动生成） |
| `/queue` | 查看排队消息：逐项取回或删除 |
| `/effort` `/lang` `/rate` `/export`(`[md]`) | 推理强度 / 语言 / 评分 / 导出会话日志（`md`=Markdown 分节文件） |
| `/model [provider/model]` | 切换模型：不带参数打开枚举选择，带参数直接切换 |
| `/permission [预设]` | 切换权限预设：不带参数打开枚举选择，带参数直接切换（full-access 有确认） |
| `/config` | 供应商列表 / 添加供应商向导 / 预览与 `$EDITOR` 编辑 settings.yaml |
| `/status` `/tokens` `/cost` `/doctor` `/init` `/agents` `/skills` | 状态与诊断（notice + Enter 展开全文） |
| `/mcp` `/permissions` `/login` `/logout` `/add-dir` `/hooks` `/vim` `/terminal-setup` `/connect` | 策略/平台说明（DSH 能力说明或占位） |
| `/resume`(`/r`) `/rewind` `/trajectory` `/settings` `/plugins` `/workspace` `/theme` `/keymap` `/preset` `/compose` | 更多 TUI 命令（Ctrl+/ 面板统一浏览；`/rewind` 回退到一条用户消息：fork 分支 + 原消息回填输入框，空输入双击 Esc 同入口） |
| `/goal /plan /compact …` | profile 注册的命令 |

**命令别名**：`exit`→`quit` · `clear`→`new` · `?`→`hotkeys` · `r`→`resume` · `m`→`model` · `perm`→`permission` · `language`→`lang`（在斜杠解析链生效，菜单仍显示主名）。

### 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_TUI_DEBUG` | `1` 输出事件/渲染调试日志 |
| `DSH_TUI_ANIM` | `0` 冻结品牌 shimmer 与 spinner 动画 |
| `DSH_TUI_THEME` | `light`/`dark`/`auto`（跟随终端背景色） |
| `DSH_TUI_THEME_PRESET` | `web`/`cc`/`pi`/`opencode` 视觉主题预设（`/theme` 同功能） |
| `DSH_TUI_KEYMAP` | `cc`/`pi`/`opencode` 键位预设（`/keymap` 同功能） |
| `DSH_TUI_LANG` | `zh`/`en`（`/lang` 运行时可切换） |
| `DSH_TUI_ENTER` | `steer`：busy 时按 Enter 直接插话；默认 `queue`（入队等待） |
| `DSH_TUI_MOUSE` | `1` 开启 TUI 内鼠标（选区复制/滚轮滚动消息列表）；**默认关闭**——右键/滚轮归宿主终端（Warp 原生菜单/scrollback），键盘 PgUp/PgDn 滚动照常 |
| `DSH_TUI_REGULAR` | `1` 显式开启 regular 渲染模式（**默认即 regular**）——主屏输出留在终端 scrollback，`[` 可随时导出转录供 Cmd+F 搜索 |
| `DSH_TUI_FULLSCREEN` | `1` 切回 fullscreen 视口模式（同 `--fullscreen`，2026-08-20 前的默认）——应用内滚动/鼠标/搜索跳转 |
| `DSH_TUI_WARP_NOTIFY` | `off` 关闭 Warp 通知（OSC 777） |

### 和其他 dsh 客户端怎么选

| 选择 | 适用场景 | 说明 |
|---|---|---|
| 官方 web 客户端 | 浏览器、富交互（图像/拖拽/表单） | 全功能基线 |
| **本 TUI**（进程内） | 终端里与 web 同栈同数据 | 同一份会话/设置/插件；必须跑在 dsh 安装的机器上 |
| 远程 HTTP 系 TUI（[dsh-tui/dsh-tui](https://github.com/dsh-tui/dsh-tui)、[MashedPotato817/dsh-tui](https://github.com/MashedPotato817/dsh-tui) 等） | 任意机器连远端 dsh host | 交互风格自成一派，与 web 不同栈；支持 Vim 模态编辑等 |

**我们的取舍**：本 TUI 只跑在 dsh 安装本机（无远程模式）；pi 版本固定（0.84.1 vendor 快照），上游修复需手动跟进；浏览器能力（图像/拖拽/设置表单）以终端形态降级——图片→占位行、设置页→`/config`；默认 regular 渲染（输出留在终端回滚），应用内搜索跳转/滚动不可用（可用终端原生 Cmd+F），`--fullscreen` 切回视口模式。

## 给开发者

**数据流**：`SessionEvent → fold() → ViewDocument → app.render()` 单向流转；`fold()` 是纯函数（无 cordis/pi 依赖），每个新事件类型在 `tests/projection.spec.ts` 补回归。

**out-of-tree 约束**：`cordis.patch.yml` 是**必填声明**（缺失直接报错）；insert 行只能引用 dsh 安装已携带的插件。更多见 [DESIGN.md](DESIGN.md) §10 与 [ARCHITECTURE.md](ARCHITECTURE.md)。

```bash
pnpm typecheck        # 严格类型检查
pnpm test             # vitest 单测（395 项）
pnpm build            # tsc 构建到 lib/
python3 scripts/e2e-pty.py           # 9 场景 PTY 端到端（真实 dsh + mock LLM）
python3 scripts/e2e-pty.py --only-questions   # 单场景
```

### 文档导航

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 总体结构：模块职责、边界与依赖方向 |
| [DESIGN.md](DESIGN.md) | 设计契约与实施修订史（§10 out-of-tree 约束） |
| [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) | dsh web 功能对齐基线（148 项逐包审计） |
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) · [PI-GAP-ANALYSIS.md](PI-GAP-ANALYSIS.md) | 基线差距审计 |
| [COMMUNITY-COMPARISON.md](docs/COMMUNITY-COMPARISON.md) | 与社区 ccch1mneyyy/dsh-TUI 的完整功能对比报告（2026-08-20） |
| [BACKLOG-FEATURE-GAP.md](docs/BACKLOG-FEATURE-GAP.md) · [BACKLOG-CC-PARITY.md](docs/BACKLOG-CC-PARITY.md) · [BACKLOG-CC-VISUAL-PARITY.md](docs/BACKLOG-CC-VISUAL-PARITY.md) | 对比报告拆解的实现清单：功能差距（Part A）+ cc 预设交互对齐（Part B）+ cc 预设视觉对齐（Part C） |
| [BOUNDARY-DESIGN.md](docs/BOUNDARY-DESIGN.md) | 能力边界判定：TUI 本分留内部 / 越权增强独立（含已完成功能回审） |
| [PLAN-ROADMAP.md](docs/PLAN-ROADMAP.md) · [PLAN-BUNDLED-SKILL.md](docs/PLAN-BUNDLED-SKILL.md) | 未动工 backlog 全量实现规划（6 阶段）· tui 手册技能随插件注册专项 |
| [INTERACTION-PLAN.md](INTERACTION-PLAN.md) | 交互规划与批次 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南（提交 trailer 约定） |
| [LICENSE](LICENSE) | MIT |

## 致谢

本项目完全由 dsh 与 DeepSeek 模型编写：规划、实现、评审与文档均由 [dsh](https://github.com/deepseek-ai/deepseek-harness) 驱动的 deepseek-v4-pro 会话完成（每笔提交带 `Assisted-by: dsh` trailer）。

灵感来源：官方 web 客户端（功能基线、文案与设计 token）、pi（渲染引擎）、Claude Code / pi 交互风格、社区 [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)（品牌区设计：像素鲸 + 渐变 DEEPSEEK 字标 + `探索未至之境！`）。
