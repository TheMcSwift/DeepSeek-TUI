# AGENTS.md — 仓库指南（AI 编码代理 / Repository guide for AI coding agents）

> 本文件供 AI 编码代理（dsh、Claude Code、Codex 等）读取。规则简短、确定、可执行。
> This file is read by AI coding agents (dsh, Claude Code, Codex, …). Rules are short, deterministic, executable.

## 这是什么 / What this is

`dsh --profile tui` 的 out-of-tree profile bundle：dsh 的终端交互客户端。
Terminal client for DeepSeek Harness (`dsh`): an out-of-tree profile bundle.

## 常用命令 / Commands

```bash
pnpm typecheck   # 严格类型检查（含 tests）
pnpm test        # vitest 单测（220 项）
pnpm build       # tsc 构建到 lib/（profile 的加载入口）
python3 scripts/e2e-pty.py              # 6 场景 PTY E2E（依赖本地 harness checkout + mock server）
python3 scripts/e2e-pty.py --only-questions
```

## 架构约定 / Architecture rules

- **单向数据流**：`SessionEvent → fold() → ViewDocument → app.render()`。fold 必须是**纯函数**（禁止 cordis/pi/IO 依赖），每个新事件类型都要在 `tests/projection.spec.ts` 补回归。
- **文档即真相源**：跨组件共享状态一律进 `ViewDocument`；视图层不允许自造第二份状态。
- **cordis 服务访问**：只允许 `ctx.get(...)` 结构读取 host 组合（`commands`/`skills`/`sessionQuery`/`sessionTitle`/`jobs`/`userQuestions`）；不 import 未在 profile 依赖树中的 dsh 包（会破坏 out-of-tree 约束）。
- **pi 私有 API**：TuiAltScreen 的实例级 hook（`routeWheel`/`handleViewportInput`）是刻意为之；改动前先看 `hookAltScreen()` 的注释。

## 硬性禁忌 / Hard rules

1. **`cordis.patch.yml` 是必填声明**——缺失会让 profile 加载直接报错；insert 行只能引用 dsh 安装已携带的插件（挂载未携带插件会让 loader 静默挂起）。改完必须跑 E2E。
2. **不要提交构建产物**：`lib/`、`.pnpm-store/`、`__pycache__/`、`node_modules/` 均被 gitignore，禁止 `git add -f`。
3. **不要改 `pnpm-lock.yaml` 的 link 依赖布局**：devDependencies 是 `link:../deepseek-harness/...`，本地开发与 CI（双 checkout 布局）都依赖这个相对结构。
4. **不要破坏 E2E 的单读者模型**：`scripts/e2e-pty.py` 的 drain 线程独占 pty fd（`wait_for`/`wait_exit` 只轮询缓冲）；任何改动不得重新引入主线程 `pump` 并发读。

## 提交约定 / Commit rules

- 每笔提交尾部带标准 trailer（空行后）：

```
Assisted-by: dsh <noreply@deepseek-ai.dev>
```

- 提交信息中文优先，类型前缀（`feat:`/`fix:`/`docs:`/`test:`/`refactor:`）。
- 每个功能批完成必须：`pnpm typecheck` + `pnpm test` + 至少一轮完整 E2E 全绿后再提交。

## 风格 / Style

- 代码注释：新代码用中文注释（与既有代码一致）；提交信息同样中文。
- 用户可见文案：一律经 `src/view/strings.ts` 双语词典（zh/en），不得硬编码。
- 视觉对齐：新 UI 元素参考 dsh web 客户端对应组件（`FEATURE-CHECKLIST.md` 有逐项源文件路径）。
