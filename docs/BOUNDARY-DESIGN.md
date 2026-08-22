# BOUNDARY-DESIGN.md — 能力边界判定：TUI 本分 vs 独立插件

> 决策日期：2026-08-22（用户拍板：仅做边界分析，不写代码）。
> 用途：后续每进一条 backlog / 新增能力时**对照自查**——留内部 / 独立 / 下沉 / 克制。
> 判据来源：[PLAN.md](../PLAN.md)（surface 定位）、[AGENTS.md](../AGENTS.md)（out-of-tree 硬约束）、
> [COMMUNITY-COMPARISON.md](COMMUNITY-COMPARISON.md)（远程对比基线 2026-08-20）、
> [BACKLOG-FEATURE-GAP.md](BACKLOG-FEATURE-GAP.md)（当前未动工项）。

---

## 1. 定位（一句话）

`dsh-tui` 是 dsh 的一个**终端 surface**（out-of-tree profile bundle 插件）。职责是：
**把 dsh runtime 的能力以终端交互的形式呈现**。凡是「能力本体」必须从 dsh 侧取
（共享 `dsh-base` 组合，经 `ctx.get` 白名单结构读取），TUI 只做**消费 + 呈现**。
违背这条的任何功能都先质问：「这是 TUI 该干的吗？」

## 2. 判定框架

### 2.1 四个判据（按权重）

| # | 判据 | 要问的问题 | 结论走向 |
|---|---|---|---|
| P1 | **跨 surface 复用性** | headless / web / 其他客户端也用得上吗？ | 用得上 → 独立；只有 TUI 用 → 内部 |
| P2 | **TUI 专属层依赖** | 强依赖终端协议（raw mode/OSC8/OSC52/鼠标/IME）、键位、差分渲染吗？ | 依赖 → 内部；不依赖 → 可独立 |
| P3 | **状态归属** | 读写的是 dsh 侧共享状态（会话/附件/反馈/模型配置/credentials）还是 TUI 视图状态？ | dsh 状态 → 数据层必须走 dsh 服务；TUI 状态 → 内部 |
| P4 | **内容 vs 机制** | 是「机制」还是「内容」（可被第三方生产）？ | 机制 → 内部；内容 → 按内容包分发 |

### 2.2 边界红线（最重要的一条）

- 访问/修改 **dsh 共享状态**的能力 → 数据层必须走 dsh 服务（`ctx.get` 白名单），
  **绝不允许用 sidecar 冒充**；
- sidecar（`tui-*.json`）是 out-of-tree 约束下挂不了 storage 域的**妥协**，只允许存
  TUI 私有视图偏好（历史/标题缓存/MRU/反馈妥协）；
- 一旦某状态 **web 和 TUI 都该看到**（反馈记录、附件清单、模型配置），sidecar 就是错误——
  它让两个 surface 数据分裂；
- TUI **不允许开 cordis 插件宿主**（AGENTS.md：insert 行只能引用 dsh 安装已携带的插件；
  挂载未携带插件会让 loader 静默挂起）。进程内扩展注册表只能扩展 **TUI 自身**
  （键位/状态行/面板），不得碰 dsh 服务层。

---

## 3. 判定结果总表

### 3.1 🔒 必须留在 TUI 内部（surface 本分，不是增强）

| 类别 | 内容 | 判据命中 |
|---|---|---|
| 交互/键位层 | cc/pi/opencode 三预设画像、键位动作表、斜杠菜单语式、三态投递（queue/steer/follow-up）、审批/提问/计划卡形态 | P2 全中 |
| 渲染层 | 消息/工具卡/diff/表格/轨迹视图、todo/job/goal/workflow/subagent 面板、上下文压力条、统计条 | P2 全中 |
| 终端协议层 | OSC 8 / OSC 52 / 鼠标 SGR / IME / resize / 退出恢复 | P2 全中 |
| 主题外观 | 四预设 × 双明暗调色板 | 客户端呈现偏好（web 有 web 的主题） |
| 会话管理 UI / 命令面 | A1–A23 大部分、会话 picker、/settings 聚合面板 | 呈现 dsh 状态 |
| 瞬态浮层 | 决策卡、A12 /btw（不写日志、不进文档流的 UI 状态） | surface 会话体验 |
| 进程级基础设施 | G6 退出漏斗、G7 输入管线、E3/E4 性能记录 | P2（TUI 进程内） |
| sidecar 视图偏好 | tui-history / tui-titles / tui-mru | P3（TUI 私有状态，妥协合法） |

