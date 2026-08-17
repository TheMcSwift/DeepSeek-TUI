# DeepSeek-TUI

`dsh --profile tui` —— [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的**终端交互客户端**。

> **本工具完全由 dsh 与 DeepSeek 模型编写**：每一行代码的规划、实现、评审与文档都由 [dsh](https://github.com/deepseek-ai/deepseek-harness) 驱动的 deepseek-v4-pro 会话完成（提交尾部带 `Assisted-by: dsh` trailer），项目本身也是 dsh 智能体的工作现场。
>
> **TUI 渲染引擎是 [pi](https://github.com/pi-ai-oss/pi)**（pi-tui / pi-ai，Claude Code 同源渲染引擎）：pi 组件以 vendor 形式内嵌（MIT 许可，见 `src/view/pi-vendor/`），经实例级 hook 挂到 pi 的 TuiAltScreen 视口模式——不 fork、不打 node_modules 补丁。

它是一个 **out-of-tree profile bundle**：复用 dsh 共享的插件栈（Agent、工具、MCP、会话持久化、权限预设），只追加一层全屏交互式聊天界面——不依赖 Host、HTTP 或浏览器。你日常用 `dsh` 跑 headless 任务，用 `dsh --profile tui` 与智能体对话。

[English version](README_EN.md) · 功能对齐基线见 [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) · 社区同类项目对比见下方 [与社区其他 dsh TUI 的对比](#与社区其他-dsh-tui-的对比)

---

## 快速开始

```
$ dsh --profile tui                     # 新会话
$ dsh --profile tui --resume <id>       # 恢复会话
$ dsh --profile tui -c                  # 恢复最近会话
```

```
dsh tui — DeepSeek Harness 终端客户端
Esc 中断（busy） · Ctrl+C 退出（idle） · / 斜杠菜单 · Ctrl+/ 命令面板
Ctrl+R 会话 · Ctrl+G 模型 · Ctrl+P 权限预设 · Ctrl+F 搜索 · Ctrl+B 分支 · Ctrl+Y 评分
Ctrl+X 复制回复 · Ctrl+W 工作区 · Ctrl+T 思考 · Ctrl+K 折叠 · Ctrl+E 退出 plan
Alt+Enter 插话 · Alt+Up 取回队列 · Tab 焦点环 · Enter 展开/收起（thinking/工具卡/长消息）
```

## 它是什么

一个给 **dsh 智能体会话**用的终端界面，以 dsh **web 客户端为功能基线**逐项对齐（详见 FEATURE-CHECKLIST.md，148 项，覆盖率 ≈ 92%）：

- **流式渲染**：Markdown 增量解析、推理块分级着色、代码高亮、TeX 数学、Mermaid 图
- **工具执行可视化**：终端卡（退出码 pill）、Read 高亮卡、grep/glob 分组卡、web_search 引用卡、`run_code` 递归子调用树、产物文件 OSC 8 链接
- **交互完备**：斜杠菜单（含命令别名）/命令面板、多选提问表单、审批弹窗、分支(fork)、消息评分、全文搜索、会话搜索
- **会话级面板**：goal / todo / jobs / **workflow 运行树**（run→member 层级披露）
- **模型与权限切换**：`/model`、`/permission` 均支持**枚举选择**（slash 菜单/Ctrl+G/Ctrl+P）与**参数直切**（`/model pi-ai/deepseek-v4`、`/permission workspace-write`）；`/config` 管理供应商（列表/添加向导/$EDITOR 编辑 settings.yaml）
- **插件投影感知**：凡注册 select 形态 session 投影的插件（如权限预设）自动获得状态行 chip 与 Ctrl+P 枚举交互，无需改 TUI
- **固定状态区**（web 布局语义）：输入区之上 = 运行状态 + 插件投影（权限预设等）；输入区之下 = 会话统计条 + model/ctx 压力/目录/token 计数
- **键盘展开/收起（pi 风格）**：Tab 焦点环 + Enter 切换（thinking 块/工具卡/折叠长消息），▸/▾/⏎ 图标为纯状态标记——不监听鼠标点击；滚轮滚动保留
- **双语界面**：zh/en 完整词典（文案逐字复用 web locale 表），`/lang` 或 `DSH_TUI_LANG` 切换
- **主题**：深/浅两套调色板（设计 token 逐字取自 web `design-platform.css` + shiki 色板）

## 架构

分层单向数据流，文档即真相源：

```
src/
├── control/        # 审批瀑布、userQuestions provider、会话/模型数据源（cordis 服务接入）
├── document/       # ViewDocument 契约：条目类型 + 生命周期 + 纯转录函数
├── projection/     # fold：SessionEvent → ViewDocument（增量、不可变更新）
│   ├── stats.ts    #   会话统计（web StatsLine 同款 fold 数学）
│   └── synthesis/  #   DSH 块 → pi-ai 形状、工具定义注册表
├── app/            # PiTuiApp：布局/焦点环/overlay/按键路由（TuiAltScreen 实例级 hook）
│   └── pi/         #   主题/调色板/高亮
├── view/           # 组件：消息/工具卡/面板/菜单/弹窗/品牌区 + strings 双语词典
├── index.ts        # runner：boot/resume、事件折叠、命令分发、quit/flush
└── startup.ts      # profile 启动入口（`@mcswift/dsh-tui/startup` 行）
```

**数据流**：`session/event` → `fold()` → `ViewDocument` → `app.render()` → 差分重渲染。折叠是纯函数（无 cordis/无 pi 依赖），`tests/projection.spec.ts` 逐事件回归。

**与 dsh 的集成**：本仓库是 out-of-tree profile（`cordis.patch.yml` 声明 startup/runner 行 + persona/hmr/tools 覆盖），通过 `dsh plugin --profile tui add @mcswift/dsh-tui`（或本地开发 `add link:<本仓库>`） 挂载；运行时经 `ctx.get(...)` 结构访问 host 组合的服务（`commands`/`skills`/`sessionQuery`/`sessionTitle`/`jobs`/`userQuestions`/`settings`/`sessionProjections`）。

## 与社区其他 dsh TUI 的对比

| 项目 | 形态 | 与我们的差异 |
|---|---|---|
| [dsh-tui/dsh-tui](https://github.com/dsh-tui/dsh-tui) | out-of-tree bundle + pi-tui（pnpm patches 修补 pi-tui） | 同为 pi-tui 内嵌 bundle。它以 patches 改 pi-tui、工具卡 Ctrl+O 三档切换、常驻 todo 面板；我们**不 patch pi**（vendor + 实例级 hook），工具卡 Enter 展开 + `i` 原始输入，状态区/双语/命令面更贴近 web 布局语义 |
| [MashedPotato817/dsh-tui](https://github.com/MashedPotato817/dsh-tui) | 走 DSH HTTP 契约的**远程客户端**（Claude Code 风格 + Vim 模态输入 + HUD） | 它是 HTTP 客户端，可在任意机器连 dsh host；我们是**进程内 profile**，与 web 共享同一插件栈与会话语义（无 HTTP 跳板、无功能降级），但必须跑在 dsh 安装本机 |
| `dsh-claude-tui`（npm） | Claude Code 风格远程 TUI | 交互风格优先于 web 对齐；我们以 web 客户端为功能基线（148 项清单） |
| `@xmoon76/dsh-pi-tui` 等 npm 上的 pi-tui 系实现 | pi-tui 客户端 | 引擎同源、实现各异；差异点以各自 README 为准 |
| dsh 官方 web 客户端 | 浏览器 | 我们逐项对齐 web 的交互与文案，但不是其替代——终端没有浏览器能力（图像、拖拽、富卡片） |

**我们的优势**

- 与官方 web 共享插件栈与持久化：同一 session jsonl、同一 settings.yaml、同一权限/计划/工作流插件，语义零漂移
- 功能对齐有据可查：148 项清单逐项审计（FEATURE-CHECKLIST.md），双语文案逐字取自 web locale 表
- 不 patch pi-tui：vendor 快照 + 实例级 hook，pi 升级可控、无补丁腐化
- 终端原生能力：PTY 驱动、OSC 8 产物链接、OSC 52 复制、`$EDITOR` 挂起编辑配置、命令别名

**我们的取舍**

- 只能跑在 dsh 安装本机（无 HTTP 远程模式）；需要远端连接的场景请用 HTTP 系客户端
- pi 版本固定（0.84.1，vendor 快照），上游修复需手动跟进
- 浏览器能力（图像、拖拽、设置页表单）以终端形态降级：设置页 → `/config`，图片 → 占位行
- 无 Vim 模态编辑（那是 HTTP 系客户端的卖点）

## 灵感与借鉴

| 来源 | 借用了什么 |
|---|---|
| **dsh web 客户端**（`packages/client/ui-*`） | 功能清单与交互语义（FEATURE-CHECKLIST.md 逐包审计）、设计 token（`design-platform.css`/shiki 色板）、locale 文案（逐字复用）、StatsLine 统计语义、composer.dock 状态区布局 |
| **pi**（pi-tui / pi-ai，Claude Code 同源渲染引擎） | 渲染引擎（TuiAltScreen 视口模式）、Editor/Markdown/ScrollView 组件、键盘协议协商、overlay 机制、键盘展开/收起交互风格 |
| **Claude Code / pi 交互风格** | Esc 中断、非阻塞决策卡（数字直选）、内联斜杠菜单、底部锚定 composer、工具卡展开 |
| **社区 dsh-TUI**（github.com/ccch1mneyyy/dsh-TUI） | 品牌区设计：DeepSeek 像素鲸 + 渐变 DEEPSEEK 字标 + `探索未至之境！` |

## 安装

**前置要求**：可用的 dsh 环境（Node ≥ 20、pnpm）。

```bash
# 从 npm 安装（推荐）
dsh plugin --profile tui add @mcswift/dsh-tui

# 或本地开发：挂载源码（lib/ 为 profile 的加载入口，改完 pnpm build 即生效）
git clone https://github.com/TheMcSwift/DeepSeek-TUI.git
dsh plugin --profile tui add link:/path/to/DeepSeek-TUI
cd DeepSeek-TUI && pnpm install && pnpm build
```

> out-of-tree profile 的 `cordis.patch.yml` 是**必填声明**（缺失直接报错）；insert 行只能引用 dsh 安装已携带的插件。更多约束见 DESIGN.md §10。

## 使用

### 命令

| 命令 | 说明 |
|---|---|
| `/new` `/quit` `/clone` `/help`(`/hotkeys`) | 会话控制 |
| `/rename <标题>` | 固定会话标题（替代自动生成） |
| `/queue` | 查看排队消息：逐项取回或删除 |
| `/effort` `/lang` `/rate` `/export` | 推理强度 / 语言 / 评分 / 导出会话日志 |
| `/model [provider/model]` | 切换模型：不带参数打开枚举选择，带参数直接切换 |
| `/permission [预设]` | 切换权限预设：不带参数打开枚举选择，带参数直接切换（full-access 有确认） |
| `/config` | 供应商列表 / 添加供应商向导 / 预览与 `$EDITOR` 编辑 settings.yaml |
| `/goal /plan /compact …` | profile 注册的命令（Ctrl+/ 面板统一浏览） |

**命令别名**：`exit`→`quit` · `clear`→`new` · `?`→`hotkeys` · `m`→`model` · `perm`→`permission` · `language`→`lang`（在斜杠解析链生效，菜单仍显示主名）。

### 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_TUI_DEBUG` | `1` 输出事件/渲染调试日志 |
| `DSH_TUI_ANIM` | `0` 冻结品牌 shimmer 与 spinner 动画 |
| `DSH_TUI_THEME` | `light`/`dark`/`auto`（OSC 11 探测） |
| `DSH_TUI_LANG` | `zh`/`en`（`/lang` 运行时可切换） |
| `DSH_TUI_ENTER` | `steer` 切换 busy 时 Enter 为插话（默认 queue） |
| `DSH_TUI_MOUSE` | `0` 关闭鼠标捕获（恢复宿主终端右键/滚轮行为） |

## 开发与测试

```bash
pnpm typecheck        # tsc 严格检查
pnpm test             # vitest 单测（245 项：投影/runner/视图/主题/面板）
pnpm build            # tsc 构建到 lib/
python3 scripts/e2e-pty.py           # 6 场景 PTY 端到端（core/resume/approval/questions/interactions）
python3 scripts/e2e-pty.py --only-questions   # 单场景
```

## 文档导航

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 总体结构：模块职责、边界与依赖方向 |
| [DESIGN.md](DESIGN.md) | 设计契约与实施修订史（§10 out-of-tree 约束） |
| [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) | dsh web 功能对齐基线（148 项逐包审计） |
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) · [PI-GAP-ANALYSIS.md](PI-GAP-ANALYSIS.md) | 基线差距审计 |
| [INTERACTION-PLAN.md](INTERACTION-PLAN.md) | 交互规划与批次 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南（提交 trailer 约定） |
| [LICENSE](LICENSE) | MIT |
