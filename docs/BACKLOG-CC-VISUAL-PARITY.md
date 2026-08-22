# BACKLOG-CC-VISUAL-PARITY.md — cc 预设与 Claude Code 的**视觉渲染**对齐清单

> 范围：**视觉语式层**（渲染出来的样子），与 [BACKLOG-CC-PARITY.md](BACKLOG-CC-PARITY.md)
> （交互/键位层）互补。本文只关心「看起来像不像 Claude Code」，不讨论按键语义。
> 基准：Claude Code 原版视觉基线（subagent `dd3f53c9` 交付 + claude-code-best/claude-code
> 源码核对 + code.claude.com 文档）。本地现状以 **regular（主屏 scrollback）为默认** 的快照为准
> （`--fullscreen` 才是视口渲染，本文在每项标注两种形态差异）。
> 方法：PTY + pyte 捕获实际渲染帧（`scripts/e2e-pty.py` 同款 drain 模型），逐元素与 CC 对比。
> 优先级：P0 一上手就感知不对 · P1 高价值 · P2 打磨。状态：✅ 已对齐（本会话落地）· 🟡 有差距 · ⏸️ 暂缓（pi 受限）。
> 验收：每批 `pnpm typecheck` + `pnpm test` + 至少一轮完整 PTY E2E；新文案进 `src/view/strings.ts` 双语。

---

## 1. 核心视觉差距表

| # | 元素 | Claude Code 实际形态 | 本地 cc 预设现状（regular 帧） | 差距判定 | 方案要点 | 优先级/工作量 |
|---|---|---|---|---|---|---|
| V1 | **用户消息** | classic：`❯` 前缀 + 纯文本回显（无气泡）；fullscreen：背景块 + `You` 标签 | cc+regular 已对齐：`❯` 前缀 + 纯文本回显 ✅；fullscreen 保留气泡（缺 `You` 标签） | 🟡 已对齐 classic | classic（regular）✅（本会话落地，cc 专属，pi 预设保留气泡）；fullscreen 补 `You` 标签 | P0 / S ✅(classic) |
| V2 | **助手/用户消息标签** | fullscreen：`Claude`（助手）+ `You`（用户）标签；classic（regular）：无标签 | fullscreen 已对齐：`Claude`/`You` 标签 ✅；classic 无标签 ✅ | ✅ 已对齐 | fullscreen 下 cc 预设补 `You`/`Claude` 标签（本会话落地，`src/view/pi-vendor/{user-message,assistant-message}.ts` label + `src/app/pi-tui-app.ts` createEntryView 按 `keymap==='cc' && !regular`）；pi 预设不加 | P1 / S ✅ |
| V3 | **thinking 状态** | `Thinking for Ns` 实时计数 + ≤10 行折叠 Markdown + Ctrl+O 展开 | 自动折叠成一行 + `Thinking…` 文案，无实时秒计数 | 🟡 缺计数与折叠样式 | ✅（2026-08-22 落地计数）：折叠行显示 `Thinking for Ns`（流式中实时跳秒、committed 定格）；≤10 行折叠摘要保持现状（单行折叠 + Enter 展开，保留分级着色） | P1 / M ✅(计数) |
| V4 | **输入框** | `❯`（U+276F）提示符 + **边框颜色随权限语义**（promptBorder/planMode/autoAccept/bashBorder）；无圆角证据 | pi Editor（无边框、无 `❯` 提示符） | 🟡 语式不符 | ✅（2026-08-22 落地边框色）：cc 预设输入框边框随权限语义着色（workspace-write 蓝 / full-access 红 / read-only 灰，`editor.borderColor` 运行时赋值，pi 预设还原主题边框）；**`❯` 提示符与 B15 同受限**（Editor 无 prompt 槽，HStack 包装会影响 editor 宽度/光标锚定——引用 B15 评估结论） | P1 / M ✅(边框色) |
| V5 | **busy 状态行** | `<frame> <动词>… (时长 · ↓ N tokens)` 如 `✻ Herding… (8m 39s · ↓ 834 tokens)`；帧 `·✢✳✶✻✽` | 星芒帧 ✅ + **恒常括号时钟已落地**（`✳ Deep diving... (2秒)`）、**文本用回 dsh `Deep diving...`（2026-08-21 用户折中决策，不复用随机动词）**、**尚缺 `↓ N tokens` 后缀** | 🟡 已部分对齐 | ✅（2026-08-22 落地）：cc 预设 busy 行追加 ` · ↓ N tokens`（流式无逐 token usage → decodeSamples 字符累计 /4 近似，与 C1 同口径；`tokens` 原文不本地化，同 `tok/s`） | P1 / M ✅(tokens) |
| V6 | **工具卡** | 折叠摘要；**非零退出 = 红点 + 输出对用户隐藏**；Ctrl+O 详情 | 已对齐：错误态折叠隐藏输出 + `✗ 失败`（✅）；红点字形仍用 `✗` | 🟡 已部分对齐 | 错误态折叠隐藏输出 ✅（本会话落地，`✗ 失败 · N 行输出（⏎ 展开）`，Enter/Ctrl+O 展开看完整）；红点字形 `✗` 保留（CC 为红点 `●`，字形待定） | P1 / S ✅(隐藏) |
| V7 | **顶部 header** | **无固定 header 栏**；会话标题 chip 挂在输入框下边框；model+effort 在会话 header | 无固定 header ✅（与 CC 一致）；会话信息在 footer | ✅ 基本对齐 | 保持；确认会话标题 chip 落到输入区下方而非 footer | P2 / S |
| V8 | **footer / status line** | 状态行可配置；footer 有快捷键提示 + 右对齐徽标 | 双行 footer（stats 行 + 会话信息行） | 🟡 语式差异 | 对齐 CC 的 status line 配置 + 右对齐徽标（可选，P2 打磨） | P2 / M |
| V9 | **slash 菜单** | `/`+前缀过滤（非 fuzzy）+ 名称/描述两列 + fullscreen hover 高亮 | 已对齐：名称列对齐 + 描述列 + 整行高亮 + per-idiom 宽度 | ✅ 已对齐（本会话落地） | — | P0 / S ✅ |
| V10 | **品牌色/主题** | 品牌橙 `#D97757` | 本地 cc 主题已有 warm-orange accent（`#D97757` 风格） | ✅ 已对齐 | — | P2 / S |

