# BACKLOG-CC-PARITY.md — cc 预设与 Claude Code 的广义交互对齐清单（Part B）

> 来源：[docs/COMMUNITY-COMPARISON.md](COMMUNITY-COMPARISON.md)。
> 范围：**广义交互层**——cc 键位预设（默认预设）在「像 Claude Code」这件事上不如
> 远程 dsh-TUI（CC 风格复刻）的地方。包括：键位与投递语义、Esc/Ctrl+C 层级、
> 菜单/卡片语式、工作流手势、视觉语式。功能命令本身的缺口（/status /doctor 等）
> 在 [BACKLOG-FEATURE-GAP.md](BACKLOG-FEATURE-GAP.md) 的 A 组，本清单只在需要时引用。
> 对齐基准：Claude Code 原版交互语义 + 远程 dsh-TUI 的 CC 复刻实现（两者冲突时以
> CC 原版为准并注明）。
> 本地现状以 `src/app/pi/keymaps.ts` 的 CC_KEYMAP 为准（2026-08-20 快照）。
> 优先级：P0 手感缺陷（CC 用户一上手就感知不对）· P1 高价值 · P2 打磨/视觉语式。
> 状态：✅ 已完成（2026-08-20，P0/P1/P2 全部 + B13 命令面）：B1–B14、B16–B20 落地；
> B13 命令面已落地（/status /tokens /cost /doctor /init /agents /skills /mcp /permissions /login /logout /add-dir /hooks /vim /terminal-setup /connect）；B15 评估后暂缓（pi Editor 边框内部绘制、无 prompt/圆角选项，包装会破坏滚动指示器与 IME 光标锚定，待 pi 升级）。
> 优先级：P0 手感缺陷（CC 用户一上手就感知不对）· P1 高价值 · P2 打磨/视觉语式。

## 1. 核心差距表

