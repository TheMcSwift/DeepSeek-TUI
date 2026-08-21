/**
 * 全局快捷键的三预设（cc/pi/opencode）：把 handleGlobalKey 的按键分支
 * 声明化为动作表，每张预设一张键位图，`/keymap` 与 `DSH_TUI_KEYMAP` 切换。
 * Tab 焦点环与 Esc 焦点复位是通用交互，不进预设。
 *
 * 语义来源：cc 预设 = 本仓库既有键位（Claude Code 式：Esc/Ctrl+C 中断、idle
 * Ctrl+C 双按退出（B3）、Ctrl+Enter 打断并发送（B5））；pi 预设 = earendil-works/pi
 * usage.md 的交互语义
 * （Ctrl+C 中断 / Ctrl+G 编辑器撰写 / Ctrl+P 循环模型）；opencode 预设 =
 * OpenCode 默认 keybinds（https://opencode.ai/docs/keybinds/：Esc 中断、
 * Ctrl+C idle 退出 / busy 清空输入、Ctrl+P 命令面板、Ctrl+X leader 键 +
 * 和弦），见 PI-GAP-ANALYSIS.md 与 SETTINGS-WORKSPACE-DESIGN.md。
 * @module dsh-tui-app/app/pi/keymaps
 */

import { matchesKey } from '@earendil-works/pi-tui'

export type KeymapId = 'cc' | 'pi' | 'opencode'

/** 预设内可绑定的动作。 */
export type KeyAction =
  | 'interrupt'   // 中断当前轮（busy）
  | 'interruptSend' // Ctrl+Enter：打断当前回合并立即投递输入（CC 语义）
  | 'quit'        // 退出（idle）
  | 'quitCtrlD'   // Ctrl+D 退出（各预设通用）
  | 'sessions'    // 会话列表
  | 'newSession'  // 原地新会话
  | 'rename'      // 重命名（会话/工作区）
  | 'model'       // 模型选择
  | 'permission'  // 权限预设
  | 'palette'     // 命令面板
  | 'theme'       // 视觉主题预设
  | 'compose'     // $EDITOR 撰写消息
  | 'editInput'   // $EDITOR 编辑当前输入（保存回填，B18）
  | 'export'      // 导出会话日志
  | 'compact'     // 压缩上下文
  | 'exitPlan'    // 退出 plan 模式
  | 'workspace'   // 切换工作目录
  | 'search'      // 转录搜索
  | 'fork'        // 分支新会话
  | 'rate'        // 评价回复
  | 'copy'        // 复制最近回复（OSC52）
  | 'steer'       // Alt+Enter 并入当前轮
  | 'retrieve'    // Alt+Up 取回排队消息
  | 'jobs'        // jobs 折叠/展开
  | 'trajectory'  // 轨迹视图
  | 'fold'        // 折叠旧消息
  | 'thinking'    // thinking 开关
  | 'clearInput'  // 清空输入框（opencode busy Ctrl+C 语义）
  | 'cycleMode'   // Shift+Tab：会话模式循环（默认→计划→完全访问，B8）

export interface KeymapEntry {
  action: KeyAction
  /**
   * 每个元素按「原始字节/转义序列相等」或 matchesKey 名称命中；以
   * `<leader>` 开头的元素是 leader 和弦（先按 leader 键再按该字符），
   * 由 resolveLeaderChord 解析。
   */
  keys: string[]
  /** 命中时机：busy = 仅运行中；idle = 仅空闲；缺省 = 任意。 */
  when?: 'busy' | 'idle'
}

/** 预设驱动的交互画像（广义交互层：同一功能在不同预设下的呈现与操作方式）。 */
export interface InteractionProfile {
  /**
   * 枚举选择的语式：
   * - `inline-cycle`：行内 ←/→ 循环切换值（Claude Code 式，不弹层）；
   * - `list`：单列选择菜单（pi/opencode 的列表风格）。
   */
  enum: 'inline-cycle' | 'list'
  /**
   * 审批/提问卡形态：
   * - `plain`：无边框纯文本 + 数字选择（Claude Code 式）；
   * - `boxed`：圆角卡（pi 风格，现状）；
   * - `centered`：居中弹窗（opencode 风格）。
   */
  card: 'plain' | 'boxed' | 'centered'
  /**
   * 斜杠菜单语式：
   * - `spacious`：内联菜单 + 名称/提示/描述全量（cc 式）；
   * - `compact`：内联菜单仅名称与提示（pi 式）；
   * - `popup`：opencode 式弹层——方角边框（区别于 pi 圆角）+ 标题计数行 +
   *   整行选中态 + 描述列，底栏点出 Ctrl+P 命令面板。上游 OpenCode 的 `/`
   *   suggestions popup 与 `ctrl+p` command_list 是并存的两条入口
   *   （opencode#38043、opencode#38086），故本预设两者都给；
   * - `panel`：不弹内联菜单，命令只走 Ctrl+P 面板（Enter 提交的 `/xxx` 行
   *   仍按目录解析执行）。当前无预设选用，保留给「只要面板」的键位方案。
   */
  slash: 'spacious' | 'compact' | 'popup' | 'panel'
}

