# PLAN-BUNDLED-SKILL.md — tui 操作手册技能随 TUI 插件注册（bundled skill）实现规划

> 属总路线图 [PLAN-ROADMAP.md](PLAN-ROADMAP.md) 阶段 1 第 1 项（建议先做——它是
> `/skills` 来源字段肉眼验证的经验探针）。
> 背景：[BOUNDARY-DESIGN.md](BOUNDARY-DESIGN.md) §6.2 —— tui 操作手册是**自描述能力、唯一例外**：
> 由 TUI 插件本身注册到 dsh（不适用「技能=agent 生态能力→独立技能包」的通用判定）。
> 官方先例：harness `apps/cli/config/agent-presets/cordis/agent.cordis.yml`
> （`- id: skill-filesystem` + `config.customSkillDirs: [!!js "…new URL('skills/', baseUrl)…"]`
> 把安装单元自带的 `skills/` 注册进宿主 skill registry）。
> 已核实语义：`!!js` 求值 = `with(ctx) { eval(expr) }`（loader `config/utils.ts`）；
> 同 id restate = 顶层字段整体替换（`applyEntryPatches`），base 的 skill-filesystem 行无 config → 安全。
> 状态：✅ 已落地（2026-08-22）——patch 注入 `customSkillDirs`、`skills/tui/SKILL.md` 随包、
> E2E 场景 `--only-skills` 通过（确认该技能只可能来自 custom 根）、typecheck/test 395 全绿。

---

## 1. 目标与验收

**目标**：`dsh --profile tui`（已 `dsh plugin add @mcswift/dsh-tui`/`link:.`）后，
`ctx.skills` 可见 `tui` 操作手册技能——`/skills` 目录、`/` 菜单（user-invocable）、agent 合并目录；
**任意 cwd 可用**；内容随 TUI 包版本同步；用户无需手动放副本。

| # | 验收 | 方法 |
|---|---|---|
| V0 | `!!js` 表达式与 `ctx.baseUrl` 实测值、rank 方向、同名重复语义 | 微探针（第 5 节步骤 0） |
| V1 | 组合树中 skill-filesystem 行带 `customSkillDirs`（指向包内 `skills/`） | `dsh --dump-config` |
| V2 | `/skills` 列表出现 `tui` 技能；`/` 菜单出现 `/tui` 项 | PTY E2E 新场景 |
| V3 | agent 侧合并目录同样携带（可选观察项） | mock LLM 观察 |
| V4 | 旧副本清理后无回归；清理前包内技能优先 | `/skills` 来源字段 |

每批验收通则：`pnpm typecheck` + `pnpm test`（351 项全绿）+ 至少一轮完整 PTY E2E。

## 2. 方案（主：declarative patch；备：env 注入）

### 2.1 主方案 —— `cordis.patch.yml` 追加 restate 行

```yaml
- id: skill-filesystem
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(ctx.baseUrl + 'package.json').resolve('@mcswift/dsh-tui/package.json')) + '/skills'"
```

要点：
- **不写 name**（restate 语义不校验；同 id 整体替换 config，base 行无 config → schema 默认值兜底）；
- 表达式拆解：`ctx.baseUrl` = profile 目录 href（带尾斜杠）→ `+ 'package.json'` 得 profile/package.json
  file URL → `createRequire` 从 profile 目录解析（与 loader 解析 bundle 同布局）→
  `@mcswift/dsh-tui/package.json` → `dirname` = 包根 → `+ '/skills'`；
- rank：custom=300 < user-dsh=400（rank 越小越优先，待 V0 实测确认方向），包内技能**优先于**用户级旧副本；
- 若 V0 发现 `ctx.baseUrl` 在 bundle patch 求值时即指向 TUI 包目录 → 表达式可简化为
  `"process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', ctx.baseUrl))"`（agent 先例同款）。

### 2.2 备选方案（仅主方案失败时启用）

runner 启动早期 `process.env.DSH_BUNDLED_SKILL_DIR = <包内 skills 绝对路径>`（web app scaffold
同款做法）。缺点：时机依赖（skill-filesystem 的 provider 是否惰性构造需实测）、`--dump-config`
不可见；故只作 plan B。

## 3. 文件变更清单

