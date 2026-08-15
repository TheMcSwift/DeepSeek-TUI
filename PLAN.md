# 方案：用 pi-tui 为 DeepSeek Harness 打造 TUI 入口（`dsh --profile tui`）

> 目标：让 `dsh` 拥有与 `web` / `headless` 平级的第三个一等 surface——终端交互界面。
> 用法形态：`dsh --profile tui`，启动即进入全屏聊天/智能体界面。
> **路线（已确认）**：独立包放在本工作区（`DeepSeek-TUI`），作为 out-of-tree profile plugin 安装，**对 deepseek-harness 仓库零侵入**；首轮交付 M0–M3。

---

## 1. 目标形态

| 项 | 说明 |
|---|---|
| 入口命令 | `dsh --profile tui [--resume <id>] [--model <m>] [--workspace <dir>]` |
| 运行方式 | 单进程、全屏 raw-mode TUI，**不经过** Host / HTTP / browser 层 |
| 核心能力（M0–M3） | 多轮对话 + 流式渲染 assistant 回复、可见的工具调用状态、会话持久化、`--resume` 恢复、会话列表、模型选择、turn 中断 |
| 与 Web UI 关系 | 同一套 `dsh-base` 插件栈（Agent/工具/MCP/持久化/预设全部共享），只是换一个前端 surface |

DSH 架构早已为此预留：`apps/cli` 的 README 与 help 文本都以 `dsh --profile tui` 作为示例，profile/bundle 机制就是为第三方 surface 设计的。

## 2. 选型依据：为什么是 pi-tui