export interface Keymap {
  id: KeymapId
  /** /keymap 选项里的显示名。 */
  label: string
  /** leader 键（opencode：ctrl+x）；无 leader 的预设省略。 */
  leader?: string
  /** 交互画像（广义交互层，见 InteractionProfile）。 */
  interaction: InteractionProfile
  entries: KeymapEntry[]
}

/** cc 预设：本仓库既有键位（Claude Code 式）。 */
export const CC_KEYMAP: Keymap = {
  id: 'cc',
  label: 'cc — Claude Code 风格',
  interaction: { enum: 'inline-cycle', card: 'plain', slash: 'spacious' },
  entries: [
    { action: 'interrupt', keys: ['escape'], when: 'busy' },
    // busy Ctrl+C 同样中断（CC 语义：Esc/Ctrl+C 双键中断）。
    { action: 'interrupt', keys: ['ctrl+c'], when: 'busy' },
    // idle Ctrl+C 走 cc 双按退出（runAction 的 quit 分支处理清空/待命）。
    { action: 'quit', keys: ['ctrl+c'], when: 'idle' },
    { action: 'quitCtrlD', keys: ['ctrl+d'] },
    // CC 语义三态投递：Ctrl+Enter = 打断当前回合并立即投递输入。
    { action: 'interruptSend', keys: ['ctrl+enter'] },
    // Shift+Tab：会话模式循环（默认 → 计划 → 完全访问，B8）。
    { action: 'cycleMode', keys: ['shift+tab'] },
    { action: 'sessions', keys: ['ctrl+r'] },
    { action: 'model', keys: ['ctrl+g'] },
    { action: 'palette', keys: ['\x1f', 'ctrl+/'] },
    { action: 'exitPlan', keys: ['ctrl+e'] },
    { action: 'workspace', keys: ['ctrl+w'] },
    { action: 'search', keys: ['\x06', 'ctrl+f'] },
    { action: 'fork', keys: ['\x02', 'ctrl+b'] },
    { action: 'rate', keys: ['\x19', 'ctrl+y'] },
    // B18: cc 预设 Ctrl+X = 用 $EDITOR 编辑当前输入（CC 复刻；复制回复在
    // pi 预设 Ctrl+X 与 opencode <leader>y 保留）。
    { action: 'editInput', keys: ['\x18', 'ctrl+x'] },
    { action: 'steer', keys: ['\x1b\r', 'alt+enter'] },
    { action: 'retrieve', keys: ['\x1b\x1b[A', 'alt+up'] },
    { action: 'jobs', keys: ['\x0f', 'ctrl+o'] },
    { action: 'trajectory', keys: ['\x0c', 'ctrl+l'] },
    { action: 'fold', keys: ['ctrl+k'] },
    { action: 'permission', keys: ['ctrl+p'] },
    { action: 'thinking', keys: ['ctrl+t'] },
  ],
}

/** pi 预设：earendil-works/pi 交互语义（Ctrl+C 中断 / Ctrl+G 撰写 / Ctrl+P 模型）。 */
export const PI_KEYMAP: Keymap = {
  id: 'pi',
  label: 'pi — pi coding-agent 风格',
  interaction: { enum: 'list', card: 'boxed', slash: 'compact' },
  entries: [
    { action: 'interrupt', keys: ['ctrl+c'], when: 'busy' },
    { action: 'quit', keys: ['ctrl+c'], when: 'idle' },
    { action: 'interrupt', keys: ['escape'], when: 'busy' },
    { action: 'quitCtrlD', keys: ['ctrl+d'] },
    { action: 'sessions', keys: ['ctrl+r'] },
    { action: 'compose', keys: ['ctrl+g'] }, // pi A3：外部编辑器撰写长消息
    { action: 'palette', keys: ['\x1f', 'ctrl+/'] },
    { action: 'exitPlan', keys: ['ctrl+e'] },
    { action: 'workspace', keys: ['ctrl+w'] },
    { action: 'search', keys: ['\x06', 'ctrl+f'] },
    { action: 'fork', keys: ['\x02', 'ctrl+b'] },
    { action: 'rate', keys: ['\x19', 'ctrl+y'] },
    { action: 'copy', keys: ['\x18', 'ctrl+x'] },
    { action: 'steer', keys: ['\x1b\r', 'alt+enter'] },
    { action: 'retrieve', keys: ['\x1b\x1b[A', 'alt+up'] },
    { action: 'jobs', keys: ['\x0f', 'ctrl+o'] },
    { action: 'trajectory', keys: ['\x0c', 'ctrl+l'] },
    { action: 'fold', keys: ['ctrl+k'] },
    { action: 'model', keys: ['ctrl+p'] }, // pi E3：Ctrl+P 循环模型（picker 等价）
    { action: 'thinking', keys: ['ctrl+t'] },
  ],
}

