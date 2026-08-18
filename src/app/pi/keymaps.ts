/**
 * 全局快捷键的 cc/pi 双预设（F4 增强）：把 handleGlobalKey 的按键分支
 * 声明化为动作表，两个预设各持一张键位图，`/keymap [cc|pi]` 与
 * `DSH_TUI_KEYMAP` 切换。Tab 焦点环与 Esc 焦点复位是通用交互，不进预设。
 *
 * 语义来源：cc 预设 = 本仓库既有键位（Claude Code 式：Esc 中断、idle
 * Ctrl+C 退出）；pi 预设 = earendil-works/pi usage.md 的交互语义
 * （Ctrl+C 中断当前轮 / Ctrl+G 外部编辑器撰写 / Ctrl+P 循环模型），
 * 见 PI-GAP-ANALYSIS.md A3/B3/E3。
 * @module dsh-tui-app/app/pi/keymaps
 */

import { matchesKey } from '@earendil-works/pi-tui'

export type KeymapId = 'cc' | 'pi'

/** 预设内可绑定的动作。 */
export type KeyAction =
  | 'interrupt'   // 中断当前轮（busy）
  | 'quit'        // 退出（idle）
  | 'quitCtrlD'   // Ctrl+D 退出（两预设通用）
  | 'sessions'    // 会话列表
  | 'model'       // 模型选择
  | 'permission'  // 权限预设
  | 'palette'     // 命令面板
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
  | 'compose'     // $EDITOR 撰写消息（pi A3）
  | 'swallow'     // 吞掉按键（busy Ctrl+C 在 cc 预设下的语义）

export interface KeymapEntry {
  action: KeyAction
  /**
   * 每个元素按「原始字节/转义序列相等」或 matchesKey 名称命中
   * （如 `'\x1f'`/`'ctrl+/'` 两者其一即可，覆盖 pi 键表的两种命名）。
   */
  keys: string[]
  /** 命中时机：busy = 仅运行中；idle = 仅空闲；缺省 = 任意。 */
  when?: 'busy' | 'idle'
}

export interface Keymap {
  id: KeymapId
  /** /keymap 选项里的显示名。 */
  label: string
  entries: KeymapEntry[]
}

/** cc 预设：本仓库既有键位（Claude Code 式）。 */
export const CC_KEYMAP: Keymap = {
  id: 'cc',
  label: 'cc — Claude Code 风格',
  entries: [
    { action: 'interrupt', keys: ['escape'], when: 'busy' },
    { action: 'quit', keys: ['ctrl+c'], when: 'idle' },
    // busy Ctrl+C 吞掉（不中断、不进编辑器剪贴板语义）——cc 的肌肉记忆。
    { action: 'swallow', keys: ['ctrl+c'], when: 'busy' },
    { action: 'quitCtrlD', keys: ['ctrl+d'] },
    { action: 'sessions', keys: ['ctrl+r'] },
    { action: 'model', keys: ['ctrl+g'] },
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
    { action: 'permission', keys: ['ctrl+p'] },
    { action: 'thinking', keys: ['ctrl+t'] },
  ],
}

/** pi 预设：earendil-works/pi 交互语义（Ctrl+C 中断 / Ctrl+G 撰写 / Ctrl+P 模型）。 */
export const PI_KEYMAP: Keymap = {
  id: 'pi',
  label: 'pi — pi coding-agent 风格',
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

export const KEYMAPS: readonly Keymap[] = [CC_KEYMAP, PI_KEYMAP]

export function isKeymapId(value: string): value is KeymapId {
  return value === 'cc' || value === 'pi'
}

export function keymapById(id: KeymapId): Keymap {
  return id === 'pi' ? PI_KEYMAP : CC_KEYMAP
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
    // matchesKey 的第二个参数是 KeyId 联合；原始字节/转义序列不进键表，
    // 用类型断言走同一匹配入口（运行时对未知名返回 false）。
    if (entry.keys.some(key => data === key || matchesKey(data, key as Parameters<typeof matchesKey>[1]))) return entry.action
  }
  return undefined
}
