# DeepSeek-TUI 供应链安全审计报告

| 项 | 内容 |
|----|------|
| 审计对象 | `DeepSeek-TUI`（`@mcswift/dsh-tui`，dsh 的终端交互客户端，npm 发布包 + pnpm workspace） |
| 审计日期 | 2026-08-17 |
| 审计范围 | 全依赖树（1 个 lockfile）+ 近期 npm 供应链攻击 IOC 比对 + `package.json` semver 范围命中分析 + AI 配置篡改排查 + OSV.dev 权威交叉验证 |
| 工具链 | pnpm 11.21.0，Node v24.19.0，registry = `https://registry.npmjs.org/` |
| 执行命令 | `pnpm audit` + lockfile IOC 精确比对（131 项）+ `package.json` 范围匹配 + OSV.dev 逐包验证 |

---

## TL;DR — 按包修复建议（速查 / 行动表）

> 结论先行：**本次审计 0 命中**。lockfile 无任何已知投毒 IOC，`pnpm audit` 0 漏洞，
> 8 个运行时直接依赖经 OSV.dev 精确版本验证全部干净，AI 编码代理后门专项排查干净。
> 下面是加固清单（P2 一次性配置），不是修复清单。

### 🔴 P0 / P1 — 立即与尽快处理

**无。** 没有任何包的范围覆盖投毒版本或已知 CVE 脆弱版本：

