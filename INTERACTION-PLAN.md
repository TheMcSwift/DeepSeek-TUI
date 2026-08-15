# 交互全面审计与优化方案（dsh-tui）

> 审计基线：M1–M4 + 弹窗/IME 修复后的现状（63 单测 + 五场景 E2E 全绿）。
> 每项 = 现状 → 问题 → 方案 → 优先级（P0 交互缺陷 / P1 体验缺口 / P2 打磨）→ 工作量（S/M/L）。
> 已核实的上游事实：pi-tui 0.84.1 无 alt-screen 搜索（暂缓项）、Markdown 已原生输出 OSC8 超链接、
> DSH 事件词表含 `plan/mode`、`subagent/descriptor`、`feedback/record`、`permission/preset`。

## 1. 内容渲染

### 1.1 工具卡展开/折叠 — P0 / M ⚠️ 交互缺失
- 现状：`ToolExecutionComponent.expanded` 永远 false；长输出硬截断 6 行 + `…`（无行数、无展开入口）。
- 方案：① 输出渲染改为 `truncateToVisualLines` + 「… N more lines」计数；② 工具卡 Enter 切换 expanded
  （overlay 焦点语义已验证的 DialogPanel 模式，或全局键 `app.tools.expand` 绑定到卡片组件）；③ 展开态渲染完整输出。
- 测试：假终端 Enter 展开/折叠 + 截断计数单测；E2E 长输出场景。

### 1.2 错误 turn 渲染 — P0 / S ⚠️ 目前完全不可见
- 现状：`turn/end {reason:{kind:'error'}}` 被投影丢弃——agent 失败时界面毫无痕迹（只剩 busy 结束）。
- 方案：Projection 新增 `ErrorEntry`（红色卡片：code/message）；View 渲染；E2E mock 一个 error turn。

### 1.3 中断反馈 — P0 / S
- 现状：`turn/end` aborted 与 completed 无区分。
- 方案：投影保留终止原因 → 尾部 StatusEntry「已中断」/ ErrorEntry 复用。

### 1.4 thinking 折叠与分级 — P1 / M
- 现状：reasoning 块裸渲染，无折叠、无「Thinking…」标签、无分级着色。
- 方案：全局键 `Ctrl+T` 切换隐藏（`AssistantMessageComponent.setHideThinkingBlock`）；隐藏态显示
  `hiddenThinkingLabel`（dim）；分级着色复用 palette 已有的 `thinkingOff…thinkingMax` 语义色。

### 1.5 代码块增强 — P1 / S
- 现状：hljs 高亮 ✓（palette 重着色）。
- 方案：语言标签行（Markdown transform 注入 `` ```lang `` 头 → 渲染首行 dim 标签）；行号不做（收益低）。

### 1.6 系统行 — P1 / M
- 现状：`session/title`、`permission/preset`、`plan/mode`、`agent-preset/selected` 事件无呈现（web 有系统行）。
- 方案：投影为 `SystemEntry`（单行 dim：标题生成/权限预设切换/模型切换/plan 模式启停）→ 文档流渲染。

### 1.7 图片渲染（read_image）— P2 / L
- 现状：`showImages: false`，image-convert 是桩；DSH `read_image` 产出图片块→显示为空。
- 方案：Kitty/iTerm2 协议直接渲染 png（`ToolExecutionComponent.setShowImages(true)` + 真 image-convert，
  或跳过转换仅支持 png/jpeg 原生支持格式）；依赖终端能力检测，非支持终端回退文本。

### 1.8 长消息折叠 — P2 / M
- 方案：超长 User/Assistant 消息（> N 行）折叠为「展开 N 行」交互（复用 1.1 模式）。

### 1.9 链接 ✓ / LaTeX ✓ / mermaid ✗
- 链接：OSC8 已原生输出（终端支持即点击）——记录，补一条 E2E 断言。
- LaTeX：pi-tui Markdown 默认 Unicode 渲染 ✓——记录。
- mermaid：不引入（grok-mermaid 依赖重、DSH 无此产物）；代码块输出即可。

## 2. 输入体验

### 2.1 IME ✓（已修，待复测）；已知残余风险
- 若 Warp 仍偏移：组合期间暂停 CSI 2026 同步输出（composition 感知），列为 P1 备选。

### 2.2 busy 排队提示 — P1 / S
- 现状：busy 时可打字但 Enter 被吞，无任何视觉提示。
- 方案：busy 时编辑器边框/状态槽加「● 回复中 · 输入将保留」；turn 结束后若有缓冲文本，自动提交（
  现行为是留在缓冲等 Enter——改为提示 + 自动提交二选一，默认保留现行为 + 提示）。

### 2.3 补全完善 — P1 / M
- 现状：`@/#` 路径补全（headless 测试曾 flaky）；slash 命令补全因上游 Enter 语义移除。
- 方案：① 修路径补全的稳定触发与测试；② 斜杠命令改为**不劫持 Enter 的补全**：仅在列表打开时 Tab 确认
  （上游限制调查后决定，否则保持现状并文档化）；③ `@` 提及子代理/会话（DSH subagent 目录）。

### 2.4 输入历史持久化 — P2 / S
- 方案：Editor 历史（↑/↓）落 `$DSH_HOME/tui-history.json`（限量 200 条，读写轻量）。

### 2.5 大粘贴 — P2 / S
- 现状：bracketed paste ✓（pi 内建，>10 行有标记）。
- 方案：>N 行粘贴时提交前确认弹窗（复用 ApprovalDialog 的确认形态）。

## 3. 交互组件

### 3.1 Header 增强 — P1 / S
- 方案：+ 会话标题（`session/title` 最新值，超长截断）+ 模型 reasoning effort（meta 已含 settings 读取）。
- 数据：title 从投影（新增 SystemEntry 时同步）；effort 从 runner meta 传入。

