# 社区对比报告 — ccch1mneyyy/dsh-TUI vs DeepSeek-TUI

> 入库日期：2026-08-20。基线：本仓库 `5cf9f2b`（v0.2.1）；远程仓库
> `github.com/ccch1mneyyy/dsh-TUI`（`@deepseek-harness-tui/dsh-tui` v0.8.5，克隆于
> `/tmp/dsh-TUI-remote`，depth 50，commit `1f93efe`）。
> 分析方式：两边 README / docs 全量通读 + 关键源码逐文件核对（远程 commands.ts、
> Chat.tsx、interaction/configuration/themes/architecture/plugins 文档；本地
> keymaps.ts、commandCatalog、FEATURE-CHECKLIST 148 项清单）+ 两个只读 subagent
> 的全仓库清单交叉验证。
> 配套实现清单：功能差距见 [BACKLOG-FEATURE-GAP.md](BACKLOG-FEATURE-GAP.md)；
> cc 预设与 Claude Code 的广义交互差距见 [BACKLOG-CC-PARITY.md](BACKLOG-CC-PARITY.md)。

---

## 1. 定位总览

| 维度 | **ccch1mneyyy/dsh-TUI**（远程） | **DeepSeek-TUI**（本地） |
|---|---|---|
| npm 包 | `@deepseek-harness-tui/dsh-tui` 0.8.5（已发布，官方公众号收录，GitHub Trending） | `@mcswift/dsh-tui` 0.2.1 |
| 形态 | 独立 TUI 产品：`dsh-tui` 直达命令 / `dsh --profile dsh-tui`；自带 install.sh、Windows dsh-tui.cmd | out-of-tree profile：`dsh --profile tui`（`dsh plugin add @mcswift/dsh-tui`） |
| 设计基线 | **Claude Code 风格**（CC 指令全集复刻、双 Esc 时间回溯、像素鲸） | **dsh web 客户端为功能基线**（148 项逐项对齐，覆盖率 ≈92%） |
| 渲染引擎 | 自移植 Ink 核心（React 19 + react-reconciler + vendor/dsh-std） | pi-tui 0.84.1 vendor 内嵌 + 实例级 hook（不 patch） |
| 数据流 | SessionEvent → fold（纯函数）→ Channel 投影 → React → Ink 差分渲染 | SessionEvent → fold（纯函数）→ ViewDocument → pi app.render() 差分渲染 |
| 文档 | 10 篇双语 + 877 行插件开发指南 + 508 行用户指南 | 9 篇 + FEATURE-CHECKLIST + 2 份 GAP 审计 |
| 验证 | 100+ verify/repro 脚本 + 15 步构建门禁 + smoke | 26 spec ≈349 单测 + 8 段 PTY E2E |

> 关键结论：**两边架构内核同源**（DSH 插件栈 + 纯函数投影 + 差分渲染 + 会话日志为
> 唯一真源），差异在渲染引擎（移植 Ink vs pi-tui vendor）与生态位（完整产品 vs
> web 对齐精修 profile）。

## 2. 命令集差异（远程 45+ 内置 vs 本地 22 原生 + 注册表）

### 2.1 远程独有（本地完全没有）

**会话/工作流**
- `/rewind` 时间回溯：选历史用户消息 → 找所属 turn 起点 → DSH fork 分支 → 回放边界前历史 → 原消息放回输入框。双击 Esc 同入口；不能回退到第一条；模型忙先取消（≤30s）；插件可经 `tui/rewind-prompt` 否决或附加回退模式，完成后收 `tui/rewind-done`。
- `/btw <问题>` 侧问：复用当前上下文做无工具单轮调用，浮层面板显示；**不进会话历史/不计 token**、不打断主回合；`c` 复制；再触发中止上一个。
- `/trace`（+Ctrl+T）全屏轨迹场景：时间线/热点双视图、`tool:`/`kind:`/`turn:`/`err:`/`run:`/`>10s`/`tok>1k` 查询（多条 AND 原位高亮）、`[`/`]` 跳失败点、`{`/`}` 跳轮次、`m` 投影模式（等分/墙钟/压缩空闲）。
- `/workspace resume|rename|open`：工作区选择器/重命名/直接打开（绝对路径、相对路径、`file://` URI、插件 URI；launcher 也可带目标）。
- `/clear` 独立清屏（本地 `clear` 是 `/new` 别名，语义不同）。