| # | 交互点 | 本地 cc 预设现状 | Claude Code 行为（远程对齐版） | 差距判定 | 方案要点 | 优先级/工作量 |
|---|---|---|---|---|---|---|
| B1 | **Enter（busy）** | queue：入队到回合结束后（web 语义，`DSH_TUI_ENTER=steer` 可翻转） | **steer**：注入当前回合下一步边界，不中断（默认即如此） | ❌ 语义相反，最大差距 | cc 预设下 busy Enter 默认 = steer（仅 cc 预设翻转默认值，pi/opencode 保持各自画像；`DSH_TUI_ENTER` 仍可覆盖）；队列语义保留给 follow-up/显式 queue | P0 / M | ✅ |
| B2 | **Ctrl+C（busy）** | swallow：吞掉按键（不中断） | **中断当前回合**（Esc 亦中断，两键并存） | ❌ 吞掉是本地自定义，CC 用户按 Ctrl+C 无反应 | cc 预设 busy Ctrl+C = interrupt（与 Esc 同动作）；吞掉行为移除或降级为 opencode 预设专属 | P0 / S | ✅ |
| B3 | **Ctrl+C（idle）** | 单次即退出 | **清空输入 → 连按两次退出**（3s 窗口，提示「再按一次退出」） | ❌ 单次退出误触风险高 | cc 预设 idle Ctrl+C 分两段：有输入=清空并解除退出待命；空输入=进入退出待命（3s 内再按才退出）；Ctrl+D 保持双按退出 | P0 / S | ✅ |
| B4 | **Tab（busy + 输入非空）** | 焦点环（Tab 恒为焦点循环） | **follow-up**：排入当前回合之后处理（提示「将在回合后处理」） | ❌ 无 follow-up 语义 | busy 且输入非空时 Tab = follow-up 入队（复用队列机制，区分 steer/follow-up 放置位置）；输入为空保持焦点环 | P1 / M | ✅ |
| B5 | **Ctrl+Enter** | 无此键 | **interrupt 并立即发送**（打断当前回合，投递输入） | ❌ 缺失 | keymaps 增动作 `interruptSend`：busy=中断并投递、idle=直接发送；cc 预设绑定 | P1 / S | ✅ |
| B6 | **Esc（busy）** | 中断（pending 消息留在队列/输入框） | **中断并立即重投 pending 消息**（Codex 语义） | 🟡 缺重投 | 中断时若有未领取消息 → 中断落定后自动重投（或提示「已重投」）；与 Alt+Up 取回共存 | P1 / M | ✅ |
| B7 ✅ | **/rewind 时间回溯** | 无（只有 Ctrl+B fork 分支） | CC 有 `/rewind` 命令（恢复早期消息）；远程扩展为**空输入双击 Esc = rewind** | ❌ 缺失 | 见 BACKLOG-FEATURE-GAP A11：用户消息选择器 + fork 回放 + 原消息回填；cc 预设下空输入双击 Esc 从「清空」升级为「清空 → 双击 rewind」层级 | P1 / L |
| B8 ✅ | **Shift+Tab 会话模式循环** | 无 | CC 的 Shift+Tab 在 normal/plan 等模式间切换；远程为 默认 → 计划 → 完全访问（plan/sandbox/approval 原子组合） | ❌ 缺失 | 模式循环纯函数（sessionModes 式）+ Shift+Tab 键 + 当前模式状态行 chip；模式切换缝隙验证（plan-mode/sandbox-policy/approval） | P1 / M |
| B9 ✅ | **@ 文件引用** | `@/#` 路径补全（无 basename、无引号、无自动附加） | 任意位置 `@` 菜单（basename 匹配、目录深入、`@"path"` 引号）、发送时文本文件内容/目录自动附加——CC 招牌交互 | ❌ 弱化 | 见 BACKLOG-FEATURE-GAP B3 | P1 / M |
| B10 ✅ | **slash 命令 Tab 补全** | 内联菜单形态已对齐（spacious：名称/提示/描述全量），但 **Tab 补全命令名被移除**（pi-tui 0.84.1 Enter-confirms-suggestion bug，补全弹层 Enter 会把 `/quit` 变 `/quiquit`） | CC 中 `/` 菜单 Tab/Enter 均可选中补全 | 🟡 补全被禁 | 修复或等价实现：补全弹层打开时 Enter 先取消补全再提交（本地已有 editor.handleInput 包装，回归测试已修 `/quiquit`）——恢复 Tab 补全需要绕开 pi bug 或升级 pi；不阻塞时保持现状并记录 | P2 / M |
| B11 ✅ | **plan review** | 计划全文渲染 + approve ✓（C3 🟡，无「去讨论」、无反馈行） | 批准 / 拒绝 / **去聊天讨论**三选项 + 底部反馈输入行（批准带反馈=继续规划语义）、`1`/`2` 直选、Esc 打断 | 🟡 缺两要素 | ① 加「去聊天讨论」选项（ASK_CANCELLED + 模型停留计划模式）；② 底部反馈输入行（Enter 提交=继续规划+反馈；批准行带反馈报错） | P1 / M |
| B12 ✅ | **/export 语义** | 展示 jsonl 路径 + flush | CC 的 `/export` 导出 **Markdown 文件**（用户/思考/助手/工具分节） | 🟡 语义不同 | 见 BACKLOG-FEATURE-GAP A22 | P2 / M |
| B13 ✅ | **命令全集完整性** | 缺 /status /cost /doctor /init /config /permissions /login /logout /mcp /vim /terminal-setup /connect /rewind /audit /bug /review /practice /pr_comments /release-notes /vuln-check | CC 指令全集复刻 | ❌ 缺口 | 全部见 BACKLOG-FEATURE-GAP A 组；本清单只跟踪「cc 画像完整性」验收：cc 预设下 `/` 菜单覆盖 CC 主命令集 | P1 / L（随 A 组） |
| B14 ✅ | **busy 提示语式** | `Deep diving...`（web 文案）+ 15s 时钟 + 品牌 shimmer | 随机动词 spinner（Working…/Thinking…，每回合一次）+ token/上传/elapsed 计数 + thinking 状态最少展示 2s | 🟡 文案与形态非 CC | 已落地并**按 2026-08-21 用户决策折中**：cc 预设保留 dsh 标志性 `Deep diving...` 文本（不复用随机动词），但保留 CC 括号恒常时钟 `(Xm Ys)` + 星芒 spinner（见 BACKLOG-CC-VISUAL-PARITY V5） | P2 / M |
| B15 ⏸️ | **输入框形态** | pi Editor（无边框） | CC 圆角边框 + `❯` 提示符 + 空输入刻意无 placeholder（IME preedit 保护） | 🟡 视觉语式 | cc 预设下输入框换 CC 形态：上下边框 + `❯` 前缀 + 多行窗口（≤5 行、caret 行可见）——pi Editor 定制或包一层 chrome；**大改，需先探 pi 输入组件 seam** | P2 / L |
| B16 ✅ | **StickyPromptHeader / NewMessagesPill** | 仅「↓ 回到底部 (End)」提示 | 向上滚动时钉住最后一条用户消息 + `↓ N new messages` 计数 pill（点击回底） | 🟡 弱化 | 见 BACKLOG-FEATURE-GAP B13 | P2 / M |
| B17 ✅ | **steer/follow-up 未领取区** | busy 状态行队首预览（1 条） | 输入框上方 `⚡steer 区` + `⏳follow-up 区`（`↳` 缩进，多消息可见） | 🟡 弱化 | 见 BACKLOG-FEATURE-GAP B14 | P2 / S |
| B18 ✅ | **Ctrl+X 语义** | 复制最近回复（OSC 52） | CC 无此全局键；远程 = 编辑当前输入（外部编辑器） | ⚠️ 自定义键位与 CC 无关 | 决策项：cc 预设 Ctrl+X 改绑「编辑当前输入」（对齐远程 CC 复刻），复制改绑他处（如 leader 或保留 Alt 系）；或保持现状并文档化 | P2 / S（决策后） |
| B19 ✅ | **退出恢复命令** | 退出后无恢复提示 | 远程退出时打印恢复命令（`dsh --profile <p> ` / `dsh-tui --resume <id>`） | 🟡 缺提示 | 退出前打印「恢复本会话：dsh --profile tui --resume <id>」一行 | P3 / S |
| B20 | **双按退出窗口提示** | Ctrl+D 双按退出（已有） | Ctrl+C/Ctrl+D 均双按 + 「再按一次退出」提示（3s 窗口） | 🟡 提示缺失 | 与 B3 一并实现提示文案（strings.ts 双语） | P0（随 B3）/ S | ✅ |