/** opencode 预设：OpenCode 默认 keybinds（Ctrl+X leader + 和弦、Ctrl+P 命令面板）。 */
export const OPENCODE_KEYMAP: Keymap = {
  id: 'opencode',
  label: 'opencode — OpenCode 风格',
  leader: 'ctrl+x',
  interaction: { enum: 'list', card: 'centered', slash: 'popup' },
  entries: [
    { action: 'interrupt', keys: ['escape'], when: 'busy' },
    { action: 'quit', keys: ['ctrl+c'], when: 'idle' },
    // opencode 的 input_clear：busy Ctrl+C 清空输入而非中断（中断是 Esc）。
    { action: 'clearInput', keys: ['ctrl+c'], when: 'busy' },
    { action: 'quitCtrlD', keys: ['ctrl+d'] },
    // opencode：ctrl+p = command_list（命令面板）；ctrl+r = session_rename。
    { action: 'palette', keys: ['\x1f', 'ctrl+/', 'ctrl+p'] },
    { action: 'rename', keys: ['ctrl+r'] },
    { action: 'sessions', keys: ['<leader>l'] },
    { action: 'newSession', keys: ['<leader>n'] },
    { action: 'model', keys: ['<leader>m'] },
    { action: 'trajectory', keys: ['\x0c', 'ctrl+l', '<leader>g'] }, // session_timeline
    { action: 'compose', keys: ['<leader>e'] }, // editor_open
    { action: 'theme', keys: ['<leader>t'] }, // theme_list
    { action: 'copy', keys: ['<leader>y'] }, // messages_copy
    { action: 'export', keys: ['<leader>x'] }, // session_export
    { action: 'thinking', keys: ['ctrl+t', '<leader>h'] }, // ctrl+t 保留 + messages_toggle_conceal
    { action: 'compact', keys: ['<leader>c'] }, // session_compact
    { action: 'exitPlan', keys: ['ctrl+e'] },
    { action: 'workspace', keys: ['ctrl+w'] },
    { action: 'search', keys: ['\x06', 'ctrl+f'] },
    { action: 'fork', keys: ['\x02', 'ctrl+b'] },
    { action: 'rate', keys: ['\x19', 'ctrl+y'] },
    { action: 'steer', keys: ['\x1b\r', 'alt+enter'] },
    { action: 'retrieve', keys: ['\x1b\x1b[A', 'alt+up'] },
    { action: 'jobs', keys: ['\x0f', 'ctrl+o'] },
    { action: 'fold', keys: ['ctrl+k'] },
  ],
}

export const KEYMAPS: readonly Keymap[] = [CC_KEYMAP, PI_KEYMAP, OPENCODE_KEYMAP]

export function isKeymapId(value: string): value is KeymapId {
  return value === 'cc' || value === 'pi' || value === 'opencode'
}

export function keymapById(id: KeymapId): Keymap {
  return id === 'pi' ? PI_KEYMAP : id === 'opencode' ? OPENCODE_KEYMAP : CC_KEYMAP
}

/** 普通按键命中（含 matchesKey 名称；`<leader>` 和弦不在这里匹配）。 */
function entryMatches(entry: KeymapEntry, data: string): boolean {
  return entry.keys.some(key => {
    if (key.startsWith('<leader>')) return false
    return data === key || matchesKey(data, key as Parameters<typeof matchesKey>[1])
  })
}

/**
 * 在预设里解析按键动作：按声明序取第一个「键命中且时机匹配」的条目。
 * 时机用 busy 状态过滤，因此同一键可在 busy/idle 两态绑定不同动作
 * （如 pi 预设的 Ctrl+C：busy 中断、idle 退出）。
 */
export function resolveKeyAction(keymap: Keymap, data: string, busy: boolean): KeyAction | undefined {
  for (const entry of keymap.entries) {
    if (entry.when === 'busy' && !busy) continue
    if (entry.when === 'idle' && busy) continue
    if (entryMatches(entry, data)) return entry.action
  }
  return undefined
}

/** 数据是否命中 leader 键（opencode：ctrl+x）。 */
export function isLeaderKey(keymap: Keymap, data: string): boolean {
  const leader = keymap.leader
  if (leader === undefined) return false
  return data === leader || matchesKey(data, leader as Parameters<typeof matchesKey>[1])
}

/** 解析 leader 和弦（先按 leader 再按单字符，opencode 默认 2s 超时）。 */
export function resolveLeaderChord(keymap: Keymap, data: string, busy: boolean): KeyAction | undefined {
  for (const entry of keymap.entries) {
    if (entry.when === 'busy' && !busy) continue
    if (entry.when === 'idle' && busy) continue
    for (const key of entry.keys) {
      if (key.startsWith('<leader>') && key.slice('<leader>'.length) === data) return entry.action
    }
  }
  return undefined
}