**状态/诊断**
- `/context`（loaded-context 明细）、`/status`（会话信息）、`/cost`、`/tokens`、`/doctor`（环境自检 + 插件运行时诊断）、`/init`（创建 AGENTS.md）、`/config`（配置来源）。
- `/login`、`/logout`、`/permissions`、`/add-dir`、`/hooks`、`/mcp`、`/agents`、`/skills`（技能目录，带来源桶）、`/debug-prompt`（LLM 请求快照落盘 0600）。
- `/tips`（使用技巧面板）。

**模型/显示**
- `/effort` 滑杆（←/→ 实时生效）+ `<id>` + `status`。
- `/preset` Agent preset 选择器（standard/code/minimal/cordis/**liangshen**；blank-only 规则；持久化 `~/.dsh-tui/agent-preset.json`）。
- `/activity` 工作动画选择器（30 帧预设，默认 moon8）。
- `/thinking` 命令式思考开关（不持久化）。
- `/provider` 9 步交互向导（catalog/自定义端点、草稿凭据探测模型、写 settings.yaml + .credentials.yaml 0600、回滚）。
- `/theme` 颜色主题选择器（auto/light/dark/dark-ansi + 自定义 JSON）。

**平台/生态**
- `/update`（npm 版本检查 + 更新 profile 并自动重启恢复会话；仅 `dsh --profile` 可用；回合运行中拒绝；0.7.0–0.7.1 死锁区间拒绝）。
- `/plugins check <路径>`（manifest 解析 + 五态协商诊断）。
- `/terminal-setup`、`/vim`、`/connect`（占位说明）。
- 打包 7 个技能命令：`/audit` `/bug` `/review` `/practice` `/pr_comments` `/release-notes` `/vuln-check`（SKILL.md 随包注册，可被用户同名覆盖）。

### 2.2 本地独有（远程没有）

- `/queue` 排队 dock（逐项取回/删除）——远程只有 Alt+Up 取回 + Esc 重投。
- `/rate` 消息评分（👍/👎 + 备注，sidecar 持久化）——远程无反馈功能。
- `/clone` 分支复制会话（远程无 fork，只有 rewind）。
- `/keymap [cc|pi|opencode]` 快捷键三预设（远程固定一套 CC 式键位）。
- `/theme [web|cc|pi|opencode]` 视觉主题四预设（远程是颜色主题）。
- `/preset [cc|pi|opencode]` 键位+主题一键双切。
- `/compose` `$EDITOR` 撰写长消息（远程是 Ctrl+X 编辑当前输入，形态不同）。
- 别名体系更全：`exit→quit` `clear→new` `?→hotkeys` `m→model` `perm→permission` `language→lang` `r→resume`。

### 2.3 共有但语义不同

| 命令 | 远程 | 本地 |
|---|---|---|
| `/export` | 导出 Markdown 文件（`dsh-tui-export-<ts>.md`） | 展示 jsonl 路径 + flush |
| `/model` | fork 会话续聊（历史保留、旧会话留 /resume；写 model.json） | live 切换（modelRef 覆盖 + saveSelection 持久化） |
| `/settings` | 命名空间设置编辑器（暂存制 s/d，statusBar 15 项等） | 六行聚合面板（数字直选 + ←/→ 循环） |
| `/resume` | 全屏会话浏览器（搜索/预览/跨项目/子 agent 折叠/重命名/删除/清理） | 会话 picker（列表 + 搜索 + 标题缓存回填） |

## 3. 输入与交互差异

### 3.1 消息投递三态（核心交互模型不同）

| 状态 | 远程（CC 语义） | 本地（web 语义） |
|---|---|---|
| Enter（busy） | **steer**（注入下一步边界，默认） | **queue**（默认，上限 10 FIFO；`DSH_TUI_ENTER=steer` 切换） |
| Tab（busy） | **follow-up**（排入回合之后） | Tab 是焦点环，无 follow-up |
| Ctrl+Enter（⌘Enter） | **interrupt 并立即发送** | 无此键 |
| Esc（busy） | 中断并**重投 pending 消息** | 中断（无重投） |

### 3.2 @ 文件引用与图片附件（远程强项，本地 ⛔）

- 远程：任意位置 `@` 补全（前缀**或 basename** 匹配、目录深入、带空格路径自动加引号 `@"path"`）；文本文件/目录自动附加；**PNG/JPEG/WebP/GIF 经附件库作为图片块发送**；Ctrl+V 粘贴文件管理器文件/剪贴板位图 → `[Image #N]`（文本不含 base64）。
- 本地：仅 `@/#` 路径补全（slash 补全因 pi-tui 0.84.1 Enter-confirms bug 移除）；read_image 占位行；粘贴仅文本 + 30 行确认。

### 3.3 搜索体系（入口错位）

| 能力 | 远程 | 本地 |
|---|---|---|
| 输入历史搜索 | Ctrl+R（history.jsonl 200 条 + 相对时间） | ↑/↓ 历史回显 |
| 会话列表 | /resume 全屏浏览器 | Ctrl+R 会话 picker |
| 会话全文搜索 | 转录模式 `/` + `n`/`N`（含工具参数/结果） | Ctrl+F 本地条目搜索 |
| 后端会话搜索 | 浏览器内实时 | picker 250ms 防抖 searchSessions ✅ |

### 3.4 鼠标与选区（远程 fullscreen，本地键盘化）

- 远程（fullscreen: true）：拖拽选区**松开即复制**（OSC 52 + wl-copy/xclip/xsel/tmux）、双击/三击、单击消息行展开、单击「加载更早」/StickyHeader/「↓ N new」、单击超链接、键盘扩展选区。
- 本地：不监听鼠标点击（图标纯状态标记），Tab 焦点环 + Enter 展开；滚轮保留。
- 消息选择模式：远程 Shift+Up；本地无。

### 3.5 其他输入差异

- 外部编辑器：远程全局 Ctrl+X 编辑当前输入；本地 cc 预设 Ctrl+X=复制回复、编辑走 /compose。
- Shift+Tab 会话模式循环（默认→计划→完全访问，plan/sandbox/approval 原子组合）：远程有；本地无。
- Ctrl+O：远程=transcript 详情展开；本地=jobs 折叠。
- Ctrl+P：远程=loaded-context 面板；本地 cc=权限预设行内循环。
- ⌘ 修饰键：远程 macOS ⌘V/⌘O/⌘Enter；本地无。
- 终端 tab 标题：远程 `⠂/⠐ 🐋 <标题>` 动画；本地无。
- StickyPromptHeader/NewMessagesPill：远程有；本地仅「↓ 回到底部 (End)」提示。

### 3.6 问卷 / plan review / 审批

- 问卷：两边都全。远程最后一行恒为自由输入（选项行直接打字=选项标签+自定义文本）、并发子代理 FIFO；本地 `i/n` 进度 + 数字直选 + 上一题/跳过（web 文案逐字）。
- plan review：远程完整（1/2 直选、底部反馈行、批准带反馈报错=继续规划、Esc 打断）；本地 🟡 仅 approve ✓（无「去讨论」）。
- 审批：两边都有 allow-once/reject。远程 1/2 + Esc/Ctrl+C fail-closed；本地有审批审计行 + CC-02 命令块富化（回查工具卡）+ 120s 超时 + 非捕获卡。

## 4. 会话工作流差异

- **/resume**：远程全屏浏览器（实时搜索标题/目录/分支/模型、Tab 预览、ctrl+a 跨项目、ctrl+b 分支过滤、ctrl+s 子 agent 折叠、ctrl+r/ctrl+d 重命名/删除、ctrl+x 清理空会话、标题证据分级、定界窗口 + 变更令牌缓存、MRU last-used.json、zstd 帧链遍历 4× 快）；本地 picker（列表 + 搜索 + 标题缓存回填，无预览/跨项目/子 agent/重命名删除）。
- **rewind vs fork**：远程时间回溯（双 Esc、插件可介入）；本地分支（Ctrl+B 分支点选择器 + /clone）。
- **子 agent**：远程会话级折叠/计数/清理 + /agents；本地 `◆ subagent` 徽标行 + one-shot 只读守卫。
- **队列**：远程 Alt+Up 取回 + Esc 重投；本地 Enter 入队（上限 10）+ 队首预览 + /queue dock。