## 2. 已对齐项（不需重做，避免重复实现）

- **Esc 层级**：slash 菜单 Esc 关闭 ✅、补全弹层 Esc 先取消再提交 ✅、焦点复位 ✅。
- **Alt+Up 取回**：取回最后一条未处理消息 ✅。
- **? 帮助菜单**：/hotkeys 分组对齐列面板（内容随预设切换）✅。
- **审批卡形态**：cc = plain 无边框 + 数字直选 ✅（interaction.card）。
- **enum 行内循环**：cc = ←/→ 行内循环 ✅（interaction.enum）。
- **斜杠菜单语式**：cc = spacious 内联菜单（名称/提示/描述全量）✅（interaction.slash）。
- **/new 非破坏性**：旧会话可经 /resume 找回 ✅。
- **Shift+Enter 换行 / Ctrl+J / Option+Enter 兜底**：本地 Shift+Enter 换行 ✅（Ctrl+J/Option+Enter 兜底需确认，P3 补）。
- **大段粘贴确认**：30 行确认弹窗 ✅（CC 为单事务粘贴 + 异步升级，行为等价）。

## 3. 实施批次建议

| 批次 | 内容 | 预期效果 |
|---|---|---|
| 批次 1（手感 P0） ✅ | B1 Enter=steer（cc 默认翻转）、B2 busy Ctrl+C 中断、B3+B20 idle 双按退出 | CC 用户首屏手感一致 | ✅ |
| 批次 2（投递闭环） ✅ | B4 Tab follow-up、B5 Ctrl+Enter、B6 Esc 重投 pending | 三态投递完整（与 Part A 批次 1 联动） | ✅ |
| 批次 3（工作流） ✅ | B8 Shift+Tab 模式、B11 plan review 补全、B7 /rewind | CC 核心工作流手势 |
| 批次 4（语式打磨） ✅ | B14 busy 动词、B16 NewMessagesPill、B17 未领取区、B19 退出恢复命令 | 视觉与状态语式 |
| 批次 5（评估） ✅ | B10 slash Tab 补全（自研 slash menu 已绕开 pi bug）、B18 Ctrl+X 决策；B15 暂缓 | 大改/依赖 pi seam 项，先探再排 |

> 验收通则：每批 `pnpm typecheck` + `pnpm test`（351 项全绿）+ 至少一轮完整 PTY E2E；
> 键位改动补 `tests/pi/keymaps.spec.ts`（三预设解析 + leader 和弦）；新文案进
> `src/view/strings.ts` 双语；cc 预设改动不得破坏 pi/opencode 预设（交互画像三维
> 是预设隔离的，见 keymaps.ts InteractionProfile）。