`pi-tui`（npm 包 `@earendil-works/pi-tui@0.84.1`，即 [Pi coding agent](https://github.com/earendil-works/pi) 的 TUI 库）：

- **同技术栈**：TypeScript ESM，engines `node >=22.19.0`，与本机（Node v24.19.0）及 DSH（`^22.19.0 || >=24`）完全一致；纯 JS 依赖（macOS/Linux 无原生编译）。
- **成熟度**：在 Pi coding agent 中生产使用；MIT 协议（与 DSH 一致）。
- **渲染质量**：差分渲染 + CSI 2026 同步输出（无闪烁）、bracketed paste、Kitty 键盘协议、resize 自适应、OSC 8 超链接。
- **组件恰好够用**：`Text` / `Markdown`（流式）/ `Editor`（输入框、自动补全、slash 命令）/ `SelectList` / `SettingsList` / `Loader` / `ScrollView` / `Box` / `Stack` / `Image`（Kitty/iTerm2 协议）/ `Overlay`（弹层）。
- **运行模型匹配**：`ProcessTerminal` 直接在当前进程 stdin/stdout 上开 raw mode（不强制 spawn 子进程），与 headless 的"进程内直驱 Agent"模式天然契合。

替代项（不选的原因）：ratatui 是 Rust（需 FFI/子进程桥）；bubbletea 是 Go；ink/blessed 生态老化、无同步输出。三者都会引入第二语言或第二运行时。

## 3. 架构设计

### 3.1 三个 surface 的关系

```
                 dsh launcher (apps/cli, 位于 deepseek-harness 仓库, 零修改)
                 ├── profile web      → dsh-base + dsh-web-app      (HTTP + Web UI)
                 ├── profile headless → dsh-base + dsh-headless     (一次性直驱，打印退出)
                 └── profile tui      → dsh-base + dsh-tui-app ★新  (本工作区, pi-tui 全屏交互)

dsh-base（共享核心）: Agent / Session / LLM / 工具 / 预设 / MCP / 持久化 / 目标 / 计划 / skill …
```

TUI **复用 `dsh-base` 的全部智能体能力**，运行器与 headless 同构——直接通过核心注册表创建 Agent、订阅 session 事件，不引入 HTTP。

### 3.2 组装链路（out-of-tree，已验证的现有机制）

1. **安装即注册**：`dsh plugin --profile tui add link:.`（在本工作区执行）
   - 自动初始化 `/Users/mcswift/.dsh/profiles/tui`（`package.json` + `cordis.patch.yml` + pnpm 设置，默认 bundles 为 `@deepseek-ai/dsh-base`）；
   - 在 profile 目录内以 `link:` 方式挂载本包（改动即时生效，无需重装）；
   - **对账**：本包 manifest 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，`dsh plugin` 自动把它追加进 `dsh.profile.bundles`。
2. **模块解析**：bundle 包本体从 profile 的 `node_modules` 解析；其 `@deepseek-ai/*` peer 依赖（cordis、dsh-agent、dsh-session…）从 dsh 安装维护的兜底层 `$DSH_HOME/profiles/node_modules` 解析（Node 父目录向上查找命中已修复的 symlink 层，无需 pnpm 管理）。
3. **组合树**：`dsh-base` 的 patch 先应用，本包的 `cordis.patch.yml` 后应用（surface 行 restate 覆盖、insert 启动插件），用户的 `cordis.patch.yml` 与 `--patch` 最后覆盖。

对 deepseek-harness 仓库**零修改**：不碰 `PROFILE_TEMPLATES`、不碰 `apps/cli` 依赖。

### 3.3 进程内数据流（基于已确认的真实 API）

```
用户按键
  └→ pi-tui Editor.onSubmit
      └→ agent.followup(createUserMessage(...))          // 同 headless runner
          └→ ctx.on('session/event', (session, event))   // 同 session-projection 的订阅方式
              ├─ assistant/message (delta)  → Markdown 组件流式追加
              ├─ tool/call → ToolStatusBar 显示 spinner + 工具名 + 参数摘要
              ├─ tool/result → 状态栏标记完成
              └─ turn/end → 输入框恢复可用
          └→ agent.whenIdle() → sessions.flush(agent.session)  // 同 headless 的持久化
退出（Ctrl+C / /quit）
  └→ flush 后恢复终端 → ctx.appExit → 有界 shutdown（复用 headless 的退出链路）
```

- Agent 创建：`agents.create({ sessionId, meta: { cwd }, agentOptions: { provider, model }, setup })` + `installModelSelection`——headless runner 已示范，直接照搬。
- 会话恢复（M3）：agent 类型已有 `ResumeAgentOptions`；持久化走 `dsh-session-persistence-jsonl`（`$DSH_HOME` 下）。
- 会话列表（M3）：复用 `dsh-session-query`（dsh-base 内建；TUI patch 把 `session-query-sqlite` 行 restate 为按需打开 `openAt: first-search`，首次打开列表时才触发索引）。
- 模型选择（M3）：读 `agentDefaultModel` 服务（headless 正是从它取 `currentSelection()`）。
- turn 中断：agent 的 inbox / `agent/inbox/spliced` 事件提供取消能力。

> M3 的两处 API 细节（resume 的确切入口、session-query 服务名）在实现时对照 `packages/core/agent` 与 web-app 的调用点确认，本方案已确认其存在。

### 3.4 TUI 内部结构（app 层与 pi-tui 解耦）

```
src/app/
  tui.ts            # TUI + ProcessTerminal 挂载、raw mode、resize、退出恢复
  state.ts          # ★纯 reducer：SessionEvent → ChatState（可单测，不依赖终端）
  components/
    chat-view.ts    # ScrollView + 消息列表（用户消息 / Markdown 流式 assistant 消息）
    composer.ts     # Editor 输入框 + slash 命令（/new /resume /model /quit）
    tool-status.ts  # 当前运行工具的状态行
    session-picker.ts # SelectList overlay：会话列表/新建
    model-picker.ts # SelectList overlay：模型选择
  theme.ts          # pi-tui Theme（对齐 DSH 视觉风格）
```

`state.ts` 是刻意设立的纯函数层：终端渲染与业务状态分离，让 90% 的逻辑能用 vitest 无终端测试。

## 4. 交互设计

- 输入：`Editor` 多行输入框，Enter 提交、Shift+Enter 换行（pi-tui 内建）。
- 快捷键：`Ctrl+C` 中断当前 turn（空闲时退出）、`Ctrl+L` 清屏（不销毁会话）、`Ctrl+R` 会话选择、`Ctrl+M` 模型选择、`Ctrl+D` 或 `/quit` 退出。
- 流式回复：Markdown 组件直接消费 delta 事件；工具调用折叠为状态行，按键展开参数/结果。
- 非 TTY 兜底：stdin/stdout 不是 TTY 时（CI、管道）打印明确错误并退出，提示改用 `dsh --profile headless`。

## 5. 里程碑（首轮交付 M0–M3）

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **M0 骨架** | 本仓库包骨架（package.json/tsconfig/build/cordis.patch.yml/startup/invariant/index）；安装进 profile；peer 解析校验 | `dsh plugin --profile tui add link:.` 成功；`dsh --profile tui --help` 解析正常；`--dump-config` 显示 `dsh-base + dsh-tui-app` 组合树；profile 目录内 `require.resolve` 全部 peer 成功 |
| **M1 最小界面** | pi-tui 全屏挂载：banner Text + Editor 回显 + 退出；SIGINT/SIGTERM 处理 | 真实终端可进入/退出、无残留无闪烁；kill 信号干净退出、终端恢复 |
| **M2 核心对话** | Agent 直驱：流式 Markdown、用户消息、工具状态行、turn 结束、退出时 flush | `dsh --profile tui` 完成真实多轮 agent 对话；`$DSH_HOME` 下产出 session jsonl；非 TTY 降级正常 |
| **M3 会话管理** | `--resume <id>`、会话列表（SelectList overlay）、`/new`、模型选择、中断 turn | 重启后从列表恢复历史会话并继续对话；切换模型生效；中断后同会话可继续 |

## 6. 仓库结构（本工作区）

```
DeepSeek-TUI/
  package.json          # name: dsh-tui-app, version 0.1.0, type: module
                        # dsh.bundle.patch → ./cordis.patch.yml
                        # deps: @earendil-works/pi-tui@0.84.1(pin), commander, @deepseek-ai/schemastery
                        # peers: 与 headless 对齐（cordis, cordis-plugin-loader, dsh-agent,
                        #        dsh-agent-default-model, dsh-invariants, dsh-llm, dsh-session, dsh-cmdline）
  cordis.patch.yml      # surface patch：system-prompt persona / hmr disabled / tools mode /
                        # insert code-runtime + tui-startup + tui-runner（对照 headless 写法）
  tsconfig.json         # NodeNext + strict，输出 lib/ + lib/types/
  src/
    index.ts            # tui-runner：Agent 生命周期 + 事件订阅（对照 headless/src/index.ts）
    startup.ts          # commander 参数（--resume/--model/--workspace/--session）+ TUI_STARTUP_SERVICE
    invariant.ts
    app/*               # 3.4 的组件与 reducer
  tests/
    state.spec.ts       # reducer 单测：事件序列 → ChatState
    pty-smoke.spec.ts   # PTY 冒烟（node-pty，devDep）：spawn dsh，喂输入断言输出
  README.md             # 安装/开发/用法
```

- 构建：`tsc`（无 bundler，规避 peer external 打包坑），exports 映射对齐 headless（`.`、`./startup`、`./invariant`、`./cordis.patch.yml`、`./package.json`）。
- 发布（可选）：`npm publish` 后用户以 `dsh plugin --profile tui add dsh-tui-app` 安装；本地开发用 `link:.` 即可。

## 7. 开发循环（已按本机环境写实）

```sh
# 本机已满足: Node v24.19.0, pnpm 11.7.0, DSH_HOME=/Users/mcswift/.dsh（web profile 已就绪）

alias dsh="pnpm --dir /Users/mcswift/private/deepseek-harness dsh"   # 用 harness 检出的 launcher

cd /Users/mcswift/private/DeepSeek-TUI
pnpm install && pnpm build
dsh plugin --profile tui add link:.        # 初始化 profile + 链接本包 + 对账 bundles
dsh --profile tui                          # 进入 TUI；之后改代码只需重新 build
```

## 8. 测试策略

- **单测（主战场）**：`state.ts` reducer——喂 session 事件序列（delta 分片、工具调用、错误 turn），断言 ChatState；无终端依赖，CI 可跑。
- **PTY 冒烟**：`node-pty`（devDep，有 prebuild）spawn `dsh --profile tui`，喂按键、断言输出与退出码/终端恢复；配 mock LLM（harness 仓库自带 `pnpm mock:llm`）跑确定性 e2e。
- **跨 surface 校验**：TUI 退出后用 `dsh --profile headless` / 再次 `dsh --profile tui --resume` 验证同一 session 可用。
- **手测清单**：resize、窄终端、Ctrl+C 中断、kill 信号、长时间流式回复。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| DSH 处于 developer preview，API 破坏性变更频繁 | 运行器只依赖 headless 已用且已发布的公开 API；升级时以 harness 仓库中 headless 的对应改动为对照 |
| pi-tui 0.x API 变动 | pin `0.84.1`；全部组件封装在 `src/app/` 薄适配层内，替换成本受限 |
| peer 依赖兜底解析失败（dsh 安装闭包缺包） | M0 设显式校验步骤（profile 目录内 `require.resolve` 全部 peer），失败时降级为把缺失包装进 profile 目录 |
| 长回复/高频 delta 的渲染压力 | 依赖 pi-tui 差分渲染 + `tui.requestRender()` 合帧；delta 先进 reducer 再统一触发渲染 |
| 非 TTY / 窄终端 | 明确降级路径与最小宽度检查（overlay 有 `visible` 回调可用） |
| Windows（pi-tui 自带 win32 prebuilds） | 首轮以 macOS/Linux 为目标，Windows 作为后续验证项 |

## 10. 决策记录

- ✅ 代码落位：独立放在本工作区（out-of-tree profile plugin），harness 仓库零修改
- ✅ 首轮范围：M0–M3（含 resume / 会话列表 / 模型选择）
- ✅ 包名/版本：`dsh-tui-app@0.1.0`，MIT

## 11. 实施状态（2026-08-13，已全部完成）

| 里程碑 | 状态 | 证据 |
|---|---|---|
| M0 骨架 + 安装 + 启动链 | ✅ | `dsh plugin --profile tui add link:<本目录>` 对账出 `bundles: [dsh-base, dsh-tui-app]`；`--help` 输出本应用参数；`--dump-default-config` 显示组合树；profile 目录内全部 peer `require.resolve` 成功 |
| M1 pi-tui 全屏 + 退出恢复 | ✅ | PTY 实测 banner 渲染、`/quit` 退出码 0、终端恢复；无头假终端单测 8 项 |
| M2 核心对话 | ✅ | reducer 单测 11 项；真实 PTY + harness mock LLM 完成一轮对话（流式回复 `mock response recovered` 渲染）；退出前 flush 持久化（session jsonl.zstd） |
| M3 会话管理 | ✅ | `--resume <id>` 实测回放历史并继续；会话/模型 picker 单测 3 项；中断 turn（`agent.cancel({kind:'user'})`）单测；非 TTY 降级单测 |
| 测试总计 | ✅ | vitest 5 文件 45 测试全绿；typecheck/build 干净；`scripts/e2e-pty.py` 确定性 PTY E2E 全过 |
| 渲染优化（追加） | ✅ | 复用 pi 套件：TuiAltScreen（原生 PgUp/PgDn/滚轮）、pi dark 调色板 + hljs 代码高亮、角色化消息气泡与工具卡片（状态着色）、Working 状态槽 + 头部身份栏；注入上下文过滤（仅渲染 `source.kind==='user'`）；视图按 key 增量复用 + 会话切换 reset；退出看门狗修复 resume 后事件循环不排空的挂起 |

**TDD 实践**：每个模块先写测试（state.spec → state.ts、startup.spec → startup.ts、runner.spec → index.ts、pi-tui-app.spec → pi-tui-app.ts），RED→GREEN 迭代；假终端（FakeTerminal）与假表面（FakeApp）两个缝隙使 pi-tui 层与 runner 层均可在 CI 无终端测试。

**安装/使用**：`dsh plugin --profile tui add link:/Users/mcswift/private/DeepSeek-TUI`（`link:` 使重建即时生效）；`dsh --profile tui` 进入；快捷键见 README.md。

## 11. 参考

- [pi-tui（earendil-works/pi）](https://github.com/earendil-works/pi/tree/main/packages/tui) — npm: `@earendil-works/pi-tui@0.84.1`
- [DeepSeek Harness CLI behavior reference](https://github.com/deepseek-ai/deepseek-harness/blob/main/apps/cli/README.md)（entry modes / profiles / app arguments）
- 同构参照实现（harness 仓库内）：`packages/bundle/headless`（直驱 Agent）、`packages/bundle/web-app`（surface patch 写法）、`packages/boot/app-boot/src/profile.ts`（profile/plugin 机制）、`apps/cli/src/plugin.ts`（out-of-tree 安装与对账）