## 5. UI/显示差异

### 5.1 状态观察（远程大幅领先）

| 能力 | 远程 | 本地 |
|---|---|---|
| 工作状态行动画 | dsh-working-activity（30 帧动画选择器、ice-blue sweep、`⚠ ctx N%` 压力前缀、token 后缀；publish:false 不污染日志） | 品牌 shimmer + spinner（DSH_TUI_ANIM=0 冻结） |
| TPS 仪表 | 1/8 格 gauge + min-max sparkline + 语义色（≥50 绿/≥20 黄/<20 红） | 无 |
| 上下文进度条 | contextBar 5 段（system/prompt/assistant/thinking/tools 分类着色、最大余数法、标签自适应收缩） | footer `ctx N%` + 10 段三段彩条 |
| loaded-context 面板 | Ctrl+P 切换（分节摘要） | 无 |
| 每消息统计 | Ran for/TTFT/tok/s + 轮次结局 | ⏱/⚡/tok/s + 结局徽标 ✅ |
| 会话统计条 | StatusMetrics | stats.ts（web StatsLine 同款）✅ |

### 5.2 渲染能力（各有胜负）

| 能力 | 远程 | 本地 |
|---|---|---|
| TeX 数学 | ❌ | ✅ pi renderLatex |
| Mermaid | ❌ | ✅ grok-mermaid |
| Diff | SplitDiffView 分屏（diffLayout 可配） | 词级红绿 + hunk 头（无分屏） |
| 表格 | MarkdownTable | pi GFM 子集 |
| 布局级虚拟化 | ✅ 屏外行高度占位 + painted-once + expansion hold + sticky 夹紧 + MemoRow | ❌ O(n)（依赖 compaction） |
| 回放合并/有界缓存 | ✅ 合并 chunk + 各缓存上限 | 流式合帧 + 条目身份增量更新 |
| 工具卡 | 结构化卡片 + 分类状态点 + ToolUseLoader | 终端卡/read 卡/grep 分组/web_search 引用/**run_code 递归子调用树** + `i` raw input |

### 5.3 主题与设置

- 远程：颜色主题（light/dark/dark-ansi/auto + **自定义 JSON** 100 语义键 + 6 种颜色格式 + 路径穿越防护 + 损坏容错）；`/settings` 命名空间编辑器（statusBar 15 项/diffLayout/thinkingFold/toolBackground、secret 字段、[restart] 徽标、revision 栅栏）。
- 本地：视觉主题四预设（web/cc/pi/opencode × dark/light，web token 逐字）；`/settings` 六行聚合面板。

## 6. 插件生态与扩展性（最大架构差异）

| 维度 | 远程 | 本地 |
|---|---|---|
| 插件宿主 | TuiPluginHost：grants 8 权限（7 默认拒）/storage.local（256 键/256 KiB 原子写）/messages.observe（收窄映射）/effect-ledger（C-060 台账）/command-attribution/decision-guard | ❌ 无（out-of-tree 约束：只能挂 dsh 已携带插件；storage 域挂载静默挂起） |
| 接缝 | 13 个：会话事件/prompt 槽位/技能打包/主题/系统 prompt 段/设置区块/profile 组合/全屏场景/决策事件/托管对话框/状态行/快捷键/自定义渲染器 | ❌ 无公开接缝（仅 sessionProjections select 形态投影自动获得 chip + Ctrl+P） |
| 规范 | dsh-ecosystem-spec 社区规范（五态协商、信任模型 C-070）、dsh-tui-ecosystem 组织、plugin-template 模板、dsh-working-activity 参考实现 | ❌ |
| 公共 API | 11 个导出子路径 | 仅 `.` / `./startup` |
| 打包 | 7 技能 + liangshen 梁神 preset（首轮 Minimal 双工具锚定 → 首次调用后开放全目录 → 压缩后重锚；Windows Git Bash 自动发现） | 无 |

## 7. 平台与工程差异

| 维度 | 远程 | 本地 |
|---|---|---|
| 安装 | npm 全局 + dsh-tui bin + install.sh + Windows .cmd + 旧包迁移（dsh-cc-tui/cc-tui、~/.dsh-cc 自动复制、旧环境变量警告、resume.txt 双写） | `dsh plugin add @mcswift/dsh-tui` / `link:` |
| 自更新 | /update + 后台检查 + Launcher 对齐 + 混合态拒绝 + tmp-rename 竞态重试 | ❌ |
| VS Code | companion 扩展 dsh-tui-vscode（已上架 Marketplace，真实集成终端承载） | ❌ |
| 配置 | cordis.patch.yml 全字段（provider/model/cwd/workspace/effort/modes/activity/activityFrames/contextBar/fullscreen/preset/sessionId）+ 22 环境变量 | cordis.patch.yml（persona/hmr/tools + insert 三行）+ 11 环境变量 |
| 持久化 | ~/.dsh-tui/ 14 种文件（theme/themes/agent-preset/model/effort/lang/working-activity/resume/last-used/history/extension-grants/plugin-storage/effect-ledger…） | $DSH_HOME sidecar 6 种（keymap/theme-preset/titles/history/feedback/settings） |
| 技术栈 | React 19 + react-reconciler + 移植 Ink + marked + cli-highlight | pi-tui 0.84.1 vendor + hljs + grok-mermaid + diff |
| 验证 | 100+ verify/repro + 15 步门禁 + 泄漏/堆快照/PTY/并发脚本 | 26 spec ≈349 单测 + 8 段 PTY E2E |
| 运维细节 | childStderr 捕获（ANSI 剥离 + 去重折叠）、promptDebug、force-production-react、退出漏斗（teardown 区分）、zstd 帧链遍历、migrate-sessions-to-jsonl | 双 flush、标题缓存回填、Warp OSC 777 通知 |

## 8. 本地独有 / 更强（远程没有的点）

1. **web 对齐基线**：148 项逐包审计清单 + 双语文案逐字取自 web locale 表。
2. **三键位预设 + 交互画像三维**（cc/pi/opencode，opencode Ctrl+X leader 和弦、slash popup 语式）。
3. **消息评分**（/rate + Ctrl+Y + 备注 + sidecar）。
4. **Ctrl+B 分支点选择器 + /clone**。
5. **workflow 运行树面板**（run→member 层级、四事件结构化 fold）。
6. **TeX + Mermaid 渲染**。
7. **/queue dock**。
8. **run_code 递归子调用树**。
9. **审批审计行 + CC-02 命令块富化**（工具卡回查）。
10. **Warp/OSC 777 桌面通知**。
11. **命令别名体系**、**启动标题回填**、**flushSettled 双 flush**、**纯函数 fold 投影**。
12. **/settings 六行聚合面板**（数字直选 + 行内循环，随主题预设换肤）。

