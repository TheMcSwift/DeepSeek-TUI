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
| 插件清单 | ❌ 无集中视图 | — |
| 插件设置 | ❌ 无（散在命令/投影） | — |
| 集中状态一览 | 🟡 散在 header/footer | — |

## 3. 方案：`/settings` 分区面板 + 三个补全命令

原则：**面板是瞬态派生视图**（单向数据流不破——只读现成 seam，写路径全部走既有命令），
**每个分区一个现有命令的聚合入口**，不新建第二份状态。

### 3.1 `/settings` — General 分区（H13 收口）

入口命令 `/settings`（裸命令开面板，行式条目沿用 HotkeysPanel 的窗口滚动形态）：

| 行 | 现状值（数据源） | 操作 |
|---|---|---|
| 语言 | `strings()` 当前 locale（dsh 持久化） | Enter → `/lang` 枚举 |
| 主题 | `DSH_TUI_THEME` 明暗 × 当前视觉预设（web/cc/pi/opencode） | Enter → `/theme` 枚举 |
| Enter 行为 | `DSH_TUI_ENTER` 默认 queue | Enter → queue/steer 枚举 |
| 快捷键预设 | 当前 `cc`/`pi`/`opencode` | Enter → `/keymap` 枚举 |
| 动画 | `DSH_TUI_ANIM` | Enter → on/off |
| 配置文件 | settings.yaml 路径 | Enter → `/config` |

持久化策略：能进 settings.yaml 的（语言已在 dsh 侧；keymap 已落 sidecar）维持现状；
新增 env 型设置先「运行时 + sidecar + 面板提示」三级，不强行改写 dsh settings 命名空间
（out-of-tree 约束：settings 是 dsh 的服务，TUI 只写自己已占用的键）。

### 3.2 `/plugins` — 插件清单与设置（H20 + H21 收口）

**数据源诚实声明**：tui profile 挂载的是 dsh-base，**没有独立插件 registry 服务**；
ctx 白名单（AGENTS.md）为 commands / skills / sessionQuery / sessionTitle / jobs /
userQuestions / sessionProjections（K3 已用）。因此插件清单是**代理视图**：

- 行来源：`ctx.commands.list(agent)` 的命令 → 反查注册插件名（目录 label 前缀）；
  `ctx.skills.list()` 的技能 → 技能目录行（G22/H33 已有）；
  `sessionProjections.snapshot` 的投影 → 投影行（K3 chips 已有）。
- 每插件一行：`名称 · 命令 N · 技能 M · 投影 K`，Enter 展开明细（该插件提供的命令/
  技能/投影逐行）。
- **H20 插件设置页**：插件行 Enter → 明细里列出该插件的**可写投影**（select 形态 →
  复用 Ctrl+P 通用 picker）与其**注册命令**（→ 命令面板执行）。bash/agentloop/websearch
  卡在 web 里是表单；终端等价物就是「投影枚举 + 同名命令」这条 K3 已建好的写路径。

这一步**零新服务依赖**，全部数据已在白名单内——纯聚合视图，M 级工作量。

### 3.3 `/workspace` — 工作区管理（H11 收口）

| 能力 | 方案 | 状态 |
|---|---|---|
| 列出工作区 | `sessionQuery.listSessions()` 的 cwd 去重 + 当前工作区置顶（● 标记） | 待做（S 级） |
| 切换 | 选中行 → Ctrl+W 既有流程 | ✅ 复用 |
| 重命名 | 裸 `/rename` → 目标「工作区目录」→ 单段名校验 → `fs.rename` + footer/路径更新 | ✅ 本轮落地 |
| 删除 | **默认不做**：`fs.rm -r` 的误触代价不可逆，且删除后 dsh 会话的 cwd 记录悬空；列为 ⛔/低优先 | ⛔ 克制 |

H11 在清单中从 ❌ 调整为 🟡（重命名 ✅ / 删除 ⛔ 克制 / 列表 M1 补）。

## 4. 实施批次

| 批次 | 内容 | 量级 |
|---|---|---|
| **M1（本批已完成）** | `/keymap` 双预设 + `/rename` 工作区重命名 + `/compose`（pi A3） | ✅ 0.2.1 |
| **M2（下批）** | `/settings` General 分区面板（只读聚合 + 跳转既有命令） | S–M |
| **M3** | `/plugins` 代理清单 + 插件明细（命令/技能/投影聚合） | M |
| **M4** | `/workspace` 列表 + 切换（复用 Ctrl+W） | S |

## 5. 验收口径

- 每条用户可见文案经 `strings.ts` 双语词典；面板数据只读既有 seam，写路径复用既有命令。
- H13 标 🟡（面板聚合而非独立设置页——终端形态的合理等价）；H20/H21 落地后标 🟡→✅；
  H11 保持 🟡（删除克制）。
- 每个批次：typecheck + 单测 + E2E 全绿（`/settings`、`/plugins` 各补一条 PTY 断言）。

> 修订：本文件随 0.2.1 批（keymap/rename/compose）落地而创建；M2–M4 的开工以清单
> 状态为准，不再单独维护本文件的未落地部分。
