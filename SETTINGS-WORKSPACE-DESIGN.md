# SETTINGS-WORKSPACE-DESIGN.md — 设置面与工作区管理的终端方案

> 目标：把 FEATURE-CHECKLIST 的 H13（设置面板）、H20（插件设置页）、H21（插件清单）、
> H11（工作区管理）在**单栏终端**里收敛成一个与 Claude Code / dsh web 对齐的方案。
> 基线源码：web 侧 `packages/client/ui-settings-*`、`ui-workspace`、`ui-permission-presets`；
> 本仓库已有终端对应物：`/config`（K2）、`/lang`、`/keymap`（0.2.1 批）、`/rename`（H7+H11）、
> `DSH_TUI_THEME/ENTER/KEYMAP/ANIM` env、sessionProjections 投影 chips（K3）。

## 1. 两个参考系

### 1.1 Claude Code：命令式、无面板
Claude Code 没有设置面板——它是**一组命令 + 一个配置文件**：

| CC 命令 | 作用 | TUI 现状 |
|---|---|---|
| `/config` | 打开 `~/.claude/settings.json` 直接编辑 | ✅ `/config`：预览 / `$EDITOR` 挂起编辑 / OSC52 复制路径 |
| `/status` | 一行显示版本 / 模型 / cwd / 账户 / 成本 | 🟡 等价物散在 header + footer（模型、ctx%、cwd、消息/token 数） |
| `/permissions` | 权限模式查看/切换 | ✅ Ctrl+P / `/permission`（投影 chips 常显当前值） |
| `/model` | 模型切换 | ✅ Ctrl+G / `/model`（pi 预设下 Ctrl+P） |
| `/cost` | 用量/成本 | ⛔ 成本无定价数据（CC-12 已评估） |
| `/login` | 凭据 | ✅ 等价：env / `settings.yaml` credentials |

结论：**CC 的哲学是「设置即命令 + 文本文件」**——TUI 已经走在这条路上（`/config` 直通
settings.yaml 就是 CC `/config` 的对应物）。缺的不是面板，而是 **`/status` 式的集中一览**
与 **插件清单**。

### 1.2 dsh web：分区设置面板 + 工作区浏览器
web 的 `ui-settings-*` 是分区模态（General/Models/Plugins/Plugin inventory），
`ui-workspace` 是侧栏浏览器。单栏终端无法承载侧栏，但可以逐区**面板化**。

## 2. 现状盘点（0.2.1 批后）

| 能力 | 现状 | 位置 |
|---|---|---|
| 配置文件 | ✅ 路径 / 预览 / $EDITOR 编辑 / 复制路径 | `/config` |
| 供应商管理 | ✅ 列表 + 添加向导（settings seam 写 `llm-pi-ai.providers`） | `/config` |
| 语言 | ✅ zh/en 持久化（dsh 侧） | `/lang`、`DSH_TUI_LANG` |
| 主题 | ✅ 明暗（light/dark/auto，OSC11 探测）× **视觉主题四预设 web/cc/pi/opencode**（`/theme` 热切换 + sidecar；pi/opencode 取官方主题逐字值） | `DSH_TUI_THEME`、`DSH_TUI_THEME_PRESET`、`/theme` |
| Enter 行为 | ✅ queue/steer | `DSH_TUI_ENTER` |
| 快捷键预设 | ✅ **cc/pi/opencode 三预设（本轮新落地）**，opencode 含 Ctrl+X leader 和弦体系；`/preset` 一键同切键位+主题 | `/keymap [cc|pi|opencode]`、`DSH_TUI_KEYMAP`、sidecar |
| 权限 | ✅ 预设切换 + 投影 chip 常显 | Ctrl+P、`/permission` |
| 会话重命名 | ✅ | `/rename [标题]` |
| 工作区重命名 | ✅ **本轮新落地（H11 半程）** | 裸 `/rename` → 目标选择 → 目录单段名校验 → `fs.rename` |
| 工作区切换 | ✅ 自由文本路径 + 校验 | Ctrl+W |
| 插件清单 | ✅ **`/plugins` 能力清单（M3 落地）**——命令/技能/投影三区代理视图 | `/plugins` |
| 插件设置 | ✅ 代理写路径：投影行 Enter → 通用枚举 picker；命令行 Enter → 执行；技能行 Enter → 插入 composer | `/plugins` |
| 集中状态一览 | 🟡 散在 header/footer | — |
| 工作区列表 | ✅ **`/workspace`（M4 落地）**——sessionQuery cwd 去重 + 会话计数 + 最近优先 + 当前标记 | `/workspace` |

## 3. 方案：`/settings` 分区面板 + 三个补全命令

原则：**面板是瞬态派生视图**（单向数据流不破——只读现成 seam，写路径全部走既有命令），
**每个分区一个现有命令的聚合入口**，不新建第二份状态。

### 3.1 `/settings` — General 分区（H13 收口）✅ 已落地（M2）

入口命令 `/settings`（裸命令开面板；已开则就地刷新行）。面板是**瞬态派生视图**：
打开时实时收集现状值，不落文档；行操作全部跳转既有命令/闭包，零新写逻辑。

| 行 | 现状值（数据源） | 操作 |
|---|---|---|
| 语言 | `resolveLanguage(DSH_TUI_LANG)` | → `/lang` 枚举 |
| 主题 | 明暗变体（暗色/亮色/跟随终端）× 当前预设（web/cc/pi/opencode） | → 主题四选（切换后面板就地重绘新预设风格） |
| Enter 行为 | `DSH_TUI_ENTER`（排队/steer） | → 两选；写 settings seam `tui.enterBehavior`（命名空间已注册，重启后生效） |
| 快捷键预设 | 当前 `cc`/`pi`/`opencode` | → 键位三选（sidecar 持久化） |
| 动画 | `piTuiInternals.animFrameMs`（开/关） | → 运行时切换 + settings seam `tui.anim`（命名空间已注册，重启后生效） |
| 配置文件 | settings.yaml 路径 | → `/config` |