## 9. 差距雷达（5 分制）

| 功能域 | 远程 | 本地 | 差距来源 |
|---|---|---|---|
| 命令面 | 4.5 | 2.5 | 45+ vs 22 原生命令 |
| 会话工作流 | 4.5 | 3.0 | 全屏浏览器/rewind/btw vs picker/fork |
| 状态观察 | 4.5 | 2.5 | 动画 30 帧/TPS/5 段 context bar vs shimmer/ctx% |
| 输入体验 | 4.5 | 2.5 | 图片附件/鼠标/选择模式 vs 文本键盘 |
| 渲染精度 | 3.5 | 4.5 | 本地 TeX/Mermaid/词级 diff/子调用树更全 |
| 主题系统 | 4.0 | 3.5 | 自定义 JSON + 100 键 vs 四预设 × 双明暗 |
| 插件生态 | 5.0 | 0.5 | 13 接缝 + 规范 + 社区 vs 无（架构约束） |
| 设置面板 | 4.0 | 3.0 | 命名空间编辑器 vs 六行聚合 |
| 平台运维 | 4.5 | 1.0 | /update + VSCode 扩展 + 迁移 + 发布 vs 无 |
| web 对齐 | 2.5 | 4.5 | 148 项清单 + 双语逐字是本地独有资产 |
| 键位体系 | 2.0 | 4.5 | cc/pi/opencode 三预设 + 交互画像三维 |
| 消息操作 | 2.0 | 4.5 | /rate、/clone、/queue dock 本地独有 |

## 10. 结论

两者同源（DSH 插件栈 + fold 纯函数投影 + 差分渲染），但**远程是「CC 风格完整
产品」**（命令面/会话工作流/状态观察/插件生态/平台运维全面领先，迭代活跃），
**本地是「web 语义精修型 profile」**（渲染精度、web 对齐、键位体系、消息操作与
纯函数架构是差异化优势）。以功能覆盖为标尺远程整体领先约一个量级；以「与官方
web 客户端语义零漂移 + 可控维护」为标尺本地架构更收敛。

实现取舍原则（详见两份 BACKLOG）：
- 优先补**命令面 + 状态观察 + 三态投递**等低风险高感知项；
- **插件生态/VS Code 扩展/自更新**受 out-of-tree 约束或需发布流程，列为架构评估；
- cc 预设的 Claude Code 交互对齐单独跟踪（BACKLOG-CC-PARITY.md）。
