# dsh 破坏性更新适配备忘 / Upstream upgrade notes

> 面向后续每一次 dsh 上游升级（尤其带 `!` 的 refactor 与 alpha 发布）的**操作备忘**：
> 标准流程、本次（0.1.2-alpha.5）适配映射表、踩坑记录。规则来自 AGENTS.md 与
> `.github/workflows/{ci,release}.yml`，此处只记录"怎么做"。

## 1. 标准适配流程（每次 dsh 升级照做）

```bash
# ① 第一时间暴露 API 漂移——链接依赖直接对 ../deepseek-harness 编译
pnpm typecheck

# ② 对照上游新 API（上游源码即真相源，link 依赖可直达）
#    ../deepseek-harness/packages/*/src/…（含 .agents/notes/implemented/ 的架构决策文档）

# ③ 三件套验证（改完必须全绿）
pnpm typecheck && pnpm test
pnpm build                                   # lib/ 是插件加载入口
pnpm --dir ../deepseek-harness run build:lib:host   # E2E 依赖 harness host 产物与当前源码同步
python3 scripts/e2e-pty.py                   # 8 场景 PTY E2E

# ④ 文档同步：AGENTS.md（API 约定）、README.md（兼容性）、本文档映射表

# ⑤ 发版：bump package.json → 提交 → tag v*（push tag 触发 release.yml 的 OIDC npm publish）
#    tag 必须精确等于 package.json version（release.yml 有校验步骤）
```

**判定**：只要 `pnpm typecheck` 报错，就是"还没适配"——不要凭印象假设已适配
（本次落差：用户以为已适配，实际 22 个类型错误全在 session/settings/提问三处）。

## 2. 本次映射表（0.1.2-alpha.5，2026-08-31 ~ 09-02 发布）

破坏性重构：`refactor(session)!` 系列（`timeline`：session-persistence handle-based seam →
SQLite 后端移除 → 事件 seq 与 log offset 品牌化）+ 配套 API 漂移。commit `2351d19`。

| 旧 API | 新 API | TUI 落点 |
|---|---|---|
| `Session.events` | `Session.snapshotEvents(fromSeq?, toSeq?)` / `event(seq)` | `src/index.ts` 7 处；要"最后一个事件 seq"用 `session.seq - 1`（`Session.seq` = 下一个写入位） |
| `meta.seedLength: cut` | `meta.isSeeded: true` + `inheritedEventCount: SessionLogOffset(cut)` | fork/clone/rewind（`forkSession`） |
| `installSettingsSection(ctx, ns, schema, defaults, …)` | `ctx.settings.register('tui', schema, { base })` → `SettingsScope` | `apply()`；写面不变：`settings.get('tui')` / `settings.update('tui', patch)` 仍存在（未注册命名空间 update 会抛错，TUI 调用处已静默 catch） |
| `UserQuestionService.registerProvider({ ask })` | `ctx.on('user-questions/request', async (req, next) => …)` waterfall | `installApprovals`；root（未 scoped）监听者按 scope 分发语义全局接收，**返回答案即 claim** |
| `permissionPresets.current(events)` | `permissionPresets.current(session)` | `src/index.ts` 3 处 |
| `todo/write` 事件类型来自会话核心 | 来自 `@deepseek-ai/dsh-tool-todo`（`SessionEventMap` 模块增强） | devDep `link:../deepseek-harness/packages/todo/tool-todo` + `import type {}` 聚合——**仅类型，无运行时依赖**，不违反 out-of-tree 约束 |
| `SessionPersistence.locate(session.header).path` | 已移除（handle-based seam） | `/export` 无参提示改为通用文案（存储位置归后端配置） |

## 3. 踩坑记录（下次升级复用）

1. **夹具必须透传新参数**：`tests/runner.spec.ts` 的 `createAgent` mock 若丢弃
   `seed`/`inheritedEventCount`，fork 子会话为空 → 表现为"fork 后界面像没发生"
   （app.meta.session 不变）的**假失败**，且 settle 吞掉真实异常，排查极耗时。
   真实 Harness 的 createAgent 全数透传，夹具要镜像。
2. **事件声明跨包聚合**：插件自有事件外的新事件类型（本次 `todo/write`）很可能被
   upstream 移入独立包；`import type {}` 聚合即可拿类型，不要复制类型定义
   （会静默漂移），除非该包不在 dsh 安装依赖树里（见 AGENTS.md 约束）。
3. **scope 语义**：`user-questions/request` 是 Agent 作用域 waterfall——TUI 在
   root ctx 注册即可收全部 live-root 请求（`ask()` 内部已校验 CALLER_NOT_LIVE/
   DELEGATED_CALLER）；**不要**在 agent scoped ctx 注册（那会只见一个 agent）。
4. **E2E 前必须重建 harness host**：`build:lib:host`（tsc -b + tsdown）。头一天
   的旧产物会让 E2E 跑在过时行为上，出现"单测绿、E2E 也绿但行为不对"的假象。
5. **版本号对 npm 事实**：npm 上已发布的版本不能再发（0.4.0 已发 → 下版 0.5.0）；
   release.yml 的 `Verify tag matches version` 会拦 tag 与 version 不一致。
6. **文档同步清单**：AGENTS.md（架构约定里出现过的 API 名）、README.md（前置要求/
   兼容性一句话）、DESIGN.md / BOUNDARY-DESIGN.md 中提及的旧符号。

## 4. 后续升级的特别关注点

- `SessionEventMap` 事件增删会影响 `fold.ts` 的 switch 可判定性（TS2678）与
  `tests/projection.spec.ts` 的 fixture —— 每个新事件类型补回归（AGENTS.md 硬性要求）。
- `cordis.patch.yml` 的 insert 行只允许引用 **dsh 安装已携带**的插件（本次无需改：
  `dsh-tools`/`dsh-skill-filesystem`/`dsh-code-runtime-worker-thread`/hmr/system-prompt
  均在 apps/cli 依赖树中验证过）。
- `session/end-seed` 生命周期标与 `inheritedEventCount` 语义：fork 后 seed 中可能含
  child-owned 事件，**精确切点**务必走 `inheritedEventCount`，不要扫描日志推断
  （upstream 文档明确的迁移风险点）。