| 文件 | 变更 |
|---|---|
| `skills/tui/SKILL.md` | **新增**（真相源，从 `.dsh/skills/tui/SKILL.md` 原样迁移；front matter：name/description/whenToUse；正文双语） |
| `corodis.patch.yml` → `cordis.patch.yml` | 追加 §2.1 restate 行 |
| `package.json` | `files` 加 `"skills"`（发布 npm 包时随带） |
| `.dsh/skills/tui/` | **删除**（避免 project-dsh(100) 源与 custom 源同名双源；rank 语义 V0 确认后执行） |
| `scripts/e2e-pty.py` | 新增 `scenario_skills()` + `--only-skills` 开关 |
| `README.md` | 安装即带手册技能说明；撤销/更新旧手动副本指引 |
| `docs/BOUNDARY-DESIGN.md` | §6.2 标注「✅ 已落地（v0.4.0）」 |
| `docs/BACKLOG-FEATURE-GAP.md` | A21 约束列补注：tui 手册注册已落地（如与 A21 同批关闭） |

> 说明：`~/.dsh/skills/tui` 旧副本由发布说明指引用户删除（不自动删用户文件；不删时包内技能亦优先）。

## 4. 测试策略

- **单测**：无新增（fold/视图管线不涉及；`skill-catalog.ts` 渲染逻辑已有覆盖）；
- **E2E 新场景** `scenario_skills`：
  1. 隔离 home（`ensure_core_home`）+ mock LLM（沿用现有模式）；
  2. 启动 TUI → 输入 `/skills` → `wait_for` 断言输出含技能名 `tui`（TUI 本地目录命令，不依赖 mock 回复）；
  3. 可加断言 `/` 菜单候选含 `/tui`（视菜单渲染断言成本取舍，P2）；
  4. `/quit` 退出码 0；
  5. 注册 `--only-skills` 开关（与 `--only-core` 等并列）。
- **V1 快速探针**：`dsh --dump-config 2>&1 | grep -A3 skill-filesystem`（无需起完整 TUI）。

## 5. 实施步骤（顺序）

0. **微探针（约 30 分钟，先做）**
   - `dsh --dump-config` 看 skill-filesystem 行合并结果与 `ctx.baseUrl` 实际指向；
   - 若表达式报错，退回备选表达式（见 §2.1 简化分支 / §2.2）；
   - 确认 rank 方向（custom vs project-dsh vs user-dsh 同名时谁生效），决定 `.dsh/skills/tui/` 删除与旧副本指引措辞。
1. 迁移技能：`git mv .dsh/skills/tui skills/tui`（内容不变，仅位置）。
2. `cordis.patch.yml` 加 restate 行（用实测后的表达式）。
3. `package.json` `files` 加 `"skills"`。
4. 删除 `.dsh/skills/tui/`（V0 确认后；`git rm -r`）。
5. `cd /Users/mcswift/private/deepseek-harness && pnpm dsh --profile tui --dump-config` 复核 V1。
6. `scripts/e2e-pty.py` 加 `scenario_skills` + `--only-skills`；跑 `--only-skills`。
7. `pnpm typecheck` + `pnpm test` + 完整 E2E 全绿。
8. README 更新；BOUNDARY §6.2 / A21 标注落地。
9. 提交：`feat: tui 操作手册技能随插件注册为 bundled skill` + `Assisted-by` trailer。

## 6. 风险与对策

| 风险 | 检测点 | 对策 |
|---|---|---|
| `!!js` 表达式求值失败（语法/词汇不可用） | `dump-config` 立即报错 | 用 `process.getBuiltinModule` 系（agent 先例已验证）；再不行走 §2.2 |
| `createRequire` 从 profile 目录解析不到包 | `dump-config` | 与 loader 同布局必可解析；`npm pack --dry-run` 复核 files |
| 同名技能（旧项目源/旧用户副本）语义歧义 | V0 实测 | 删除仓库旧源；发布说明指引删副本；rank 已保证包内优先 |
| 技能目录漏打包 | `npm pack --dry-run` tarball 清单 | files 加 `"skills"` |
| 包内技能对 agent 侧不可见 | V3（可选） | agent 合并目录带全局注册（agent.cordis.yml 注释证实）；若个别场景缺失，记录为限制并归档 |

## 7. 范围外（明确不做）

- A21 的 7 个 agent 工作流技能（不属于本项，仍按独立技能包推进）；
- 用户级旧副本的自动删除（仅文档指引）；
- 技能内容的扩充/改写（本项只做注册形态迁移，内容维持现状）。