### 3.2 📦 过于增强 → 应该独立开发

| 能力 | 判定 | 独立形态 | 理由 |
|---|---|---|---|
| **A21 打包技能（7 个）** | ✅ **最典型越权** | **独立技能包**（dsh 技能生态：`~/.dsh/skills/<名>/SKILL.md`，可独立仓库）+ 安装脚本（同名覆盖语义与远程一致） | 技能是 **agent 能力**（SKILL.md 指令），headless / web 同样消费（P1 命中）；与 TUI 代码零耦合；放 TUI 包内 = 客户端私有化了一份本属于生态的能力 |
| **C3/A15 帧动画** | ⚠️ 理想应独立，现实妥协 | 理想 = **dsh 侧插件**（远程对标的 `dsh-working-activity` 正是 dsh 官方包，TUI 消费）；现实 = 依赖树约束 → **内部模块 + 预留交换缝**（独立 `src/working-activity/` 纯函数帧表，不混入视图层），待官方包可挂载时整块替换 | P1/P2 偏独立（帧表不依赖终端）；但本地无第二消费者、约束禁止 import 官方包 → 妥协为模块隔离 |
| **G1 全量 13 接缝插件宿主** | ⏸️ 克制 | 若做 = TUI 自身的**进程内扩展点**（键位/状态行/面板），第三方插件独立开发；已决策 ⛔，仅留 tuiShortcuts/tuiStatus 验证口 | 注意层次：这是「TUI 内扩展」，不是「dsh cordis 插件」——TUI 不允许开 cordis 插件宿主（out-of-tree 硬约束） |
| **A9 /provider 深向导** | ⚠️ 克制 | 降为「直切 + 简单表单」；数据层走 dsh settings 服务 | 写的是 **dsh 配置**（credentials/settings.yaml，web 也写同一份）——UI 是 client 本分，但「草稿探测/多选/回滚」是远程的增强复杂度；若无 settings 服务就 sidecar 化 = 跨客户端分裂风险 |
| **F1 自定义 JSON 主题** | 🔧 机制内部 / 内容独立 | 机制（加载器/校验/palette 运行时覆盖）留内部；`~/.dsh/tui-themes/*.json` 是**第三方内容包** | P4：主题作者独立分发，机制属于 surface 本分 |

### 3.3 🔄 已正确分割的（防止再折腾）

- **B4 图片附件**：数据层已在 dsh-base 挂载 `dsh-attachment-local`（独立 dsh 插件 ✅），TUI 只做
  剪贴板采集 + 输入装饰 + 渲染——**这就是标准答案的样子：dsh 侧插件管状态，surface 只管交互**。
- **G44 反馈存储**：理想 = dsh storage 域插件，现为 sidecar 妥协（已文档标注）——
  将来 dsh 开放即下沉，别把 sidecar 固化成分发形态。

### 3.4 ⛔ 定位边界（与「独立插件」无关，已决策不做）

`/update`（A20）、VS Code 扩展（G3）、npm 发布/CI（G8）——与 out-of-tree 约束或发布流程冲突。

---

## 4. 对照自查清单（新能力进 backlog 前必须回答）

