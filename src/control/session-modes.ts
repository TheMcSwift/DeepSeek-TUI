/**
 * Shift+Tab 会话模式循环（B8，BACKLOG-CC-PARITY）：默认 → 计划 → 完全访问。
 * 每个模式是 plan/sandbox 两平面的原子组合（仿远程 dsh-TUI 的 sessionModes，
 * 本地没有 sandbox-policy 直接服务访问缝隙，sandbox 平面映射到已有的
 * permissionPresets 切换，approval 随权限预设一体）。
 * 纯函数、零 cordis/pi 依赖（与 fold 同级纪律），可单测。
 * @module dsh-tui-app/control/session-modes
 */

/** 一个会话模式档：哪些平面被触碰（缺省字段 = 该档不改变此平面）。 */
export interface SessionModeSpec {
  /** 稳定 id；也是展示名。 */
  id: string
  /** plan 平面：进入/退出计划模式（`/plan on|off` 命令通道）。 */
  plan?: boolean
  /** sandbox 平面：权限预设目标（permissionPresets 预设名；缺省 = 不改权限）。 */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
}

/**
 * 默认三档循环（数组顺序即 Shift+Tab 循环顺序；index 0 是无标记基础档）。
 * 保守语义：plan 档不动权限（避免 Side effect 超出 CC 原版 Shift+Tab=normal/plan
 * 切换的预期）；full 档带 danger-full-access 确认（复用 switchPreset 的 C4 确认）。
 */
export const DEFAULT_SESSION_MODES: readonly SessionModeSpec[] = [
  { id: 'default', plan: false, sandbox: 'workspace-write' },
  { id: 'plan', plan: true },
  { id: 'full', plan: false, sandbox: 'danger-full-access' },
]

/** 当前模式的下一个档（循环取模；未知 id 视为 default 之前的位置）。 */
export function nextSessionMode(current: string): SessionModeSpec {
  const index = DEFAULT_SESSION_MODES.findIndex(mode => mode.id === current)
  const next = (index < 0 ? DEFAULT_SESSION_MODES.length - 1 : index) + 1
  return DEFAULT_SESSION_MODES[next % DEFAULT_SESSION_MODES.length]
}

/** 模式表是否含该 id（状态行/校验用）。 */
export function isSessionModeId(value: string): boolean {
  return DEFAULT_SESSION_MODES.some(mode => mode.id === value)
}
