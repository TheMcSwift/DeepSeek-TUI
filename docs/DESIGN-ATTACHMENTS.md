# DESIGN-ATTACHMENTS.md — B4 图片附件专项设计文档

> 状态：📐 设计文档（2026-08-22，用户决策「先出设计文档，实现押后」）。
> 来源：[docs/PLAN-ROADMAP.md](PLAN-ROADMAP.md) 阶段 5 · [BACKLOG-FEATURE-GAP.md](BACKLOG-FEATURE-GAP.md) B4。
> 决策史：2026-08-20 用户拍板「B4 做」；缝隙已探明——
> `dsh-attachment-local` 在 dsh-base 组合的 `base/cordis.patch.yml` 已挂载
> （附件服务可用，可走真附件路径）。
> 边界判定（[BOUNDARY-DESIGN.md](BOUNDARY-DESIGN.md) §3.3）：**数据层= dsh 侧插件
> （attachment 域），TUI 只做剪贴板采集 + 输入装饰 + 渲染**——B4 附件的
> 标准答案形态（BOUNDARY §3.3 明文引用）。

---

## 1. 范围

| 项 | 纳入 | 排除 |
|---|---|---|
| 输入 | 剪贴板位图（macOS pbcopy / Wayland / X11 / Win32 原生剪贴板读取路径差异较大） | 拖拽文件（终端无 DnD 协议） |
| 引用 | `[Image #N]` 手牌装饰；图片文件粘贴自动转 `@` 引用（B4 既有约定）+ 文本文件内容自动附加（B3 已落地） | — |
| 渲染 | Kitty 图片协议优先、iTerm2 inline image 后备、都不支持时占位行 | 终端画布尺寸下的缩放裁剪 |
| 存储 | `dsh-attachment-local` 服务（持久化附件库） | 本地临时文件路径泄漏 |

## 2. 数据流（单向，遵守 AGENTS.md）