1. **这能力 headless / web 会用吗？** → 会：独立（dsh 侧插件 / 技能包 / 内容包），TUI 只消费；不会：继续 ↓
2. **它强依赖终端/键位/渲染吗？** → 是：内部模块化（独立 `src/` 目录 + 纯函数层），不混视图；否：允许独立
3. **读写 dsh 共享状态吗？** → 是：数据层必须 `ctx.get` 服务；无服务 → 先评估（下沉 dsh 侧 / sidecar 妥协并文档标注）；否：↑
4. **第三方会生产内容吗？** → 会：定义内容格式 + 目录约定 + 校验失败跳过；机制留内部
5. **能塞进现有命令面/面板/设置吗？** → 能：内部；不能且独立演进：回到 1 重新判定

---

## 5. 与 BACKLOG 的映射（当前未动工项速查）

| Backlog 项 | 边界结论 |
|---|---|
| A21 打包技能 | **独立技能包**（唯一显著越权项） |
| C3 / A15 帧动画 | 内部模块 + 交换缝（理想：dsh 侧独立插件） |
| A9 /provider 向导 | 克制：直切 + 简单表单，数据走 dsh settings 服务 |
| B4 图片附件 | 内部（数据层已正确走 dsh 服务） |
| F1 自定义 JSON 主题 | 内部机制 + 第三方内容包约定 |
| G1 插件宿主 | 克制（⛔ 决策 + 轻接缝验证口） |
| 批次 1–4 / 6–7 其余（C1/C2/C4/C5/C6、D1/D2/A14、B5–B7、A10/A12/A13/A16、E1、F3/F4、E3/E4/G4/G6/G7/A19） | 全部内部（surface 本分） |

---

## 6. 已完成功能回审（2026-08-22）

> 对已落地功能（FEATURE-CHECKLIST 99 ✅ + 0.2–0.3 各批）**反向**应用四判据，
> 检查「已完成但本应独立/下沉」的遗留。方法：sidecar 全量盘点 + 技能分发形态核对 + 疑似项逐条排除。

### 6.1 红线审计：sidecar 全量盘点（P3）

| sidecar | 内容 | 判定 |
|---|---|---|
| `tui-history.json` | 输入历史 | ✅ TUI 私有偏好 |
| `tui-titles.json` | 会话标题缓存 | ✅ 缓存私有，数据源是 dsh `readTitle` 服务 |
| `tui-keymap.txt` | 键位预设 | ✅ TUI 私有偏好 |
| `tui-theme-preset.txt` | 视觉主题预设 | ✅ TUI 私有偏好 |
| `tui-feedback.json` | 回复评价（G44） | ⚠️ **唯一妥协**：理想 = dsh storage 域插件，out-of-tree 不可挂 → 已文档标注待下沉（见 3.3） |

- dsh 共享状态（会话/附件/模型配置/权限/标题本体）：**零 sidecar**，全部走 `ctx.get` 服务 ✅；
- 设置项经 dsh settings 服务 `tui` 命名空间（`installSettingsSection`）✅ —— 正面案例；
- 小整洁（非越权）：TUI 偏好持久化两套并存（enterBehavior 走 settings.yaml，theme/keymap 走 sidecar
  txt），可择机统一收口到 `tui` 命名空间。

### 6.2 唯一例外：tui 操作手册技能 = 自描述能力，随 TUI 插件注册（2026-08-22 修正）

> **修正**：早前本节的「并入外部技能包（symlink 模式）」结论**撤回**——那是本地个人安装方式
> （mcswift-skills 仓库 + symlink），与 TUI 自身无关，不构成参照。事实核对如下。

- **现状（事实）**：tui 操作手册**目前不是由 TUI 插件注册的**。仓库根 `.dsh/skills/tui/` 只是
  项目级文件（dsh 以 project-dsh 源按 cwd 发现，会话 cwd 不在本仓库即失效）；`~/.dsh/skills/tui/`
  是手动副本（非安装产物）。`@mcswift/dsh-tui` 的 cordis.patch.yml / package.json **无任何技能注册行为**。