### 3.2 Footer 增强 — P1 / M
- 方案：+ 上下文占比（token-meter 的 sessionProjections 快照读取，⚠ 核对投影读取 API）+ 当前 turn 步数。
- git 分支：DSH 无此服务，不引入。

### 3.3 Picker 增强 — P1 / M
- 方案：会话/模型选择器支持**输入过滤**（SelectList.setFilter + 键入即搜，参考 pi session-selector-search）；
  模型列表按 provider 分组（组头 dim 行）；当前值标记 ✓。

### 3.4 权限预设切换器 — P1 / M
- 现状：预设只在会话创建时钉死（settings 默认），运行中不可换。
- 方案：`Ctrl+P` 弹层（presets 列表：read-only / workspace-write / danger-full-access），选择后调用
  DSH 的预设切换缝隙（permission-presets apply / switch 工具路径，⚠ 实现时核对 API）——与审批弹窗配合形成闭环。

### 3.5 状态槽增强 — P2 / S
- 方案：Working 行加已运行时长（CountdownTimer 反用：正向计时）。

### 3.6 主题 — P2 / M
- 方案：light.json palette 并入；启动时按终端背景（pi 有 detectTerminalBackgroundFromEnv 逻辑，shim 可复制）自动选择。

### 3.7 上下文相关键位提示 — P2 / S
- 方案：footer 静态提示 → 状态相关（busy 时显示「Ctrl+C 中断」，空闲时显示「Ctrl+R 会话…」）。

## 4. 交互行为

### 4.1 会话操作 — P1 / S
- 方案：`/new` slash 命令（在 onSubmit 分支处理：flush 当前 + 新建）；会话重命名不做（DSH 无重命名缝隙）。

### 4.2 小终端适配 — P1 / S
- 现状：布局有 min 尺寸但未验证极小终端。
- 方案：<80 列时 footer 提示自动截断 ✓（已做）；<40 列时 header 隐藏会话 id；E2E 加 resize 场景。

### 4.3 错误兜底 — P2 / S
- 方案：turn 错误（1.2）+ 会话恢复失败等运行时错误 → 文档流 ErrorEntry（统一出口）。

## 5. DSH 能力渲染

### 5.1 plan-mode — P1 / M
- 现状：`plan/mode` 事件不渲染；plan-review 提问当普通弹窗（detail 是 markdown 原文，未格式化）。
- 方案：① header 徽标「◐ plan」；② plan-review intent 弹窗的 detail 用 Markdown 组件渲染计划全文；
  ③ approve 选项高亮（intent.approve 对应标签）。

### 5.2 子代理徽标 — P2 / S
- 方案：`subagent/descriptor` → 文档流单行徽标（`◆ subagent · label`）。

### 5.3 消息反馈 — P2 / S
- 方案：`feedback/record` → 消息尾标；主动点赞/点踩（⚠ 核对 DSH 反馈写入缝隙，若无 UI 缝隙则仅展示）。

## 6. 性能与稳健性

### 6.1 超长转录 — P2 / L（记录为主）
- 现状：全量渲染 O(n)（pi 引擎限制，其官方同样依赖 compaction）。策略：不虚拟化；依赖 DSH 自动 compaction
  （投影已渲染摘要条目）；必要时「清屏」动作把旧消息折叠为一条 SystemEntry。

### 6.2 流式突发 ✓（记录）
- requestRender 合帧 + 条目身份增量更新 + Markdown 缓存——已是最优路径。

### 6.3 视觉回归快照 — P2 / M
- 方案：引入 `@danypops/pi-tui-harness`（@xterm/headless + golden 快照）对关键组件（工具卡/diff/弹窗）做视觉回归。

## 7. 路线图

| 批次 | 内容 | 预期 |
|---|---|---|
| **P0（交互缺陷）** | 1.1 工具卡展开/截断计数 · 1.2 错误 turn · 1.3 中断反馈 | 交互闭环 + 单测 + E2E 各场景 | ✅ 已完成 |
| **P1（体验缺口）** | 1.4 thinking · 1.5 代码标签 · 1.6 系统行 · 2.2 busy 提示 · 2.3 补全 · 3.1–3.4（header/footer/picker/预设切换）· 4.1 /new · 4.2 小终端 · 5.1 plan-mode | 对齐 pi/web 的常用体验 | ✅ 已完成（3.2 footer 上下文百分比与 4.2 小终端列为记录项；2.3 补全已按上游约束处理） |
| **P2（打磨）** | 1.7 图片 · 1.8 长消息折叠 · 2.4 历史持久化 · 2.5 大粘贴 · 3.5–3.7 · 5.2 子代理 · 5.3 反馈 · 6.1/6.3 | 锦上添花 | ✅ 已完成（3.6 为 `DSH_TUI_THEME` 启动期切换，未做 OSC11 自动探测；6.3 为文本级 `toMatchSnapshot` 快照，未引入 @danypops/pi-tui-harness） |

每批保持 TDD 与五场景 E2E 全绿；P0 预计一轮、P1 两轮、P2 视需求取舍。

## 8. 验收清单（摘要）

- 工具卡：长输出折叠 + 展开完整 + 计数正确；错误 turn 红卡可见；Ctrl+C 中断显示「已中断」。
- thinking 可隐藏/展开、分级着色；代码块带语言标签；模型/权限/plan 切换有系统行。
- 弹窗、picker、审批、预设切换全部键盘可达（方向键/Enter/Esc，焦点恢复正确）。
- 中文输入：主输入框与弹窗输入行的 IME 候选框位置正确。
- 全量单测 + 五场景 E2E + 新增交互场景（展开/错误 turn/plan 弹窗）全绿。