```
剪贴板位图 / 图片文件路径
  └→ 附件保存：attachment.create/save（dsh 服务，v0 用 shac256 去重）
      └→ composer 装饰：[Image #N]（仅序号占位，不含 base64）
          └→ Enter 提交 → createUserMessage（content 带 image 块或 attachment 引用）
              └→ agent/session 流转（attachment 域随会话持久化）
                  └→ 渲染：Tool 结果/消息内的 image 块 → 协议探测后：
                        Kitty/iTerm2 内嵌 → 终端绘制；否则占位行 `[Image #N · WxH]`
```

**红线**：消息文本**永不含 base64**（B4 约束）；附件 Id 是唯一引用句柄；
fold/视图层不接触附件二进制（渲染层经服务只读取）。

## 3. 交互设计

- **粘贴位图**：composer 内 Ctrl+V 触发剪贴板读取（平台路径先行：macOS
  `pbpaste`/`osascript` 探测；Win32/Wayland 后续迭代），成功 → composer 追加
  `[Image #N]` 占位 + 状态槽 toast「已附加图片 #N」；失败 → toast 错误，不阻塞输入。
- **图片文件粘贴**：粘贴文本若是一条本地图片路径（png/jpg/jpeg/gif/webp 扩展），
  自动转 `@` 引用（B3 路径补全语义）；发送时附件服务附加。
- **占用行显示**：composer 上方无缩略图轨道（终端无 DOM 轨道）——
  VStack 内 `[Image #N]` 装饰行即等价物（dim + accent 边框，Enter 聚焦可查看预览行）。
- **发送后**：assistant/tool 卡片里的 image 块渲染为内嵌图或占位行；
  用户消息气泡显示 `[图片 #N]` 单行（不展开原始图像）。
- **删除**：占位行 Backspace 删除该引用（若已保存先 reconcile 附件记录，P2 后置）。

## 4. 渲染方案（终端图片协议）

| 方案 | 条件 | 实现 |
|---|---|---|
| **Kitty 图形协议**（P1 目标） | env `TERM` 含 `kitty` 或探测 `\x1b_Gi=…\x07` 回显 | 转义序列窗口式绘制（需计算终端 cell 尺寸与缩放；尺寸元数据进占位行） |
| **iTerm2 inline image**（P1 后备） | env `TERM` 含 `iTerm`/`xterm-256color` + `iterm2` 探测 | `\x1b]1337;File=inline=1:…\x07`（base64 内嵌预览——仅渲染管道，不落消息文本） |
| **占位行**（P3 通用降级） | 两者皆无（tmux 无 passthrough / macOS 默认终端） | `[Image #N · WxH · <类型> · ⏎ 预览]`，Enter 打开宿主（`open`/`xdg-open`） |

- 探测时机：启动一次 + 渲染首个 image 前重探（协议回显性探测，1s 超时静默降级）；
- 探测结果缓存于 app（进程级），`/config` 或 `/diagnostics` 不涉及。

## 5. 存储与去重

- 附件经 `dsh-attachment-local` 服务保存（dsh 侧持久化目录/sha256 去重已有）；
  TUI 侧保存前先 `listByHash(hash)` 查重（同图不重复入库）；
- 附件记录的**会话归属**由 dsh attachment 域管理（TUI 不写自有 sidecar——
  附件是 dsh 共享状态，**禁止 tui-*.json 冒名**（BOUNDARY §2.2 红线））。
- 退出/换会话时附件引用随会话流（由 dsh 侧 GC/生命周期策略处理，TUI 不干预）。

## 6. 分期计划

| 期 | 内容 | 验收 |
|---|---|---|
| **P1** | 剪贴板位图采集（macOS 先行）+ 附件保存 + `[Image #N]` 装饰 + 占位行渲染（协议探测框架 + 硬编码占位） | 粘贴位图 → 消息带引用 → 转录占位行；E2E（mock LLM + 位图 fixture） |
| **P2** | Kitty 协议绘制 + iTerm2 后备 + 尺寸缩放 | 真 Kimi/iTerm2 终端实测链路出图 |
| **P3** | 图片文件 `@` 引用附加 + 删除 reconcile + 多图片画廊查询（终端无灯箱——P3 仅收藏/删除） | 图片文件粘贴 → @引用 → 发送附加 |

## 7. 测试策略

- **单测**：占位行渲染（纯函数）+ 装饰序列化（`[Image #N]` 与序号管理）+
  协议探测判定（env/回显的纯函数分支）；
- **PTY E2E**：mock LLM 场景喂位图 fixture（64×64 PNG）→ 断言占位行与
  `[Image #1]` 装饰；协议探测回显适配 FakeTerminal（feedRaw）；
- **手测**：Kitty/iTerm2/Warp 三终端 + tmux 无 passthrough 降级路径。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 剪贴板位图无跨平台统一 API | P1 只做 macOS（`pbpaste`/osascript），其他平台 P3 记录并降级 |
| Kitty/iTerm2 协议在 tmux 无 passthrough | 探测回显失败即占位行 + `❯ 在宿主中打开`（OSC 8） |
| 附件库与消息文本不同步（删除/GC） | P1 只增不删（无 UI 删除路径）；P3 再规划 reconcile 与 GC 对齐 |
| 大图粘贴内存/终端缓冲 | 尺寸上限预检（P1：>10MB 拒绝并提示，web 同款 limits 口径） |

## 9. 与现有功能的交互

- **B3 @ 引用**：图片文件路径走既有 @ 补全（无 autocomplete 变更，仅发送路径的
  附加检测扩展（content 含 image 块））；
- **read_image 占位（G31/FEATURE-CHECKLIST B4）**：已有占位行保留；P1 后 read_image
  结果走同一渲染管道（Kitty/iTerm2/占位）；
- **/export md**：导出时图片引用输出为 `[Image #N]` 文本（不嵌 base64——记录为导出格式限制）。