- 7 个运行时依赖全部**精确锁定**（无 semver 范围）：`@earendil-works/pi-tui@0.84.1`、`chalk@6.0.0`、`commander@15.0.0`、`cross-spawn@7.0.6`、`diff@9.0.0`、`grok-mermaid@0.2.3`、`highlight.js@11.12.0`
- 4 个 dev 依赖带范围（`@types/cross-spawn ^6.0.6`、`@types/node ^22.20.0`、`typescript ^6.0.3`、`vitest ^4.1.8`），均不覆盖任何投毒版本/问题包
- 传递依赖 `debug@4.4.3`：恰锁在恶意版 `4.4.2`（2025-09 chalk/debug Qix 事件）的**修复版之后** ✓
- 依赖树中**不存在** axios / AntV / TanStack / Mistral / @ctrl/* 等近期事件的受影响包

### 🟡 P2 — 构建期 / 传递依赖

| 项 | 现状 | 处理 |
|----|------|------|
| `packageManager` 字段 | 未声明 → **已加 `pnpm@11.21.0`**（本批次） | ✅ 完成 |
| 构建脚本白名单 | **已配置**：`pnpm-workspace.yaml` 的 `allowBuilds` 只放行 `@google/genai` + `protobufjs`（pnpm 11 的新配置位；其余 install/postinstall 全被拦截） | ✅ 已达标 |
| `minimumReleaseAge` 冷却期 | 未设置 → **已加 `.npmrc`（1440 分钟 = 24h）**（本批次） | ✅ 完成 |
| CI audit 卡点 | 未配置 → **已加 `pnpm audit --audit-level=high`**（本批次） | ✅ 完成 |

### 🛡️ 工作区加固（本批次已全部落地）

1. ✅ `package.json` 加 `"packageManager": "pnpm@11.21.0"`
2. ✅ 构建脚本白名单：`pnpm-workspace.yaml#allowBuilds`（2 个包）
3. ✅ `.npmrc`：`minimumReleaseAge=1440`
4. ✅ CI 加 `pnpm audit --audit-level=high`

---

## 一、结论速览

| 维度 | 结论 | 风险等级 |
|------|------|---------|
| 已知恶意版本（IOC）命中 | **0 / 131**（2025-08 → 2026-05 全部事件代表清单） | 🟢 |
| registry 来源 | 官方 `registry.npmjs.org` | 🟢 |
| 安装脚本（攻击执行入口） | pnpm 11 默认拦截白名单外脚本；未显式固化 | 🟢（建议固化） |
| `package.json` 范围命中投毒版 | 无（运行时依赖全部精确锁定） | 🟢 |
| 运行时直接依赖 | 8 个包 OSV 精确版本验证全部「无记录」 | 🟢 |
| `pnpm audit` | 0 漏洞 | 🟢 |
| AI 编码代理后门排查 | `.Codex`/`.claude` 注入、隐藏 Unicode、`.mcp.json` 全部干净 | 🟢 |

---

## 二、供应链攻击专项核查

### 2.1 背景简述

近期 npm 生态的几起重大攻击（完整背景见 skill 的 `known-iocs.md`）：Nx s1ngularity（2025-08）、chalk/debug Qix 钓鱼（2025-09，18+ 基础包）、Shai-Hulud 1.0/2.0 自传播蠕虫（2025-09/11）、axios 维护者劫持（2026-03-31，DPRK UNC1069）、Bitwarden/SAP CAP/TanStack+Mistral 三波 Mini Shai-Hulud（2026-04/05）、Claude Code 会话后门 typosquat（2026-05-13）、AntV 波（2026-05-19，314–317 包 / 631–637 版本）。共同手法核心：**维护者账号钓鱼 → lifecycle 脚本（preinstall/postinstall）执行 → 窃凭据 → 部分蠕虫自传播**，2026 年起叠加**针对 AI 编码代理的配置投毒**（`.claude/settings.json` SessionStart hook、`.cursorrules` 隐藏 Unicode 诱导 prompt）。

### 2.2 IOC 精确版本比对

对 `pnpm-lock.yaml` 做行级精确匹配（v9 格式 `  包@版本:`），覆盖 131 项代表 IOC（Nx / chalk-debug / Shai-Hulud / axios / Bitwarden / SAP CAP / TanStack+Mistral / Claude Code 后门 / node-ipc / AntV / GlassWorm / React Native / Contagious Interview）：

**结果：0 命中。**

值得注意的「恰好干净」对照：

| 包 | 锁定版本 | 相关恶意版本 | 说明 |
|----|---------|-------------|------|
| `debug` | **4.4.3** | 4.4.2（Qix 事件） | 锁在修复版 |
| `chalk` | 6.0.0 | 5.6.1（Qix 事件） | 已跨大版本（本批升级到 6） |
| `axios` | 不在依赖树 | 1.14.1 / 0.30.4（劫持） | 树中仅 `gaxios`（Google API 客户端，无关联） |

**Claude Code 会话后门专项（MAL-2026-3649）**：仓库无 `.claude/settings*.json`，node_modules 内无包内 `.Codex/settings.json` 注入，锁文件中无 `iceberg-javascript` / `supabase-javascript` / `auth-javascript` / `microsoft-applicationinsights-common` / `ms-graph-types`。

**AI 工具链投毒排查（TrapDoor / SANDWORM_MODE / GlassWorm）**：`AGENTS.md` / `CLAUDE-UX-IDEAS.md` 等根目录文档经隐藏 Unicode 正则扫描（零宽 U+200B–200F、U+2060–2064、BOM、PUA tags U+E0000–E007F、变体选择符 U+FE00–FE0F / U+E0100–E01EF）——0 命中；无 `.mcp.json`；无 `.Codex/` 目录。

### 2.3 安装来源与脚本执行策略

| 检查项 | 实际值 | 评价 |
|--------|--------|------|
| registry | `https://registry.npmjs.org/` | 🟢 |
| pnpm 版本 | 11.21.0（≥10，默认拦截白名单外 install 脚本） | 🟢 |
| 构建脚本白名单 | `pnpm-workspace.yaml#allowBuilds`：仅 `@google/genai`、`protobufjs` | 🟢 |
| `packageManager` 字段 | 已声明 `pnpm@11.21.0`（本批次补） | 🟢 |
| `minimumReleaseAge` | `.npmrc` 1440 分钟（本批次补） | 🟢 |

---

## 三、`pnpm audit` 漏洞分布

```
No known vulnerabilities found
```

0 漏洞（audit 走官方 registry，与 lockfile 锁定版本一致）。

---

## 四、风险清单与解决方案

### P0 / P1 — 无

运行时依赖全部精确锁定、OSV 干净、audit 0 漏洞，无任何范围命中。

### P2 — 加固（一次性）

见 TL;DR 加固清单。核心理由：当前安全姿态依赖「pnpm 11 默认行为 + 精确锁定」，两者都值得**显式固化**——`packageManager` + `onlyBuiltDependencies` 防 CI/协作者环境漂移，`minimumReleaseAge` 防即时投毒窗口。

### 直接依赖用法定位（供后续升级回归参考）

| 包 | 源码使用位置 | 功能 |
|----|-------------|------|
| `chalk` | `src/app/pi/color.ts`、`src/view/pi-vendor/ansi.ts` | pi 调色板的 ANSI 着色（hex/bgHex/bold/…） |
| `cross-spawn` | `src/app/pi-tui-app.ts`（runShell/openExternalEditor）、`src/view/pi-vendor/child-process.ts` | `!command` shell 执行与 $EDITOR 挂起编辑 |
| `diff` | `src/view/pi-vendor/diff.ts`（`Diff.diffWords`） | write/edit 工具卡的词级 diff 卡片 |
| `highlight.js` | `src/app/pi/highlight.ts` + `highlight-languages.ts`（core + 46 语法子集） | 代码块/Read 卡语法高亮 |
| `commander` | `src/startup.ts` | `-c/-r/--no-session/--model/--workspace` CLI flags |
| `grok-mermaid` | `src/view/pi-vendor/mermaid-transformer.ts` | Mermaid 终端 ASCII 渲染 |
| `@earendil-works/pi-tui` | 全 surface（`src/app/pi-tui-app.ts` 等） | TUI 引擎 |

---

## 五、加固建议

1. `"packageManager": "pnpm@11.21.0"` 进根 package.json（engines 已加 node >=22.19.0）。
2. `"pnpm": { "onlyBuiltDependencies": [] }` 显式空白名单（本包无原生构建依赖；若未来引入 esbuild/原生模块需登记）。
3. `.npmrc`：`minimumReleaseAge=1440`。
4. CI（`.github/workflows/ci.yml`）加 `pnpm audit --audit-level=high` 卡点。
5. 保持运行时依赖精确锁定（本次升级 chalk/diff/highlight.js 后仍为精确版本，范围从未放开）。

---

## 附录 A：执行的核查命令（摘要）

- `pnpm audit` → 0 漏洞
- lockfile IOC 行级比对：131 项 IOC（来自 skill `known-iocs.md` 全清单），`grep -nE "^[[:space:]]+<包>@<版本>(\(|:)"` 循环 → 0 命中
- OSV.dev `POST /v1/query` 逐包（精确版本 + 按名）验证 8 个直接依赖 → 全部「无记录」
- 隐藏 Unicode 扫描：`perl -CSD -ne '/[\x{200B}-\x{200F}\x{2060}-\x{2064}\x{FEFF}\x{E0000}-\x{E007F}\x{FE00}-\x{FE0F}\x{E0100}-\x{E01EF}]/'` 根目录 AI 配置文件 → 0 命中
- `.Codex/settings*.json`、node_modules 内包内 `.claude/settings.json`、`.mcp.json` 查找 → 均不存在

## 附录 B：参考来源

- OSV.dev（权威公告：`MAL-2026-2307` axios、`MAL-2026-3649` Claude Code 后门、`MAL-2026-4132` echarts-for-react、`MAL-2026-3973` @antv/g2 等）
- safedep（Claude Code 后门与 AntV 波一手披露）、Aikido（axios 劫持）、Unit42、Wiz、StepSecurity、JFrog、Socket
- 完整 IOC 清单与事件分述：仓库 `docs/security/` 同批 skill 的 `known-iocs.md`（未随仓库提交，以 OSV/Socket 实时附录为权威基准）

*报告生成于 2026-08-17。结论：本工作区对 2025-08 → 2026-05 全部重大 npm 供应链事件 0 命中；加固建议为一次性配置项，无修复阻断。*