---

## 2. 已对齐项（本会话落地，避免重复实现）

- **slash 菜单**：per-idiom 宽度、名称列对齐（含 hint）、描述列从对齐起点开始、选中整行高亮（V9）。
- **busy spinner**：`·✢✳✶✻✽` 星芒帧（80ms），对齐 CC 的 SpinnerGlyph（V5 帧部分）。
- **busy 恒常括号时钟**：cc 预设从 0s 起就显示 `(Xm Ys)` 括号耗时（V5 时钟部分），对齐 CC 的
  `✻ Herding… (8m 39s · ↓ N tokens)` 语式（`src/app/pi-tui-app.ts` applyStatusLines，cc 专属，
  非 cc 预设保留 web 15s 门）。
- **busy 文本保留 dsh `Deep diving...`（2026-08-21 用户折中决策）**：cc 预设 busy 文本用回 dsh 标志性
  `Deep diving...`（不复用 CC 随机动词，B14 相应调整），仅保留 CC 括号恒常时钟与星芒 spinner；
  实机帧 `✳ Deep diving... (2秒)`。
- **用户消息 `❯` 回显（classic）**：cc + regular（默认）下用户消息渲染为 `❯ 消息` 纯文本回显、无气泡
  （V1 classic，`src/view/pi-vendor/user-message.ts` classic 模式 + `src/app/pi-tui-app.ts`
  createEntryView 按 `keymap==='cc' && regular` 选中）；fullscreen 与 pi 预设保留气泡。
- **工具卡错误态折叠隐藏输出**：错误工具收起态显示 `✗ 失败 · N 行输出（⏎ 展开）`，不向用户展示失败
  输出内容（V6，`src/view/pi-vendor/tool-execution.ts` collapsedSummaryLine，Enter/Ctrl+O 展开看完整）。
- **fullscreen 消息归属标签**：cc 预设 fullscreen 下用户消息上方 `You`、助手消息上方 `Claude`（V2，
  `src/view/pi-vendor/user-message.ts`/`assistant-message.ts` label + createEntryView 按
  `keymap==='cc' && !regular` 选中；`src/view/strings.ts` 双语 `youLabel`/`claudeLabel`）。
- **顶部无固定 header**：与 CC classic 一致（V7）。
- **助手消息纯 Markdown 无 bullet**：与 CC classic 一致（V2 classic 部分）。

---

## 3. 优先级建议（继续落地的批次）

| 批次 | 内容 | 预期效果 |
|---|---|---|
| 批次 A（classic 首屏 P0） | V1 用户消息 `❯` 前缀（regular 去气泡）；V5 busy 恒常时钟 + `↓ N tokens` | regular 默认下首屏一瞥即像 CC |
| 批次 B（fullscreen 标签） | V2 `Claude` 标签、V3 `Thinking for Ns` 计数、V6 工具卡红点 | 视口模式标签/状态点对齐 |
| 批次 C（输入框语义） | V4 输入框 `❯` 前缀 + 权限语义边框色（pi borderColor） | 输入区语式对齐（圆角形态暂缓 B15） |
| 批次 D（打磨） | V8 footer/status line、V10 品牌色微调 | 细节打磨 |

> 备注：V4 完整「圆角边框 + `❯` 提示符位置」受 pi-tui 0.84.1 输入组件 seam 限制（B15 评估结论），
> 但**权限语义边框色**与 **`❯` 前缀**可先落地；V1 的 `❯` 前缀与 V4 的输入框 `❯` 是同一符号语义，
> 需确认不会与 IME preedit 冲突（CC 空输入刻意无 placeholder 即为 IME 保护，本地同理保持空输入）。
