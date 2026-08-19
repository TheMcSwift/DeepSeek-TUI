---
name: tui
description: dsh-tui 终端界面（当前这个 TUI 客户端）的操作手册：斜杠命令目录、cc/pi/opencode 快捷键与交互预设、视觉主题预设、设置面板、轨迹视图、消息队列、权限审批。用户询问「这个界面怎么操作」时参考。
whenToUse: 当用户询问本 TUI 界面的操作方法（斜杠命令、快捷键、主题、设置、退出/中断等）时。
---

# dsh-tui 操作手册（本终端界面）

这是 DeepSeek Harness 的终端交互客户端（`dsh --profile tui`）。以下内容描述**用户操作方式**，不是 agent 能力。

## 基本操作

- 输入框直接键入消息，`Enter` 发送；`Shift+Enter` 换行；`↑/↓` 历史；`Ctrl+Z`/`Ctrl+Shift+Z` 撤销重做。
- **中断当前轮**：cc 预设用 `Esc`；pi/opencode 预设用 `Ctrl+C`（pi 语义，`Esc` 亦可）。
- **退出**：`Ctrl+C`（空闲时，cc/opencode）、`Ctrl+D`、或 `/quit`。
- 运行中再输入消息会**排队**（上限 10 条）；`Alt+Enter` 并入当前轮（steer）；`Alt+Up` 取回排队消息；`/queue` 查看队列。

## 斜杠命令（`/` 输入过滤，cc/pi 预设显示内联菜单）

| 命令 | 作用 |
|---|---|
| `/new` `/clone` | 新会话 / 复制当前会话 |
| `/quit` `/exit` | 退出（flush 会话） |
| `/model [provider/model]` | 切换模型（裸命令开选择器；`/m` 别名） |
| `/effort` | 选择 reasoning effort |
| `/permission [preset]` | 权限预设（read-only/workspace-write/danger-full-access 等；`/perm` 别名） |
| `/keymap [cc\|pi\|opencode]` | 快捷键 + 交互预设（见下） |
| `/theme [web\|cc\|pi\|opencode]` | 视觉主题预设（色彩） |
| `/preset [cc\|pi\|opencode]` | 一键同切「键位 + 主题 + 交互」套餐 |
| `/settings` | 聚合设置面板（语言/主题/Enter 行为/键位/动画/配置） |
| `/config` | 配置文件与供应商管理（查看/编辑/添加供应商向导） |
| `/plugins` | 能力清单（命令/技能/投影三区） |
| `/workspace` | 最近工作目录列表（切换） |
| `/trajectory` | 原始事件日志轨迹视图（排查用） |
| `/hotkeys` `/help` `/?` | 快捷键面板（随预设切换内容） |
| `/lang [zh\|en]` | 界面语言 |
| `/rename [标题]` | 重命名会话；裸命令可选择重命名「工作区目录」 |
| `/export` `/rate` `/compose` | 导出日志 / 评价回复 / $EDITOR 撰写长消息 |
| `!command` `!!command` | 执行 shell 并发送给模型 / 静默执行 |
| `@`、`#` 前缀 | 文件路径自动补全 |

## 快捷键与交互预设（`/keymap`，三个套餐）

- **cc（默认，Claude Code 式）**：`Esc` 中断；`Ctrl+C` 空闲退出；`Ctrl+R` 会话、`Ctrl+G` 模型、`Ctrl+P` **行内循环权限预设**、`Ctrl+B` 分支、`Ctrl+F` 搜索、`Ctrl+Y` 评分、`Ctrl+X` 复制回复、`Ctrl+W` 工作目录、`Ctrl+K` 折叠、`Ctrl+T` thinking、`Ctrl+O` jobs、`Ctrl+L` 轨迹、`Ctrl+E` 退出 plan、`Ctrl+/` 命令面板；`/settings` 可枚举行用 **`←/→` 行内循环切换**；审批卡**无边框纯文本**。
- **pi（pi coding-agent 式）**：`Ctrl+C` 中断；`Ctrl+G` $EDITOR 撰写；`Ctrl+P` 模型；权限走 `/permission`；审批卡**圆角卡**；斜杠菜单紧凑。
- **opencode（OpenCode 式）**：`Ctrl+C` 运行中清空输入/空闲退出；`Ctrl+P` 命令面板；`Ctrl+R` 重命名；**leader 键 `Ctrl+X` + 字母和弦**：`l` 会话、`n` 新会话、`m` 模型、`g` 轨迹、`e` 撰写、`t` 主题、`y` 复制、`x` 导出、`h` thinking、`c` 压缩；`/` 不弹内联菜单（命令走 `Ctrl+P`）；审批卡**居中弹窗**。

## 视觉主题预设（`/theme`，只改配色）

- `web`（默认，dsh web 设计 token）· `cc`（暖橙无边框灰阶）· `pi`（pi 官方 dark/light 取值）· `opencode`（opencode 默认主题）。
- 明暗变体独立：`DSH_TUI_THEME=light|dark|auto`。

## 其他

- **权限审批**：弹卡里数字直选 / `↑↓`+`Enter`；`Allow once` 只允许一次；full-access 需确认。
- **轨迹**：`Ctrl+L`（cc/pi）或 `<leader>g`（opencode），按 `seq`/类型/摘要过滤，`PgUp/PgDn` 翻页。
- **搜索**：`Ctrl+F` 转录搜索跳转。
- 状态行（footer）：模型 · `ctx N%` 上下文压力三段彩条 · cwd · 消息/token 计数。
