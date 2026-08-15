# DeepSeek-TUI

`dsh --profile tui` —— [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的**终端交互客户端**。

它是一个 **out-of-tree profile bundle**：复用 dsh 共享的插件栈（Agent、工具、MCP、会话持久化、权限预设），只追加一层全屏交互式聊天界面——不依赖 Host、HTTP 或浏览器。你日常用 `dsh` 跑 headless 任务，用 `dsh --profile tui` 与智能体对话。

[English version](README_EN.md) · 功能对齐基线见 [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md)

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
Alt+Enter 插话 · Alt+Up 取回队列 · Tab 焦点环 · 鼠标：行尾 ⏎/▸/▾ 图标点击展开
```

## 它是什么

一个给 **dsh 智能体会话**用的终端界面，以 dsh **web 客户端为功能基线**逐项对齐（详见 FEATURE-CHECKLIST.md，148 项，覆盖率 ≈ 92%）：

- **流式渲染**：Markdown 增量解析、推理块分级着色、代码高亮、TeX 数学、Mermaid 图
- **工具执行可视化**：终端卡（退出码 pill）、Read 高亮卡、grep/glob 分组卡、web_search 引用卡、`run_code` 递归子调用树、产物文件 OSC 8 链接
- **交互完备**：斜杠菜单/命令面板、多选提问表单、审批弹窗、分支(fork)、消息评分、全文搜索、会话搜索
- **会话级面板**：goal / todo / jobs / **workflow 运行树**（run→member 层级披露）
- **固定状态区**（web 布局语义）：输入区之上 = 运行状态 + 权限预设；输入区之下 = 会话统计条 + model/ctx 压力/目录/token 计数
- **鼠标支持**：滚轮滚动、行尾小图标点击展开（⏎ 折叠消息/工具卡、▸/▾ 思考块）
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
├── app/            # PiTuiApp：布局/焦点环/overlay/点击命中（TuiAltScreen 实例级 hook）
│   └── pi/         #   主题/调色板/高亮
├── view/           # 组件：消息/工具卡/面板/菜单/弹窗/品牌区 + strings 双语词典
├── index.ts        # runner：boot/resume、事件折叠、命令分发、quit/flush
└── startup.ts      # profile 启动入口（dsh-tui-app/startup 行）
```

**数据流**：`session/event` → `fold()` → `ViewDocument` → `app.render()` → 差分重渲染。折叠是纯函数（无 cordis/无 pi 依赖），`tests/projection.spec.ts` 逐事件回归。

**与 dsh 的集成**：本仓库是 out-of-tree profile（`cordis.patch.yml` 声明 startup/runner 行 + persona/hmr/tools 覆盖），通过 `dsh plugin --profile tui add link:<本仓库>` 挂载；运行时经 `ctx.get(...)` 结构访问 host 组合的服务（`commands`/`skills`/`sessionQuery`/`sessionTitle`/`jobs`/`userQuestions`）。

## 借鉴了什么

| 来源 | 借用了什么 |
|---|---|
| **dsh web 客户端**（`packages/client/ui-*`） | 功能清单与交互语义（FEATURE-CHECKLIST.md 逐包审计）、设计 token（`design-platform.css`/shiki 色板）、locale 文案（逐字复用）、StatsLine 统计语义、composer.dock 状态区布局 |
| **pi-tui**（`@earendil-works/pi-tui`，Claude Code 的渲染引擎） | 渲染引擎（TuiAltScreen 视口模式）、Editor/Markdown/ScrollView 组件、键盘协议协商、overlay 机制 |
| **Claude Code / pi 交互风格** | Esc 中断、非阻塞决策卡（数字直选）、内联斜杠菜单、底部锚定 composer、工具卡展开 |
| **社区 dsh-TUI**（github.com/ccch1mneyyy/dsh-TUI） | 品牌区设计：DeepSeek 像素鲸 + 渐变 DEEPSEEK 字标 + `探索未至之境！` |

## 安装

**前置要求**：可用的 dsh 环境（Node ≥ 20、pnpm）、本仓库 clone 到本地。

```bash
# 1. 将本包挂载为 dsh 的 tui profile 插件
DSH_HOME=~/.dsh dsh plugin --profile tui add link:/path/to/DeepSeek-TUI

# 2. 开发时构建（lib/ 为 profile 的加载入口）
pnpm install
pnpm build
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
| `/goal /plan /compact /permission …` | profile 注册的命令（Ctrl+/ 面板统一浏览） |

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
pnpm test             # vitest 单测（220 项：投影/runner/视图/主题/面板）
pnpm build            # tsc 构建到 lib/
python3 scripts/e2e-pty.py           # 6 场景 PTY 端到端（core/resume/approval/questions/interactions）
python3 scripts/e2e-pty.py --only-questions   # 单场景
```

文档索引：[ARCHITECTURE.md](ARCHITECTURE.md) 总体结构 · [DESIGN.md](DESIGN.md) 设计契约与实施修订 · [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) web 功能对齐基线 · [GAP-ANALYSIS.md](GAP-ANALYSIS.md) / [PI-GAP-ANALYSIS.md](PI-GAP-ANALYSIS.md) 基线审计 · [INTERACTION-PLAN.md](INTERACTION-PLAN.md) 交互规划 · [CONTRIBUTING.md](CONTRIBUTING.md) 贡献指南 · [LICENSE](LICENSE) MIT。

---

本项目的开发由 **dsh（DeepSeek Harness）协助完成**：会话驱动的功能对齐、审查与回归循环均由 `dsh --profile tui` 自身执行；提交记录携带标准 git trailer：`Assisted-by: dsh <noreply@deepseek-ai.dev>`（「协助」语义，非合著——避免贡献者统计与版权归属暗示）。