- **定位（用户拍板，2026-08-22）**：tui 操作手册是**自描述能力**——描述 TUI 自己的操作方式、与
  TUI 版本强绑定。它是**唯一例外**：由 TUI 插件本身注册到 dsh（skill 优先；tool 亦可），
  **不适用**「技能 = agent 生态能力 → 独立技能包」的通用判定（P1 例外化：自描述内容的消费方就是本客户端）。
- **实现缝隙（已核实官方先例与语义）**：
  - 官方先例：`apps/cli/config/agent-presets/cordis/agent.cordis.yml` 以 `- id: skill-filesystem`
    + `config.customSkillDirs: [!!js "…new URL('skills/', baseUrl)…"]` 把**安装单元自带的 skills/
    目录注册进宿主 skill registry**（源注释：注册进 host 层、无需 realm、预设即安装单元）；
  - `!!js` 求值 = `with(ctx) { eval(expr) }`（vendor/loader `config/utils.ts`）：可用
    `ctx.baseUrl`（profile 目录）/`process`，**无 require**（官方因此用 `process.getBuiltinModule`）；
    TUI 侧表达式：`process.getBuiltinModule('node:module').createRequire(ctx.baseUrl).resolve('@mcswift/dsh-tui/package.json')`
    → dirname → `/skills`（依赖 profile/node_modules 解析布局；link: 与发布安装均成立）；
  - restate 语义（`applyEntryPatches`）：同 id 行顶层字段**整体替换**——base 的 skill-filesystem 行
    仅 id+name（无 config），替换后全部字段走 schema 默认值，安全；
  - 效果：`dsh plugin add @mcswift/dsh-tui` 即自带 tui 技能，任意 cwd 可发现（custom 源，扫描序
    介于项目根与用户根之间），内容随 TUI 版本同步（无漂移问题——自描述内容的天然优势）。
- **与 A21 的边界**：A21 的 7 个技能（audit/bug/review/practice/pr_comments/release-notes/vuln-check）
  是 **agent 工作流能力**（非自描述）→ 仍按 §3.2 独立技能包，**不随 TUI 注册**。tui 操作手册是
  **唯一随 TUI 插件注册的技能**。
- **实现规划**：[PLAN-BUNDLED-SKILL.md](PLAN-BUNDLED-SKILL.md)（✅ 已落地 2026-08-22：patch
  `customSkillDirs` 注册 + `skills/tui/SKILL.md` 随包 + E2E 场景 `--only-skills` 验证）。

### 6.3 疑似项复核（均判定内部，不析出）

| 疑似项 | 排除理由 |
|---|---|
| `/status` `/tokens` `/cost` `/doctor` `/context` 等命令面 | 呈现 dsh 状态，surface 本分（P2） |
| `/config` 设置面板（settings.yaml 预览/编辑） | 消费 dsh settings 服务 ✅（P3 正确） |
| `/workspace` `/rename`（fs.rename）、H30 📂 Finder 定位（open -R） | 用户显式轻量 OS 动作，同 shell 工具界（P3：用户文件操作） |
| `/plugins` 能力清单（无 registry 服务的代理视图） | 视图等价物，数据源诚实声明（P2） |
| 品牌 splash / 像素鲸 / 双语文案 | 客户端品牌与 i18n，随包合理（P4 机制） |
| 视觉主题四预设（cc/pi 取官方逐字值） | 机制内部；内容外部化是 F1 的事（P4） |
| trajectory / stats / panels / OSC8 / OSC52 / 鼠标 | P2 全中 |

### 6.4 回审结论

已完成功能**无越权析出项**；红线审计通过（零 dsh 状态 sidecar 冒名）。
**唯一例外 = tui 操作手册技能（自描述能力，应由 TUI 插件注册为 bundled skill，见 6.2）**；
唯一待下沉 = **反馈 sidecar**（3.3 已记录，等 dsh 开放 storage 域）。
四判据在本次回审中自洽，§2–§5 无需调整。