**视觉**：面板只用语义色名（accent/muted/dim/borderMuted/selectedBg），零硬编码 hex——
随当前主题预设（web/cc/pi/opencode）自动呈现对应风格；面板内切主题后行数据就地刷新、
颜色在下一次渲染随新预设生效。组件 `src/view/components/settings-panel.ts`
（窗口滚动 + 数字直选 + Enter 执行 + Esc 关闭，HotkeysPanel 同形态）。

持久化策略：语言在 dsh 侧；keymap/theme 走 sidecar；Enter/动画经 settings seam 的
`tui` 命名空间——`apply()` 用 `installSettingsSection` 注册（schema：`enterBehavior:
queue|steer`、`anim: on|off`），写入真正落盘到 `settings.yaml` 的 `tui:` 段；启动时
若 env 未显式设置则回填（`DSH_TUI_ENTER`/`DSH_TUI_ANIM` 显式优先）。settings 服务
缺席的最小组合里注册回调不触发，TUI 退回组合默认照常可用。

**广义交互层（预设驱动的交互画像）**：同一功能在不同预设下呈现与操作方式不同——
`Keymap.interaction` 三个维度：`enum`（枚举语式：cc 行内 ←/→ 循环、pi/opencode 列表
菜单）、`card`（审批/提问卡形态：cc 无边框纯文本、pi 圆角卡、opencode 居中弹窗）、
`slash`（斜杠菜单语式：cc 全量内联、pi 紧凑内联、opencode `popup` 方角弹层——标题
计数行 + 整行选中 + 描述列 + 底栏 `Ctrl+P 面板` 入口，与命令面板**并存**；另留
`panel` 语式=只走面板不弹弹层，当前无预设选用）。配色由主题预设承担，键位与操作语式
由键位预设承担，经 `/preset` 一键同切。

### 3.2 `/plugins` — 插件清单与设置（H20 + H21 收口）✅ 已落地（M3）

**数据源诚实声明**：tui profile 挂载的是 dsh-base，**没有独立插件 registry 服务**；
ctx 白名单（AGENTS.md）为 commands / skills / sessionQuery / sessionTitle / jobs /
userQuestions / sessionProjections（K3 已用）。因此插件清单是**代理视图**——按来源
三区（命令/技能/投影），而非按插件归组：

- 命令区：`ctx.commands.list(agent)` → 行 `/<name> · description`，Enter 执行；
- 技能区：`ctx.skills.list()` → 行 `/<name> · 选中插入输入框`（非 user-invocable 灰显），
  Enter 插入 composer（与 slash 菜单一致）；
- 投影区：`sessionProjections.snapshot` → select 形态行显示当前值（Enter → 通用枚举
  picker，H20 的终端等价「设置页」）；结构化投影灰显标注。
- 组件 `src/view/components/plugins-panel.ts`（窗口滚动 + ↑/↓ 跳过头部 + Enter + Esc，
  纯语义色随主题预设换肤）。

**零新服务依赖**，全部数据已在白名单内。

### 3.3 `/workspace` — 工作区管理（H11 收口）✅ 列表落地（M4）

| 能力 | 方案 | 状态 |
|---|---|---|
| 列出工作区 | `sessionQuery.listSessions()` 的 cwd 去重 + 会话计数 + 最近优先 + 当前标记 | ✅ `/workspace` |
| 切换 | 选中行 → 目录校验 → `workspaceRef/meta/footer` 同步 → 新会话（与 Ctrl+W 共用 `applyWorkspacePath`） | ✅ 复用 |
| 重命名 | 裸 `/rename` → 目标「工作区目录」→ 单段名校验 → `fs.rename` + footer/路径更新 | ✅ 0.2.1 |
| 删除 | **默认不做**：`fs.rm -r` 的误触代价不可逆，且删除后 dsh 会话的 cwd 记录悬空；列为 ⛔/低优先 | ⛔ 克制 |

H11 保持 🟡（删除克制）。

## 4. 实施批次

| 批次 | 内容 | 量级 |
|---|---|---|
| **M1（已完成）** | `/keymap` 双预设 + `/rename` 工作区重命名 + `/compose`（pi A3） | ✅ 0.2.1 |
| **M2（已完成）** | `/settings` General 分区面板（六行聚合 + 跳转既有命令 + 面板内就地换肤） | ✅ 0.2.1 |
| **M3（已完成）** | `/plugins` 代理清单（命令/技能/投影三区 + 行级执行/插入/枚举） | ✅ 0.2.1 |
| **M4（已完成）** | `/workspace` 列表 + 切换（sessionQuery cwd 去重，与 Ctrl+W 共用路径） | ✅ 0.2.1 |

## 5. 验收口径

- 每条用户可见文案经 `strings.ts` 双语词典；面板数据只读既有 seam，写路径复用既有命令。
- H13 标 🟡（面板聚合而非独立设置页——终端形态的合理等价）；H20/H21 落地后标 🟡→✅；
  H11 保持 🟡（删除克制）。
- 每个批次：typecheck + 单测 + E2E 全绿（`/settings`、`/plugins` 各补一条 PTY 断言）。

> 修订：本文件随 0.2.1 批（keymap/rename/compose）落地而创建；M2–M4 的开工以清单
> 状态为准，不再单独维护本文件的未落地部分。
